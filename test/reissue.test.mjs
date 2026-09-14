/* ============================================================
   ПЕРЕИЗДАНИЯ
   ------------------------------------------------------------
   Год у Spotify — это дата издания, а не дата песни. Пока альбом
   обычный, разницы нет; у концертника, ремастера и юбилейного
   сборника дата уезжает на годы вперёд, и «Led Zeppelin — No
   Quarter» выходит 2007-го вместо 1973-го.

   Ниже — настоящие строки из архива, но записанные в тест руками:
   на data/years.json точные числа проверять нельзя, файл
   переписывается каждым прогоном.

   Половина проверок здесь стережёт не «поймал», а «не поймал».
   Простое /live/i выглядит соблазнительно и ломает ровно эти
   случаи: в «『ウマ娘』WINNING LIVE 22» и «Date A Live» живого
   ничего нет, это часть названия.
   ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { переиздание } from '../scripts/reissue.mjs';

test('концертную запись видно по обороту «Live At/From»', () => {
  assert.equal(переиздание('Basket Worm - Live At Zepp DiverCity, 2022',
                           'Ado 1st Live Kigeki (Live At Zepp DiverCity, 2022)'), true);
  assert.equal(переиздание('Way Down Hadestown', 'Hadestown: Live From London'), true);
  assert.equal(переиздание('Enter the Mirror (2022 Remastered)', "'77 LIVE (2022 Remastered)"), true);
  // Обособленное «live» — тоже пометка версии, Spotify так и пишет.
  assert.equal(переиздание('Mitchell: Chant II (Live)', 'Hadestown (Original Cast Recording) [Live]'), true);
  assert.equal(переиздание('Fly Me to the Moon - Live', 'Evangelion Finally'), true);
});

test('ремастер и перезапись видно по названию', () => {
  assert.equal(переиздание('No Quarter - Remaster', 'Mothership (Remastered)'), true);
  assert.equal(переиздание('Killer Queen - Remastered 2011', 'Sheer Heart Attack'), true);
  assert.equal(переиздание('Puritania - Remixed & Remastered', 'Puritanical Euphoric Misanthropia'), true);
  assert.equal(переиздание('All Too Well (10 Minute Version)', "Red (Taylor's Version)"), true);
  assert.equal(переиздание('Heroin', 'The Velvet Underground & Nico 45th Anniversary'), true);
  // Хватает и одного альбома: у трека название бывает чистое.
  assert.equal(переиздание('Master Of Puppets', 'Master Of Puppets (Remastered)'), true);
});

test('сборники, которые Spotify не помечает сборниками', () => {
  assert.equal(переиздание('el cazador', '30th Anniversary Early BEST Collection for Soundtrack'), true);
  assert.equal(переиздание('デート・ア・ライブ', '選んでデート・ア・ライブ 〜DATE A LIVE BEST SELECTION〜'), true);
  assert.equal(переиздание('Danger Zone', 'The Greatest Hits Of Kenny Loggins'), true);
  assert.equal(переиздание('Johnny Be Fair', 'The Best Of'), true);
});

test('обычный релиз не трогаем', () => {
  assert.equal(переиздание('Usseewa', 'Kyogen'), false);
  assert.equal(переиздание('Tightrope', 'A New World Record'), false);
  // Радио-версия и сингловая правка — это тот же выпуск, а не переиздание.
  assert.equal(переиздание('Alors on danse - Radio Edit', 'Cheese'), false);
  assert.equal(переиздание('Galvanize - Edit', 'Galvanize'), false);
  assert.equal(переиздание('Utauyo !! Miracle - Instrumental', 'Utauyo!! Miracle [Standard Edition]'), false);
});

/* Ловушка на жадность: если заменить разбор на простое /live/i, эти
   три строки начнут считаться концертниками, и сорок с лишним верных
   годов уедут на пересверку зря. Проверено обратным ходом — с /live/i
   проверка падает. */
