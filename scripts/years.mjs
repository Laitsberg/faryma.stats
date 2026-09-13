#!/usr/bin/env node
/* ============================================================
   ГОДА ВЫПУСКА ТРЕКОВ ИЗ MUSICBRAINZ
   ------------------------------------------------------------
   Сосед countries.mjs, только спрашивает не про исполнителя, а про
   саму песню: у записи в MusicBrainz есть дата первого выпуска.
   Результат копится в data/years.json.

   Прогон долгий: MusicBrainz разрешает один запрос в секунду, а
   уникальных песен в архиве около шести тысяч — это часа два.
   Поэтому кэш дописывается по ходу: прервалось — запусти снова,
   продолжит с того же места. Уже известных не переспрашивает.

     node scripts/years.mjs                  докачать новых
     node scripts/years.mjs --limit 50       только 50 штук
     node scripts/years.mjs --retry-missing  переспросить ненайденных
     node scripts/years.mjs --recheck        переспросить после починки
                                             правил совпадения
     node scripts/years.mjs --min-tracks 2   пропустить одноразовых
     node scripts/years.mjs --max-minutes 50 остановиться по времени

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

const CSV_PATH = argVal('--csv', path.join(ROOT, 'data.csv'));
const OUT_PATH = argVal('--out', path.join(ROOT, 'data', 'years.json'));
const LIMIT = +argVal('--limit', Infinity);
const MIN_TRACKS = +argVal('--min-tracks', 1);
const RETRY_MISSING = hasFlag('--retry-missing');
/* Переспросить тех, чей ответ получен по прежним правилам совпадения */
const RECHECK = hasFlag('--recheck');
/* Пощупать API и выйти: несколько мелких запросов с печатью кода и
   тела. Нужен, когда Spotify отвечает голым «Forbidden» и по нему не
   отличить недостающую галочку в приложении от чего-то другого. */
const PROBE = hasFlag('--probe');
/* Ограничение по времени: скрипт должен остановиться сам, чтобы
   воркфлоу успел закоммитить накопленное, а не был убит по таймауту. */
const MAX_MS = +argVal('--max-minutes', Infinity) * 60000;
const API_ROOT = process.env.MB_API || 'https://musicbrainz.org/ws/2';

/* Источник дат. Spotify лучше во всём, что важно этому архиву: у 934
   треков ссылка ведёт прямо на запись, и год берётся без угадывания, а
   поиск понимает ромадзи — то, на чём MusicBrainz и сломался. Нужен
   бесплатный ключ приложения: SPOTIFY_CLIENT_ID и SPOTIFY_CLIENT_SECRET. */
const SOURCE = argVal('--source', process.env.SPOTIFY_CLIENT_ID ? 'spotify' : 'musicbrainz');
const SP_API = process.env.SP_API || 'https://api.spotify.com/v1';
const SP_TOKEN_URL = process.env.SP_TOKEN_URL || 'https://accounts.spotify.com/api/token';
const SP_DELAY = +(process.env.SP_DELAY || 120);

const UA = 'faryma-stats/1.0 ( https://github.com/Laitsberg/faryma.stats )';
const DELAY_MS = +(process.env.MB_DELAY || 1100);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Ниже этого совпадению не верим. 84 — это «название с хвостом плюс
   исполнитель в кредите»; страница показывает год от 90, так что
   пограничные ответы в кэш попадают, но на витрину не выходят. */
const ПОРОГ = 84;

/* Версия правил совпадения. Растёт, когда меняется логика отбора:
   по ней --recheck понимает, кого стоит переспросить заново. */
const ВЕРСИЯ = 3;

const ГОД_ОТ = 1900;
const ГОД_ДО = new Date().getFullYear() + 1;

