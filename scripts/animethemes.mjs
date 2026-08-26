#!/usr/bin/env node
/* ============================================================
   КАТАЛОГ ОПЕНИНГОВ И ЭНДИНГОВ ИЗ ANIMETHEMES.MOE
   ------------------------------------------------------------
   Архив знает только то, что уже разнесли. Чтобы показать, чего
   ЕЩЁ НЕ разносили, нужен внешний список: что у тайтла вообще есть.
   animethemes.moe — открытая база сообщества, ключ не нужен.

   Из песочницы разработки их сайт недоступен, поэтому сначала
   разведка: запускаем в Actions и печатаем, что реально отвечает
   API. По этому ответу уже пишется разбор.

     node scripts/animethemes.mjs --probe        разведка
     node scripts/animethemes.mjs --limit 50     собрать каталог

   ============================================================ */

const ARGS = process.argv.slice(2);
const has = f => ARGS.includes(f);
const val = (f, d) => { const i = ARGS.indexOf(f); return i >= 0 && ARGS[i+1] ? ARGS[i+1] : d; };

const API = process.env.AT_API || 'https://api.animethemes.moe';
const UA  = 'faryma-stats/1.0 ( https://github.com/Laitsberg/faryma.stats )';
const DELAY = +(process.env.AT_DELAY || 350);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const url = API + path;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

/* ---------- разведка ----------
   Печатаем структуру ответа, а не догадываемся о ней. */
function skeleton(v, depth = 0, key = '') {
  const pad = '  '.repeat(depth);
  if (Array.isArray(v)) {
    console.log(`${pad}${key}[] — ${v.length} шт.`);
    if (v.length && depth < 3) skeleton(v[0], depth + 1, '↳ ');
    return;
  }
  if (v && typeof v === 'object') {
    if (key) console.log(`${pad}${key}{}`);
    Object.entries(v).slice(0, 14).forEach(([k, x]) => {
      if (x && typeof x === 'object') skeleton(x, depth + 1, k + ' ');
      else console.log(`${pad}  ${k}: ${JSON.stringify(x)?.slice(0, 70)}`);
    });
    return;
  }
  console.log(`${pad}${key}${JSON.stringify(v)?.slice(0, 70)}`);
}

async function probe() {
  const пробы = [
    ['корень API', '/'],
    ['поиск тайтла', '/anime?filter[name]=Chainsaw%20Man&page[size]=2'],
    ['тайтл с темами', '/anime?filter[name]=Chainsaw%20Man&include=animethemes.song.artists&page[size]=1'],
    ['по слагу', '/anime/chainsaw_man?include=animethemes.song.artists'],
    ['поиск по строке', '/search?q=Chainsaw%20Man&fields[search]=anime']
  ];
  for (const [имя, path] of пробы) {
    console.log('\n' + '='.repeat(60));
    console.log(имя, '→', path);
    try {
      const r = await get(path);
      console.log('HTTP', r.status);
      if (r.json) skeleton(r.json);
      else console.log('не JSON:', r.text.slice(0, 200));
    } catch (e) {
      console.log('ошибка запроса:', e.message);
    }
    await sleep(DELAY);
  }
}

if (has('--probe')) { await probe(); process.exit(0); }
console.log('пока умею только --probe');
