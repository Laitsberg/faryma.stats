/* ============================================================
   СКАЧИВАТЕЛЬ АРХИВА
   ------------------------------------------------------------
   Проверяем сторожей, а не саму загрузку: вместо Гугла поднимаем
   свой сервер и отдаём ему то, что хотим.

   Главный сторож тут — номер стрима. Композитор может завести новый
   лист с архивом, а старый спрятать; экспорт по номеру листа
   работает и для скрытых, и все прочие проверки такую копию
   пропускают — колонки на месте, длина та же. Сайт при этом тихо
   замирает на позавчерашнем дне, ничем не выдавая беды.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ROOT } from './helpers.mjs';

/* Выдуманный архив: столько-то стримов по столько-то треков.
   Своё, а не живое: тут можно требовать точных значений. */
function архив(доСтрима, треков = 40) {
  const строки = ['Что,Оценка,Где,Кто,Тип,Откуда,Жанр,Тэги,Когда'];
  // архив идёт от новых к старым, как настоящий
  for (let н = доСтрима; н >= 1; н--) {
    строки.push(`"СТРИМ №${н} (0${(н % 9) + 1}.01.26)",,https://vk.com/video1,,,,,,`);
    for (let i = 1; i <= треков; i++)
      строки.push(`"${i}) Артист ${н}-${i} — Трек ${i}",атлична,https://youtu.be/aaaaaaaaaaa,зритель${i},заказ,,поп,,12:00`);
  }
  return строки.join('\n');
}

async function сервер(тело) {
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end(тело);
  });
  await new Promise(ok => s.listen(0, '127.0.0.1', ok));
  return { s, адрес: `http://127.0.0.1:${s.address().port}/csv` };
}

function запустить(env) {
  return new Promise(ok => {
    const п = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch-sheet.mjs')],
      { env: { ...process.env, ...env }, cwd: ROOT });
    let out = '';
    п.stdout.on('data', d => { out += d; });
    п.stderr.on('data', d => { out += d; });
    п.on('close', код => ok({ код, out }));
  });
}

/* Каждой проверке — своя папка: скачиватель пишет файл, и соседки
   не должны видеть чужой. */
function папка() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'faryma-fetch-'));
}

test('свежая выгрузка записывается', async () => {
  const { s, адрес } = await сервер(архив(10));
  const дир = папка(), out = path.join(дир, 'data.csv');
  try {
    const r = await запустить({ SHEET_CSV_URL: адрес, OUT: out });
    assert.equal(r.код, 0, `скачиватель упал:\n${r.out}`);
    assert.ok(fs.existsSync(out), 'файл не записан');
    assert.match(r.out, /свежий стрим №10|строк/, 'нечего не сказал про выгрузку');
  } finally { s.close(); fs.rmSync(дир, { recursive: true, force: true }); }
});

test('старая копия архива не перезаписывает свежую', async () => {
  // в файле уже лежит архив до №10, а выгрузка отдаёт только до №7:
  // так выглядит спрятанный старый лист, с которого архив переехал
  const дир = папка(), out = path.join(дир, 'data.csv');
  fs.writeFileSync(out, архив(10));
  const { s, адрес } = await сервер(архив(7, 60));   // строк даже больше, а стрим старее
  try {
    const r = await запустить({ SHEET_CSV_URL: адрес, OUT: out });
    assert.equal(r.код, 1, `старую копию пропустили:\n${r.out}`);
    assert.match(r.out, /№10/, 'не сказал, какой стрим был');
    assert.match(r.out, /вкладк/i, 'не подсказал, что дело в номере вкладки');
    // и главное — файл остался прежним
    const сейчас = fs.readFileSync(out, 'utf8');
    assert.ok(сейчас.includes('СТРИМ №10'), 'архив всё-таки перезаписали старой копией');
  } finally { s.close(); fs.rmSync(дир, { recursive: true, force: true }); }
});

test('тот же стрим не считается откатом', async () => {
  // между стримами выгрузка меняется, а номер стоит на месте —
  // это норма, и ругаться тут не на что
  const дир = папка(), out = path.join(дир, 'data.csv');
  fs.writeFileSync(out, архив(10));
  const { s, адрес } = await сервер(архив(10, 45));
  try {
    const r = await запустить({ SHEET_CSV_URL: адрес, OUT: out });
    assert.equal(r.код, 0, `обругал нормальную выгрузку:\n${r.out}`);
  } finally { s.close(); fs.rmSync(дир, { recursive: true, force: true }); }
});

test('страница входа вместо выгрузки не проходит', async () => {
  const { s, адрес } = await сервер('<!DOCTYPE html><html><body>Войдите</body></html>');
  const дир = папка(), out = path.join(дир, 'data.csv');
  try {
    const r = await запустить({ SHEET_CSV_URL: адрес, OUT: out });
    assert.equal(r.код, 1, 'страницу входа приняли за архив');
    assert.equal(fs.existsSync(out), false, 'записали HTML вместо архива');
    assert.match(r.out, /доступ/i, 'не объяснил, в чём дело');
  } finally { s.close(); fs.rmSync(дир, { recursive: true, force: true }); }
});
