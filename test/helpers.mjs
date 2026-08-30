/* ============================================================
   ОБЩЕЕ ДЛЯ ТЕСТОВ
   ------------------------------------------------------------
   Тесты гоняют тот же самый код, что работает у людей: js/parse.js
   загружается в песочницу как есть, без копий и переписываний. Если
   в нём что-то сломается, тест это увидит.

   Про реальные данные. Архив пополняется каждый день, поэтому точные
   числа в тестах — верный способ получить красную сборку в утро после
   стрима. Правило простое: точные значения проверяем только на
   придуманных строках, а на data.csv — лишь то, что обязано быть
   правдой всегда: границы, суммы, отсутствие мусора.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Песочница с настоящими config.js, aliases.js и parse.js */
export function loadParse() {
  const ctx = vm.createContext({ console, URL });
  for (const f of ['js/config.js', 'js/aliases.js', 'js/parse.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

/* Константы объявлены через const и на объект контекста не попадают —
   достаём их отдельным выражением. */
export const constOf = (ctx, name) => vm.runInContext(name, ctx);

export function papa() {
  const s = { module: { exports: {} }, exports: {}, window: {}, global: {}, console, URL };
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/papaparse.min.js'), 'utf8'), s);
  return s.module.exports?.parse ? s.module.exports : s.Papa || s.window.Papa;
}

export function readCsv() {
  return papa().parse(fs.readFileSync(path.join(ROOT, 'data.csv'), 'utf8'),
    { header: true, skipEmptyLines: 'greedy' }).data;
}

/* Упрощённая сборка строк — ровно те поля, которые нужны проверкам
   данных. Настоящую сборку со всеми словарями имён проверяет
   site.test.mjs: там страница поднимается целиком, в браузере. */
export function buildRows(ctx, raw = readCsv()) {
  const rows = [], streams = [], offscale = [];
  let stream = null;
  raw.forEach((r, i) => {
    const st = ctx.parseStream(r['Что'], r['Где']);
    if (st) { stream = st; streams.push(st); return; }
    const rate = ctx.parseRate(r['Оценка']);
    const w = ctx.parseWhat(r['Что']);
    if (!rate) {
      const raw2 = (r['Оценка'] || '').trim();
      if (raw2 && /[а-яёa-z]/i.test(raw2) && (r['Тип'] || '').trim())
        offscale.push({ raw: raw2, title: w.title, streamNum: stream ? stream.num : null });
      return;
    }
    rows.push({
      i, rate, pos: w.pos, artist: w.artist, title: w.title, full: w.full,
      user: (r['Кто'] || '').trim(),
      userParts: ctx.userParts((r['Кто'] || '').trim()).map(ctx.userKey),
      source: ctx.parseSource(r['Что']),
      streamNum: stream ? stream.num : null,
      date: stream ? stream.date : null,
      sec: ctx.toSeconds(r['Когда'])
    });
  });
  return { rows, streams, offscale };
}

/* ---------- сервер для браузерных тестов ----------
   Сайт статический, поэтому хватает отдачи файлов из корня. */
export async function startServer() {
  const http = await import('node:http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    // за пределы проекта не выпускаем
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('нет такого файла');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/* Playwright лежит по-разному: в песочнице глобально, в сборке — рядом */
export async function browser() {
  let pw;
  try { pw = await import('playwright'); }
  catch { pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs'); }
  return pw.chromium.launch();
}
