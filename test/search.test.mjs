/* ============================================================
   ПОРЯДОК НАЙДЕННОГО
   ------------------------------------------------------------
   Поиск на сайте показывал найденное по алфавиту, и на запрос «eve»
   исполнитель Eve оказывался пятьдесят третьим: выше стояли чужие
   треки, где «eve» попалось внутри ника заказчика. Теперь порядок
   считает searchRanker — одна и та же функция для сайта и для бота.

   Точные числа требуем только на придуманных строках. По живому
   архиву проверяем лишь то, что обязано быть правдой всегда.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadParse, readCsv } from './helpers.mjs';

const ctx = loadParse();
const ранг = q => ctx.searchRanker(q);

test('пустой запрос не даёт оценщика', () => {
  assert.equal(ctx.searchRanker(''), null);
  assert.equal(ctx.searchRanker('   '), null);
  assert.equal(ctx.searchRanker(null), null);
});

test('лесенка точности: имя весит больше середины чужого названия', () => {
  const r = ранг('eve');
  // порядок ступеней: чем меньше число, тем точнее
  assert.equal(r('Laputa', 'Eve', 'кто-то'),        0, 'название целиком');
  assert.equal(r('Eve', 'Dramaturgy', 'кто-то'),    1, 'имя целиком');
  assert.equal(r('Everglow', 'Adios', 'кто-то'),     2, 'имя начинается с запроса');
  assert.equal(r('Muse', 'Evening Star', 'кто-то'), 3, 'название начинается с запроса');
  assert.equal(r('Steve Vai', 'For The Love', 'к'), 4, 'запрос внутри имени');
  assert.equal(r('Muse', 'Make Believe', 'кто-то'), 5, 'запрос внутри названия');
  assert.equal(r('Muse', 'Hysteria', 'StillReverie'), 6, 'запрос внутри ника');
  assert.equal(r('Muse', 'Hysteria', 'кто-то'),     7, 'совпало где-то ещё');
});

test('артист внутри имени обходит запрос внутри чужого названия', () => {
  // ради этого ступени и переставлены: «ева» находится и в «танцевать»,
  // и в «Пугачева», и второе человеку нужнее
  const r = ранг('ева');
  assert.ok(r('Алла Пугачева', 'Старинные часы', 'кто') <
            r('Кирилл Коперник', 'Пора танцевать', 'кто'),
    'слово внутри названия обошло фамилию исполнителя');
});

test('регистр не важен', () => {
  const r = ранг('AIMER');
  assert.equal(r('aimer', 'Last Stardust', 'кто'), 1);
  assert.equal(ранг('aimer')('Aimer', 'Last Stardust', 'кто'), 1);
});

test('пробелы и знаки не мешают: «kick back» и «KICKBACK» — одно', () => {
  assert.equal(ранг('kick back')('Kenshi Yonezu', 'KICKBACK', 'кто'), 0);
  assert.equal(ранг('kickback')('Kenshi Yonezu', 'KICK BACK', 'кто'), 0);
  assert.equal(ранг('kick back')('KICKBACK', 'что-то', 'кто'), 1);
});

test('знаки регулярок в запросе не ломают поиск', () => {
  // в архиве есть «AC/DC», «(sic)», «+44» — запрос идёт в регулярку,
  // и без экранирования такие строки роняли бы страницу
  for (const q of ['AC/DC', '(sic)', 'a+b', 'C++', '[alexandros]', '*', '?']) {
    assert.doesNotThrow(() => ранг(q)('кто', 'что', 'кто'), `запрос «${q}» уронил оценщик`);
  }
  assert.equal(ранг('AC/DC')('AC/DC', 'Thunderstruck', 'кто'), 1);
  assert.equal(ранг('[alexandros]')('[ALEXANDROS]', 'Wataridori', 'кто'), 1);
});

test('пустые поля не считаются совпадением', () => {
  const r = ранг('eve');
  assert.equal(r('', '', ''), 7);
  assert.equal(r(null, undefined, null), 7);
});

/* ---------- по живому архиву ---------- */

function архив() {
  const rows = [];
  let stream = null;
  readCsv().forEach(r => {
    const st = ctx.parseStream(r['Что'], r['Где']);
    if (st) { stream = st; return; }
    if (!ctx.parseRate(r['Оценка'])) return;
    const w = ctx.parseWhat(r['Что']);
    const user = (r['Кто'] || '').trim();
    rows.push({ artist: w.artist || '', title: w.title || '', user,
      search: (w.full + ' ' + user).toLowerCase() });
  });
  return rows;
}

test('в архиве исполнитель не тонет под чужими совпадениями', () => {
  const rows = архив();
  assert.ok(rows.length > 1000, 'архив не прочитался');

  // Запросы, на которые в архиве заведомо много случайных попаданий
  // внутри слов. Точных чисел не требуем — они меняются каждый день, —
  // но исполнитель с этим запросом в имени обязан быть наверху.
  for (const q of ['eve', 'ado', 'kana', 'mili']) {
    const хиты = rows.filter(r => r.search.includes(q));
    const свои = хиты.filter(r => r.artist.toLowerCase().includes(q));
    if (!свои.length) continue;          // такого артиста в архиве больше нет

    const r = ранг(q);
    const по = [...хиты].sort((a, b) =>
      r(a.artist, a.title, a.user) - r(b.artist, b.title, b.user));
    const место = по.findIndex(x => x.artist.toLowerCase().includes(q)) + 1;
    assert.ok(место <= 3,
      `«${q}»: исполнитель с этим именем только на ${место}-м месте из ${хиты.length}`);
  }
});

test('на живом архиве оценщик никого не роняет', () => {
  const rows = архив();
  const r = ранг('eve');
  for (const х of rows) {
    const v = r(х.artist, х.title, х.user);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 7,
      `у строки «${х.artist} — ${х.title}» оценка ${v}`);
  }
});
