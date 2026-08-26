#!/usr/bin/env node
/* ============================================================
   КАТАЛОГ ОПЕНИНГОВ И ЭНДИНГОВ ИЗ ANIMETHEMES.MOE
   ------------------------------------------------------------
   Архив знает только то, что уже разнесли. Чтобы показать, чего
   ЕЩЁ НЕ разносили, нужен внешний список: что у тайтла вообще есть.
   animethemes.moe — открытая база сообщества, ключ не нужен.

   Название тайтла сначала опознаём через Шикимори: он понимает и
   русские написания, и вольные, а отдаёт номер MyAnimeList. По этому
   номеру animethemes находит тайтл точно — число с числом, без
   сравнения текста. Если Шикимори тайтла не знает, остаётся запасной
   путь: поиск по имени с порогом похожести.

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

/* ---------- Шикимори ----------
   Отдаёт и английское имя, и русское, и номер MAL (это и есть его id).
   Просит представляться — User-Agent тот же, что и для animethemes. */
const SHIKI = process.env.SHIKI_API || 'https://shikimori.one/api';

async function shikiSearch(q, attempt = 0) {
  let res;
  try {
    res = await fetch(`${SHIKI}/animes?limit=8&search=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  } catch (e) {
    if (attempt < 3) { await sleep(1500 * (attempt + 1)); return shikiSearch(q, attempt + 1); }
    return [];
  }
  if (res.status === 429 || res.status === 503) {
    if (attempt < 5) { await sleep(3000 * (attempt + 1)); return shikiSearch(q, attempt + 1); }
    return [];
  }
  if (!res.ok) return [];
  const j = await res.json().catch(() => null);
  return Array.isArray(j) ? j : [];
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
    const аниме = (kind === 'опенинг' || kind === 'эндинг' ||
                   (r['Откуда'] || '').trim() === 'Аниме') &&
                  ctx.isAnimeSource(src);
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

/* Всё, что не буква и не цифра, — разделитель. Иначе «Lucky☆Star» и
   «Kirarin☆Revolution» остаются одним нечитаемым словом и не находятся
   вовсе: звёздочки в японских названиях не редкость. */
const norm = s => String(s || '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* Ромадзи пишут по-разному: «Haikyuu» и «Haikyu», «Ookami» и «Okami»,
   «Shounen» и «Shonen». Схлопываем удвоенные гласные и «ou» — тогда
   написания сходятся. Делаем это с обеими сторонами сразу, так что
   правило не может развести то, что раньше сходилось. */
const fold = w => w.replace(/ou/g, 'o').replace(/(\p{L})\1+/gu, '$1');

const ROMAN = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10 };
// «Second Season» пишут и словом, и цифрой — для нас это одно и то же
const ORD = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7 };

/* Разбираем название на слова и номер сезона. Номер пишут по-всякому —
   «2nd Season», «Season 2», «II», «S2» — и сравнивать его надо отдельно
   от слов: иначе «Haikyu!! Second Season» радостно находит
   «Monogatari Series: Second Season» по общему слову «season». */
function pull(name) {
  let t = ' ' + norm(name) + ' ';
  let season = 0, part = 0;
  const take = (re, i = 1) => {
    const m = t.match(re);
    if (m) { t = t.replace(re, ' '); return +m[i] || ROMAN[m[i]] || ORD[m[i]] || 0; }
    return 0;
  };
  season = take(/\b(\d+)\s*(?:nd|rd|th|st)?\s+(?:season|stage)\b/) ||
           take(/\b(first|second|third|fourth|fifth|sixth|seventh)\s+(?:season|stage|series)\b/) ||
           take(/\b(?:season|stage)\s*(\d+)\b/) ||
           take(/\bs(\d)\b/) ||
           take(/\s(ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/);
  part = take(/\bpart\s*(\d+)\b/);
  return { words: t.replace(/\s+/g, ' ').trim(), season: season || 1, part };
}

/* Слова, которые есть у половины тайтлов и ничего не различают. */
const STOP = new Set(['the','a','an','tv','movie','of','and','no','wa','ni','to','season','part']);
const words = t => t.split(' ').filter(w => w && !STOP.has(w)).map(fold);

/* Похожесть двух названий: коэффициент Дайса по словам (1 — то же самое,
   0 — ничего общего), приглушённый долей слов запроса, которых у
   кандидата нет. Без этого «My Hero Academia: You're Next» уверенно
   находило просто «My Hero Academia»: четыре слова из шести совпали. */
function dice(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  const d = 2 * common / (A.size + B.size);
  return d * (0.5 + 0.5 * common / A.size);
}

/* Похожесть запроса на кандидата: лучшее из всех его написаний.
   Английские названия у animethemes лежат в синонимах, у Шикимори —
   рядом с русским, поэтому «Your Lie in April» и находит
   «Shigatsu wa Kimi no Uso».

   Сезон считаем по всему набору написаний, а не по каждому отдельно:
   сиквелы часто названы без номера («K-On!!», «Made in Abyss:
   Retsujitsu no Ougonkyou»), но номер всплывает в русском имени или в
   синониме. Достаточно, чтобы нужный сезон нашёлся хоть в одном. */
function score(query, cand) {
  return scoreNames(query, [cand.name, ...(cand.animesynonyms || []).map(x => x.text)]);
}

function scoreNames(query, names) {
  const q = pull(query);
  const cs = names.filter(Boolean).map(pull);
  if (!cs.length) return 0;

  let d = 0;
  for (const c of cs) d = Math.max(d, dice(q.words, c.words));

  if (!cs.some(c => c.season === q.season))
    // кандидат объявляет сезон старше нужного — почти наверняка мимо;
    // не объявляет вовсе — может быть и сиквелом без номера
    d *= cs.some(c => c.season > q.season) ? 0.45 : 0.7;
  if (!cs.some(c => c.part === q.part)) d *= 0.6;
  return d;
}

const MIN_SCORE = +val('--min-score', 0.6);
/* Версия сопоставлялки. Когда правила сравнения меняются, старым
   записям верить нельзя — при --recheck они спрашиваются заново. */
const MATCHER_V = 3;

async function search(q) {
  const j = await get(`/search?q=${encodeURIComponent(q)}&fields[search]=anime&include[anime]=animesynonyms`);
  return (j?.search?.anime || []).slice(0, 8);
}

/* Из «Re:Zero … 3rd Season» делаем «Re:Zero …»: поиск animethemes
   спотыкается о хвосты вроде «4th Season and 5th Season», а по голому
   названию находит всю франшизу, и нужный сезон уже выбираем сами. */
function baseName(name) {
  const t = name.replace(/\s+(?:\d+(?:nd|rd|th|st)?\s+(?:Season|Stage)|(?:Season|Stage)\s*\d+|Part\s*\d+|and\s+\d+(?:nd|rd|th|st)?\s+Season)\s*/gi, ' ')
                .replace(/\s+/g, ' ').trim();
  return t && t !== name ? t : '';
}

function best(query, list) {
  let hit = null, top = -1;
  for (const c of list) {
    const s = score(query, c);
    // при равном счёте берём того, у кого совпало основное имя,
    // а потом более ранний год: «Fairy Tail» — это оригинал 2009-го
    const tie = (norm(c.name) === norm(query) ? 0.02 : 0) - (c.year || 3000) / 1e6;
    if (s + tie > top) { top = s + tie; hit = c; best.score = s; }
  }
  return hit ? { hit, s: best.score } : null;
}

/* Тайтл по номеру MyAnimeList. Здесь уже никакой похожести —
   у animethemes для каждого тайтла записаны ссылки на внешние базы. */
async function byMal(id) {
  const j = await get(`/anime?filter[has]=resources&filter[site]=MyAnimeList` +
    `&filter[external_id]=${id}&include=animethemes.song.artists&page[size]=1`);
  return j?.anime?.[0] || null;
}

/* Запасной путь — Шикимори. У него в имени только ромадзи, английского
   названия нет вовсе, зато есть русское: «Ванпанчмен», «Дандадан»,
   «Дневник будущего». Такие источники у нас есть (19 штук), и по
   animethemes они не находятся никак. Шикимори отдаёт номер MAL, а по
   номеру animethemes находит тайтл точно. */
async function viaShikimori(name) {
  const list = await shikiSearch(name);
  if (!list.length) return null;
  let hit = null, top = 0;
  for (const c of list) {
    const s = scoreNames(name, [c.name, c.russian]);
    if (s > top) { top = s; hit = c; }
  }
  if (!hit || top < MIN_SCORE) return null;
  await sleep(DELAY);
  const a = await byMal(hit.id);
  return a ? { a, how: 'по номеру MAL', score: +top.toFixed(2), mal: hit.id, shiki: hit.name } : null;
}

async function findAnime(name) {
  const inc = 'include=animethemes.song.artists';

  // 1. точное имя
  const j = await get(`/anime?filter[name]=${encodeURIComponent(name)}&${inc}&page[size]=1`);
  if (j?.anime?.[0]) return { a: j.anime[0], how: 'точно', score: 1 };

  // 2. общий поиск, при неудаче — по названию без номера сезона.
  //    Английские названия у animethemes лежат в синонимах, а в архиве
  //    пишут именно по-английски, так что это основной путь.
  await sleep(DELAY);
  let r = best(name, await search(name));
  const base = baseName(name);
  if ((!r || r.s < MIN_SCORE) && base) {
    await sleep(DELAY);
    const r2 = best(name, await search(base));
    if (r2 && (!r || r2.s > r.s)) r = r2;
  }

  if (r && r.s >= MIN_SCORE) {
    await sleep(DELAY);
    const full = await get(`/anime/${encodeURIComponent(r.hit.slug)}?${inc}`);
    if (full?.anime)
      return { a: full.anime, how: r.s >= 0.99 ? 'точно' : 'похоже', score: +r.s.toFixed(2) };
  }

  // 3. не набрали порог — спрашиваем Шикимори
  await sleep(DELAY);
  const viaShiki = await viaShikimori(name);
  if (viaShiki) return viaShiki;

  return r ? { miss: true, best: r.s, name: r.hit.name } : null;
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
  console.log('=== ШИКИМОРИ: поиск «' + q + '»');
  try {
    const r = await fetch('https://shikimori.one/api/animes?limit=5&search=' + encodeURIComponent(q),
      { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    console.log('статус', r.status);
    const j = await r.json();
    console.log(JSON.stringify(j, null, 1).slice(0, 1800));
  } catch (e) { console.log('не вышло:', e.message); }

  console.log('\n=== ANIMETHEMES: тайтл по номеру MAL');
  for (const p of [
    '/resource?filter[site]=MyAnimeList&filter[external_id]=21&include=anime',
    '/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=21&page[size]=2',
    '/anime?filter[name]=One%20Piece&include=resources&page[size]=1'
  ]) {
    console.log('\n--- ' + p);
    const j = await get(p);
    console.log(JSON.stringify(j, null, 1).slice(0, 1600));
    await sleep(DELAY);
  }
  process.exit(0);
}

/* --tryshiki «имя|имя» — посмотреть, что отвечает Шикимори и находится
   ли этот номер у animethemes */
if (has('--tryshiki')) {
  for (const name of val('--tryshiki', '').split('|')) {
    if (!name.trim()) continue;
    const list = await shikiSearch(name);
    console.log(`\n${name}`);
    if (!list.length) { console.log('  Шикимори ничего не знает'); await sleep(DELAY); continue; }
    const rated = list.map(c => [scoreNames(name, [c.name, c.russian]), c])
      .sort((a, b) => b[0] - a[0]);
    for (const [sc, c] of rated.slice(0, 4))
      console.log(`  ${sc.toFixed(2)}  ${c.name}  /  ${c.russian}  [${c.kind} ${c.aired_on || ''}] id=${c.id}`);
    const [top, hit] = rated[0];
    if (top >= MIN_SCORE) {
      await sleep(DELAY);
      const a = await byMal(hit.id);
      console.log('  → у animethemes: ' + (a ? `${a.name}, тем ${(a.animethemes || []).length}` : 'нет такого номера'));
    } else console.log('  → ниже порога, пойдём поиском по имени');
    await sleep(DELAY);
  }
  process.exit(0);
}

/* --try «имя,имя,…» — посмотреть, кого и с каким счётом находит поиск */
if (has('--try')) {
  for (const name of val('--try', '').split('|')) {
    if (!name.trim()) continue;
    let list = await search(name);
    let src = 'поиск';
    if ((best(name, list)?.s ?? 0) < MIN_SCORE && baseName(name)) {
      await sleep(DELAY);
      list = await search(baseName(name)); src = 'запасной поиск «' + baseName(name) + '»';
    }
    console.log(`\n${name}   → ${JSON.stringify(pull(name))}   [${src}]`);
    list.map(c => [score(name, c), c]).sort((a, b) => b[0] - a[0]).slice(0, 5)
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
  if (RECHECK && hit.v !== MATCHER_V) return true;
  if (RETRY && !hit.slug) return true;
  return false;
}).slice(0, LIMIT);

// Названия источников со временем чистятся, и в кэше остаются ключи,
// которых в архиве больше нет. Выкидываем.
const alive = new Set(sources.map(s => s.name));
let dropped = 0;
for (const k of Object.keys(cache)) if (!alive.has(k)) { delete cache[k]; dropped++; }
// сюда же попадают источники, которые оказались не аниме
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
      cache[s.name] = { tracks: s.n, v: MATCHER_V, how: r.how, score: r.score,
                        mal: r.mal || null, ...pack(r.a) };
      found++; themes += cache[s.name].themes.length;
    } else {
      cache[s.name] = { tracks: s.n, v: MATCHER_V, slug: null,
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
