/* ============================================================
   ОПУБЛИКОВАННЫЙ ЛИСТ — РАЗБОР ЦВЕТОВ
   ------------------------------------------------------------
   Настоящую страницу отсюда не достать, поэтому проверяем на
   выдуманной, повторяющей то, что отдаёт Гугл: <style> с классами
   наверху, номера строк отдельными ячейками слева, объединённые
   ячейки с colspan в объявлениях.

   Главное тут — цвет ячейки «Цена» превращается в пометку, а сама
   цена никуда не попадает.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { сетка, пометкаПоЦвету } from '../bot/pubhtml.mjs';
import { собрать } from '../bot/queue.mjs';

/* Форма — как у Гугла: класс несёт цвет, у ячейки только class. */
const СТРАНИЦА = `<!DOCTYPE html><html><head><style type="text/css">
  .ritz .waffle .s0{background-color:#ffffff;font-size:10pt}
  .ritz .waffle .s1{background-color:#ffff00;}
  .ritz .waffle .s2{background-color:#00ff00;}
  .ritz .waffle .s3{background-color:#e06666;}
  .ritz .waffle .s4{background-color:#efefef;}
</style></head><body><div class="ritz grid-container"><table class="waffle">
<tbody>
 <tr><th class="row-headers-background">1</th>
     <td class="s0">Что</td><td class="s0">Кто</td><td class="s0">Тип</td>
     <td class="s0">Цена</td><td class="s0">Откуда</td><td class="s0">Жанр</td>
     <td class="s0">Доп. инфа</td></tr>
 <tr><th class="row-headers-background">2</th>
     <td class="s0" colspan="7">ВНИМАНИЕ!!! ЗАКАЗ НОВЫХ ТРЕКОВ ОТ 2000Р!!!</td></tr>
 <tr><th class="row-headers-background">3</th>
     <td class="s0" colspan="7">Стрим на 5.09.2026г.</td></tr>
 <tr><th class="row-headers-background">4</th>
     <td class="s0">Fl&#228;schb&#228;nkler &amp; co</td><td class="s0">Rtur</td>
     <td class="s0">донат</td><td class="s1">р.2 222</td>
     <td class="s0"></td><td class="s0"></td><td class="s0">Комментарий</td></tr>
 <tr><th class="row-headers-background">5</th>
     <td class="s0">IKUO - Believer</td><td class="s0">DzenDish</td>
     <td class="s0">донат</td><td class="s2">р.2 200</td>
     <td class="s0"></td><td class="s0"></td><td class="s0"></td></tr>
 <tr><th class="row-headers-background">6</th>
     <td class="s0">OxT - MASS FOR THE DEAD</td><td class="s0">Sheruka</td>
     <td class="s0">долг х8</td><td class="s3">р.1 100</td>
     <td class="s0">Игра</td><td class="s0">рок</td><td class="s0"></td></tr>
 <tr><th class="row-headers-background">7</th>
     <td class="s0">Krol - Green Flash</td><td class="s0">Kipyatocheck</td>
     <td class="s0">долг</td><td class="s4">р.1 000</td>
     <td class="s0"></td><td class="s0">фанк</td><td class="s0"></td></tr>
</tbody></table></div></body></html>`;

test('сетка читает текст, цвет и объединённые ячейки', () => {
  const т = сетка(СТРАНИЦА);
  assert.equal(т.length, 7, 'прочитано не семь строк');
  // номера строк слева — служебные и в таблицу попадать не должны
  assert.equal(т[0][0].текст, 'Что', 'номер строки принят за ячейку');
  // colspan=7 растягивает объявление на семь колонок, иначе «Тип»
  // в следующих строках окажется не под своим заголовком
  assert.equal(т[1].length, 7, 'объединённая ячейка не расширена по colspan');
  // сущности раскодированы: «Fläschbänkler & co».
  // Индекс нулевой, а не первый: номер строки выброшен, и колонки
  // сдвинулись влево — ровно этого мы и добивались
  assert.equal(т[3][0].текст, 'Fläschbänkler & co');
  assert.equal(т[3][3].цвет, '#ffff00', 'цвет ячейки не подхвачен из класса');
});

test('цвет превращается в пометку, а серое и белое — ни во что', () => {
  assert.equal(пометкаПоЦвету('#ffff00'), 'сейчас');
  assert.equal(пометкаПоЦвету('#00ff00'), 'следующий');
  assert.equal(пометкаПоЦвету('#b6d7a8'), 'следующий', 'бледно-зелёный не узнан');
  assert.equal(пометкаПоЦвету('#e06666'), 'потом');
  assert.equal(пометкаПоЦвету('#ff0000'), 'потом');
  // неокрашенные ячейки: это отсутствие пометки, а не пометка
  assert.equal(пометкаПоЦвету('#ffffff'), null);
  assert.equal(пометкаПоЦвету('#efefef'), null);
  assert.equal(пометкаПоЦвету('#000000'), null);
  assert.equal(пометкаПоЦвету(''), null);
  assert.equal(пометкаПоЦвету('не цвет'), null);
});

test('заявки собираются из страницы вместе с пометками', () => {
  const д = собрать(сетка(СТРАНИЦА));
  assert.equal(д.всего, 4, 'объявления приняты за заявки или заявки потеряны');
  assert.equal(д.стрим, '5.09.2026');
  assert.deepEqual([...д.треки.map(т => т.пометка)],
    ['сейчас', 'следующий', 'потом', null]);
  assert.equal(д.пометки, 3, 'счётчик помеченных заявок неверен');
  assert.equal(д.треки[2].тип, 'долг ×8');
  assert.equal(д.треки[3].тип, 'долг ×1', '«долг» без числа — это ×1');
});

test('цены не выходят наружу и из опубликованной страницы', () => {
  const д = собрать(сетка(СТРАНИЦА));
  const всё = JSON.stringify(д);
  assert.ok(!/2\s?222|2\s?200|1\s?100|1\s?000/.test(всё), 'в ответе нашлась сумма');
  assert.ok(!/цена/i.test(всё), 'в ответе нашлась колонка цены');
  // цвет — да, значение — нет: пометка есть, суммы нет
  assert.equal(д.треки[0].пометка, 'сейчас');
});

test('чужая страница не притворяется листом', () => {
  assert.throws(() => сетка('<html><body>вход в аккаунт</body></html>'), /нет таблицы/);
  assert.throws(() => собрать(сетка(
    '<table><tr><td>раз</td><td>два</td></tr></table>')), /не нашёл строку с колонками/);
});
