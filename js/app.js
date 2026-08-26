/* ============================================================
   СБОРКА
   Читает CSV, строит ROWS и запускает отрисовку.
   ============================================================ */

let ROWS = [];                 // все разносы с распознанной оценкой
let FILTER = { tier: null };   // выбранная ступень шкалы
let ARTIST_NAMES = new Map();  // ключ → показываемое написание
let PART_NAMES = new Map();    // то же для участников, включая тех, кто только в feat.
let USER_NAMES = new Map();
let STREAMS = [];              // разделители стримов: номер и дата
let COUNTRIES = {};            // артист → страна, из data/countries.json
let SOLO_KEYS = new Set();     // кто хоть раз выступал один — нужен при разбиении имён
let NAME_ALIAS = new Map();    // «Sawano Hiroyuki» → «Hiroyuki Sawano»
let OFFSCALE = [];             // оценки, которых нет на шкале — «ГЕ-НЯ-АЛЬНО» и прочее
let SOURCE_NAMES = new Map();  // ключ → показываемое написание вселенной
let THEMES = {};               // вселенная → все её опенинги и эндинги, из data/themes.json

/* Ключ имени с учётом склейки перестановок */
const canonKey = k => NAME_ALIAS.get(k) || k;

const cur = () => FILTER.tier ? ROWS.filter(r => r.rate.tier === FILTER.tier) : ROWS;

/* ---------- загрузка ---------- */
function load() {
  const url = SHEET_CSV_URL || LOCAL_CSV;
  $('src').innerHTML =
    `<a href="${esc(SHEET_URL)}" target="_blank" rel="noopener noreferrer">таблица разносов</a>`;

  // страны — необязательны, без них раздел просто не появится
  // страны приезжают отдельно и могут прийти позже таблицы —
  // тогда просто перерисовываем свой раздел
  fetch(COUNTRIES_JSON)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      COUNTRIES = (j && j.artists) || {};
      // страны нужны не только своему разделу, но и номинациям заказчиков
      if (ROWS.length) { applyCountries(); renderCountries(cur()); renderFans(); }
    })
    .catch(() => {});

  // каталог опенингов и эндингов — тоже необязателен: без него в
  // карточке вселенной просто не будет списка «чего ещё не приносили»
  fetch(THEMES_JSON)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      THEMES = (j && j.sources) || {};
      // карточка могла открыться раньше, чем приехал каталог
      if (ROWS.length && location.hash.startsWith('#source=')) routeProfile();
    })
    .catch(() => {});

  Papa.parse(url, {
    download: true, header: true,
    skipEmptyLines: 'greedy',   // в выгрузке есть строки из одних запятых
    complete: r => {
      if (!r.data.length) return fail('Таблица прочиталась, но в ней нет строк.');
      if (!r.meta.fields?.includes('Оценка'))
        return fail('В таблице нет колонки «Оценка». Похоже, скачался не тот лист.');
      build(r.data);
    },
    error: e => fail('Не получилось прочитать таблицу: ' + e.message)
  });
}

function fail(msg) {
  $('boot').innerHTML = `<div class="err">${esc(msg)}</div>`;
}

