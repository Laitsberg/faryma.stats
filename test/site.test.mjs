/* ============================================================
   ЖИВАЯ СТРАНИЦА
   ------------------------------------------------------------
   Здесь проверяется ровно то, что видит посетитель: страница
   поднимается целиком, со всеми словарями имён, разделами и
   графиками. Чистые тесты парсера этого не достают — сегодняшняя
   ошибка с повторами жила именно в связке данных и раздела.
   ============================================================ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, browser } from './helpers.mjs';

let srv, brw, page;
const ошибки = [];

/* «найдено 517 · показаны первые 300» — нужно только первое число */
const НАЙДЕНО = `window.найдено = () => {
  const m = document.getElementById('searchCount').textContent.match(/найдено\\s+([\\d\\s\u00a0\u202f]+)/);
  return m ? +m[1].replace(/\\D/g, '') : NaN;
};`;

before(async () => {
  srv = await startServer();
  brw = await browser();
  page = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => ошибки.push('падение: ' + e.message));
  // сетевые не считаем: в песочнице закрыт доступ к шрифтам Google
  page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text()))
    ошибки.push('консоль: ' + m.text()); });
  await page.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#app', { state: 'visible', timeout: 30000 });
  // ROWS объявлена через let: такие переменные видны как имя, но
  // свойством window не становятся — window.ROWS всегда undefined
  await page.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0,
    null, { timeout: 30000 });
  // страны и каталог приезжают отдельными файлами
  await page.waitForFunction(() => ROWS.some(r => r.country), null, { timeout: 30000 });
  await page.evaluate(НАЙДЕНО);
});

after(async () => { await brw?.close(); srv?.server.close(); });

test('страница поднимается без ошибок', () => {
  assert.deepEqual(ошибки, []);
});

test('в шапке живые числа', async () => {
  const stamp = await page.$eval('.stamp', e => e.textContent.replace(/\s+/g, ' '));
  assert.match(stamp, /разносов в архиве: [\d\s ]{4,}/);
  assert.match(stamp, /обновлено \d+ \S+ \d{4}/);
});

test('цифр в табло ровно шесть', async () => {
  // Число колонок в .kpis задано явно (6 / 3 / 2), чтобы на средней
  // ширине последняя цифра не уезжала на свою строку рядом с пустой
  // ячейкой. Если цифр станет другое число — поправить и сетку.
  const n = await page.$$eval('#kpis .kpi', ns => ns.length);
  assert.equal(n, 6, 'изменилось число цифр — поправь grid-template-columns у .kpis');
});

test('колонки первого экрана одной высоты', async () => {
  // Пустота рядом с короткой колонкой вылезала дважды: сперва под
  // карточкой эфира, потом под пультом. Проверяем оба случая — с
  // коротким списком и с раздутым до сорока треков.
  const шир = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await шир.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
    await шир.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
    const мерить = () => шир.evaluate(() => ({
      пульт: Math.round(document.querySelector('.desk').getBoundingClientRect().height),
      карточка: Math.round(document.getElementById('fresh').getBoundingClientRect().height)
    }));
    const было = await мерить();
    assert.ok(Math.abs(было.пульт - было.карточка) <= 1,
      `колонки разной высоты: пульт ${было.пульт}, карточка ${было.карточка}`);

    // раздуваем последний эфир: список должен уйти в прокрутку,
    // а карточка — остаться ростом с пульт
    const стало = await шир.evaluate(() => {
      const st = STREAMS.filter(s => ROWS.some(r => r.streamNum === s.num))
        .reduce((a, b) => b.num > a.num ? b : a);
      const свои = ROWS.filter(r => r.streamNum === st.num);
      for (let i = свои.length; i < 40; i++) {
        const к = { ...свои[i % свои.length] };
        к.pos = i + 1; к.title = 'проверочный трек ' + (i + 1);
        ROWS.push(к);
      }
      renderFresh();
      const л = document.querySelector('.last-list');
      return {
        пульт: Math.round(document.querySelector('.desk').getBoundingClientRect().height),
        карточка: Math.round(document.getElementById('fresh').getBoundingClientRect().height),
        строк: document.querySelectorAll('.last-row').length,
        прокрутка: л.scrollHeight > л.clientHeight + 8,
        хвостВиден: document.getElementById('fresh').classList.contains('more')
      };
    });
    assert.equal(стало.строк, 40, 'список показал не все треки');
    assert.ok(Math.abs(стало.пульт - стало.карточка) <= 1,
      `на длинном списке колонки разъехались: ${стало.пульт} и ${стало.карточка}`);
    assert.equal(стало.прокрутка, true, 'длинный список не ушёл в прокрутку');
    assert.equal(стало.хвостВиден, true, 'список прокручивается, а тени у края нет');
  } finally { await шир.close(); }
});

