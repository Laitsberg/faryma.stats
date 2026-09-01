#!/usr/bin/env node
/* ============================================================
   СНИМКИ СТРАНИЦЫ
   ------------------------------------------------------------
   Поднимает сайт локально, открывает его в трёх ширинах и
   складывает картинки в папку. Заодно проверяет две вещи, которые
   в проверках не поймаешь глазами, а глазами ловишь поздно:

     * страница не едет вбок ни на одной ширине;
     * колонки первого экрана одной высоты (на широком экране).

   Зачем отдельно от npm test: проверки говорят «сломано» или «не
   сломано», а картинку показать не могут. После правок в стилях
   надо именно посмотреть — числа тут не помогают.

   Куда класть картинки: первым аргументом или SHOTS_DIR,
   по умолчанию — во временную папку.

       node scripts/shots.mjs
       node scripts/shots.mjs /tmp/мои-снимки

   Выходит с ошибкой, если хоть одна проверка не прошла: скрипт
   годится и как ворота перед коммитом.
   ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, browser } from '../test/helpers.mjs';

const OUT = process.argv[2] || process.env.SHOTS_DIR
  || path.join(os.tmpdir(), 'faryma-снимки');

/* Три ширины, а не больше: телефон, узкий стол и широкий стол.
   940 здесь не случайно — на этой ширине колонки первого экрана
   ещё стоят рядом, и именно тут они разъезжались. */
const ШИРИНЫ = [
  { w: 1440, h: 1100, имя: 'широкий' },
  { w:  940, h: 1200, имя: 'узкий'   },
  { w:  390, h:  844, имя: 'телефон' }
];

const беды = [];

fs.mkdirSync(OUT, { recursive: true });
const { server, base } = await startServer();
const бр = await browser();

for (const { w, h, имя } of ШИРИНЫ) {
  const стр = await бр.newPage({ viewport: { width: w, height: h } });
  await стр.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 120000 });
  await стр.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0,
    null, { timeout: 120000 });
  // графики рисуются после сборки строк, дать им дорисоваться
  await стр.waitForTimeout(2500);

  await стр.screenshot({ path: path.join(OUT, `${имя}-верх.png`) });

  const итог = await стр.evaluate(() => {
    const пульт = document.querySelector('.desk');
    const карточка = document.getElementById('fresh');
    return {
      вбок: document.documentElement.scrollWidth > window.innerWidth,
      пульт: пульт ? Math.round(пульт.getBoundingClientRect().height) : 0,
      карточка: карточка && !карточка.hidden
        ? Math.round(карточка.getBoundingClientRect().height) : 0
    };
  });

  if (итог.вбок) беды.push(`${имя} (${w}): страница едет вбок`);
  // ниже 900 колонки идут друг под другом, равнять нечего
  if (w > 900 && итог.карточка && Math.abs(итог.пульт - итог.карточка) > 1)
    беды.push(`${имя} (${w}): колонки разной высоты — ` +
      `пульт ${итог.пульт}, карточка ${итог.карточка}`);

  // разделы вниз по странице: шкала оценок и поиск
  for (const [id, файл] of [['cScale', 'шкала'], ['secSearch', 'поиск']]) {
    const el = await стр.$('#' + id);
    if (!el) continue;
    await el.scrollIntoViewIfNeeded();
    await стр.waitForTimeout(900);
    await стр.screenshot({ path: path.join(OUT, `${имя}-${файл}.png`) });
  }

  console.log(`${имя} (${w}): вбок ${итог.вбок ? 'ДА' : 'нет'}` +
    (w > 900 ? `, пульт ${итог.пульт} / карточка ${итог.карточка}` : ''));
  await стр.close();
}

/* Колесо живёт на своей странице и своими стилями пользуется теми же:
   правка в общем файле ломает его так же легко, как главную. */
const кол = await бр.newPage({ viewport: { width: 1440, height: 1100 } });
await кол.goto(base + '/wheel.html', { waitUntil: 'networkidle', timeout: 120000 });
await кол.fill('#names', 'Аня\nБорис\nВаля\nГлеб\nДима\nЕва\nЖеня\nЗина');
await кол.waitForTimeout(1200);
await кол.screenshot({ path: path.join(OUT, 'колесо.png') });
if (await кол.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
  беды.push('колесо (1440): страница едет вбок');
console.log('колесо: снято');
await кол.close();

await бр.close();
server.close();

console.log('\nКартинки: ' + OUT);
if (беды.length) {
  console.error('\nНе прошло:');
  беды.forEach(б => console.error('  · ' + б));
  process.exit(1);
}
console.log('Проверки прошли.');