/* ---------- построение строк ---------- */
function build(raw) {
  // сначала собираем словари написаний, чтобы «HOYO-MiX» и
  // «HOYO-MIX» считались одним исполнителем
  const parsed = raw.map(r => ({ r, w: parseWhat(r['Что']) }));
  ARTIST_NAMES = canonMap(parsed.map(p => p.w.artist).filter(Boolean), nameKey);
  USER_NAMES   = canonMap(
    raw.flatMap(r => userParts(r['Кто'])).filter(Boolean), userKey);

  // кто хоть раз выступал один — по этому списку решаем, разбивать ли
  // «X & Y» на двоих или это цельное название группы
  const soloKeys = new Set();
  parsed.forEach(p => { if (p.w.artist && isSolo(p.w.artist)) soloKeys.add(nameKey(p.w.artist)); });
  SOLO_KEYS = soloKeys;   // тем же набором разбиваем имена при отрисовке

  // имена участников тоже склеиваем по регистру
  const allParts = [];
  parsed.forEach(p => { if (p.w.artist) allParts.push(...participants(p.w.artist, soloKeys)); });
  PART_NAMES = canonMap(allParts, nameKey);

  // Вселенные пишут в разном регистре: «ULTRAKILL» и «Ultrakill»,
  // «FINAL FANTASY XIV: Endwalker» и «Final Fantasy XIV: Endwalker».
  // Сводим к самому частому написанию — как имена исполнителей.
  SOURCE_NAMES = canonMap(
    parsed.map(p => parseSource(p.r['Что'])).filter(Boolean), nameKey);

  const partCounts = new Map();
  allParts.forEach(v => { const k = nameKey(v); partCounts.set(k, (partCounts.get(k) || 0) + 1); });
  NAME_ALIAS = buildNameAliases(partCounts);

  ROWS = [];
  STREAMS = [];
  OFFSCALE = [];
  let stream = null;               // текущий стрим, под которым идут треки

  parsed.forEach(({ r, w }, i) => {
    const st = parseStream(r['Что'], r['Где']);
    if (st) { stream = st; STREAMS.push(st); return; }
    const rate = parseRate(r['Оценка']);
    const link = parseLink(r['Где']);
    if (!rate) {
      // Оценка есть, но она не со шкалы: «ГЕ-НЯ-АЛЬНО», «БДСМ ШЕДЕВР»,
      // «стал подводной лодкой / 10». В статистику их не пустить —
      // ступени у них нет, — но и терять жалко: это живая речь эфира.
      const raw = (r['Оценка'] || '').trim();
      if (raw && /[а-яёa-z]/i.test(raw) && (r['Тип'] || '').trim()) OFFSCALE.push({
        raw, artist: w.artist, title: w.title, link,
        streamNum: stream ? stream.num : null,
        date: stream ? stream.date : null,
        moment: stream ? momentUrl(stream.vod, toSeconds(r['Когда'])) : ''
      });
      return;
    }
    const user = (r['Кто'] || '').trim();
    ROWS.push({
      i, rate, link,
      artist: w.artist, title: w.title, full: w.full,
      artistKey: w.artist ? canonKey(nameKey(w.artist)) : '',
      user, userKey: user ? userKey(user) : '',
      // соавторы заказа: «kumashisan; Svd_bb» — это двое
      userParts: userParts(user).map(userKey),
      type:   (r['Тип'] || '').trim(),
      origin: (r['Откуда'] || '').trim(),
      source: (() => { const x = parseSource(r['Что']);
        return x ? (SOURCE_NAMES.get(nameKey(x)) || x) : ''; })(),
      kind:   sourceKind(r['Что']),      // опенинг / эндинг / OST / вставка
      genres: splitGenres(r['Жанр']),
      tags:   (r['Тэги'] || '').split(/[,\/]/).map(s => s.trim()).filter(Boolean),
      feature:(r['Фича'] || '').trim(),
      pos: w.pos,
      min: toMinutes(r['Когда']),
      sec: toSeconds(r['Когда']),
      dur: null,
      platform: link ? link.platform : '',
      ytId:    link ? youtubeId(link.url)   : '',
      spId:    link ? spotifyId(link.url)   : '',
      yaId:    link ? yandexTrack(link.url) : '',
      search: (w.full + ' ' + user).toLowerCase(),
      parts: w.artist ? participants(w.artist, soloKeys).map(x => canonKey(nameKey(x))) : [],
      streamNum: stream ? stream.num : null,
      date: stream ? stream.date : null,
      // ссылка на нужную минуту записи стрима
      moment: stream ? momentUrl(stream.vod, toSeconds(r['Когда'])) : ''
    });
  });

  STREAMS.sort((a, b) => a.num - b.num);
  computeDurations();

  // Дата берётся из истории, а не из часов браузера: показывать здесь
  // момент открытия страницы бессмысленно — важно, когда воркфлоу
  // последний раз забирал таблицу.
  $('upd').textContent = '—';
  fetch(HISTORY_JSONL)
    .then(r => r.ok ? r.text() : null)
    .then(txt => {
      if (!txt) return;
      const lines = txt.trim().split('\n').filter(Boolean);
      const last = JSON.parse(lines[lines.length - 1]);
      const d = new Date(last.date + 'T00:00:00Z');
      if (!isNaN(d.getTime())) $('upd').textContent =
        d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    })
    .catch(() => {});
  $('total').textContent = num(ROWS.length);
  $('boot').style.display = 'none';
  $('app').style.display = '';
  applyCountries();
  initControls();
  render();
  initGame();
  initProfile();
  initNav();
}


