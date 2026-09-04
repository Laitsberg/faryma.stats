/* ============================================================
   СТРАНИЦА ОЧЕРЕДИ
   ------------------------------------------------------------
   Ответ бота подделываем: настоящий требует сети, а проверять надо
   не бота, а то, что страница из его ответа рисует. Подделка сделана
   по живому /queue/debug — те же виды и то же их распределение.

   Стережём тут две вещи. Первая — что цены не появятся на странице,
   даже если однажды приедут от бота. Вторая — что страница честно
   говорит, когда бот молчит, а не показывает пустоту.
   ============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser } from './helpers.mjs';

const ВИДЫ = [['донат', 4], ['заказ', 28], ['повтор', 1], ['долг ×9', 9],
  ['долг ×8', 22], ['долг ×7', 16], ['долг ×6', 2], ['долг ×5', 10],
  ['долг ×4', 11], ['долг ×3', 41], ['долг ×2', 30], ['долг', 12]];

function подделка() {
  const треки = [];
  for (const [тип, n] of ВИДЫ) for (let i = 0; i < n; i++) {
    const m = тип.match(/×(\d+)/);
    треки.push({
      что: треки.length % 3 === 0
        ? 'https://open.spotify.com/track/13JjbD8SXv6t1jU0frwvKP'
        : `Артист ${треки.length} - Трек`,
      кто: `зритель${треки.length % 7}`, откуда: '', жанр: '',
      инфа: треки.length % 4 === 0 ? 'Скип до подготовки' : '',
      вид: тип.startsWith('долг') ? 'долг' : тип,
      кратность: m ? +m[1] : null, тип, н: треки.length + 1
    });
  }
  return { стрим: '5.09.2026', всего: треки.length, треки,
    группы: Object.fromEntries(ВИДЫ), обновлено: new Date().toISOString() };
}

const ОТВЕТ = JSON.stringify(подделка());
const ВСЕГО = ВИДЫ.reduce((s, [, n]) => s + n, 0);

let srv, brw, page;

before(async () => {
  srv = await startServer();
  brw = await browser();
  page = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/queue', r => r.fulfill({
    status: 200, contentType: 'application/json; charset=utf-8', body: ОТВЕТ }));
  await page.goto(srv.base + '/queue.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#qApp:not([hidden])');
});

after(async () => { await brw?.close(); srv?.server.close(); });

test('очередь показана целиком и в исходном порядке', async () => {
  const итог = await page.evaluate(() => ({
    строк: document.querySelectorAll('#qRows tr').length,
    первый: document.querySelector('#qRows td')?.textContent.trim(),
    метка: document.getElementById('streamTag').textContent,
    видов: document.querySelectorAll('#qLadder .rung').length
  }));
  assert.equal(итог.строк, ВСЕГО, 'в списке не все заявки');
  assert.equal(итог.первый, '1', 'нумерация начинается не с единицы');
  assert.match(итог.метка, /5\.09\.2026/, 'дата стрима не показана');
  assert.equal(итог.видов, ВИДЫ.length, 'показаны не все виды');
});

test('цифр в табло четыре — столько же, сколько колонок у сетки', async () => {
  // .kpis.k4 задаёт 4 / 2 / 2. Станет цифр другое число — поправить класс,
  // иначе последняя уедет на свою строку рядом с пустой ячейкой
  const n = await page.$$eval('#qKpis .kpi', ns => ns.length);
  assert.equal(n, 4, 'изменилось число цифр — поправь класс k4 у .kpis');
  const колонок = await page.$eval('#qKpis',
    e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  assert.equal(колонок, 4, 'колонок не столько, сколько цифр');
});

test('нажатие на вид оставляет только его, повторное — снимает', async () => {
  await page.click('#qLadder .rung[data-vid="донат"]');
  let итог = await page.evaluate(() => ({
    строк: document.querySelectorAll('#qRows tr').length,
    состояние: document.getElementById('qState').textContent
  }));
  assert.equal(итог.строк, 4, 'отбор по виду «донат» показал не четыре заявки');
  assert.match(итог.состояние, /донат/);

  await page.click('#qLadder .rung[data-vid="донат"]');
  итог = await page.evaluate(() => document.querySelectorAll('#qRows tr').length);
  assert.equal(итог, ВСЕГО, 'повторное нажатие не сняло отбор');
});

test('на странице нет ни цен, ни рублей', async () => {
  // Даже если однажды бот начнёт их присылать, страница не должна их показать
  const текст = await page.$eval('body', e => e.innerText);
  assert.ok(!/\d\s?\d{3}\s?(р|₽|руб)/i.test(текст), 'на странице нашлась сумма');
  assert.ok(!/цена/i.test(текст), 'на странице нашлось слово «цена»');
});

test('когда бот молчит, страница говорит об этом, а не пустует', async () => {
  const стр = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await стр.route('**/queue', r => r.fulfill({
      status: 503, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ беда: 'очередь не прочиталась' }) }));
    await стр.goto(srv.base + '/queue.html', { waitUntil: 'networkidle' });
    await стр.waitForSelector('#qErr:not([hidden])', { timeout: 15000 });
    const итог = await стр.evaluate(() => ({
      видно: !document.getElementById('qErr').hidden,
      текст: document.getElementById('qErrText').textContent,
      списокСкрыт: document.getElementById('qApp').hidden
    }));
    assert.equal(итог.видно, true);
    assert.equal(итог.списокСкрыт, true, 'показан пустой список вместо объяснения');
    assert.match(итог.текст, /не читается|бот/i, 'объяснение ничего не объясняет');
  } finally { await стр.close(); }
});

test('страница не разъезжается по ширине', async () => {
  for (const w of [320, 390, 820, 1440]) {
    const стр = await brw.newPage({ viewport: { width: w, height: 900 } });
    try {
      await стр.route('**/queue', r => r.fulfill({
        status: 200, contentType: 'application/json; charset=utf-8', body: ОТВЕТ }));
      await стр.goto(srv.base + '/queue.html', { waitUntil: 'networkidle' });
      await стр.waitForSelector('#qApp:not([hidden])');
      const вбок = await стр.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(вбок, false, `на ширине ${w} страница едет вбок`);
    } finally { await стр.close(); }
  }
});
