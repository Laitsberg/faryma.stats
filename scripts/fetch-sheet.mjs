#!/usr/bin/env node
/* ============================================================
   СКАЧАТЬ ТАБЛИЦУ
   ------------------------------------------------------------
   Забирает лист архива в CSV и кладёт в data.csv.

   Скачанное проверяется перед записью. Гугл на закрытый доступ
   отвечает не ошибкой, а страницей входа — без проверки такая
   страница молча легла бы вместо архива и убила сайт.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || path.join(ROOT, 'data.csv');

const SHEET_ID = process.env.SHEET_ID || '1yEUr29llt9L1zWavC4lxkyhd6UeIwrQuGsPon9fXt4A';
const GID      = process.env.SHEET_GID || '1372192852';

/* Адреса пробуем по очереди: у разных способов публикации работает разное.
   Первый успешный и осмысленный ответ выигрывает. */
const URLS = process.env.SHEET_CSV_URL ? [process.env.SHEET_CSV_URL] : [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}&headers=1`
];

const REQUIRED = ['Что', 'Оценка'];
const MIN_KEEP = 0.9;    // новая выгрузка не может быть сильно короче старой

function papa() {
  const sandbox = { module: { exports: {} }, exports: {}, window: {}, global: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'papaparse.min.js'), 'utf8'), sandbox);
  return sandbox.module.exports?.parse ? sandbox.module.exports : sandbox.Papa || sandbox.window.Papa;
}

function inspect(text) {
  if (/^\s*<(!doctype|html)/i.test(text))
    return { ok: false, why: 'вернулась HTML-страница, а не CSV — скорее всего доступ к таблице закрыт' };
  const P = papa();
  const r = P.parse(text, { header: true, skipEmptyLines: 'greedy' });
  const fields = r.meta.fields || [];
  const missing = REQUIRED.filter(f => !fields.includes(f));
  if (missing.length)
    return { ok: false, why: `нет колонок ${missing.join(', ')} — похоже, скачался не тот лист. Есть: ${fields.slice(0, 12).join(', ')}` };
  const rated = r.data.filter(x => (x['Оценка'] || '').trim()).length;
  if (rated < 100)
    return { ok: false, why: `всего ${rated} строк с оценкой — выгрузка выглядит обрезанной` };
  return { ok: true, rows: r.data.length, rated, fields };
}

let saved = null;
const reasons = [];
for (const url of URLS) {
  const short = url.replace(/\?.*$/, '?…');
  process.stdout.write(`пробую ${short}\n`);
  let text;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'faryma-stats/1.0' } });
    if (!res.ok) { const w = `HTTP ${res.status}`; console.log(`  ${w} — дальше`); reasons.push(`${short}: ${w}`); continue; }
    text = await res.text();
  } catch (e) { console.log(`  не отвечает: ${e.message} — дальше`); reasons.push(`${short}: ${e.message}`); continue; }

  const v = inspect(text);
  if (!v.ok) { console.log(`  ${v.why} — дальше`); reasons.push(`${short}: ${v.why}`); continue; }

  console.log(`  ок: строк ${v.rows}, с оценкой ${v.rated}`);
  saved = { text, ...v, url };
  break;
}

if (!saved) {
  console.error('\nНи один адрес не отдал пригодный CSV. Что вернулось:');
  reasons.forEach(r => console.error('  · ' + r));
  if (reasons.some(r => /HTML-страница/.test(r)))
    console.error('\nПохоже на закрытый доступ: Настроить доступ → «Все, у кого есть ссылка» → Читатель.');
  if (reasons.some(r => /не тот лист/.test(r)))
    console.error('\nПохоже на неверный gid вкладки — проверь SHEET_GID.');
  process.exit(1);
}

/* Защита от подмены: если новая выгрузка резко короче — не перезаписываем */
if (fs.existsSync(OUT)) {
  const old = inspect(fs.readFileSync(OUT, 'utf8'));
  if (old.ok && saved.rated < old.rated * MIN_KEEP) {
    console.error(`\nБыло ${old.rated} строк с оценкой, стало ${saved.rated} — слишком большая усадка.`);
    console.error('Ничего не перезаписываю. Если архив правда почистили, удали data.csv вручную.');
    process.exit(1);
  }
  if (old.ok) console.log(`было с оценкой ${old.rated}, стало ${saved.rated} (+${saved.rated - old.rated})`);
}

fs.writeFileSync(OUT, saved.text);
console.log(`записано в ${path.relative(ROOT, OUT)}`);