/* Сколько времени заняло обсуждение трека.
   Длительности в таблице нет, но есть тайм-код начала: расстояние до
   следующего трека того же стрима и есть длина разноса. У последнего
   трека стрима следующего нет — он остаётся без длительности. */
function computeDurations() {
  const byStream = new Map();
  ROWS.forEach(r => {
    if (r.streamNum == null || r.sec == null) return;
    if (!byStream.has(r.streamNum)) byStream.set(r.streamNum, []);
    byStream.get(r.streamNum).push(r);
  });
  byStream.forEach(list => {
    // по номеру, а не по тайм-коду: номер — это порядок, в котором
    // треки шли на самом деле, а тайм-коды местами разъезжаются
    list.sort((a, b) => (a.pos ?? 1e9) - (b.pos ?? 1e9));
    for (let i = 0; i < list.length - 1; i++) {
      const d = list[i + 1].sec - list[i].sec;
      // отрицательная разница значит, что тайм-коды в таблице
      // разошлись с порядком — такую пару просто пропускаем
      if (d >= DUR_MIN_SEC && d <= DUR_MAX_SEC) list[i].dur = d;
    }
  });
}

/* Проставляет строкам страну по кэшу MusicBrainz.
   Низкая уверенность совпадения приравнивается к «не знаем». */
function applyCountries() {
  const look = k => {
    const hit = COUNTRIES[k];
    return (hit && hit.country && (hit.score ?? 0) >= COUNTRY_MIN_SCORE)
      ? (COUNTRY_NAMES[hit.country] || hit.country) : null;
  };
  ROWS.forEach(r => {
    // Ищем по участникам, а не по строке целиком: страну спрашивают
    // на «Hiroyuki Sawano» и «Aimer» по отдельности, а ключ
    // «hiroyuki sawano feat. aimer» в кэше отсутствует. Берём первого
    // участника, чья страна известна, — он же и главный в строке.
    r.country = null;
    for (const k of r.parts) { const c = look(k); if (c) { r.country = c; break; } }
    if (!r.country) r.country = look(r.artistKey);
  });
}

/* ---------- отрисовка ---------- */
function render() {
  const rows = cur();
  renderLadder();
  renderDock();
  renderRecords();
  renderKpis(rows);
  renderScale();
  renderTrend();
  renderRepeats();
  renderArtists(rows);
  renderUsers(rows);
  renderFans();
  renderGenres(rows);
  renderOrigin(rows);
  renderUniverses(rows);
  renderType(rows);
  renderHour(rows);
  renderTags(rows);
  renderPlatforms(rows);
  renderDuration(rows);
  renderStreams();
  renderCountries(rows);
  renderOffscale();
  renderSearch();
  $('filterState').textContent =
    FILTER.tier ? ('показаны только: ' + FILTER.tier) : 'фильтр не задан';
}

/* Дубль фильтра появляется, когда пульт ушёл вверх, и прячется,
   когда он снова виден. IntersectionObserver вместо слушателя
   прокрутки: браузер сам решает, когда проверять, и не дёргает
   пересчёт на каждый пиксель. */
function initDock() {
  const desk = document.querySelector('.desk');
  const dock = $('dock');
  if (!desk || !dock || !('IntersectionObserver' in window)) return;
  dock.hidden = false;
  new IntersectionObserver(([e]) => {
    // прячем, пока пульт виден, и пока страница ещё выше него
    dock.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0);
  }, { rootMargin: '-8px 0px 0px 0px', threshold: 0 }).observe(desk);
}

