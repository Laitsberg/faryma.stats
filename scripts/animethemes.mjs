#!/usr/bin/env node
/* ============================================================
   КАТАЛОГ ОПЕНИНГОВ И ЭНДИНГОВ ИЗ ANIMETHEMES.MOE
   ------------------------------------------------------------
   Архив знает только то, что уже разнесли. Чтобы показать, чего
   ЕЩЁ НЕ разносили, нужен внешний список: что у тайтла вообще есть.
   animethemes.moe — открытая база сообщества, ключ не нужен.

   Складывает в data/themes.json по одной записи на источник:
   какой тайтл нашёлся и какие у него темы (OP1, ED2, …).

     node scripts/animethemes.mjs --probe          посмотреть API
     node scripts/animethemes.mjs                  докачать новых
     node scripts/animethemes.mjs --limit 200      только 200 штук
     node scripts/animethemes.mjs --retry-missing  переспросить ненайденных
     node scripts/animethemes.mjs --max-minutes 20 остановиться по времени

   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const has = f => ARGS.includes(f);
const val = (f, d) => { const i = ARGS.indexOf(f); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : d; };

const CSV_PATH = val('--csv', path.join(ROOT, 'data.csv'));
const OUT_PATH = val('--out', path.join(ROOT, 'data', 'themes.json'));
const LIMIT    = +val('--limit', Infinity);
const RETRY    = has('--retry-missing');
const RECHECK  = has('--recheck');
const MAX_MS   = +val('--max-minutes', Infinity) * 60000;

const API   = process.env.AT_API || 'https://api.animethemes.moe';
const UA    = 'faryma-stats/1.0 ( https://github.com/Laitsberg/faryma.stats )';
const DELAY = +(process.env.AT_DELAY || 350);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(p, attempt = 0) {
  let res;
  try {
    res = await fetch(API + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch (e) {
    if (attempt < 3) { await sleep(1500 * (attempt + 1)); return get(p, attempt + 1); }
    throw e;
  }
  if (res.status === 429 || res.status === 503) {
    if (attempt < 5) { await sleep(3000 * (attempt + 1)); return get(p, attempt + 1); }
    throw new Error('animethemes не отвечает: ' + res.status);
  }
  if (!res.ok) return null;
  return res.json();
}

/* ---------- разбор берём из кода сайта ---------- */
function loadSiteCode() {
  const ctx = vm.createContext({ console, URL });
  for (const f of ['js/config.js', 'js/parse.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
function papa() {
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'papaparse.min.js'), 'utf8');
  const box = { module: { exports: {} }, exports: {}, window: {}, global: {} };
  vm.createContext(box); vm.runInContext(src, box);
  return box.module.exports?.parse ? box.module.exports : box.Papa || box.window.Papa;
}

/* Аниме-источники архива: те, где в скобках стоит опенинг или эндинг,
   либо колонка «Откуда» говорит «Аниме». */
function collectSources(ctx) {
  const rows = papa().parse(fs.readFileSync(CSV_PATH, 'utf8'),
    { header: true, skipEmptyLines: 'greedy' }).data;
  // Регистр сводим так же, как на сайте: «ULTRAKILL» и «Ultrakill» —
  // одна вселенная, и спрашивать её дважды незачем.
  const canon = ctx.canonMap(
    rows.map(r => ctx.parseSource(r['Что'])).filter(Boolean), ctx.nameKey);

  const counts = new Map();
  rows.forEach(r => {
    if (!ctx.parseRate(r['Оценка'])) return;
    let src = ctx.parseSource(r['Что']);
    if (!src) return;
    src = canon.get(ctx.nameKey(src)) || src;
    const kind = ctx.sourceKind(r['Что']);
    const аниме = kind === 'опенинг' || kind === 'эндинг' ||
                  (r['Откуда'] || '').trim() === 'Аниме';
    if (!аниме) return;
    counts.set(src, (counts.get(src) || 0) + 1);
  });
  return [...counts].map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n);          // частые спрашиваем первыми
}

