#!/usr/bin/env node
/* ============================================================
   ОТВЕТЧИК ДЛЯ ЧАТА
   ------------------------------------------------------------
   Маленький сервер, который на вопрос «а разносили ли этот трек?»
   отвечает одной строкой. Его дёргает Moobot: в команде !разнос
   стоит «URL fetch», и всё, что мы вернём, уходит прямо в чат.

   Ни ключей Twitch, ни двухфакторной защиты для этого не нужно —
   бот просто ходит по обычному адресу.

   Данные и код разбора берутся с самого сайта по HTTP:
   farymastats.info раздаёт и data.csv, и js/parse.js как обычные
   файлы. Поэтому здесь нет ни своей копии архива, ни своей копии
   правил разбора — а значит, они не разойдутся с сайтом. Обновление
   архива подхватывается само, без передеплоя.
   ============================================================ */

import http from 'node:http';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE || 'https://farymastats.info').replace(/\/+$/, '');
/* Как часто перечитывать архив. Он меняется раз в сутки, так что
   десяти минут с запасом хватает. */
const REFRESH_MS = +(process.env.REFRESH_MIN || 10) * 60_000;
/* Чат Twitch режет длинные сообщения, поэтому держим ответ коротким. */
const MAX_LEN = 380;

let АРХИВ = null;          // { rows, users, when }
let ГРУЗИМ = null;         // чтобы не тянуть файл десятью запросами разом

/* ---------- загрузка ---------- */

async function достать(путь) {
  const r = await fetch(`${BASE}/${путь}`, { headers: { 'user-agent': 'faryma-chat-bot' } });
  if (!r.ok) throw new Error(`${путь}: ответил ${r.status}`);
  return r.text();
}

async function собрать() {
  const [papaSrc, cfg, aliases, parse, csv] = await Promise.all([
    достать('vendor/papaparse.min.js'),
    достать('js/config.js'),
    достать('js/aliases.js'),
    достать('js/parse.js'),
    достать('data.csv')
  ]);

  const песочница = { module: { exports: {} }, exports: {}, window: {}, global: {}, console, URL };
  vm.createContext(песочница);
  vm.runInContext(papaSrc, песочница, { filename: 'papaparse' });
  const Papa = песочница.module.exports?.parse ? песочница.module.exports
    : песочница.Papa || песочница.window.Papa;

  const ctx = vm.createContext({ console, URL });
  vm.runInContext(cfg, ctx, { filename: 'config.js' });
  vm.runInContext(aliases, ctx, { filename: 'aliases.js' });
  vm.runInContext(parse, ctx, { filename: 'parse.js' });

  const raw = Papa.parse(csv, { header: true, skipEmptyLines: 'greedy' }).data;

  const rows = [];
  const users = new Map();
  let stream = null;
  raw.forEach(r => {
    const st = ctx.parseStream(r['Что'], r['Где']);
    if (st) { stream = st; return; }
    const rate = ctx.parseRate(r['Оценка']);
    if (!rate) return;
    const w = ctx.parseWhat(r['Что']);
    const кто = (r['Кто'] || '').trim();
    const строка = {
      artist: w.artist, title: w.title, rate,
      user: кто,
      streamNum: stream ? stream.num : null,
      date: stream ? stream.date : null,
      // по этому полю и ищем: исполнитель, название, заказчик
      искать: (w.full + ' ' + кто).toLowerCase(),
      // то же без пробелов и знаков: «KICK BACK» и «KICKBACK» —
      // одна и та же песня, и спросить могут любым из двух способов
      сжато: (w.full + ' ' + кто).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    };
    rows.push(строка);
    ctx.userParts(кто).forEach(u => {
      const k = ctx.userKey(u);
      if (!users.has(k)) users.set(k, { имя: u, треки: [] });
      users.get(k).треки.push(строка);
    });
  });

  if (rows.length < 1000) throw new Error(`в архиве всего ${rows.length} строк — похоже, скачалось не то`);
  return { rows, users, when: Date.now(), ctx };
}