test('на телефоне список последнего эфира обрезан честно', async () => {
  // Сколько строк видно, решает CSS (.last-row:nth-child(n+9)), а
  // сколько обещает ссылка — JS (LAST_SHOW). Разъедутся — тут упадёт.
  const узкий = await brw.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await узкий.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
    await узкий.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
    const итог = await узкий.evaluate(() => {
      const строки = [...document.querySelectorAll('#fresh .last-row')];
      const видно = строки.filter(n => getComputedStyle(n).display !== 'none').length;
      const ещё = document.querySelector('#fresh .last-more');
      return {
        всего: строки.length, видно,
        ссылкаВидна: !!ещё && getComputedStyle(ещё).display !== 'none',
        вСсылке: ещё ? +(ещё.textContent.match(/ещё\s+(\d+)/) || [])[1] : null
      };
    });
    assert.ok(итог.всего > 0, 'список последнего эфира пуст');
    assert.equal(итог.видно, Math.min(итог.всего, 8), 'видно не столько строк, сколько обещано');
    if (итог.всего > итог.видно) {
      assert.equal(итог.ссылкаВидна, true, 'строки спрятаны, а ссылки на остальные нет');
      assert.equal(итог.вСсылке, итог.всего - итог.видно, 'в ссылке не то число треков');
    } else {
      assert.equal(итог.ссылкаВидна, false, 'ссылка есть, а прятать нечего');
    }
  } finally { await узкий.close(); }
});

test('все разделы на месте и не пустые', async () => {
  const пустые = await page.$$eval('section', ns => ns
    .filter(n => getComputedStyle(n).display !== 'none')
    .filter(n => n.textContent.replace(/\s+/g, '').length < 40)
    .map(n => n.querySelector('h2')?.textContent || n.id));
  assert.deepEqual(пустые, [], 'раздел показан, но пуст');
  const всего = await page.$$eval('section', ns => ns.length);
  assert.ok(всего >= 18, `разделов всего ${всего}`);
});

test('графики действительно нарисованы', async () => {
  const плохие = await page.evaluate(() => [...document.querySelectorAll('canvas')]
    .filter(c => c.offsetParent !== null)              // только видимые
    .filter(c => { const ch = Chart.getChart(c);
      return !ch || !ch.data.datasets.some(d => d.data.length); })
    .map(c => c.id));
  assert.deepEqual(плохие, [], 'график пуст');
});

