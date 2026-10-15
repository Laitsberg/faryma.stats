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
import { обрезать } from './trim-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT || path.join(ROOT, 'data.csv');

const SHEET_ID = process.env.SHEET_ID || '1yEUr29llt9L1zWavC4lxkyhd6UeIwrQuGsPon9fXt4A';
const GID      = process.env.SHEET_GID || '957661826';   // «Уже разнесли (архив)»

/* Адреса пробуем по очереди: у разных способов публикации работает разное.
   Первый успешный и осмысленный ответ выигрывает. */
const URLS = process.env.SHEET_CSV_URL ? [process.env.SHEET_CSV_URL] : [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}&headers=1`
];

const REQUIRED = ['Что', 'Оценка'];

const MIN_KEEP = 0.9;    // новая выгрузка не может быть сильно короче старой

/* Разбор строк-разделителей берём общий — тот же, что у сайта и бота.
   Нужен, чтобы знать номер самого свежего стрима в выгрузке. */
const ctx = vm.createContext({ console, URL });
for (const f of ['js/config.js', 'js/aliases.js', 'js/parse.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

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

  /* Номер самого свежего стрима. По нему видно, не подсунули ли нам
     старую копию архива: все прочие проверки такую копию пропускают —
     колонки на месте, длина та же, — и сайт тихо замирает на
     позавчерашнем дне, ничем не выдавая беды. */
  let стрим = 0;
  for (const x of r.data) {
    const st = ctx.parseStream(x['Что'], x['Где']);
    if (st && st.num > стрим) стрим = st.num;
  }
  return { ok: true, rows: r.data.length, rated, fields, стрим };
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

  /* Режем колонки сразу и тут же перепроверяем: разносов должно
     остаться ровно столько же. Если обрезка что-то потеряла — лучше
     упасть, чем записать обкусанный архив. */
  const урезанный = обрезать(text, papa());
  const п = inspect(урезанный);
  if (!п.ok || п.rated !== v.rated) {
    const что = п.ok ? `с оценкой было ${v.rated}, после обрезки ${п.rated}` : п.why;
    console.log(`  обрезка колонок всё испортила: ${что} — дальше`);
    reasons.push(`${short}: обрезка — ${что}`);
    continue;
  }
  console.log(`  оставлено колонок: ${п.fields.length} из ${v.fields.length}, ` +
    `${(text.length / 1048576).toFixed(2)} → ${(урезанный.length / 1048576).toFixed(2)} МБ`);

  saved = { text: урезанный, ...п, url };
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
  /* Номер стрима назад не идёт. Если он упал — читаем не ту вкладку:
     композитор может завести новый лист и спрятать старый, а экспорт
     по номеру листа работает и для скрытых. Молча перезаписать архив
     позавчерашней копией — худшее, что тут можно сделать. */
  if (old.ok && old.стрим && saved.стрим && saved.стрим < old.стрим) {
    console.error(`\nВ архиве был стрим №${old.стрим}, в выгрузке только №${saved.стрим}.`);
    console.error('Похоже, SHEET_GID показывает на старую копию архива — проверь номер вкладки.');
    console.error('Ничего не перезаписываю.');
    process.exit(1);
  }
  if (old.ok) console.log(`было с оценкой ${old.rated}, стало ${saved.rated} (+${saved.rated - old.rated})` +
    (saved.стрим ? `, свежий стрим №${saved.стрим}` : ''));
}

fs.writeFileSync(OUT, saved.text);
console.log(`записано в ${path.relative(ROOT, OUT)}`);
