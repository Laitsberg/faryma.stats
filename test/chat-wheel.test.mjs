/* ============================================================
   ОТ ЧАТА ДО КОЛЕСА
   ------------------------------------------------------------
   Сквозная проверка: человек написал в чат — сервис его запомнил —
   страница колеса подставила его в участники. По кускам всё работало
   и раньше, ломается обычно стык.

   Живёт отдельным файлом: здесь одновременно поднимаются поддельный
   чат, статика сайта, наш сервис и браузер, и мешать это с мелкими
   проверками разбора протокола незачем.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer, browser } from './helpers.mjs';

test('ник из чата доезжает до колеса на сайте', async () => {
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

  клиенты.forEach(c => c.write(['kumashisan', 'Svd_bb', 'Летта', 'Moobot']
    .map(n => `:${n}!${n}@${n}.tmi.twitch.tv PRIVMSG #farymacomposer :привет\r\n`).join('')));
  await new Promise(r => setTimeout(r, 400));

  const brw = await browser();
  const p = await brw.newPage({ viewport: { width: 1280, height: 900 } });
  const ошибки = [];
  p.on('pageerror', e => ошибки.push(e.message));
  await p.goto(srv.base + '/wheel.html', { waitUntil: 'networkidle' });
  await p.evaluate(a => { window.CHAT_URL = a; }, адрес);
  await p.click('#chat');
  await p.waitForFunction(() => /человек|не вышло|никого/
    .test(document.getElementById('chatNote').textContent), null, { timeout: 20000 });

  const итог = await p.evaluate(() => ({
    заметка: document.getElementById('chatNote').textContent,
    сколько: +document.getElementById('count').textContent,
    имена: document.getElementById('names').value.split('\n')
  }));

  await brw.close();
  бот.server.close();
  srv.server.close();
  чат.сброс();
  клиенты.forEach(c => c.destroy());
  чатСервер.close();

  assert.deepEqual(ошибки, []);
  assert.ok(!/не вышло/.test(итог.заметка), итог.заметка);
  assert.ok(итог.имена.includes('kumashisan'), 'ник из чата не доехал до колеса');
  assert.ok(итог.имена.includes('Летта'), 'кириллический ник потерялся');
  assert.ok(!итог.имена.some(n => n.toLowerCase() === 'moobot'), 'бот попал в колесо');
  assert.equal(итог.сколько, итог.имена.length);
});
