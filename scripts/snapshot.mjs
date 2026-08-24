#!/usr/bin/env node
/* ============================================================
   СНИМОК ДНЯ
   ------------------------------------------------------------
   Дописывает строку в data/history.jsonl — по одной на дату.

   Зачем: в таблице нет дат, есть только порядок строк. Но если
   каждый день записывать, сколько разносов уже накопилось, то
   разница между днями показывает, что разобрали за это время.
   Через месяц у каждого трека появляется примерная дата, а у
   архива — настоящая ось времени, которой в таблице нет.

   Файл строчный (jsonl): дописывается в конец, не переписывается,
   поэтому история не портится при сбое посреди записи.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV  = process.env.CSV || path.join(ROOT, 'data.csv');
const OUT  = process.env.HISTORY || path.join(ROOT, 'data', 'history.jsonl');

function sandboxed(file, extra = {}) {
  const s = { module: { exports: {} }, exports: {}, window: {}, global: {}, console, URL, ...extra };
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), s, { filename: file });
  return s;
}

const P = (() => {
  const s = sandboxed('vendor/papaparse.min.js');
  return s.module.exports?.parse ? s.module.exports : s.Papa || s.window.Papa;
})();

const ctx = vm.createContext({ console, URL });
for (const f of ['js/config.js', 'js/parse.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

const rows = P.parse(fs.readFileSync(CSV, 'utf8'), { header: true, skipEmptyLines: 'greedy' }).data;

const rated = [];
const artists = new Set(), users = new Set();
const tiers = {};
rows.forEach(r => {
  const rate = ctx.parseRate(r['Оценка']);
  if (!rate) return;
  rated.push(rate.score);
  tiers[rate.tier] = (tiers[rate.tier] || 0) + 1;
  const { artist } = ctx.parseWhat(r['Что']);
  if (artist) artists.add(ctx.nameKey(artist));
  const u = (r['Кто'] || '').trim();
  if (u) users.add(ctx.userKey(u));
});

const today = new Date().toISOString().slice(0, 10);
const entry = {
  date: today,
  rows: rows.length,
  rated: rated.length,
  avg: +(rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(4),
  artists: artists.size,
  users: users.size,
  tiers
};

/* Одна запись на дату: повторный запуск в тот же день заменяет её,
   а не плодит дубли. */
let lines = [];
if (fs.existsSync(OUT)) {
  lines = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)
    .filter(l => { try { return JSON.parse(l).date !== today; } catch { return false; } });
}

const prev = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
lines.push(JSON.stringify(entry));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n');

console.log(`${today}: разносов ${entry.rated}, средний ${entry.avg}, исполнителей ${entry.artists}`);
if (prev) {
  const d = entry.rated - prev.rated;
  console.log(`с ${prev.date}: ${d > 0 ? '+' + d : d} разносов`);
}
console.log(`всего дней в истории: ${lines.length}`);
