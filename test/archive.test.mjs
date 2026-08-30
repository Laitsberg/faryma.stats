/* ============================================================
   АРХИВ
   ------------------------------------------------------------
   Проверки на настоящем data.csv. Архив пополняется каждый день,
   поэтому здесь нет точных чисел — только то, что обязано быть
   правдой и завтра: границы, суммы, отсутствие мусора.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadParse, constOf, readCsv, buildRows } from './helpers.mjs';

const ctx = loadParse();
const SCALE_ORDER = constOf(ctx, 'SCALE_ORDER');
const TIERS = constOf(ctx, 'TIERS');
const raw = readCsv();
const { rows, streams, offscale } = buildRows(ctx, raw);

test('архив не съёжился', () => {
  // На 29 августа 2026 — 6697. Порог заметно ниже: он ловит поломку
  // выгрузки, а не рост архива.
  assert.ok(rows.length >= 6500, `разносов всего ${rows.length}`);
  assert.ok(streams.length >= 270, `стримов всего ${streams.length}`);
});

test('средний балл в разумных пределах', () => {
  const avg = rows.reduce((a, r) => a + r.rate.score, 0) / rows.length;
  assert.ok(avg > 6 && avg < 7.5, `средний балл ${avg.toFixed(4)}`);
});

test('каждая оценка есть на шкале', () => {
  const чужие = [...new Set(rows.map(r => r.rate.label))].filter(l => !SCALE_ORDER.includes(l));
  assert.deepEqual(чужие, [], 'оценки вне шкалы попали в статистику');
});

test('сумма подступеней сходится со ступенью', () => {
  for (const t of TIERS) {
    const ступень = rows.filter(r => r.rate.tier === t.key).length;
    const части = SCALE_ORDER.filter(l => l.startsWith(t.key))
      .reduce((s, l) => s + rows.filter(r => r.rate.label === l).length, 0);
    assert.equal(части, ступень, `${t.key}: ${части} ≠ ${ступень}`);
  }
});

test('баллы не выходят за шкалу', () => {
  const плохие = rows.filter(r => !(r.rate.score >= 0 && r.rate.score <= 10));
  assert.equal(плохие.length, 0);
});

test('шуточные оценки не считаются за настоящие', () => {
  assert.equal(rows.filter(r => /^гениально\+/.test(r.rate.label)).length, 0);
  // и при этом не пропадают: им место в разделе «вне шкалы»
  assert.ok(offscale.some(o => /гени|генит/i.test(o.raw)),
    'шуточные «гениально+» должны лежать в разделе вне шкалы');
});

test('у каждого разноса есть эфир, название и номер трека', () => {
  assert.equal(rows.filter(r => r.streamNum == null).length, 0, 'разнос без эфира');
  assert.equal(rows.filter(r => !r.title).length, 0, 'разнос без названия');
  assert.equal(rows.filter(r => r.pos == null).length, 0, 'разнос без номера трека');
});

test('номера эфиров уникальны, и нулевой на месте', () => {
  const nums = streams.map(s => s.num);
  assert.equal(new Set(nums).size, nums.length, 'повторяющийся номер стрима');
  assert.ok(nums.includes(0), 'потерялся СТРИМ №0');
  assert.equal(streams.filter(s => !s.date).length, 0, 'у стрима нет даты');
});

test('в названиях не осталось служебных пометок', () => {
  const сор = rows.filter(r => /ПОВТОР:/i.test(r.title));
  assert.deepEqual(сор.map(r => r.title), [], 'пометка о повторе попала в название');
});

test('пометки о повторах разбираются', () => {
  const RE = /ПОВТОР:\s*(?:стрим\s*№?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*стрим)\s*[;,]\s*(\d+)\s*трек/i;
  const всего = rows.filter(r => /ПОВТОР[:\s]/i.test(r.full || '')).length;
  const разобрано = rows.filter(r => RE.test(r.full || '')).length;
  assert.ok(всего >= 40, `пометок всего ${всего}`);
  // три пометки написаны свободной формой («Этот стрим», «68.5; Трек от…»)
  assert.ok(разобрано >= всего - 4, `разобрано ${разобрано} из ${всего}`);
});

test('оценки вне шкалы не пересекаются с оценёнными', () => {
  assert.ok(offscale.length >= 20, `вне шкалы всего ${offscale.length}`);
  const оценённые = new Set(rows.map(r => r.i));
  assert.equal(offscale.filter(o => оценённые.has(o.i)).length, 0);
});

test('вселенная не бывает обрывком пометки', () => {
  // Пустая строка — это «вселенной нет», так у двух третей архива, и
  // это нормально. А вот «OST», «MV» или «Dr» в качестве вселенной —
  // всегда след того, что парсер зацепил не ту часть строки.
  const МУСОР = /^(?:OST|OP|ED|MV|PV|VN|UTA|OVA|Opening|Ending|Insert|Theme|Song|Live|Cover|Piano|Remix|Instrumental|Acoustic|Vocal|ep)$/i;
  const плохие = [...new Set(rows.map(r => r.source).filter(Boolean))].filter(s => МУСОР.test(s));
  assert.deepEqual(плохие, [], 'пометка стала вселенной');
});

test('вселенных достаточно много и они не схлопнулись', () => {
  const src = new Set(rows.map(r => r.source).filter(Boolean));
  assert.ok(src.size >= 1600, `вселенных всего ${src.size}`);
  // франшизы, которые парсер уже однажды схлопывал по слэшу
  for (const s of ['Fate/Zero', 'Fate/stay night', '.hack//Sign'])
    assert.ok(src.has(s), `потерялась вселенная «${s}»`);
});

test('тайм-коды растут внутри эфира', () => {
  // Не строго: в архиве есть эфиры с разъехавшимися тайм-кодами, но
  // если бы порядок ломался повсеместно, длительности стали бы враньём.
  let всего = 0, назад = 0;
  const byStream = new Map();
  rows.forEach(r => {
    if (r.sec == null) return;
    if (!byStream.has(r.streamNum)) byStream.set(r.streamNum, []);
    byStream.get(r.streamNum).push(r);
  });
  for (const list of byStream.values()) {
    list.sort((a, b) => a.pos - b.pos);
    for (let i = 1; i < list.length; i++) { всего++; if (list[i].sec < list[i - 1].sec) назад++; }
  }
  assert.ok(назад / всего < 0.02, `тайм-код идёт назад в ${назад} случаях из ${всего}`);
});
