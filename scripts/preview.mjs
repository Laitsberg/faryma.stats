#!/usr/bin/env node
/* ============================================================
   КАРТИНКА ДЛЯ ПРЕВЬЮ ССЫЛКИ
   ------------------------------------------------------------
   Когда ссылку кидают в телеграм или дискорд, там показывается
   карточка: заголовок, описание, картинка. Картинки у нас не было —
   рисуем её из og/preview.html, подставив свежие цифры из таблицы.

   Считаем теми же функциями, что и сайт, чтобы цифры на карточке
   и на странице не расходились.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function siteCode() {
  const ctx = vm.createContext({ console, URL });
  for (const f of ['js/config.js', 'js/aliases.js', 'js/parse.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
function papa() {
  const box = { module: { exports: {} }, exports: {}, window: {}, global: {} };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/papaparse.min.js'), 'utf8'), box);
  return box.module.exports?.parse ? box.module.exports : box.Papa || box.window.Papa;
}

const ctx = siteCode();
const rows = papa().parse(fs.readFileSync(path.join(ROOT, 'data.csv'), 'utf8'),
  { header: true, skipEmptyLines: 'greedy' }).data;

const исполнители = new Set(), заказчики = new Set(), стримы = new Set();
const ступени = new Map();
let разносов = 0;

// Склейка перестановок имён: «Sawano Hiroyuki» и «Hiroyuki Sawano» —
// один человек. Сайт делает так же, иначе цифра на карточке разойдётся
// с цифрой в шапке страницы.
const solo = new Set();
rows.forEach(r => {
  const w = ctx.parseWhat(r['Что']);
  if (w.artist && ctx.isSolo(w.artist)) solo.add(ctx.nameKey(w.artist));
});
const partCounts = new Map();
rows.forEach(r => {
  const w = ctx.parseWhat(r['Что']);
  if (!w.artist) return;
  ctx.participants(w.artist, solo).forEach(v => {
    const k = ctx.nameKey(v);
    partCounts.set(k, (partCounts.get(k) || 0) + 1);
  });
});
const alias = ctx.buildNameAliases(partCounts);
const canonKey = k => alias.get(k) || k;

rows.forEach(r => {
  // номера стримов лежат не в колонке, а в строках-разделителях
  const st = ctx.parseStream(r['Что'], r['Где']);
  if (st) { стримы.add(st.num); return; }
  const rate = ctx.parseRate(r['Оценка']);
  if (!rate) return;
  разносов++;
  ступени.set(rate.tier, (ступени.get(rate.tier) || 0) + 1);
  const w = ctx.parseWhat(r['Что']);
  // считаем так же, как цифра в шапке сайта: по строке исполнителя
  // целиком, а не по каждому участнику фита отдельно
  if (w.artist) исполнители.add(canonKey(ctx.nameKey(w.artist)));
  ctx.userParts(r['Кто']).forEach(u => заказчики.add(ctx.userKey(u)));
});

const TIERS = vm.runInContext('TIERS', ctx);
const tiers = TIERS.map(t => ступени.get(t.key) || 0).join(',');
const q = new URLSearchParams({
  tracks: разносов, artists: исполнители.size,
  users: заказчики.size, streams: стримы.size || 0, tiers
});
console.log('цифры для карточки:', q.toString());

// простой сервер: браузеру нужен http, чтобы шрифты и стили встали как надо
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(d);
  });
}).listen(8137);

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
await p.goto(`http://127.0.0.1:8137/og/preview.html?${q}`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(600);
fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true });
await p.screenshot({ path: path.join(ROOT, 'icons', 'og.png') });
await b.close();
srv.close();
console.log('готово: icons/og.png');