test('слово «live» внутри названия — ещё не концерт', () => {
  assert.equal(переиздание('どこまで走れば', '『ウマ娘 プリティーダービー』WINNING LIVE 22'), false);
  assert.equal(переиздание('デート・ア・ライブ', 'Date A Live Original Soundtrack'), false);
  assert.equal(переиздание('Alive - Single Version', 'Demons Are a Girl'), false);
});

test('пустые и кривые входные данные не роняют разбор', () => {
  assert.equal(переиздание(null, null), false);
  assert.equal(переиздание(undefined, ''), false);
  assert.equal(переиздание('', 'Live At Wembley'), true);
});

/* Уговор с data/years.json: у трека, помеченного переизданием, год
   остаётся только если его подтвердил поиск оригинала. Иначе года нет
   вовсе — лучше пусто, чем 2007-й у песни 1973 года.
   Точных чисел тут нет намеренно: файл переписывается каждым прогоном
   сбора, и завтра их станет больше. */
test('год у переиздания стоит только там, где его подтвердил поиск', () => {
  const f = path.join(ROOT, 'data', 'years.json');
  if (!fs.existsSync(f)) return;
  const tracks = JSON.parse(fs.readFileSync(f, 'utf8')).tracks || {};
  const плохие = [];
  for (const [k, v] of Object.entries(tracks)) {
    // Записи, собранные по прежним правилам, этот уговор не давали.
    if ((v.v ?? 1) < 7) continue;
    if (!v.переиздание || !v.year) continue;
    if (!v.годПоиска) плохие.push(`${k}: ${v.year} с «${v.spAlbum}», поиск не спрашивали`);
  }
  assert.deepEqual(плохие, []);
});

/* ============================================================
   СБОР ЦЕЛИКОМ, НА ПОДСТАВНОМ SPOTIFY
   ------------------------------------------------------------
   Одной регулярки мало: важно, что́ скрипт делает с найденным
   переизданием. В песочнице до api.spotify.com не достучаться, но
   years.mjs и не обязан туда ходить — адрес он берёт из SP_API,
   и сюда подставляется свой сервер на localhost.

   Три случая, ради которых всё и затевалось:
     · ссылка ведёт на ремастер, поиск находит оригинал → год оригинала;
     · ссылка ведёт на концертник, поиск пуст        → года нет вовсе;
     · ссылка ведёт на обычный альбом                → поиск не трогаем.

   Последнее не придирка: сверять всех подряд — это вдвое больше
   запросов, а лимит Spotify отвечает на перебор закрытым окном на час.
   ============================================================ */

import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ТРЕКИ = {
  remaster: {
    id: 'remaster', name: 'No Quarter - Remaster', duration_ms: 427000,
    artists: [{ name: 'Led Zeppelin' }],
    album: { name: 'Mothership (Remastered)', album_type: 'album', release_date: '2007-11-12',
             images: [{ width: 300, url: 'http://картинка/mothership.jpg' }] }
  },
  concert: {
    id: 'concert', name: 'Nothing Findable - Live At Nowhere', duration_ms: 200000,
    artists: [{ name: 'Никто' }],
    album: { name: 'Концерт в никуда (Live At Nowhere)', album_type: 'album', release_date: '2024-01-01',
             images: [{ width: 300, url: 'http://картинка/live.jpg' }] }
  },
  plain: {
    id: 'plain', name: 'Usseewa', duration_ms: 180000,
    artists: [{ name: 'Ado' }],
    album: { name: 'Kyogen', album_type: 'album', release_date: '2020-10-23',
             images: [{ width: 300, url: 'http://картинка/kyogen.jpg' }] }
  }
};

/* Что отдаёт поиск. У концертника оригинала нет намеренно — это и есть
   случай «подтвердить нечем». */
