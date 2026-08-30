/* ============================================================
   ОТ ЧАТА ДО КОЛЕСА
   ------------------------------------------------------------
   Сквозная проверка: человек написал в чат — сервис его запомнил —
   колесо на странице подставило его в участники. По кускам всё
   работало и раньше, ломается обычно стык.

   Всё одним тестом намеренно. Модули поднимаются один раз на процесс,
   и второй такой же тест в этом же файле подключался бы к уже
   закрытому чату из первого. Да и среда тут дорогая: поддельный чат,
   статика сайта, наш сервис и браузер разом.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer, browser } from './helpers.mjs';

test('чат, колесо и вращение работают вместе', async () => {
  const клиенты = [];
  const чатСервер = net.createServer(c => {
    c.setEncoding('utf8'); клиенты.push(c); c.on('data', () => {}); c.on('error', () => {});
  });
  await new Promise(ok => чатСервер.listen(0, '127.0.0.1', ok));

  process.env.CHAT_HOST = '127.0.0.1';
  process.env.CHAT_PORT = String(чатСервер.address().port);
  process.env.TWITCH_CHANNEL = 'farymacomposer';

  const srv = await startServer();
  process.env.BASE = srv.base;

  const чат = await import('../bot/chat.mjs');
  const бот = await import('../bot/server.mjs');
  чат.начать();
  await new Promise(ok => бот.server.listen(0, '127.0.0.1', ok));
  const адрес = `http://127.0.0.1:${бот.server.address().port}/chatters`;
  await new Promise(r => setTimeout(r, 400));

  const пишут = ники => клиенты.forEach(c => c.write(ники
    .map(n => `:${n}!${n}@${n}.tmi.twitch.tv PRIVMSG #farymacomposer :привет\r\n`).join('')));
  const пауза = мс => new Promise(r => setTimeout(r, мс));

  пишут(['kumashisan', 'Летта', 'Moobot']);
  await пауза(300);

  const brw = await browser();
  const p = await brw.newPage({ viewport: { width: 1280, height: 1000 } });
  const ошибки = [];
  p.on('pageerror', e => ошибки.push(e.message));
  await p.goto(srv.base + '/wheel.html', { waitUntil: 'networkidle' });
  await p.evaluate(a => { window.CHAT_URL = a; }, адрес);
  await p.click('#spinTime [data-sec="6"]');

  /* 1. разовое «взять из чата» */
  await p.click('#chat');
  await p.waitForFunction(() => /человек|не вышло|никого/
    .test(document.getElementById('chatNote').textContent), null, { timeout: 20000 });
  const первый = await p.evaluate(() => ({
    заметка: document.getElementById('chatNote').textContent,
    имена: document.getElementById('names').value.split('\n')
  }));

  /* 2. автообновление подхватывает новых */
  await p.check('#live');
  await p.waitForFunction(() => +document.getElementById('count').textContent > 0,
    null, { timeout: 15000 });
  const сначала = +(await p.$eval('#count', e => e.textContent));

  пишут(['Вова', 'Гриша', 'Дима']);
  await пауза(300);
  await p.evaluate(() => изЧата({ тихо: true }));
  await p.waitForFunction(() => +document.getElementById('count').textContent >= 5,
    null, { timeout: 15000 });
  const стало = +(await p.$eval('#count', e => e.textContent));

  /* 3. пока колесо крутится, список замирает.
     Запрос к чату идёт секунду-другую, и ответ вполне может прийти
     ровно во время вращения — подменять участников в этот момент
     нельзя, иначе объявим не того, кого показали. */
  const до = await p.$eval('#names', e => e.value);
  await p.click('#spin');
  await пауза(700);
  пишут(['ОченьПоздний']);
  await пауза(200);
  await p.evaluate(() => изЧата({ тихо: true }));
  await пауза(300);
  const воВремя = await p.$eval('#names', e => e.value);

  await p.waitForFunction(() => !document.getElementById('out').hidden,
    null, { timeout: 40000 });
  const выпал = await p.$eval('#winner', e => e.textContent);

  /* 4. ручная правка выключает автообновление, иначе оно затрёт написанное */
  await p.fill('#names', 'Я\nСам\nВпишу');
  await пауза(400);
  const живойПосле = await p.$eval('#live', e => e.checked);

  await brw.close();
  бот.server.close();
  srv.server.close();
  чат.сброс();
  клиенты.forEach(c => c.destroy());
  чатСервер.close();

  assert.deepEqual(ошибки, []);
  assert.ok(!/не вышло/.test(первый.заметка), первый.заметка);
  assert.ok(первый.имена.includes('kumashisan'), 'ник из чата не доехал до колеса');
  assert.ok(первый.имена.includes('Летта'), 'кириллический ник потерялся');
  assert.ok(!первый.имена.some(n => n.toLowerCase() === 'moobot'), 'бот попал в колесо');

  assert.equal(сначала, 2, `сначала было ${сначала} вместо двух`);
  assert.equal(стало, 5, `после новых сообщений стало ${стало} вместо пяти`);

  assert.equal(воВремя, до, 'список подменился посреди вращения');
  assert.ok(до.split('\n').includes(выпал), `объявлен «${выпал}», которого не было в списке`);
  assert.equal(живойПосле, false, 'ручная правка не выключила автообновление');
});
