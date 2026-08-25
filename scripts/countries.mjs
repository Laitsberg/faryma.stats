#!/usr/bin/env node
/* ============================================================
   СТРАНЫ ИСПОЛНИТЕЛЕЙ ИЗ MUSICBRAINZ
   ------------------------------------------------------------
   Проходит уникальных исполнителей из data.csv и спрашивает у
   MusicBrainz страну. Результат копится в data/countries.json.

   Прогон долгий: MusicBrainz разрешает один запрос в секунду,
   а исполнителей около четырёх тысяч — это больше часа. Поэтому
   кэш дописывается по ходу дела: прервалось — запусти снова,
   продолжит с того же места. Уже известных не переспрашивает.

     node scripts/countries.mjs                  докачать новых
     node scripts/countries.mjs --limit 50       только 50 штук
     node scripts/countries.mjs --retry-missing  переспросить ненайденных
     node scripts/countries.mjs --min-tracks 2   пропустить одноразовых
     node scripts/countries.mjs --max-minutes 50 остановиться по времени
     node scripts/countries.mjs --recheck        переспросить ненайденных
                                                 после починки запроса

   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARGS = process.argv.slice(2);
const argVal = (name, def) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : def;
};
const hasFlag = name => ARGS.includes(name);

const CSV_PATH  = argVal('--csv', path.join(ROOT, 'data.csv'));
const OUT_PATH  = argVal('--out', path.join(ROOT, 'data', 'countries.json'));
const LIMIT     = +argVal('--limit', Infinity);
const MIN_TRACKS = +argVal('--min-tracks', 1);
const RETRY_MISSING = hasFlag('--retry-missing');
/* Переспросить тех, кого прошлый — более слабый — запрос не нашёл
   вовсе (0 баллов) или нашёл, но без страны. */
const RECHECK = hasFlag('--recheck');
/* Ограничение по времени. Нужно, чтобы скрипт успел завершиться сам и
   вызывающий воркфлоу успел закоммитить накопленное, а не был убит
   по таймауту с потерей несохранённого. */
const MAX_MS = +argVal('--max-minutes', Infinity) * 60000;
const API_ROOT  = process.env.MB_API || 'https://musicbrainz.org/ws/2';

/* MusicBrainz требует внятный User-Agent с контактом — иначе банит */
const UA = 'faryma-stats/1.0 ( https://github.com/Laitsberg/faryma.stats )';

/* Пауза между запросами. Лимит — один запрос в секунду; берём с запасом. */
const DELAY_MS = +(process.env.MB_DELAY || 1100);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- разбор строк берём из того же кода, что и сайт ----------
   чтобы «уникальный исполнитель» здесь и на странице означал одно и то же */
