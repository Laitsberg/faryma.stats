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
   Сначала точное имя, потом общий поиск: в архиве пишут и
   «Boku no Hero Academia 3rd Season», и просто «Naruto». */
const norm = s => String(s || '').toLowerCase()
  .replace(/[!?.,:;''"`~*\-–—_]/g, ' ').replace(/\s+/g, ' ').trim();

async function findAnime(name) {
  const inc = 'include=animethemes.song.artists';
  let j = await get(`/anime?filter[name]=${encodeURIComponent(name)}&${inc}&page[size]=1`);
  let a = j?.anime?.[0];
  if (a) return { a, how: 'точно' };

  await sleep(DELAY);
  j = await get(`/search?q=${encodeURIComponent(name)}&fields[search]=anime`);
  const list = j?.search?.anime || [];
  const want = norm(name);
  const hit = list.find(x => norm(x.name) === want) || list[0];
  if (!hit) return null;

  await sleep(DELAY);
  const full = await get(`/anime/${encodeURIComponent(hit.slug)}?${inc}`);
  return full?.anime ? { a: full.anime, how: norm(hit.name) === want ? 'поиском' : 'похожее' } : null;
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

const ctx = loadSiteCode();
const sources = collectSources(ctx);
let cache = {};
try { cache = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).sources || {}; } catch {}

const todo = sources.filter(s => {
  const hit = cache[s.name];
  if (!hit) return true;
  if (RETRY && !hit.slug) return true;
  return false;
}).slice(0, LIMIT);

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
    cache[s.name] = r ? { tracks: s.n, how: r.how, ...pack(r.a) } : { tracks: s.n, slug: null };
    if (r) { found++; themes += cache[s.name].themes.length; }
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