/* ---------- навигация по разделам ----------
   Страница выросла до семнадцати разделов, и листать её насквозь стало
   долго. Кнопка живёт в правом нижнем углу: сверху уже стоит плавающий
   фильтр, а внизу справа до неё дотягивается большой палец.

   Адрес при переходе не меняется: хэш занят карточками (#artist=…,
   #user=…, #stream=…), и подмешивать туда якоря разделов значило бы
   ломать кнопку «назад». */
function initNav() {
  const nav = $('nav'), btn = $('nvBtn'), panel = $('nvPanel');
  const heads = [...document.querySelectorAll('section .shd')];
  if (!nav || !heads.length) return;

  const items = heads.map((h, i) => ({
    el: h.closest('section'),
    num: h.querySelector('.ch')?.textContent.trim() || String(i + 1).padStart(2, '0'),
    title: h.querySelector('h2')?.textContent.trim() || ''
  })).filter(x => x.el);

  panel.innerHTML =
    `<button class="nv-item nv-top" data-i="-1"><b>↑</b><span>В начало</span></button>` +
    items.map((x, i) =>
      `<button class="nv-item" data-i="${i}"><b>${esc(x.num)}</b><span>${esc(x.title)}</span></button>`
    ).join('');

  const open = v => {
    panel.hidden = !v;
    nav.classList.toggle('on', v);
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
  };
  btn.onclick = () => open(panel.hidden);

  panel.onclick = e => {
    const b = e.target.closest('.nv-item');
    if (!b) return;
    const i = +b.dataset.i;
    open(false);
    if (i < 0) scrollTo({ top: 0, behavior: 'smooth' });
    else items[i].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // клик мимо и Escape закрывают
  document.addEventListener('click', e => {
    if (!panel.hidden && !nav.contains(e.target)) open(false);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });

  if (!('IntersectionObserver' in window)) { nav.hidden = false; return; }

  /* Какой раздел сейчас на экране — подписываем кнопку и подсвечиваем
     строку в списке, чтобы было видно, где ты находишься. */
  const visible = new Set();
  const mark = () => {
    const i = items.findIndex(x => visible.has(x.el));
    $('nvNow').textContent = i < 0 ? 'разделы' : items[i].title;
    panel.querySelectorAll('.nv-item').forEach(b =>
      b.classList.toggle('on', +b.dataset.i === i));
  };
  const io = new IntersectionObserver(es => {
    es.forEach(e => e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
    mark();
  }, { rootMargin: '-45% 0px -45% 0px' });
  items.forEach(x => io.observe(x.el));

  // кнопка появляется, только когда шапка уехала вверх
  const head = document.querySelector('header');
  new IntersectionObserver(([e]) => {
    nav.hidden = e.isIntersecting;
    if (e.isIntersecting) open(false);
  }, { threshold: 0 }).observe(head);
}

/* ---------- поиск ---------- */
const SEARCH_LIMIT = 300;

function renderSearch() {
  const q  = $('q').value.trim().toLowerCase();
  const fr = $('fRate').value;
  const fu = $('fUser').value;
  const fo = $('fOrigin').value;
  const fg = $('fGenre').value;

  let rows = cur();
  if (q)  rows = rows.filter(r => r.search.includes(q));
  if (fr) rows = rows.filter(r => r.rate.label === fr);
  if (fu) rows = rows.filter(r => r.userParts.includes(fu));
  if (fo) rows = rows.filter(r => r.origin === fo);
  if (fg) rows = rows.filter(r => r.genres.includes(fg));

  $('searchCount').textContent = `найдено ${num(rows.length)}` +
    (rows.length > SEARCH_LIMIT ? ` · показаны первые ${SEARCH_LIMIT}` : '');

  // Обрезкой занимается table(): она сортирует весь набор и только
  // потом берёт первые SEARCH_LIMIT. Иначе сортировка по колонке
  // переставляла бы 300 случайных строк вместо всего архива.
  const view = rows
    .map(r => ({
      artist: r.artist || '—', title: r.title,
      label: r.rate.label, color: r.rate.color, score: r.rate.score,
      user: r.user || '—', genre: r.genres.join(' / '),
      source: r.source, origin: r.origin,
      link: r.link, feature: r.feature,
      when: r.date ? r.date.getTime() : 0,
      stream: r.streamNum, moment: r.moment
    }));

  table('tSearch', [
    { k: 'artist', t: 'исполнитель', lead: 1, w: '15%', f: r => artistNames(r.artist) },
    { k: 'title',  t: 'трек', w: '22%', f: r => r.link
        ? `<a class="tlink" href="${esc(r.link.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><span class="plat">${esc(r.link.platform)}</span>`
        : esc(r.title) },
    // 15%, а не 11%: «кринж-контент++» — самая широкая плашка, и в узкую
    // колонку она вылезала поверх ника заказчика
    { k: 'label',  t: 'оценка', mono: 1, sortK: 'score', w: '15%', f: r => ratePill(r.label) },
    { k: 'user',   t: 'заказчик', mono: 1, w: '12%', f: r => userNames(r.user) },
    { k: 'genre',  t: 'жанр', w: '12%' },
    // «Откуда» стоит рядом с жанром, а не между исполнителем и треком:
    // источник известен у 44% строк, и посередине он рвал бы главную
    // пару колонок дырой на каждой второй строке.
    { k: 'source', t: 'откуда', w: '14%',
      f: r => r.source ? sourceLink(r.source)
            : (r.origin ? `<span class="plat">${esc(r.origin.toLowerCase())}</span>` : '') },
    { k: 'when',   t: 'когда', mono: 1, w: '10%', f: r => {
        if (!r.when) return '—';
        const d = new Date(r.when).toLocaleDateString('ru-RU');
        // номер ведёт в профиль стрима, а отдельная ссылка — на запись.
        // Подписываем её словом: одинокий треугольник был почти не виден
        // и в него было трудно попасть пальцем.
        const st = `<a class="pf-link nowrap" href="#stream=${r.stream}" data-stream="${r.stream}">стрим №${r.stream}</a>` +
          (r.moment ? ` <a class="mom" href="${esc(r.moment)}" target="_blank" rel="noopener noreferrer">▶ разнос</a>` : '');
        // без разделителя: в узкой колонке дата и стрим и так встают
        // друг под другом, а точка посередине повисала отдельной строкой
        return `<span class="nowrap">${d}</span> ${st}`;
      } }
  ], view, 'artist', SEARCH_LIMIT);
}

/* ---------- управление ---------- */
function initControls() {
  const rs = $('fRate');
  SCALE_ORDER.filter(l => ROWS.some(r => r.rate.label === l))
    .forEach(l => rs.add(new Option(l, l)));

  const us = $('fUser');
  [...group(ROWS, r => r.userParts.length ? r.userParts : null)]
    .sort((a, b) => b[1].length - a[1].length).slice(0, 60)
    .forEach(([key, rs2]) => us.add(new Option(
      `${USER_NAMES.get(key) || key} (${rs2.length})`, key)));

  const og = $('fOrigin');
  [...group(ROWS, r => r.origin || null)]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([o, rs]) => og.add(new Option(`${o} (${rs.length})`, o)));

  const gg = $('fGenre');
  [...group(ROWS, r => r.genres)]
    .filter(([, rs]) => rs.length >= 15)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([g, rs]) => gg.add(new Option(`${g} (${rs.length})`, g)));

  // Только 'input'. У текстового поля 'change' срабатывает при потере
  // фокуса — то есть ровно в тот момент, когда пользователь кликает
  // куда-то ещё, например по заголовку таблицы. Лишняя перерисовка
  // съедала этот клик. Списки 'input' тоже отправляют.
  ['q', 'fRate', 'fUser', 'fOrigin', 'fGenre'].forEach(id =>
    $(id).addEventListener('input', renderSearch));
  $('reset').onclick = () => { FILTER.tier = null; render(); };
  $('dockReset').onclick = () => { FILTER.tier = null; render(); };
  initDock();
}

load();