const ПОИСК = {
  'No Quarter|Led Zeppelin': [{
    id: 'orig', name: 'No Quarter', duration_ms: 427000,
    artists: [{ name: 'Led Zeppelin' }],
    album: { name: 'Houses Of The Holy', album_type: 'album', release_date: '1973-03-28',
             images: [{ width: 300, url: 'http://картинка/houses.jpg' }] }
  }]
};

test('переиздание по ссылке сверяется поиском, обычный альбом — нет', async () => {
  const поиски = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    res.setHeader('content-type', 'application/json');
    /* Токен только латиницей: кириллица в заголовке Authorization
       роняет fetch с «Cannot convert argument to a ByteString». */
    if (u.pathname.endsWith('/token'))
      return res.end(JSON.stringify({ access_token: 'test', expires_in: 3600 }));
    const m = u.pathname.match(/\/tracks\/(.+)$/);
    if (m) return res.end(JSON.stringify(ТРЕКИ[m[1]] || {}));
    if (u.pathname.endsWith('/search')) {
      const q = u.searchParams.get('q') || '';
      поиски.push(q);
      const наз = (q.match(/track:"([^"]*)"/) || [])[1] || '';
      const исп = (q.match(/artist:"([^"]*)"/) || [])[1] || '';
      return res.end(JSON.stringify({ tracks: { items: ПОИСК[`${наз}|${исп}`] || [] } }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const порт = srv.address().port;

  const дом = fs.mkdtempSync(path.join(os.tmpdir(), 'years-'));
  const csv = path.join(дом, 'a.csv'), вых = path.join(дом, 'years.json');
  fs.writeFileSync(csv,
    'Что,Где,Когда,Кто,Тип,Столбец 6,Оценка,Откуда,Тэги,Жанр,Фича\n' +
    '1) Led Zeppelin — No Quarter,https://open.spotify.com/track/remaster,,,,,атлична,,,,\n' +
    '2) Никто — Nothing Findable,https://open.spotify.com/track/concert,,,,,атлична,,,,\n' +
    '3) Ado — Usseewa,https://open.spotify.com/track/plain,,,,,атлична,,,,\n');

  /* spawn, а не execFile: с execFile дочерний процесс ждёт ответа от
     сервера, который живёт в этом же процессе, и оба стоят насмерть. */
  const ch = spawn('node', ['scripts/years.mjs', '--csv', csv, '--out', вых], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, SPOTIFY_CLIENT_ID: 'x', SPOTIFY_CLIENT_SECRET: 'y',
           SP_API: `http://127.0.0.1:${порт}/v1`,
           SP_TOKEN_URL: `http://127.0.0.1:${порт}/token`, SP_DELAY: '0' }
  });
  const код = await new Promise(r => ch.on('exit', r));
  srv.close();
  assert.equal(код, 0, 'сбор должен завершиться без ошибки');

  const t = JSON.parse(fs.readFileSync(вых, 'utf8')).tracks;
  fs.rmSync(дом, { recursive: true, force: true });

  const зеп = t['led zeppelin|no quarter'];
  assert.equal(зеп.year, 1973, 'год берётся у оригинала, а не у ремастера');
  assert.equal(зеп.как, 'ссылка→поиск');
  assert.equal(зеп.переиздание, true);
  // Обложка и альбом остаются от ссылки: они про ту самую запись.
  assert.equal(зеп.обложка, 'http://картинка/mothership.jpg');

  const конц = t['никто|nothing findable'];
  assert.equal(конц.year, null, 'подтвердить нечем — года нет совсем');
  assert.equal(конц.переиздание, true);
  assert.equal(конц.обложка, 'http://картинка/live.jpg', 'обложка при этом на месте');
  assert.equal(конц.альбом, 'Концерт в никуда (Live At Nowhere)');

  const ado = t['ado|usseewa'];
  assert.equal(ado.year, 2020);
  assert.equal(ado.переиздание, undefined, 'обычный альбом переизданием не считается');

  assert.equal(поиски.length, 2, 'поиском сверяли только два переиздания из трёх треков');
});