async function архив() {
  if (АРХИВ && Date.now() - АРХИВ.when < REFRESH_MS) return АРХИВ;
  // пока один запрос тянет файл, остальные ждут его же
  if (!ГРУЗИМ) ГРУЗИМ = собрать()
    .then(a => { АРХИВ = a; return a; })
    .catch(e => {
      console.error('не смог обновить архив:', e.message);
      if (АРХИВ) return АРХИВ;      // отдаём то, что есть
      throw e;
    })
    .finally(() => { ГРУЗИМ = null; });
  return ГРУЗИМ;
}

/* ---------- поиск ---------- */

const дата = d => d ? d.toLocaleDateString('ru-RU', { timeZone: 'UTC' }) : '';
const обрезать = s => s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1).trimEnd() + '…';
const ссылка = q => `${BASE}/?q=${encodeURIComponent(q)}`;

function искатьТрек(a, запрос) {
  const q = запрос.trim().toLowerCase();
  if (!q) return 'Напиши, что искать: !разнос unravel';

  /* Короткий запрос ищем по целому слову. «Ado» иначе находил
     «Shadow», «Tornado» и заказчика «AnonymousAdomin» — триста
     совпадений вместо двадцати, и в чат уходила чепуха. Длинные
     запросы оставляем как есть: там подстрока почти всегда по делу. */
  const рег = q.length <= 4
    ? new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u')
    : null;
  const сжатый = q.replace(/[^\p{L}\p{N}]+/gu, '');
  const нашлись = a.rows.filter(r => рег
    ? рег.test(r.искать)
    // длинный запрос ищем и как есть, и без пробелов
    : r.искать.includes(q) || (сжатый.length >= 4 && r.сжато.includes(сжатый)));
  if (!нашлись.length)
    return `«${запрос}» ещё не приносили — можно нести! ${BASE}`;

  /* Сначала точность совпадения, и только потом свежесть. Без этого
     на «unravel» отвечало «Muse — Unravelling»: он был новее, а
     подстрока нашлась и там. Человек спрашивает про конкретный трек,
     и точное попадание в название важнее всего остального. */
  const точность = r => {
    const t = (r.title || '').toLowerCase();
    const a2 = (r.artist || '').toLowerCase();
    const u = (r.user || '').toLowerCase();
    const сж = x => x.replace(/[^\p{L}\p{N}]+/gu, '');
    if (t === q || сж(t) === сжатый) return 0;
    if (a2 === q || сж(a2) === сжатый) return 1;
    if (t.startsWith(q)) return 2;
    if (t.includes(q) || сж(t).includes(сжатый)) return 3;
    if (a2.includes(q) || сж(a2).includes(сжатый)) return 4;
    if (u.includes(q)) return 5;
    return 6;
  };
  const свежие = [...нашлись].sort((x, y) =>
    точность(x) - точность(y) || (y.date || 0) - (x.date || 0));
  const r = свежие[0];
  const кто = r.artist ? `${r.artist} — ${r.title}` : r.title;

  let ответ = `${кто}: ${r.rate.label}`;
  if (r.streamNum != null) ответ += `, стрим №${r.streamNum}`;
  if (r.date) ответ += ` (${дата(r.date)})`;
  if (r.user) ответ += `, принёс ${r.user}`;

  /* Тот же трек, принесённый повторно, интереснее прочих совпадений.
     Сравниваем без знаков и пробелов: «KICK BACK» и «KICKBACK» — одна
     и та же песня, а точное сравнение строк их разводило. */
  const ключ = x => (x.artist + ' ' + x.title).toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const тотЖе = нашлись.filter(x => x !== r && ключ(x) === ключ(r));
  if (тотЖе.length) {
    const пред = тотЖе.sort((x, y) => (y.date || 0) - (x.date || 0))[0];
    ответ += `. Приносили и раньше: ${пред.rate.label}` +
      (пред.streamNum != null ? `, №${пред.streamNum}` : '');
  }

  const ещё = нашлись.length - 1 - тотЖе.length;
  if (ещё > 0) ответ += `. Ещё ${ещё} ` +
    склон(ещё, 'совпадение', 'совпадения', 'совпадений') + `: ${ссылка(запрос)}`;
  return обрезать(ответ);
}