/* ---------- поиск тайтла ----------
   В архиве тайтлы пишут по-английски («Your Lie in April»), а у
   animethemes основное имя — ромадзи («Shigatsu wa Kimi no Uso»).
   Поэтому точное совпадение по имени срабатывает редко, а общий поиск
   раньше брал просто первый результат — и «Arcane» превращался в
   «Kami no Tou». Теперь берём кандидатов вместе с их синонимами
   (английские названия лежат именно там) и считаем похожесть; если
   ни один кандидат не похож, честно записываем «не нашлось». */

const norm = s => String(s || '').toLowerCase()
  .replace(/[\[\]!?.,:;''"`~*\-–—_/\\+&#@()]/g, ' ')
  .replace(/\s+/g, ' ').trim();

const ROMAN = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10 };

/* Номер сезона: «2nd Season», «Season 2», «II», «S2», «2nd Stage».
   Отсутствие номера считаем первым сезоном. */
function seasonOf(name) {
  const t = norm(name);
  let m = t.match(/(\d+)\s*(?:nd|rd|th|st)?\s+(?:season|stage|shou)\b/) ||
          t.match(/\b(?:season|stage)\s*(\d+)\b/) ||
          t.match(/\bs(\d)\b/);
  if (m) return +m[1];
  m = t.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/);
  if (m) return ROMAN[m[1]];
  m = t.match(/\s(\d)\s*$/);
  if (m) return +m[1];
  return 1;
}
function partOf(name) {
  const m = norm(name).match(/\bpart\s*(\d+)\b/);
  return m ? +m[1] : 0;
}

/* Слова, которые ничего не различают: они есть у половины тайтлов. */
const STOP = new Set(['the','a','an','tv','movie','season','part','no','wa','ni','to','of','and','2nd','3rd','4th','5th','1st','hen','shou']);
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));

/* Коэффициент Дайса по словам: 1 — одно и то же, 0 — ничего общего. */
function dice(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return 2 * common / (A.size + B.size);
}

/* Похожесть запроса на кандидата: лучшее из основного имени и синонимов,
   со штрафом за несовпадение сезона или части. */
function score(query, cand) {
  const names = [cand.name, ...(cand.animesynonyms || []).map(x => x.text)].filter(Boolean);
  let best = 0;
  for (const n of names) best = Math.max(best, norm(n) === norm(query) ? 1 : dice(query, n));
  const seasonOk = names.some(n => seasonOf(n) === seasonOf(query));
  const partOk   = names.some(n => partOf(n)   === partOf(query));
  if (!seasonOk) best *= 0.45;
  if (!partOk)   best *= 0.6;
  return best;
}

const MIN_SCORE = +val('--min-score', 0.5);

async function findAnime(name) {
  const inc = 'include=animethemes.song.artists';

  // 1. точное имя
  let j = await get(`/anime?filter[name]=${encodeURIComponent(name)}&${inc}&page[size]=1`);
  let a = j?.anime?.[0];
  if (a) return { a, how: 'точно', score: 1 };

  // 2. общий поиск — кандидаты приходят вместе с синонимами
  await sleep(DELAY);
  j = await get(`/search?q=${encodeURIComponent(name)}&fields[search]=anime&include[anime]=animesynonyms`);
  const list = (j?.search?.anime || []).slice(0, 6);
  if (!list.length) return null;

  let hit = null, best = 0;
  for (const c of list) { const s = score(name, c); if (s > best) { best = s; hit = c; } }
  if (!hit || best < MIN_SCORE) return { miss: true, best, name: hit?.name || '' };

  await sleep(DELAY);
  const full = await get(`/anime/${encodeURIComponent(hit.slug)}?${inc}`);
  if (!full?.anime) return null;
  return { a: full.anime, how: best >= 0.99 ? 'точно' : 'похоже', score: +best.toFixed(2) };
}

function pack(a) {
  return {
    slug: a.slug, name: a.name, year: a.year ?? null, season: a.season ?? null,
    themes: (a.animethemes || []).map(t => ({
      t: t.type || '', s: t.slug || '', seq: t.sequence ?? null,
      title: t.song?.title || '',
      artists: (t.song?.artists || []).map(x => x.name).filter(Boolean)
    })).filter(t => t.title || t.s)
  };
}

