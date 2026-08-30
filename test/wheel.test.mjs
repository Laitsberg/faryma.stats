/* ============================================================
   КОЛЕСО СУДЬБЫ
   ------------------------------------------------------------
   Колесо крутят в прямом эфире на благотворительном стриме, и
   ошибка там видна всем сразу: объявили одного, а выпал другой.
   Поэтому проверяется и то, как оно выглядит, и то, честно ли
   выбирает.
   ============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser } from './helpers.mjs';

let srv, brw, page;
const ошибки = [];

before(async () => {
  srv = await startServer();
  brw = await browser();
  page = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => ошибки.push('падение: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load/.test(m.text()))
    ошибки.push('консоль: ' + m.text()); });
  await page.goto(srv.base + '/wheel.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
});

after(async () => { await brw?.close(); srv?.server.close(); });

test('страница колеса поднимается без ошибок', () => {
  assert.deepEqual(ошибки, []);
});

test('повтор имени удваивает шансы', async () => {
  // Так устроена таблица композитора: у кого две строки, у того два
  // сектора. Если это сломается, розыгрыш станет нечестным незаметно.
  const доли = await page.evaluate(() => {
    const имена = ['А', 'Б', 'В', 'Г', 'Д', 'А'];
    const счёт = {};
    for (let i = 0; i < 30000; i++) {
      const n = имена[случайный(имена.length)];
      счёт[n] = (счёт[n] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(счёт).map(([k, v]) => [k, v / 30000]));
  });
  assert.ok(Math.abs(доли['А'] - 1 / 3) < 0.02, `«А» выпадала в ${(доли['А'] * 100).toFixed(1)}% вместо 33%`);
  for (const имя of ['Б', 'В', 'Г', 'Д'])
    assert.ok(Math.abs(доли[имя] - 1 / 6) < 0.02, `«${имя}»: ${(доли[имя] * 100).toFixed(1)}% вместо 16.7%`);
});

test('выбор равномерен и не любит первый сектор', async () => {
  /* Порог считан, а не выбран на глаз. На 50 секторах и 300 000
     розыгрышей на сектор приходится по 6000, случайный разброс — около
     77, то есть 1.3%. Крайние значения из полусотни отходят примерно на
     три с половиной таких разброса, это 4.5%. Порог в 12% оставляет
     тройной запас: честный генератор его не перешагнёт, а перекошенный
     провалит. Прежний порог в 10% при 50 000 прогонов был на грани и
     падал сам по себе. */
  const края = await page.evaluate(() => {
    const n = 50, счёт = new Array(n).fill(0);
    for (let i = 0; i < 300000; i++) счёт[случайный(n)]++;
    const ожидание = 300000 / n;
    return { мин: Math.min(...счёт) / ожидание, макс: Math.max(...счёт) / ожидание };
  });
  assert.ok(края.мин > 0.88 && края.макс < 1.12,
    `перекос: от ${края.мин.toFixed(3)} до ${края.макс.toFixed(3)} от ожидаемого`);
});

test('колесо крутится и объявляет того, кто есть в списке', async () => {
  const имена = ['Аня', 'Боря', 'Вова', 'Гриша', 'Дима'];
  await page.fill('#names', имена.join('\n'));
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('#count', e => e.textContent), '5');

  await page.click('#spin');
  await page.waitForFunction(() => !document.getElementById('out').hidden, null, { timeout: 25000 });
  const выпал = await page.$eval('#winner', e => e.textContent);
  assert.ok(имена.includes(выпал), `объявлен «${выпал}», которого нет в списке`);
});

test('выпавшего можно убрать и вернуть', async () => {
  const было = +(await page.$eval('#count', e => e.textContent));
  await page.click('#drop');
  await page.waitForTimeout(300);
  assert.equal(+(await page.$eval('#count', e => e.textContent)), было - 1);
  assert.equal(await page.$eval('#restore', e => e.hidden), false);

  await page.click('#restore');
  await page.waitForTimeout(300);
  assert.equal(+(await page.$eval('#count', e => e.textContent)), было);
});

test('список переживает перезагрузку страницы', async () => {
  await page.fill('#names', 'Один\nДва\nТри');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  assert.equal(await page.$eval('#names', e => e.value), 'Один\nДва\nТри');
});

test('колесо наполняется из архива', async () => {
  for (const режим of ['year', 'all', 'regular', 'never']) {
    await page.selectOption('#src', режим);
    await page.click('#load');
    await page.waitForFunction(() => /участник|нашлось|не получилось/
      .test(document.getElementById('loadNote').textContent), null, { timeout: 30000 });
    const заметка = await page.$eval('#loadNote', e => e.textContent);
    assert.ok(!/не получилось/.test(заметка), `режим «${режим}»: ${заметка}`);
    const сколько = +(await page.$eval('#count', e => e.textContent));
    assert.ok(сколько > 50, `режим «${режим}» дал всего ${сколько} участников`);
  }
});

test('пустое колесо не даёт себя крутить', async () => {
  await page.click('#clear');
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('#spin', e => e.disabled), true);
  assert.equal(await page.$eval('#count', e => e.textContent), '0');
});

test('страница не разъезжается по ширине', async () => {
  for (const w of [320, 390, 768, 1440]) {
    const p2 = await brw.newPage({ viewport: { width: w, height: 900 } });
    await p2.goto(srv.base + '/wheel.html', { waitUntil: 'networkidle' });
    await p2.fill('#names', ['kumashisan', 'Svd_bb', 'Мишура', 'DzenDish'].join('\n'));
    await p2.waitForTimeout(400);
    const шире = await p2.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await p2.close();
    assert.equal(шире, false, `на ${w}px страница едет вбок`);
  }
});

test('с главной есть ссылка на колесо', async () => {
  const p2 = await brw.newPage();
  await p2.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
  const есть = await p2.$$eval('a[href="wheel.html"]', a => a.length);
  await p2.close();
  assert.ok(есть > 0, 'на главной нет ссылки на колесо');
});