function искатьЗаказчика(a, запрос) {
  const имя = запрос.trim();
  if (!имя) return 'Напиши ник: !я или !статистика ник';

  const k = a.ctx.userKey(имя);
  const hit = a.users.get(k);
  if (!hit) return `${имя} пока ничего не приносил. Самое время: ${BASE}`;

  const треки = hit.треки;
  const балл = треки.reduce((s, r) => s + r.rate.score, 0) / треки.length;
  const ORDER = vmConst(a.ctx, 'SCALE_ORDER');
  const лучший = [...треки].sort((x, y) =>
    ORDER.indexOf(x.rate.label) - ORDER.indexOf(y.rate.label))[0];
  const гениальных = треки.filter(r => r.rate.tier === 'гениально').length;

  // место в общем зачёте — по числу принесённого
  const все = [...a.users.values()].sort((x, y) => y.треки.length - x.треки.length);
  const место = все.findIndex(u => u === hit) + 1;

  return обрезать(
    `${hit.имя}: ${треки.length} ${склон(треки.length, 'трек', 'трека', 'треков')}, ` +
    `средний ${балл.toFixed(2)}, в «гениально» ${гениальных}. ` +
    `Лучшее: ${лучший.artist} — ${лучший.title} (${лучший.rate.label}). ` +
    `Место в зачёте: ${место} из ${все.length}`);
}

function vmConst(ctx, имя) { return vm.runInContext(имя, ctx); }

function склон(n, од, дв, мн) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return мн;
  if (b > 1 && b < 5) return дв;
  return b === 1 ? од : мн;
}

/* ---------- сервер ---------- */

const server = http.createServer(async (req, res) => {
  const отдать = (текст, код = 200) => {
    res.writeHead(код, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      // Moobot ходит со своей стороны, но пусть и страница сможет
      'access-control-allow-origin': '*'
    });
    res.end(текст);
  };

  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    // Moobot подставляет аргументы уже закодированными, но если кто-то
    // дёрнет адрес руками с сырой кириллицей — тоже разберём
    let q = u.searchParams.get('q') || '';
    if (!q && /[?&]q=/.test(req.url)) {
      try { q = decodeURIComponent(req.url.split(/[?&]q=/)[1].split('&')[0]); } catch { /* оставим пустым */ }
    }

    if (u.pathname === '/health') {
      const a = await архив();
      return отдать(`ок, разносов ${a.rows.length}, обновлено ${new Date(a.when).toISOString()}`);
    }
    if (u.pathname === '/track') return отдать(искатьТрек(await архив(), q));
    if (u.pathname === '/user')  return отдать(искатьЗаказчика(await архив(), q));
    if (u.pathname === '/') return отдать(
      'Ответчик для чата стрима.\n' +
      '/track?q=название — приносили ли трек\n' +
      '/user?q=ник — статистика заказчика\n' +
      '/health — жив ли\n' + BASE);

    отдать('нет такой команды', 404);
  } catch (e) {
    console.error(e);
    // в чат уходит человеческая фраза, а не стек вызовов
    отдать('Архив сейчас недоступен, попробуйте через минуту', 200);
  }
});

/* Сервер поднимается, только когда файл запущен напрямую. При импорте
   отдаются сами функции — так их проверяют тесты, без процесса и порта. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  server.listen(PORT, () => {
    console.log(`ответчик слушает порт ${PORT}, данные берёт с ${BASE}`);
    архив().then(a => console.log(`архив загружен: ${a.rows.length} разносов`))
           .catch(e => console.error('первая загрузка не удалась:', e.message));
  });
}

export { собрать, искатьТрек, искатьЗаказчика, server };