function loadSiteCode() {
  const ctx = vm.createContext({ console, URL });
  for (const f of ['js/config.js', 'js/parse.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

/* ---------- имя для поиска ----------
   «feat.» в названии сбивает поиск: MusicBrainz ищет одного артиста,
   а не связку. Амперсанд наоборот трогать нельзя — «MYTH & ROID»
   это настоящее имя группы. */
function queryName(name) {
  return name
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Запрос ищет и по псевдонимам, а не только по основному имени.
   У японских исполнителей основное имя записано иероглифами
   («澤野弘之»), а латиница лежит в псевдонимах, и точный поиск по
   artist: не находил ни Hiroyuki Sawano, ни Kenshi Yonezu, ни
   ZUTOMAYO — притом что все они в базе есть. */
function queryString(name) {
  const q = name.replace(/["\\]/g, ' ').trim();
  return `artist:"${q}" OR alias:"${q}" OR sortname:"${q}"`;
}

async function fetchArtist(name, attempt = 0) {
  const url = `${API_ROOT}/artist/?query=${encodeURIComponent(queryString(name))}&fmt=json&limit=1`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (e) {
    if (attempt < 3) { await sleep(2000 * (attempt + 1)); return fetchArtist(name, attempt + 1); }
    throw e;
  }
  // 503 — «притормози»; MusicBrainz отдаёт его при превышении лимита
  if (res.status === 503 || res.status === 429) {
    if (attempt < 5) { await sleep(3000 * (attempt + 1)); return fetchArtist(name, attempt + 1); }
    throw new Error('MusicBrainz не отвечает: ' + res.status);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} для «${name}»`);
  const j = await res.json();
  const a = j.artists?.[0];
  if (!a) return { country: null, score: 0 };
  return {
    country: a.country || a.area?.['iso-3166-1-codes']?.[0]
             || a['begin-area']?.['iso-3166-1-codes']?.[0] || null,
    area: a.area?.name || a['begin-area']?.name || null,
    areaId: a.area?.id || a['begin-area']?.id || null,
    score: a.score ?? 0,
    mbid: a.id || null,
    mbName: a.name || null
  };
}

/* ---------- город → страна ----------
   У четверти найденных исполнителей MusicBrainz знает не страну, а
   город или регион: «Ufa», «Boston», «Tokyo», «England». Поднимаемся
   по дереву областей до той, у которой есть код страны. Ответы
   складываем в отдельный кэш: городов куда меньше, чем исполнителей,
   и один и тот же встречается десятки раз. */
async function areaCountry(areaId, areaCache, depth = 0) {
  if (!areaId || depth > 4) return null;
  if (areaCache[areaId] !== undefined) return areaCache[areaId];

  const url = `${API_ROOT}/area/${areaId}?inc=area-rels&fmt=json`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch { return null; }
  if (res.status === 503 || res.status === 429) { await sleep(3000); return null; }
  if (!res.ok) { areaCache[areaId] = null; return null; }
  const j = await res.json();

  const own = j['iso-3166-1-codes']?.[0] || null;
  if (own) { areaCache[areaId] = own; return own; }

  // «part of» в обратную сторону — это и есть объемлющая область
  const up = (j.relations || []).find(x =>
    x.type === 'part of' && x.direction === 'backward' && x.area?.id);
  if (!up) { areaCache[areaId] = null; return null; }

  await sleep(DELAY_MS);
  const parent = await areaCountry(up.area.id, areaCache, depth + 1);
  areaCache[areaId] = parent;
  return parent;
}

/* ---------- сбор исполнителей из архива ---------- */
function collectArtists(ctx) {
  const Papa = createRequire();
  const rows = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'),
    { header: true, skipEmptyLines: 'greedy' }).data;

  const counts = new Map();   // ключ → сколько раз встретился
  const names = [];
  rows.forEach(r => {
    if (!ctx.parseRate(r['Оценка'])) return;      // только разнесённые
    const { artist } = ctx.parseWhat(r['Что']);
    if (!artist) return;
    names.push(artist);
    const k = ctx.nameKey(artist);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const canon = ctx.canonMap(names, ctx.nameKey);
  return [...counts]
    .map(([key, n]) => ({ key, name: canon.get(key), n }))
    .filter(a => a.n >= MIN_TRACKS)
    .sort((a, b) => b.n - a.n);                   // частых спрашиваем первыми
}

function createRequire() {
  // PapaParse лежит в vendor/, подключаем как обычный скрипт
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'papaparse.min.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {}, window: {}, global: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.module.exports?.parse ? sandbox.module.exports
       : sandbox.Papa || sandbox.window.Papa;
}

/* ---------- кэш ---------- */
function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    return j.artists && typeof j.artists === 'object' ? j : { artists: {} };
  } catch { return { artists: {} }; }
}

function saveCache(cache, stats) {
  cache.generated = new Date().toISOString();
  cache.source = 'MusicBrainz';
  cache.note = 'score — уверенность совпадения по версии MusicBrainz, 0–100';
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 1) + '\n');
  if (stats) console.log(`  … сохранено, известно ${Object.keys(cache.artists).length}`);
}

/* ---------- главное ---------- */
const ctx = loadSiteCode();
const artists = collectArtists(ctx);
const cache = loadCache();

const todo = artists.filter(a => {
  const hit = cache.artists[a.key];
  if (!hit) return true;
  if (RETRY_MISSING && !hit.country) return true;
  // после починки запроса имеет смысл переспросить тех, кого старый
  // не нашёл; те, у кого страна уже есть, не трогаются
  if (RECHECK && !hit.country && (!hit.score || hit.areaId || hit.area)) return true;
  return false;
}).slice(0, LIMIT);

console.log(`исполнителей в архиве: ${artists.length}`);
console.log(`уже в кэше:            ${Object.keys(cache.artists).length}`);
console.log(`спросить:              ${todo.length}`);
if (!todo.length) { console.log('нечего докачивать'); process.exit(0); }

const eta = Math.round(todo.length * DELAY_MS / 60000);
console.log(`примерно ${eta} мин при одном запросе в секунду\n`);

const startedAt = Date.now();
const areaCache = cache.areas || (cache.areas = {});
let done = 0, found = 0, failed = 0, ranOut = false;
for (const a of todo) {
  if (Date.now() - startedAt > MAX_MS) {
    ranOut = true;
    console.log(`\nвремя вышло (${Math.round(MAX_MS / 60000)} мин), останавливаюсь на ${done}/${todo.length}`);
    break;
  }
  try {
    const r = await fetchArtist(queryName(a.name));
    // страны нет, но известен город — поднимаемся до страны
    if (!r.country && r.areaId) {
      await sleep(DELAY_MS);
      const c = await areaCountry(r.areaId, areaCache);
      if (c) { r.country = c; r.viaArea = true; }
    }
    cache.artists[a.key] = { name: a.name, tracks: a.n, ...r };
    if (r.country) found++;
  } catch (e) {
    console.error(`  ! ${a.name}: ${e.message}`);
    failed++;
    if (failed > 20) { console.error('слишком много ошибок подряд, останавливаюсь'); break; }
  }
  done++;
  if (done % 25 === 0) {
    console.log(`${done}/${todo.length} · со страной ${found}`);
    saveCache(cache, true);
  }
  await sleep(DELAY_MS);
}

saveCache(cache);
const withCountry = Object.values(cache.artists).filter(x => x.country).length;
console.log(`\nготово: спрошено ${done}, страна нашлась у ${found}`);
console.log(`всего в кэше ${Object.keys(cache.artists).length}, из них со страной ${withCountry}`);
const left = artists.length - Object.keys(cache.artists).length;
if (ranOut || left > 0) console.log(`осталось спросить ${left} — следующий запуск продолжит`);