/* ---------- разбор строк берём из того же кода, что и сайт ---------- */
function loadSiteCode() {
  const ctx = vm.createContext({ console, URL });
  for (const f of ['js/config.js', 'js/aliases.js', 'js/parse.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

/* ---------- ключ песни ----------
   Скобки в конце названия — это про конкретную запись, а не про
   песню: «Usseewa (Live)», «Usseewa (THE FIRST TAKE)» и просто
   «Usseewa» вышли в один год. Схлопываем их в один ключ — и запрос
   один, и в кэше не три строчки вместо одной.
   ВАЖНО: ровно эта же функция живёт в baza-trekov.html. Разойдутся —
   страница перестанет находить года. */
function чистоеНазвание(title) {
  return String(title || '')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function ключГода(nameKey, artist, title) {
  return nameKey(artist) + '|' + nameKey(чистоеНазвание(title));
}

/* ---------- имя и название для запроса ----------
   «feat.» сбивает поиск: MusicBrainz ищет одного артиста, а не
   связку. Амперсанд не трогаем — «MYTH & ROID» настоящее имя. */
function queryName(name) {
  return name
    .replace(/\s+(feat\.?|ft\.?|featuring|vs\.?|x)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/* Люценовские спецсимволы в кавычках всё равно ломают разбор запроса */
const экран = s => String(s).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();

/* Для сравнения: только буквы и цифры, регистр не важен. «Kick Back»
   и «KICKBACK» — одно название, «Ussewa» и «Usseewa» — уже нет. */
const срав = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function годИз(s) {
  const m = String(s || '').match(/^(\d{4})/);
  if (!m) return null;
  const y = +m[1];
  return y >= ГОД_ОТ && y <= ГОД_ДО ? y : null;
}

/* Год записи: у самой записи, а если его нет — самый ранний по
   выпускам, в которые она попала. */
function годЗаписи(rec) {
  const года = [];
  const свой = годИз(rec['first-release-date']);
  if (свой) года.push(свой);
  for (const rel of rec.releases || []) {
    /* Обе даты, а не первая попавшаяся: у выпуска стоит год издания
       (сборник 2001-го), а у группы выпусков — год, когда песня
       вышла впервые (1998-й). Нужен самый ранний. */
    const издание = годИз(rel.date);
    const впервые = годИз(rel['release-group']?.['first-release-date']);
    if (издание) года.push(издание);
    if (впервые) года.push(впервые);
  }
  return года.length ? Math.min(...года) : null;
}

/* ---------- насколько ответ похож на то, что спрашивали ----------
   MusicBrainz почти всем кандидатам ставит 100, поэтому уверенность
   считаем сами: точно совпало название и исполнитель — 100, исполнитель
   совпал частично (feat., сокращение) — 92, иначе ответ ненадёжный. */
function уверенность(rec, artist, title) {
  const нет = { score: 0, как: '' };
  const тВопрос = срав(title), тОтвет = срав(rec.title);
  if (!тВопрос || !тОтвет) return нет;
  /* Точное совпадение — лучший случай. Но у одной из сторон бывает
     хвост, которого нет у другой: в архиве «Kaze ni Nare», в
     MusicBrainz «Kaze ni Nare - Live Edition». Короткие названия так
     сравнивать нельзя: «Go» найдётся внутри «Gone» и «Golden». */
  const точно = тОтвет === тВопрос;
  const краем = !точно && Math.min(тОтвет.length, тВопрос.length) >= 8 &&
                (тОтвет.startsWith(тВопрос) || тВопрос.startsWith(тОтвет));

  const аВопрос = срав(artist);
  const кредиты = (rec['artist-credit'] || []).map(c => срав(c.name || c.artist?.name));
  const целиком = срав((rec['artist-credit'] || [])
    .map(c => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join(''));

  const исполнитель =
    (кредиты.includes(аВопрос) || целиком === аВопрос) ? 100
    : кредиты.some(k => k && (k.includes(аВопрос) || аВопрос.includes(k))) ? 92
    : (целиком.includes(аВопрос) || аВопрос.includes(целиком)) ? 92
    : 0;
  if (!исполнитель) return нет;

  if (точно) return { score: исполнитель, как: 'название' };
  if (краем)  return { score: исполнитель - 8, как: 'хвост' };

  /* Название не совпало буквой в букву — и это норма для японских
     песен: в архиве ромадзи («Usseewa»), а в MusicBrainz оригинал
     («うっせぇわ»). Раньше такие записи выбрасывались, и у песни
     оставалась одна-единственная запись с латинским названием —
     обычно свежая. Так «Usseewa» 2020 года и получила 2025-й.
     Название мы уже задали в самом запросе, поиск умеет искать по
     псевдонимам, так что высокий балл MusicBrainz при точно
     совпавшем исполнителе — достаточное основание. */
  if ((rec.score ?? 0) >= 95 && исполнитель === 100)
    return { score: 91, как: 'псевдоним' };
  return нет;
}

async function fetchYear(artist, title, attempt = 0) {
  /* Ищем имя тремя полями сразу. artist — это подпись под записью
     целиком («Ado feat. Кто-то»), artistname и creditname — отдельные
     участники. У countries.mjs та же беда решена псевдонимами: в
     MusicBrainz японцы записаны иероглифами, а латиница лежит рядом. */
  const имя = экран(queryName(artist));
  const q = `recording:"${экран(title)}" AND (artist:"${имя}"` +
            ` OR artistname:"${имя}" OR creditname:"${имя}")`;
  const url = `${API_ROOT}/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=25`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (e) {
    if (attempt < 3) { await sleep(2000 * (attempt + 1)); return fetchYear(artist, title, attempt + 1); }
    throw e;
  }
  if (res.status === 503 || res.status === 429) {
    if (attempt < 5) { await sleep(3000 * (attempt + 1)); return fetchYear(artist, title, attempt + 1); }
    throw new Error('MusicBrainz не отвечает: ' + res.status);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} для «${artist} — ${title}»`);

  const j = await res.json();
  const свои = (j.recordings || [])
    .map(r => ({ rec: r, ...уверенность(r, artist, title), year: годЗаписи(r) }))
    .filter(x => x.score >= ПОРОГ && x.year);

  if (!свои.length) return { year: null, score: 0, v: ВЕРСИЯ };

  /* Год песни — самый ранний среди записей этого же исполнителя с этим
     же названием. Иначе у ремастера 1998 года стоял бы 2019-й, а у
     сингла, попавшего потом в сборник, — год сборника. */
  const ранняя = свои.reduce((a, b) => (b.year < a.year ? b : a));
  const лучшая = свои.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    year: ранняя.year,
    score: лучшая.score,
    как: ранняя.как,
    v: ВЕРСИЯ,
    mbid: ранняя.rec.id || null,
    mbTitle: ранняя.rec.title || null,
    mbArtist: (ранняя.rec['artist-credit'] || []).map(c => c.name || c.artist?.name).join(', ') || null,
    // сколько записей этой песни MusicBrainz знает — видно, разнобой ли это
    записей: свои.length
  };
}

/* ============================================================
   SPOTIFY
   ============================================================ */

let SP_TOKEN = null;

async function spToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('нет SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET — ключ приложения Spotify обязателен');
  }
  const res = await fetch(SP_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    const тело = await res.text().catch(() => '');
    throw new Error(`Spotify не выдал токен: HTTP ${res.status}` + (тело ? ` — ${тело.slice(0, 300)}` : ''));
  }
  SP_TOKEN = (await res.json()).access_token;
  return SP_TOKEN;
}

/* 429 у Spotify приходит с Retry-After — сколько именно ждать он
   говорит сам, гадать не нужно. 401 значит, что часовой токен истёк. */
async function spGet(path, attempt = 0) {
  if (!SP_TOKEN) await spToken();
  const res = await fetch(SP_API + path, { headers: { Authorization: 'Bearer ' + SP_TOKEN } });
  if (res.status === 401 && attempt < 2) { SP_TOKEN = null; return spGet(path, attempt + 1); }
  if (res.status === 429 && attempt < 5) {
    const пауза = (+res.headers.get('retry-after') || 2) * 1000 + 500;
    console.log(`  … Spotify просит подождать ${Math.round(пауза / 1000)} с`);
    await sleep(пауза);
    return spGet(path, attempt + 1);
  }
  if (!res.ok) {
    /* Тело ответа Spotify обычно объясняет причину словами — без него
       403 неотличим от «не та галочка при создании приложения». */
    const тело = await res.text().catch(() => '');
    throw new Error(`Spotify HTTP ${res.status} на ${path.slice(0, 60)}` +
                    (тело ? ` — ${тело.slice(0, 300)}` : ''));
  }
  return res.json();
}

const годАльбома = a => годИз(a && a.release_date);

/* По одному треку за запрос. Пачками по 50 было бы девятнадцать
   запросов вместо девятисот, но /tracks?ids= это приложение получает
   403 Forbidden — проверено пробой: одиночный трек, поиск, альбом и
   исполнитель отдаются, групповая выборка нет. По одному выходит
   пара минут на всё, так что переживём.

   Год тут не угадан: это релиз, на который ссылается сама таблица. */
async function spПоСсылкам(список, cache, закрыто) {
  let найдено = 0, сделано = 0;
  for (const t of список) {
    let tr = null;
    try {
      tr = await spGet('/tracks/' + t.sid);
    } catch (e) {
      // Битая или устаревшая ссылка не должна ронять весь прогон:
      // такой трек просто уйдёт в поиск наравне с остальными.
      console.error(`  ! ${t.artist} — ${t.title}: ${e.message}`);
    }
    const годСсылки = tr && годАльбома(tr.album);

    /* Ссылка сама по себе год не решает: в таблице она порой ведёт на
       концертник или сборник, вышедший много позже песни. У «Ado —
       Basket Worm» так получился 2026-й с альбома «Ado 1st Live
       Kigeki (Live At Zepp DiverCity, 2022)». Поэтому спрашиваем ещё
       и поиском и берём то, что раньше. */
    let поиском = null;
    if (tr) {
      await sleep(SP_DELAY);
      поиском = await spПоиском(t).catch(() => null);
    }
    const года = [годСсылки, поиском && поиском.year].filter(Boolean);
    const year = года.length ? Math.min(...года) : null;

    if (tr) {
      const как = !годСсылки ? 'поиск'
                : (поиском && поиском.year && поиском.year < годСсылки) ? 'ссылка→поиск'
                : 'ссылка';
      cache.tracks[t.key] = {
        artist: t.artist, title: t.title, разносов: t.n,
        year, score: year ? 100 : 0, как, v: ВЕРСИЯ,
        sid: t.sid, spTitle: tr.name || null,
        spArtist: (tr.artists || []).map(a => a.name).join(', ') || null,
        spAlbum: tr.album?.name || null,
        годСсылки: годСсылки || null, годПоиска: (поиском && поиском.year) || null
      };
      if (year) { найдено++; закрыто.add(t.key); }
    }
    сделано++;
    if (сделано % 50 === 0) {
      console.log(`ссылки ${сделано}/${список.length} · с годом ${найдено}`);
      saveCache(cache, false);
    }
    await sleep(SP_DELAY);
  }
  console.log(`ссылки ${сделано}/${список.length} · с годом ${найдено}`);
  saveCache(cache, false);
  return найдено;
}

/* Для остальных — поиск. Берём самый ранний альбом среди версий этой
   же песни у этого же исполнителя: так сингл 2020 года побеждает
   сборник 2025-го, на котором он потом оказался. */
async function spПоиском(t) {
  const q = `track:"${t.title.replace(/"/g, ' ')}" artist:"${queryName(t.artist).replace(/"/g, ' ')}"`;
  /* limit=10 — потолок этого приложения: пробой проверено, что 20 и 50
     отвергаются с «Invalid limit», а 10 отдаётся. Меньше кандидатов —
     чуть меньше шансов увидеть самое раннее издание, но поиск и так
     сортирует по релевантности, и оригинал обычно в первой десятке. */
  const j = await spGet('/search?type=track&limit=10&q=' + encodeURIComponent(q));
  const свои = [];
  for (const tr of j.tracks?.items || []) {
    const { score, как } = уверенностьSp(tr, t.artist, t.title);
    const year = годАльбома(tr.album);
    if (score >= ПОРОГ && year) свои.push({ tr, score, как, year });
  }
  if (!свои.length) return { year: null, score: 0, v: ВЕРСИЯ };
  const ранняя = свои.reduce((a, b) => (b.year < a.year ? b : a));
  const лучшая = свои.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    year: ранняя.year, score: лучшая.score, как: 'поиск:' + ранняя.как, v: ВЕРСИЯ,
    sid: ранняя.tr.id, spTitle: ранняя.tr.name,
    spArtist: (ранняя.tr.artists || []).map(a => a.name).join(', '),
    spAlbum: ранняя.tr.album?.name || null, вариантов: свои.length
  };
}

/* Та же мера, что и для MusicBrainz, только поля другие. Отдельная
   функция, а не общая: у Spotify исполнители лежат плоским списком, а
   пути «псевдоним» тут не нужно — их поиск ромадзи понимает сам. */
function уверенностьSp(tr, artist, title) {
  const нет = { score: 0, как: '' };
  const тВопрос = срав(title), тОтвет = срав(tr.name);
  if (!тВопрос || !тОтвет) return нет;
  const точно = тОтвет === тВопрос;
  const краем = !точно && Math.min(тОтвет.length, тВопрос.length) >= 8 &&
                (тОтвет.startsWith(тВопрос) || тВопрос.startsWith(тОтвет));
  if (!точно && !краем) return нет;

  const аВопрос = срав(artist);
  const имена = (tr.artists || []).map(a => срав(a.name));
  const целиком = имена.join('');
  const исполнитель =
    имена.includes(аВопрос) || целиком === аВопрос ? 100
    : имена.some(k => k && (k.includes(аВопрос) || аВопрос.includes(k))) ? 92
    : целиком.includes(аВопрос) || аВопрос.includes(целиком) ? 92
    : 0;
  if (!исполнитель) return нет;
  return точно ? { score: исполнитель, как: 'название' }
               : { score: исполнитель - 8, как: 'хвост' };
}

/* Разведка: спрашиваем по одному и печатаем, что ответили. Ничего не
   пишем и никуда не сохраняем. */
async function spПрощупать() {
  const id = '1Mwm3pnsBiZvErRoxfEFbJ';          // трек из архива
  console.log('ключ:', process.env.SPOTIFY_CLIENT_ID
    ? `есть, ${process.env.SPOTIFY_CLIENT_ID.length} символов` : 'НЕТ');
  try {
    await spToken();
    console.log('токен: получен,', SP_TOKEN.length, 'символов');
  } catch (e) { console.log('токен: НЕ получен —', e.message); return; }

  const пробы = [
    ['один трек',            `/tracks/${id}`],
    ['один трек с market',   `/tracks/${id}?market=SE`],
    ['пачка из двух',        `/tracks?ids=${id},6z4p9s72H2RYiAEMiGb89M`],
    ['поиск',                '/search?type=track&limit=1&q=' + encodeURIComponent('Ado Usseewa')],
    ['поиск с market',       '/search?type=track&limit=1&market=SE&q=' + encodeURIComponent('Ado Usseewa')],
    ['альбом',               '/albums/4aawyAB9vmqN3uQ7FjRGTy'],
    ['исполнитель',          '/artists/4k1ELeJKT1ISyDv8JivPpB'],
    /* Какой размер выдачи поиска нам вообще позволен: с limit=50
       прилетает «Invalid limit», с limit=1 всё хорошо. Нужна граница,
       а не догадка — чем больше версий песни в ответе, тем надёжнее
       выбирается самый ранний альбом. */
    ['поиск limit=50',       '/search?type=track&limit=50&q=' + encodeURIComponent('Ado Usseewa')],
    ['поиск limit=20',       '/search?type=track&limit=20&q=' + encodeURIComponent('Ado Usseewa')],
    ['поиск limit=10',       '/search?type=track&limit=10&q=' + encodeURIComponent('Ado Usseewa')],
    ['поиск limit=5',        '/search?type=track&limit=5&q='  + encodeURIComponent('Ado Usseewa')],
    ['поиск q=track:artist:', '/search?type=track&limit=5&q=' +
      encodeURIComponent('track:"Usseewa" artist:"Ado"')]
  ];
  for (const [имя, path] of пробы) {
    const res = await fetch(SP_API + path, { headers: { Authorization: 'Bearer ' + SP_TOKEN } });
    const тело = await res.text().catch(() => '');
    console.log(`${имя.padEnd(20)} ${res.status}  ${тело.slice(0, 160).replace(/\s+/g, ' ')}`);
    await sleep(300);
  }
}

/* ---------- сбор песен из архива ---------- */
function createRequire() {
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'papaparse.min.js'), 'utf8');
  const sandbox = { module: { exports: {} }, exports: {}, window: {}, global: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.module.exports?.parse ? sandbox.module.exports
       : sandbox.Papa || sandbox.window.Papa;
}

function collectTracks(ctx) {
  const Papa = createRequire();
  const rows = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'),
    { header: true, skipEmptyLines: 'greedy' }).data;

  const counts = new Map();
  rows.forEach(r => {
    if (!ctx.parseRate(r['Оценка'])) return;          // только разнесённые
    const { artist, title } = ctx.parseWhat(r['Что']);
    if (!artist || !title) return;                    // без имени спрашивать нечего
    const чистое = чистоеНазвание(title);
    if (!чистое) return;
    const key = ключГода(ctx.nameKey, artist, title);
    // Ссылка лежит то в «Где», то в следующем столбце — смотрим оба.
    const sid = (Object.values(r).join(' ')
      .match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/) || [])[1] || null;
    const было = counts.get(key);
    if (было) { было.n++; if (!было.sid && sid) было.sid = sid; }
    else counts.set(key, { key, artist, title: чистое, n: 1, sid });
  });

  return [...counts.values()]
    .filter(t => t.n >= MIN_TRACKS)
    .sort((a, b) => b.n - a.n);                        // частых спрашиваем первыми
}

/* ---------- кэш ---------- */
function loadCache() {
  try {
    const j = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    return j.tracks && typeof j.tracks === 'object' ? j : { tracks: {} };
  } catch { return { tracks: {} }; }
}

function saveCache(cache, stats) {
  cache.generated = new Date().toISOString();
  cache.source = 'MusicBrainz';
  cache.note = 'year — самый ранний выпуск записи; score — наша уверенность в совпадении, 0–100';
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 1) + '\n');
  if (stats) console.log(`  … сохранено, известно ${Object.keys(cache.tracks).length}`);
}

/* ---------- главное ---------- */
if (PROBE) { await spПрощупать(); process.exit(0); }

const ctx = loadSiteCode();
const tracks = collectTracks(ctx);
const cache = loadCache();

const todo = tracks.filter(t => {
  const hit = cache.tracks[t.key];
  if (!hit) return true;
  if (RETRY_MISSING && !hit.year) return true;
  if (RECHECK && (hit.v ?? 1) < ВЕРСИЯ) return true;
  return false;
}).slice(0, LIMIT);

console.log(`песен в архиве: ${tracks.length}`);
console.log(`уже в кэше:     ${Object.keys(cache.tracks).length}`);
console.log(`спросить:       ${todo.length}`);
if (!todo.length) { console.log('нечего докачивать'); process.exit(0); }

console.log(`источник:       ${SOURCE}`);

const startedAt = Date.now();
const промахи = [];
let done = 0, found = 0, failed = 0, ranOut = false;

/* Сначала — те, у кого в таблице есть ссылка на Spotify: пачками по
   пятьдесят, без поиска и без риска промахнуться мимо песни. */
/* Что уже закрыл проход по ссылкам — по нему и решаем, кого отдавать
   поиску. Раньше здесь стояло «у кого в кэше ещё нет года», и это
   рушило --recheck: запись с годом и ссылкой не попадала ни в один
   проход, переспросить её было нельзя. Список todo и так собран из
   тех, кого спрашивать надо. */
const сделано = new Set();
if (SOURCE === 'spotify') {
  const поСсылке = todo.filter(t => t.sid);
  if (поСсылке.length) {
    console.log(`\nпо ссылкам из таблицы: ${поСсылке.length}`);
    found += await spПоСсылкам(поСсылке, cache, сделано);
    done += сделано.size;
  }
}

// Кого ссылка не закрыла — в поиск наравне с бесссылочными.
const остальные = todo.filter(t => !сделано.has(t.key));
const шаг = SOURCE === 'spotify' ? SP_DELAY : DELAY_MS;
if (остальные.length) {
  console.log(`\nпоиском: ${остальные.length}, примерно ${Math.max(1, Math.round(остальные.length * шаг / 60000))} мин\n`);
}

for (const t of остальные) {
  if (Date.now() - startedAt > MAX_MS) {
    ranOut = true;
    console.log(`\nвремя вышло (${Math.round(MAX_MS / 60000)} мин), останавливаюсь на ${done}/${todo.length}`);
    break;
  }
  try {
    const r = SOURCE === 'spotify' ? await spПоиском(t) : await fetchYear(t.artist, t.title);
    cache.tracks[t.key] = { artist: t.artist, title: t.title, разносов: t.n, ...r };
    if (r.year) found++;
    else if (промахи.length < 40) промахи.push(`${t.artist} — ${t.title}`);
  } catch (e) {
    console.error(`  ! ${t.artist} — ${t.title}: ${e.message}`);
    failed++;
    if (failed > 20) { console.error('слишком много ошибок подряд, останавливаюсь'); break; }
  }
  done++;
  if (done % 25 === 0) {
    console.log(`${done}/${todo.length} · с годом ${found}`);
    saveCache(cache, true);
  }
  await sleep(шаг);
}

saveCache(cache);
if (промахи.length) {
  console.log(`\nне нашлось (первые ${промахи.length}) — по ним и видно, что чинить:`);
  промахи.forEach(x => console.log('  ·', x));
}

const сГодом = Object.values(cache.tracks).filter(x => x.year).length;
console.log(`\nготово: спрошено ${done}, год нашёлся у ${found}`);
console.log(`всего в кэше ${Object.keys(cache.tracks).length}, из них с годом ${сГодом}`);
const left = tracks.length - Object.keys(cache.tracks).length;
if (ranOut || left > 0) console.log(`осталось спросить ${left} — следующий запуск продолжит`);