test('каждая пара повторов — один и тот же трек', async () => {
  // Сайт брал из пометки номер стрима и номер трека и подставлял то,
  // что лежит на этом месте, без проверки. Пометки считают эфиры
  // с единицы, а архив — с нуля, и в графе «было» оказывалась оценка
  // чужого трека. Эта проверка — про то, чтобы такое не вернулось.
  const пары = await page.evaluate(() => {
    const n = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const похоже = (x, y) => { const a = n(x), b = n(y);
      return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
    return repeatPairs().map(p => {
      // Совпасть должно название ИЛИ исполнитель. Обоих сразу требовать
      // нельзя: в архиве есть законные пары, где второй раз принесли
      // другую версию — кавер «What's up, people?!» и оригинал,
      // «Криминальная Россия» в главной теме и в вариации. А вот когда
      // не сходится ни то ни другое — это подставленный чужой трек.
      return { совпало: похоже(p.src.title, p.again.title) ||
                        похоже(p.src.artist, p.again.artist),
               было: p.src.rate?.label, стало: p.again.rate?.label,
               что: `${p.again.artist} — ${p.again.title}`,
               нашли: `${p.src.artist} — ${p.src.title} (№${p.src.streamNum})` };
    });
  });
  assert.ok(пары.length >= 25, `пар всего ${пары.length}`);
  assert.deepEqual(пары.filter(p => !p.совпало), [], 'в паре разные треки');
  assert.deepEqual(пары.filter(p => !p.было || !p.стало), [], 'у пары нет оценки');
});

test('ссылки на эфиры ведут в существующие эфиры', async () => {
  const битые = await page.evaluate(() => {
    const есть = new Set(ROWS.map(r => r.streamNum));
    return [...document.querySelectorAll('a[href^="#stream="]')]
      .map(a => +a.getAttribute('href').slice(8))
      .filter(n => !есть.has(n));
  });
  assert.deepEqual([...new Set(битые)], [], 'ссылка ведёт в эфир, которого нет');
});

test('фильтр по ступени считает то же, что и данные', async () => {
  for (const tier of ['гениально', 'кринж-контент']) {
    const [видно, вданных] = await page.evaluate(async t => {
      document.getElementById('fRate').value = 'ступень:' + t;
      renderSearch();
      return [найдено(), ROWS.filter(r => r.rate.tier === t).length];
    }, tier);
    assert.equal(видно, вданных, `ступень «${tier}»`);
  }
});

test('фильтр по стране считает то же, что и данные', async () => {
  const пара = await page.evaluate(() => {
    const c = document.querySelector('#fCountry option:nth-child(2)').value;
    document.getElementById('fRate').value = '';
    document.getElementById('fCountry').value = c;
    renderSearch();
    return [c, найдено(), ROWS.filter(r => r.country === c).length];
  });
  assert.equal(пара[1], пара[2], `страна «${пара[0]}»`);
});

test('фильтр по году складывается со ступенью', async () => {
  const got = await page.evaluate(() => {
    document.getElementById('fCountry').value = '';
    document.getElementById('fRate').value = 'ступень:атлична';
    FILTER.year = 2025; render(); renderSearch();
    const n = найдено();
    const real = ROWS.filter(r => r.rate.tier === 'атлична' && r.date?.getFullYear() === 2025).length;
    FILTER.year = null; document.getElementById('fRate').value = ''; render(); renderSearch();
    return [n, real];
  });
  assert.equal(got[0], got[1]);
});

test('карточки открываются', async () => {
  const адреса = await page.evaluate(() => {
    const top = (get) => [...ROWS].map(get).filter(Boolean)[0];
    return {
      artist: top(r => r.artistKey),
      user:   top(r => r.userParts[0]),
      source: top(r => r.source),
      stream: 0            // самый первый эфир: ноль когда-то терялся
    };
  });
  for (const [вид, знач] of Object.entries(адреса)) {
    await page.goto(`${srv.base}/index.html#${вид}=${encodeURIComponent(знач)}`,
      { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
    await page.waitForTimeout(400);
    const открыта = await page.$eval('#profile', e => !e.hidden);
    assert.ok(открыта, `карточка #${вид}=${знач} не открылась`);
  }
  await page.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
});

test('страница не разъезжается по ширине', async () => {
  for (const w of [320, 390, 768, 1440]) {
    const p = await brw.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
    await p.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0, null, { timeout: 30000 });
    const шире = await p.evaluate(() => document.documentElement.scrollWidth >
                                        document.documentElement.clientWidth + 1);
    await p.close();
    assert.equal(шире, false, `на ${w}px страница едет вбок`);
  }
});

test('отбор попадает в адрес и открывается по ссылке', async () => {
  // выставляем отбор руками и смотрим, что он оказался в адресе
  const адрес = await page.evaluate(() => {
    document.getElementById('q').value = 'unravel';
    document.getElementById('fRate').value = 'ступень:гениально';
    FILTER.year = 2025;
    render();
    return location.search;
  });
  assert.match(адрес, /q=unravel/);
  assert.match(адрес, /rate=/);
  assert.match(адрес, /year=2025/);

  // теперь открываем этот адрес заново — отбор должен восстановиться
  const p2 = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  await p2.goto(srv.base + '/index.html' + адрес, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0,
    null, { timeout: 30000 });
  await p2.waitForTimeout(600);
  const восстановлено = await p2.evaluate(() => ({
    q: document.getElementById('q').value,
    rate: document.getElementById('fRate').value,
    year: FILTER.year,
    найдено: document.getElementById('searchCount').textContent,
    // и страница должна открыться на самом поиске: иначе человек видит
    // шапку сайта и решает, что ссылка не сработала
    поискСверху: Math.round(document.getElementById('secSearch').getBoundingClientRect().top)
  }));
  await p2.close();
  assert.equal(восстановлено.q, 'unravel');
  assert.equal(восстановлено.rate, 'ступень:гениально');
  assert.equal(восстановлено.year, 2025);
  assert.match(восстановлено.найдено, /найдено/);
  assert.ok(Math.abs(восстановлено.поискСверху) < 60,
    `поиск оказался в ${восстановлено.поискСверху}px от верха`);
});

test('без отбора страница остаётся на шапке', async () => {
  const p2 = await brw.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
  await p2.waitForTimeout(700);
  const прокрутка = await p2.evaluate(() => Math.round(scrollY));
  await p2.close();
  assert.equal(прокрутка, 0, 'страница уехала вниз без причины');
});

test('страна из ссылки доживает до приезда списка стран', async () => {
  // Список стран собирается позже таблицы. Если бы отбор применялся
  // только один раз, страна из ссылки молча терялась бы.
  const страна = await page.evaluate(() =>
    document.querySelector('#fCountry option:nth-child(2)').value);
  const p2 = await brw.newPage({ viewport: { width: 1440, height: 1000 } });
  await p2.goto(`${srv.base}/index.html?country=${encodeURIComponent(страна)}`,
    { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.some(r => r.country),
    null, { timeout: 30000 });
  await p2.waitForTimeout(600);
  const [выбрано, видно, вданных] = await p2.evaluate(c => [
    document.getElementById('fCountry').value,
    document.getElementById('searchCount').textContent,
    ROWS.filter(r => r.country === c).length
  ], страна);
  await p2.close();
  assert.equal(выбрано, страна);
  assert.equal(+видно.match(/найдено\s+([\d\s  ]+)/)[1].replace(/\D/g, ''), вданных);
});

test('сброс очищает и отбор, и адрес', async () => {
  const после = await page.evaluate(() => {
    document.getElementById('q').value = 'test';
    document.getElementById('fRate').value = 'гениально';
    FILTER.year = 2024; render();
    document.getElementById('reset').click();
    return { search: location.search, q: document.getElementById('q').value,
             rate: document.getElementById('fRate').value, year: FILTER.year };
  });
  assert.equal(после.search, '');
  assert.equal(после.q, '');
  assert.equal(после.rate, '');
  assert.equal(после.year, null);
});

test('карточка поверх отбора не съедает отбор', async () => {
  const итог = await page.evaluate(async () => {
    document.getElementById('q').value = 'unravel'; renderSearch();
    const был = location.search;
    location.hash = 'stream=100';
    await new Promise(r => setTimeout(r, 400));
    const сКарточкой = location.search;
    closeProfile();
    await new Promise(r => setTimeout(r, 400));
    return { был, сКарточкой, после: location.search,
             q: document.getElementById('q').value };
  });
  assert.equal(итог.сКарточкой, итог.был, 'отбор пропал при открытии карточки');
  assert.equal(итог.после, итог.был, 'отбор пропал при закрытии карточки');
  assert.equal(итог.q, 'unravel');
});

test('«Почти собрали» показывает то же, что и карточка вселенной', async () => {
  const итог = await page.evaluate(() => {
    const список = almostDone(2);
    // числа в разделе обязаны совпадать с тем, что покажет карточка:
    // считает их одна и та же функция, и это надо удержать
    const расхождения = список.slice(0, 10).map(x => {
      const m = themeMatch(THEMES[x.наше]);
      return (m.got === x.got && m.list.length === x.всего) ? null
        : `${x.name}: раздел ${x.got}/${x.всего}, карточка ${m.got}/${m.list.length}`;
    }).filter(Boolean);
    return {
      всего: список.length,
      расхождения,
      карточек: document.querySelectorAll('#almostList .al').length,
      // недостающих ровно столько, сколько обещано
      счётСходится: список.every(x => x.нехватает.length === x.нет && x.нет >= 1 && x.нет <= 2),
      мелочь: список.filter(x => x.всего < 3).length,
      нетронутые: список.filter(x => x.got === 0).length
    };
  });
  assert.deepEqual(итог.расхождения, []);
  assert.ok(итог.всего >= 20, `вселенных в разделе ${итог.всего}`);
  assert.ok(итог.карточек > 0 && итог.карточек <= 24);
  assert.equal(итог.счётСходится, true, 'список недостающих не сходится со счётчиком');
  assert.equal(итог.мелочь, 0, 'тайтл с двумя темами попал в «почти собрали»');
  assert.equal(итог.нетронутые, 0, 'нетронутый тайтл попал в «почти собрали»');
});

test('ссылки из «Почти собрали» открывают карточку вселенной', async () => {
  const имя = await page.$eval('#almostList .al a[data-source]', a => a.dataset.source);
  await page.goto(`${srv.base}/index.html#source=${encodeURIComponent(имя)}`,
    { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
  await page.waitForTimeout(600);
  assert.ok(await page.$eval('#profile', e => !e.hidden), `карточка «${имя}» не открылась`);
  await page.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
});

test('карточка последнего эфира не врёт', async () => {
  const итог = await page.evaluate(() => {
    const сТреками = STREAMS.filter(s => ROWS.some(r => r.streamNum === s.num));
    const st = сТреками.reduce((a, b) => b.num > a.num ? b : a);
    const rows = ROWS.filter(r => r.streamNum === st.num);
    const карточка = document.getElementById('fresh');
    const метка = document.getElementById('liveTag');
    const текст = карточка.textContent + ' ' + метка.textContent;
    return {
      картВидна: !карточка.hidden,
      меткаВидна: !метка.hidden,
      // берём именно ссылку с номером: в textContent «№274» и «30 августа»
      // стоят вплотную и склеиваются в «№27430»
      номерВКарточке: +((карточка.querySelector('.last-n a')?.textContent || '')
        .match(/№(\d+)/) || [])[1],
      номерВМетке: +(метка.textContent.match(/стрим №(\d+)/) || [])[1],
      ожидаемый: st.num,
      треков: rows.length,
      // в разметке число и подпись — соседние узлы: «8внесено треков»
      вКарточке: +(карточка.textContent.match(/(\d+)\s*внесено/) || [])[1],
      сЗаписью: !!st.vod,
      // у эфира без записи среднего балла быть не должно: таблицу
      // ещё заполняют, и число соврало бы
      естьСредний: /средний балл/.test(карточка.textContent),
      естьПометка: /таблицу ещё заполняют/.test(метка.textContent),
      строкСписка: карточка.querySelectorAll('.last-row').length,
      сОценкой: [...карточка.querySelectorAll('.last-row')]
        .filter(n => n.querySelector('.pill')).length,
      текст
    };
  });
  assert.equal(итог.картВидна, true);
  assert.equal(итог.меткаВидна, true);
  assert.equal(итог.номерВКарточке, итог.ожидаемый, 'в карточке не последний эфир');
  assert.equal(итог.номерВМетке, итог.ожидаемый, 'в метке не последний эфир');
  assert.equal(итог.вКарточке, итог.треков, 'в карточке не то число треков');
  if (итог.сЗаписью) {
    assert.equal(итог.естьСредний, true, 'у разобранного эфира нет среднего балла');
  } else {
    assert.equal(итог.естьСредний, false, 'средний балл по недозаполненному эфиру');
    assert.equal(итог.естьПометка, true, 'не сказано, что таблицу ещё заполняют');
  }
  // про сам эфир сайт утверждать не вправе: идёт ли стрим, он не знает
  assert.ok(!/сейчас разбирают|эфир идёт/.test(итог.текст),
    'страница утверждает то, чего сайт не знает');
  // «лучшее» считается только по эфиру, у которого есть запись:
  // по недозаполненной таблице лучший трек меняется каждый день
  // список — это перечисление внесённых строк, а не вывод по ним:
  // в нём должен быть весь эфир и у каждой строки своя оценка
  assert.equal(итог.строкСписка, итог.треков, 'в списке не все треки эфира');
  assert.equal(итог.сОценкой, итог.треков, 'у строки списка нет оценки');
});

test('якорь раздела в адресе прокручивает к разделу', async () => {
  // ссылка из чата ведёт на farymastats.info/#secAlmost — раздел
  // появляется позже страницы, и браузер сам к нему не возвращается
  for (const id of ['secAlmost', 'secOff']) {
    const p2 = await brw.newPage({ viewport: { width: 1440, height: 900 } });
    await p2.goto(`${srv.base}/index.html#${id}`, { waitUntil: 'networkidle' });
    await p2.waitForFunction(() => typeof THEMES !== 'undefined' &&
      Object.keys(THEMES).length > 0, null, { timeout: 30000 });
    await p2.waitForTimeout(900);
    const верх = await p2.evaluate(i =>
      Math.round(document.getElementById(i).getBoundingClientRect().top), id);
    await p2.close();
    assert.ok(Math.abs(верх) < 60, `#${id}: раздел оказался в ${верх}px от верха`);
  }
});

test('навигация не зовёт в скрытые разделы', async () => {
  const итог = await page.evaluate(async () => {
    document.getElementById('secAlmost').style.display = 'none';
    document.getElementById('nvBtn').click();     // открыть
    await new Promise(r => setTimeout(r, 100));
    const скрытый = [...document.querySelectorAll('#nvPanel .nv-item span')]
      .some(s => s.textContent === 'Почти собрали');
    document.getElementById('secAlmost').style.display = '';
    document.getElementById('nvBtn').click();     // закрыть
    document.getElementById('nvBtn').click();     // открыть заново
    await new Promise(r => setTimeout(r, 100));
    const видимый = [...document.querySelectorAll('#nvPanel .nv-item span')]
      .some(s => s.textContent === 'Почти собрали');
    document.getElementById('nvBtn').click();
    return { скрытый, видимый };
  });
  assert.equal(итог.скрытый, false, 'скрытый раздел остался в навигации');
  assert.equal(итог.видимый, true, 'видимый раздел пропал из навигации');
});

test('в карточке заказчика видно, чего не хватает в его вселенных', async () => {
  const кто = await page.evaluate(() => {
    const по = new Map();
    ROWS.forEach(r => {
      if (!r.source || !THEMES[r.source]?.slug) return;
      r.userParts.forEach(u => по.set(u, (по.get(u) || 0) + 1));
    });
    return [...по].sort((a, b) => b[1] - a[1])[0][0];
  });
  await page.goto(`${srv.base}/index.html#user=${encodeURIComponent(кто)}`,
    { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof THEMES !== 'undefined' && Object.keys(THEMES).length > 0);
  await page.waitForTimeout(700);

  const итог = await page.evaluate(кто => {
    const карточки = [...document.querySelectorAll('#profile .pf-almost .al')];
    const rows = ROWS.filter(r => r.userParts.includes(кто));
    const свои = new Set(rows.map(r => r.source).filter(Boolean));
    const данные = missingFor(rows);
    return {
      карточек: карточки.length,
      // каждый показанный тайтл должен быть из его вселенных
      чужие: данные.filter(x => !свои.has(x.наше)).map(x => x.name),
      // и в каждом обязаны остаться пробелы
      безПробелов: данные.filter(x => x.нет < 1).length,
      // числа те же, что в карточке вселенной
      расхождения: данные.slice(0, 6).map(x => {
        const m = themeMatch(THEMES[x.наше]);
        return m.got === x.got && m.list.length === x.всего ? null : x.name;
      }).filter(Boolean)
    };
  }, кто);
  assert.ok(итог.карточек > 0 && итог.карточек <= 6, `карточек ${итог.карточек}`);
  assert.deepEqual(итог.чужие, [], 'показан тайтл, который он не приносил');
  assert.equal(итог.безПробелов, 0, 'показан тайтл без пробелов');
  assert.deepEqual(итог.расхождения, [], 'числа разошлись с карточкой вселенной');

  await page.goto(srv.base + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof ROWS !== 'undefined' && ROWS.length > 0);
});

test('поиск на сайте и в чате находят одно и то же', async () => {
  const итог = await page.evaluate(() => {
    const найти = q => {
      document.getElementById('q').value = q;
      document.getElementById('fRate').value = '';
      renderSearch();
      return +(document.getElementById('searchCount').textContent
        .match(/найдено\s+([\d\s  ]+)/) || [])[1].replace(/\D/g, '');
    };
    const через = найти('kick back');
    const слитно = найти('kickback');
    найти('');
    return { через, слитно };
  });
  // «KICK BACK» и «KICKBACK» — одна песня; бот в чате отвечает на оба
  // запроса одинаково, и ссылка из его ответа должна вести к тому же
  assert.ok(итог.через >= 2, `«kick back» нашёл ${итог.через}`);
  assert.equal(итог.через, итог.слитно, 'пробел в запросе меняет результат');
});
