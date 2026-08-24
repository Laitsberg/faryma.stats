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

const cur = () => FILTER.tier ? ROWS.filter(r => r.rate.tier === FILTER.tier) : ROWS;

/* ---------- загрузка ---------- */
function load() {
  const url = SHEET_CSV_URL || LOCAL_CSV;
  $('src').textContent = SHEET_CSV_URL ? 'Гугл-таблица' : 'архив в репозитории';

  // страны — необязательны, без них раздел просто не появится
  // страны приезжают отдельно и могут прийти позже таблицы —
  // тогда просто перерисовываем свой раздел
  fetch(COUNTRIES_JSON)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      COUNTRIES = (j && j.artists) || {};
      if (ROWS.length) { applyCountries(); renderCountries(cur()); }
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
  USER_NAMES   = canonMap(raw.map(r => (r['Кто'] || '').trim()).filter(Boolean), userKey);

  // кто хоть раз выступал один — по этому списку решаем, разбивать ли
  // «X & Y» на двоих или это цельное название группы
  const soloKeys = new Set();
  parsed.forEach(p => { if (p.w.artist && isSolo(p.w.artist)) soloKeys.add(nameKey(p.w.artist)); });

  // имена участников тоже склеиваем по регистру
  const allParts = [];
  parsed.forEach(p => { if (p.w.artist) allParts.push(...participants(p.w.artist, soloKeys)); });
  PART_NAMES = canonMap(allParts, nameKey);

  ROWS = [];
  STREAMS = [];
  let stream = null;               // текущий стрим, под которым идут треки

  parsed.forEach(({ r, w }, i) => {
    const st = parseStream(r['Что'], r['Где']);
    if (st) { stream = st; STREAMS.push(st); return; }
    const rate = parseRate(r['Оценка']);
    if (!rate) return;
    const link = parseLink(r['Где']);
    const user = (r['Кто'] || '').trim();
    ROWS.push({
      i, rate, link,
      artist: w.artist, title: w.title, full: w.full,
      artistKey: w.artist ? nameKey(w.artist) : '',
      user, userKey: user ? userKey(user) : '',
      type:   (r['Тип'] || '').trim(),
      origin: (r['Откуда'] || '').trim(),
      genres: splitGenres(r['Жанр']),
      tags:   (r['Тэги'] || '').split(/[,\/]/).map(s => s.trim()).filter(Boolean),
      feature:(r['Фича'] || '').trim(),
      min: toMinutes(r['Когда']),
      platform: link ? link.platform : '',
      script: scriptOf(w.full, w.artist + ' ' + w.title),
      search: (w.full + ' ' + user).toLowerCase(),
      parts: w.artist ? participants(w.artist, soloKeys).map(nameKey) : [],
      streamNum: stream ? stream.num : null,
      date: stream ? stream.date : null,
      // ссылка на нужную минуту записи стрима
      moment: stream ? momentUrl(stream.vod, toSeconds(r['Когда'])) : ''
    });
  });

  STREAMS.sort((a, b) => a.num - b.num);

  $('upd').textContent = new Date().toLocaleString('ru-RU',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('total').textContent = num(ROWS.length);
  $('boot').style.display = 'none';
  $('app').style.display = '';
  applyCountries();
  initControls();
  render();
}

/* Проставляет строкам страну по кэшу MusicBrainz.
   Низкая уверенность совпадения приравнивается к «не знаем». */
function applyCountries() {
  ROWS.forEach(r => {
    const hit = COUNTRIES[r.artistKey];
    r.country = (hit && hit.country && (hit.score ?? 0) >= COUNTRY_MIN_SCORE)
      ? (COUNTRY_NAMES[hit.country] || hit.country)
      : null;
  });
}

/* ---------- отрисовка ---------- */
function render() {
  const rows = cur();
  renderLadder();
  renderKpis(rows);
  renderScale();
  renderTrend();
  renderArtists(rows);
  renderUsers(rows);
  renderGenres(rows);
  renderOrigin(rows);
  renderScriptChart(rows);
  renderType(rows);
  renderHour(rows);
  renderTags(rows);
  renderPlatforms(rows);
  renderCountries(rows);
  renderSearch();
  $('filterState').textContent =
    FILTER.tier ? ('показаны только: ' + FILTER.tier) : 'фильтр не задан';
}

/* ---------- поиск ---------- */
const SEARCH_LIMIT = 300;

function renderSearch() {
  const q  = $('q').value.trim().toLowerCase();
  const fr = $('fRate').value;
  const fu = $('fUser').value;

  let rows = cur();
  if (q)  rows = rows.filter(r => r.search.includes(q));
  if (fr) rows = rows.filter(r => r.rate.label === fr);
  if (fu) rows = rows.filter(r => r.userKey === fu);

  $('searchCount').textContent = `найдено ${num(rows.length)}` +
    (rows.length > SEARCH_LIMIT ? ` · показаны первые ${SEARCH_LIMIT}` : '');

  // Обрезкой занимается table(): она сортирует весь набор и только
  // потом берёт первые SEARCH_LIMIT. Иначе сортировка по колонке
  // переставляла бы 300 случайных строк вместо всего архива.
  const view = rows
    .map(r => ({
      artist: r.artist || '—', title: r.title,
      label: r.rate.label, color: r.rate.color,
      user: r.user || '—', genre: r.genres.join(' / '),
      link: r.link, feature: r.feature,
      when: r.date ? r.date.getTime() : 0,
      stream: r.streamNum, moment: r.moment
    }));

  table('tSearch', [
    { k: 'artist', t: 'исполнитель', lead: 1 },
    { k: 'title',  t: 'трек', f: r => r.link
        ? `<a class="tlink" href="${esc(r.link.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a><span class="plat">${esc(r.link.platform)}</span>`
        : esc(r.title) },
    { k: 'label',  t: 'оценка', mono: 1, f: r => ratePill(r.label) },
    { k: 'user',   t: 'заказчик', mono: 1 },
    { k: 'genre',  t: 'жанр' },
    { k: 'when',   t: 'когда', mono: 1, f: r => {
        if (!r.when) return '—';
        const d = new Date(r.when).toLocaleDateString('ru-RU');
        // номер стрима ведёт прямо на момент разноса в записи
        const st = r.moment
          ? `<a class="tlink" href="${esc(r.moment)}" target="_blank" rel="noopener noreferrer">стрим №${r.stream}</a>`
          : `<span class="plat">стрим №${r.stream}</span>`;
        return `${d} <span class="plat">·</span> ${st}`;
      } }
  ], view, 'artist', SEARCH_LIMIT);
}

/* ---------- управление ---------- */
function initControls() {
  const rs = $('fRate');
  SCALE_ORDER.filter(l => ROWS.some(r => r.rate.label === l))
    .forEach(l => rs.add(new Option(l, l)));

  const us = $('fUser');
  [...group(ROWS, r => r.userKey || null)]
    .sort((a, b) => b[1].length - a[1].length).slice(0, 60)
    .forEach(([key, rs2]) => us.add(new Option(
      `${USER_NAMES.get(key) || key} (${rs2.length})`, key)));

  ['q', 'fRate', 'fUser'].forEach(id => {
    $(id).addEventListener('input', renderSearch);
    $(id).addEventListener('change', renderSearch);
  });
  $('reset').onclick = () => { FILTER.tier = null; render(); };
}

load();
