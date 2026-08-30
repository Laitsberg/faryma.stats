/* ============================================================
   ЧТЕНИЕ ЧАТА
   ------------------------------------------------------------
   К настоящему Twitch отсюда не дотянуться, да и незачем: чат —
   это простой текстовый протокол, и проверить разбор можно на
   своём сервере, который говорит теми же строками.

   Так проверяется именно то, что легко сломать: разбор строки,
   ответ на PING, склейка сообщений, разрезанных на куски,
   отсев ботов и забывание тех, кто писал давно.
   ============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

let сервер, порт, клиенты = [], чат;

/* Поддельный чат: принимает подключение и шлёт то, что попросят */
function поднять() {
  return new Promise(ok => {
    сервер = net.createServer(c => {
      c.setEncoding('utf8');
      клиенты.push(c);
      c.on('data', () => {});          // NICK и JOIN просто глотаем
      c.on('error', () => {});
    });
    сервер.listen(0, '127.0.0.1', () => ok(сервер.address().port));
  });
}

const шлём = строки => клиенты.forEach(c =>
  c.write(строки.map(s => s + '\r\n').join('')));

const подождать = мс => new Promise(r => setTimeout(r, мс));

before(async () => {
  порт = await поднять();
  process.env.CHAT_HOST = '127.0.0.1';
  process.env.CHAT_PORT = String(порт);
  process.env.TWITCH_CHANNEL = 'farymacomposer';
  process.env.CHAT_WINDOW_MIN = '60';
  чат = await import('../bot/chat.mjs');
  чат.начать();
  await подождать(300);
});

after(() => { чат?.сброс(); клиенты.forEach(c => c.destroy()); сервер?.close(); });

test('подключаемся к чату', () => {
  assert.equal(чат.состояние().подключены, true);
  assert.equal(чат.состояние().канал, 'farymacomposer');
});

test('ники из сообщений попадают в список', async () => {
  шлём([
    ':kumashisan!kumashisan@kumashisan.tmi.twitch.tv PRIVMSG #farymacomposer :привет',
    ':Svd_bb!Svd_bb@Svd_bb.tmi.twitch.tv PRIVMSG #farymacomposer :несу трек',
    ':Letta!Letta@Letta.tmi.twitch.tv PRIVMSG #farymacomposer :о да'
  ]);
  await подождать(200);
  const ники = чат.чатеры();
  assert.ok(ники.includes('kumashisan'));
  assert.ok(ники.includes('Svd_bb'));
  assert.equal(ники.length, 3);
});

test('регистр ника сохраняется как в чате', () => {
  assert.ok(чат.чатеры().includes('Svd_bb'), 'ник пришёл в другом регистре');
});

test('один человек не занимает два места', async () => {
  шлём([':kumashisan!kumashisan@kumashisan.tmi.twitch.tv PRIVMSG #farymacomposer :ещё раз']);
  await подождать(200);
  assert.equal(чат.чатеры().filter(n => n === 'kumashisan').length, 1);
});

test('боты каналов в колесо не попадают', async () => {
  шлём([
    ':moobot!moobot@moobot.tmi.twitch.tv PRIVMSG #farymacomposer :команда выполнена',
    ':Nightbot!Nightbot@Nightbot.tmi.twitch.tv PRIVMSG #farymacomposer :правила чата',
    ':StreamElements!se@se.tmi.twitch.tv PRIVMSG #farymacomposer :спасибо за подписку'
  ]);
  await подождать(200);
  const ники = чат.чатеры().map(n => n.toLowerCase());
  for (const бот of ['moobot', 'nightbot', 'streamelements'])
    assert.ok(!ники.includes(бот), `${бот} попал в список`);
});

test('на PING отвечаем PONG, иначе нас отключат', async () => {
  const ответы = [];
  клиенты.forEach(c => c.on('data', d => ответы.push(d)));
  шлём(['PING :tmi.twitch.tv']);
  await подождать(250);
  assert.ok(ответы.join('').includes('PONG :tmi.twitch.tv'), 'на PING не ответили');
});

test('сообщение, разрезанное на куски, всё равно читается', async () => {
  // TCP не обещает, что строка придёт целиком: она может прийти
  // двумя кусками, и склеивать их — наша забота
  клиенты.forEach(c => c.write(':razrez!razrez@razrez.tmi.twitch'));
  await подождать(120);
  клиенты.forEach(c => c.write('.tv PRIVMSG #farymacomposer :половинками\r\n'));
  await подождать(250);
  assert.ok(чат.чатеры().includes('razrez'), 'склеенное сообщение потерялось');
});

test('служебные строки не считаются за людей', async () => {
  const было = чат.чатеры().length;
  шлём([
    ':tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!',
    ':justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #farymacomposer',
    ':tmi.twitch.tv ROOMSTATE #farymacomposer'
  ]);
  await подождать(200);
  assert.equal(чат.чатеры().length, было);
});

test('кто писал давно — забывается', async () => {
  шлём([':ktoto!ktoto@ktoto.tmi.twitch.tv PRIVMSG #farymacomposer :я тут']);
  await подождать(200);
  assert.ok(чат.чатеры().includes('ktoto'), 'ник не записался');

  // окно читается при каждом обращении, поэтому его можно сузить прямо
  // сейчас: то, что было написано секунду назад, сразу станет старым
  const было = process.env.CHAT_WINDOW_MIN;
  process.env.CHAT_WINDOW_MIN = '0.001';     // 60 миллисекунд
  await подождать(150);
  assert.equal(чат.чатеры().length, 0, 'старые ники не забылись');

  process.env.CHAT_WINDOW_MIN = было;
});