/* ---------- главное ---------- */
if (has('--probe')) {
  const q = val('--q', 'Your Lie in April');
  for (const p of [
    `/animesynonym?filter[text]=${encodeURIComponent(q)}&include=anime`,
    `/anime?filter[name]=${encodeURIComponent(q)}&include=animesynonyms&page[size]=2`,
    `/search?q=${encodeURIComponent(q)}&fields[search]=anime&include[anime]=animesynonyms`
  ]) {
    console.log('\n=== ' + p);
    const j = await get(p);
    console.log(JSON.stringify(j, null, 1).slice(0, 2500));
    await sleep(DELAY);
  }
  process.exit(0);
}

/* --try «имя,имя,…» — посмотреть, кого и с каким счётом находит поиск */
if (has('--try')) {
  for (const name of val('--try', '').split('|')) {
    if (!name.trim()) continue;
    const j = await get(`/search?q=${encodeURIComponent(name)}&fields[search]=anime&include[anime]=animesynonyms`);
    const list = (j?.search?.anime || []).slice(0, 6);
    console.log(`\n${name}  (сезон ${seasonOf(name)})`);
    list.map(c => [score(name, c), c]).sort((a, b) => b[0] - a[0])
      .forEach(([s, c]) => console.log(`  ${s.toFixed(2)}  ${c.name}   [${(c.animesynonyms||[]).map(x=>x.text).slice(0,3).join(' | ')}]`));
    await sleep(DELAY);
  }
  process.exit(0);
}

const ctx = loadSiteCode();
const sources = collectSources(ctx);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).sources || {}; } catch {}

// Записи без поля score сделаны старым поиском, который брал первый
// результат подряд. Им доверять нельзя — при --recheck спрашиваем заново.
const todo = sources.filter(s => {
  const hit = cache[s.name];
  if (!hit) return true;
  if (RECHECK && hit.score === undefined) return true;
  if (RETRY && !hit.slug) return true;
  return false;
}).slice(0, LIMIT);

// Названия источников со временем чистятся, и в кэше остаются ключи,
// которых в архиве больше нет. Выкидываем.
const alive = new Set(sources.map(s => s.name));
let dropped = 0;
for (const k of Object.keys(cache)) if (!alive.has(k)) { delete cache[k]; dropped++; }
if (dropped) console.log(`выкинул устаревших ключей:  ${dropped}`);

console.log(`аниме-источников в архиве: ${sources.length}`);
console.log(`уже в кэше:                ${Object.keys(cache).length}`);
console.log(`спросить:                  ${todo.length}`);
if (!todo.length) { console.log('нечего докачивать'); process.exit(0); }

const save = () => {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generated: new Date().toISOString(),
    source: 'animethemes.moe',
    note: 'how — как нашёлся тайтл: точно / поиском / похожее',
    sources: cache
  }, null, 1) + '\n');
};

const started = Date.now();
let done = 0, found = 0, themes = 0, fails = 0;
for (const s of todo) {
  if (Date.now() - started > MAX_MS) {
    console.log(`\nвремя вышло, останавливаюсь на ${done}/${todo.length}`);
    break;
  }
  try {
    const r = await findAnime(s.name);
    if (r && r.a) {
      cache[s.name] = { tracks: s.n, how: r.how, score: r.score, ...pack(r.a) };
      found++; themes += cache[s.name].themes.length;
    } else {
      cache[s.name] = { tracks: s.n, slug: null,
        near: r?.miss ? r.name : '', score: r?.miss ? +r.best.toFixed(2) : 0 };
    }
  } catch (e) {
    console.error(`  ! ${s.name}: ${e.message}`);
    if (++fails > 20) { console.error('слишком много ошибок, останавливаюсь'); break; }
  }
  done++;
  if (done % 50 === 0) { console.log(`${done}/${todo.length} · нашлось ${found}, тем ${themes}`); save(); }
  await sleep(DELAY);
}

save();
const всего = Object.values(cache);
console.log(`\nготово: спрошено ${done}, нашлось ${found}`);
console.log(`в кэше ${всего.length} источников, с тайтлом ${всего.filter(x => x.slug).length}`);
const how = {};
всего.forEach(x => { if (x.how) how[x.how] = (how[x.how] || 0) + 1; });
console.log('как нашлись:', how);
