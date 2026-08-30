/* ============================================================
   ПАРСЕР
   ------------------------------------------------------------
   Самая ценная часть набора: почти все ошибки, которые доходили
   до людей, жили именно здесь. Каждая проверка ниже — это либо
   правило шкалы, либо реальный случай из архива, на котором сайт
   уже спотыкался.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadParse, constOf } from './helpers.mjs';

const ctx = loadParse();
const SCALE_ORDER = constOf(ctx, 'SCALE_ORDER');
const TIERS = constOf(ctx, 'TIERS');
const r = s => ctx.parseRate(s);

test('ступени и модификаторы дают ожидаемый балл', () => {
  assert.equal(r('гениально').score, 10);
  assert.equal(r('гениально-').score, 9.7);
  assert.equal(r('гениально - -').score, 9.4);
  assert.equal(r('атлична').score, 8);
  assert.equal(r('атлична++').score, 8.6);
  assert.equal(r('хорошечно - -').score, 5.4);
  assert.equal(r('нормас+').score, 4.3);
  assert.equal(r('ну такое-').score, 1.7);
  assert.equal(r('кринж-контент').score, 0);
});

test('«гениально--» и «гениально - -» — одно и то же', () => {
  assert.equal(r('гениально--').label, 'гениально - -');
  assert.equal(r('гениально - -').label, 'гениально - -');
  assert.equal(r('гениально---').label, 'гениально - -');
});

test('плюс сверх потолка — шутка, а не оценка', () => {
  // Композитор ставит его в одном ряду с «ДЫНЯ +» и «ИМБА+».
  // Раньше плюс молча снимался, и шутка шла в статистику десяткой.
  assert.equal(r('гениально+'), null);
  assert.equal(r('гениально++'), null);
  assert.equal(r('генитально+'), null);
  assert.equal(r('гениально+ (ВЕЛИКИЙ СУП НАВАРИЛИ)'), null);
});

test('минус ниже дна — тоже не оценка, а плюс к кринжу считается', () => {
  assert.equal(r('кринж-контент-'), null);
  assert.equal(r('кринж-контент - -'), null);
  assert.equal(r('кринж-контент+').score, 0.3);
  assert.equal(r('кринж-контент++').score, 0.6);
});

test('балл никогда не выходит за 0–10', () => {
  for (const t of TIERS)
    for (const m of ['++', '+', '', '-', '- -']) {
      const hit = r(t.key + (m === '- -' ? ' - -' : m));
      if (hit) assert.ok(hit.score >= 0 && hit.score <= 10, `${t.key}${m} → ${hit.score}`);
    }
});

test('опечатки из архива разбираются', () => {
  assert.equal(r('отлично').tier, 'атлична');
  assert.equal(r('генитально').tier, 'гениально');
  assert.equal(r('кринж контент+').label, 'кринж-контент+');
  assert.equal(r('ГЕНИАЛЬНО').tier, 'гениально');
  assert.equal(r('  атлична  ').tier, 'атлична');
});

test('комментарий в скобках не мешает', () => {
  assert.equal(r('гениально (МИКРОХРОМАТИКА)').label, 'гениально');
  assert.equal(r('атлична+ (гениально-)').label, 'атлична+');
  assert.equal(r('(кринж-контент)').label, 'кринж-контент');   // в скобках вся оценка
  assert.equal(r('хорошечно- / гениально-').label, 'хорошечно-');  // две через слэш — берём первую
});

test('не-оценки отбрасываются', () => {
  for (const bad of ['', null, undefined, 'ДЫНЯ 🍈 +', 'ИМБА+', 'ГЕ-НЯ-АЛЬНО',
                     'хорошечно как идея', 'бдсм', 'легендарно!!!', 'Гена'])
    assert.equal(r(bad), null, `${bad} не должно быть оценкой`);
});

test('шкала идёт от лучшего к худшему и без выдуманных ступеней', () => {
  assert.equal(SCALE_ORDER[0], 'гениально');
  assert.equal(SCALE_ORDER.at(-1), 'кринж-контент');
  assert.ok(!SCALE_ORDER.includes('гениально+'));
  assert.ok(!SCALE_ORDER.includes('кринж-контент-'));
  // порядок = убывание балла
  const scores = SCALE_ORDER.map(l => r(l).score);
  for (let i = 1; i < scores.length; i++)
    assert.ok(scores[i] <= scores[i - 1], `${SCALE_ORDER[i]} стоит не на месте`);
});

test('номер трека и разбор строки «Что»', () => {
  const w = ctx.parseWhat('11) TK from Ling Tosite Sigure — Signal [1 Opening 91 Days / 91 День]');
  assert.equal(w.pos, 11);
  assert.equal(w.artist, 'TK from Ling Tosite Sigure');
  assert.equal(w.title, 'Signal');
});

test('дробный номер трека не оставляет хвоста в названии', () => {
  // «18.5)» раньше резалось до «5)», и в 225 названиях оставался мусор
  const w = ctx.parseWhat('18.5) Kenshi Yonezu — KICK BACK');
  assert.equal(w.pos, 18.5);
  assert.equal(w.artist, 'Kenshi Yonezu');
  assert.equal(w.title, 'KICK BACK');
  assert.equal(ctx.parseWhat('18,5) A — B').pos, 18.5);
});

test('служебная пометка о повторе не попадает в название', () => {
  const s = '13) Ado — unravel (TK from Ling tosite sigure - unravel; LIVE; Cover; ПОВТОР: СТРИМ №5, 41 трек от Mich) [1 Opening Tokyo Ghoul]';
  const w = ctx.parseWhat(s);
  assert.ok(!/ПОВТОР/i.test(w.title), 'в названии осталась пометка');
  assert.ok(/ПОВТОР/i.test(w.full), 'пометка должна оставаться в полной строке');
});

test('вселенная: слэш внутри названия не разрывает его', () => {
  // «Fate/Zero» — одно название, а «Bleach / Блич» — название и перевод
  assert.equal(ctx.parseSource('A — B [1 Opening Fate/Zero]'), 'Fate/Zero');
  assert.equal(ctx.parseSource('A — B [1 Opening Bleach / Блич]'), 'Bleach');
  assert.equal(ctx.parseSource('A — B [1 Opening .hack//Sign / .хак//ЗНАК]'), '.hack//Sign');
  assert.equal(ctx.parseSource('A — B [OST; Overlord IV / Повелитель 4]'), 'Overlord IV');
});

test('западные мультсериалы не считаются аниме', () => {
  assert.equal(ctx.isAnimeSource('Arcane'), false);
  assert.equal(ctx.isAnimeSource('Arcane: League of Legends'), false);
  assert.equal(ctx.isAnimeSource('Bleach'), true);
});

test('тайм-код переводится в секунды', () => {
  assert.equal(ctx.toSeconds('13:30'), 810);
  assert.equal(ctx.toSeconds('1:46:45'), 6405);
  assert.equal(ctx.toSeconds(''), null);
});

test('строка стрима разбирается, и нулевой номер не теряется', () => {
  const st = ctx.parseStream('СТРИМ №0 (19.05.24)', 'https://vkvideo.ru/video-1_2');
  assert.equal(st.num, 0);
  assert.equal(st.date.getFullYear(), 2024);
  assert.equal(ctx.parseStream('СТРИМ №272 (26.08.26)', '').num, 272);
  assert.equal(ctx.parseStream('1) Обычный трек — Название', ''), null);
});

test('площадка определяется по ссылке', () => {
  assert.equal(ctx.parseLink('https://youtu.be/abc').platform, 'YouTube');
  assert.equal(ctx.parseLink('https://open.spotify.com/track/x').platform, 'Spotify');
  assert.equal(ctx.parseLink('нет ссылки'), null);
});

test('ключи имён сводят написания', () => {
  assert.equal(ctx.nameKey('HOYO-MiX'), ctx.nameKey('HOYO-MIX'));
  assert.equal(ctx.userKey('  kumashisan '), ctx.userKey('Kumashisan'));
  // [...] — массив приезжает из песочницы, у него свой Array.prototype
  assert.deepEqual([...ctx.userParts('kumashisan; Svd_bb')], ['kumashisan', 'Svd_bb']);
});
