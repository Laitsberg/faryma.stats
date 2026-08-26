/* ============================================================
   ПРОФИЛИ ИСПОЛНИТЕЛЯ, ЗАКАЗЧИКА И СТРИМА
   Открываются поверх страницы по клику на имя или номер стрима.
   Адрес меняется на #artist=…, #user=… или #stream=…, поэтому на
   конкретный профиль можно дать ссылку, а «назад» в браузере его
   закрывает.
   ============================================================ */

function initProfile() {
  $('pfClose').onclick = closeProfile;
  $('pfBack').onclick = closeProfile;

  // клик по любому элементу с data-artist / data-user / data-stream,
  // где бы он ни был
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-artist]');
    if (a) { e.preventDefault(); location.hash = 'artist=' + encodeURIComponent(a.dataset.artist); return; }
    const u = e.target.closest('[data-user]');
    if (u) { e.preventDefault(); location.hash = 'user=' + encodeURIComponent(u.dataset.user); return; }
    const src = e.target.closest('[data-source]');
    if (src) { e.preventDefault(); location.hash = 'source=' + encodeURIComponent(src.dataset.source); return; }
    const s = e.target.closest('[data-stream]');
    if (s) { e.preventDefault(); location.hash = 'stream=' + s.dataset.stream; }
  });

  addEventListener('hashchange', routeProfile);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('profile').hidden) closeProfile(); });
  routeProfile();
}

function routeProfile() {
  const m = location.hash.match(/^#(artist|user|source|stream)=(.*)$/);
  if (!m) { hideProfile(); return; }
  if (m[1] === 'artist')      showArtist(decodeURIComponent(m[2]));
  else if (m[1] === 'user')   showUser(decodeURIComponent(m[2]));
  else if (m[1] === 'source') showSource(decodeURIComponent(m[2]));
  else                        showStream(+m[2]);
}

function closeProfile() {
  // history.back вернёт на состояние без хэша, если мы сами его ставили
  if (location.hash) history.pushState('', '', location.pathname + location.search);
  hideProfile();
}

function hideProfile() {
  $('profile').hidden = true;
  document.body.style.overflow = '';
}

function openProfile(title, sub, html) {
  $('pfTitle').textContent = title;
  $('pfSub').textContent = sub;
  $('pfBody').innerHTML = html;
  $('profile').hidden = false;
  $('pfBody').scrollTop = 0;
  document.body.style.overflow = 'hidden';   // фон не должен ездить под окном
}

/* Четыре метрики в шапке профиля.
   Третий элемент пары помечает значения-слова («гениально-», «нормас++»):
   их набираем мельче и не рвём посреди слова, иначе на телефоне
   получается «гениал / ьно-». */
function kpiBlock(kpi) {
  return `<div class="pf-kpi">` + kpi.map(([v, l, word]) =>
    `<div><b${word ? ' class="w"' : ''}>${esc(v)}</b><span>${esc(l)}</span></div>`
  ).join('') + `</div>`;
}

/* Полоски распределения по ступеням — общий кусок для обоих профилей */
function tierBars(rows) {
  const m = group(rows, r => r.rate.tier);
  const max = Math.max(...TIERS.map(t => (m.get(t.key) || []).length));
  return `<div class="pf-bars">` + TIERS.map(t => {
    const n = (m.get(t.key) || []).length;
    if (!n) return '';
    return `<div class="pf-bar">
      <span class="pf-bn">${esc(t.key)}</span>
      <span class="pf-bt"><span style="width:${max ? n / max * 100 : 0}%;background:${t.c}"></span></span>
      <span class="pf-bv">${num(n)}</span></div>`;
  }).join('') + `</div>`;
}

/* Список треков — используется и в профиле артиста, и в профиле стрима */
function trackList(rows, opts = {}) {
  return '<div class="pf-list">' + rows.map(r => {
    const when = r.date ? r.date.toLocaleDateString('ru-RU') : '';
    const right = opts.showStream
      ? `<a class="tlink nowrap" href="#stream=${r.streamNum}">стрим №${r.streamNum}</a>`
      : (r.min != null ? `<span class="plat">${Math.floor(r.min / 60)}:${String(r.min % 60).padStart(2, '0')}</span>` : '');
    const title = r.link
      ? `<a class="tlink" href="${esc(r.link.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`
      : esc(r.title);
    const who = opts.showArtist ? artistNames(r.artist, 'pf-who') + ' — ' : '';
    const from = opts.showUser && r.user
      ? ` <a class="tlink nowrap" href="#user=${encodeURIComponent(r.user)}" data-user="${esc(r.user)}">принёс ${esc(r.user)}</a>`
      : '';
    const moment = r.moment
      ? ` <a class="mom" href="${esc(r.moment)}" target="_blank" rel="noopener noreferrer">▶ разнос</a>`
      : '';
    return `<div class="pf-row">
      <div class="pf-t">${who}${title}</div>
      <div class="pf-r">${ratePill(r.rate.label)}</div>
      <div class="pf-d">${esc(when)} ${right}${from}${moment}</div>
    </div>`;
  }).join('') + '</div>';
}

/* Франшизы, для которых исполнитель что-то писал.
   Связь была односторонней: из вселенной можно было уйти в артиста,
   а обратно нет. Сезоны сводим к франшизе, чтобы «Boku no Hero
   Academia» не распадалась на семь строк. */
function franchiseTags(rows, title) {
  const m = new Map();
  rows.forEach(r => {
    if (!r.source) return;
    const b = sourceParts(r.source).base;
    m.set(b, (m.get(b) || 0) + 1);
  });
  if (!m.size) return '';
  const list = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  return `<h3 class="pf-h">${esc(title)}</h3><div class="pf-tags">` +
    list.map(([k, n]) =>
      `<a class="pf-tag pf-tag-l" href="#source=${encodeURIComponent(k)}" data-source="${esc(k)}">` +
      `${esc(k)} <b>${num(n)}</b></a>`).join('') + `</div>`;
}

/* ---------- профиль артиста ---------- */
function showArtist(name) {
  const key = canonKey(nameKey(name));
  const rows = ROWS.filter(r => r.parts.includes(key) || r.artistKey === key);
  if (!rows.length) { hideProfile(); return; }

  const shown = PART_NAMES.get(key) || ARTIST_NAMES.get(key) || name;
  const a = avg(rows.map(r => r.rate.score));
  const best = [...rows].sort((x, y) => y.rate.score - x.rate.score)[0];
  const worst = [...rows].sort((x, y) => x.rate.score - y.rate.score)[0];
  const byDate = [...rows].filter(r => r.date).sort((x, y) => x.date - y.date);
  const span = byDate.length
    ? `${byDate[0].date.toLocaleDateString('ru-RU')} — ${byDate[byDate.length - 1].date.toLocaleDateString('ru-RU')}`
    : '';

  const kpi = [
    [num(rows.length), plural(rows.length, 'разнос', 'разноса', 'разносов')],
    [f2(a), 'средний балл'],
    [best.rate.label, 'лучшая оценка', 1],
    [worst.rate.label, 'худшая', 1]
  ];

  openProfile(shown, span,
    kpiBlock(kpi) +
    tierBars(rows) +
    franchiseTags(rows, 'Писал для') +
    `<h3 class="pf-h">Все разносы</h3>` +
    trackList([...rows].sort((x, y) => (y.date || 0) - (x.date || 0)), { showStream: true }));
}

/* ---------- профиль заказчика ---------- */
function showUser(name) {
  const key = userKey(name);
  const rows = ROWS.filter(r => r.userParts.includes(key));
  if (!rows.length) { hideProfile(); return; }

  const shown = USER_NAMES.get(key) || name;
  const a = avg(rows.map(r => r.rate.score));
  const best = [...rows].sort((x, y) => y.rate.score - x.rate.score)[0];
  const byDate = [...rows].filter(r => r.date).sort((x, y) => x.date - y.date);
  const span = byDate.length
    ? `${byDate[0].date.toLocaleDateString('ru-RU')} — ${byDate[byDate.length - 1].date.toLocaleDateString('ru-RU')}`
    : '';

  const kpi = [
    [num(rows.length), plural(rows.length, 'трек', 'трека', 'треков')],
    [f2(a), 'средний балл'],
    [best.rate.label, 'лучший результат', 1],
    [num(rows.filter(r => r.rate.tier === 'гениально').length), 'в «гениально»']
  ];

  // Чем именно человек кормит композитора — то, чего нет в профиле
  // исполнителя: у заказчика есть свой вкус, и он тут виден.
  const fav = [...group(rows, r => r.genres)]
    .map(([k, rs]) => ({ k, n: rs.length }))
    .sort((x, y) => y.n - x.n).slice(0, 5);
  const favHtml = fav.length
    ? `<h3 class="pf-h">Чаще всего приносит</h3><div class="pf-tags">` +
      fav.map(g => `<span class="pf-tag">${esc(g.k)} <b>${num(g.n)}</b></span>`).join('') +
      `</div>`
    : '';

  openProfile(shown, span,
    kpiBlock(kpi) +
    tierBars(rows) + favHtml +
    franchiseTags(rows, 'Приносил из') +
    `<h3 class="pf-h">Всё, что принёс</h3>` +
    trackList([...rows].sort((x, y) => (y.date || 0) - (x.date || 0)),
      { showArtist: true, showStream: true }));
}

/* ---------- профиль вселенной ----------
   Устроен как таблица аниме, которую зрители ведут руками: франшиза
   делится на сезоны, внутри сезона — заставки, концовки и саундтрек
   по отдельности. Сезоны в архиве записаны отдельными источниками
   («Boku no Hero Academia 3rd Season»), поэтому собираем их обратно
   по общей части названия. */
const KINDS = ['опенинг', 'эндинг', 'вставка', 'OST'];
const KIND_TITLE = { 'опенинг': 'Опенинги', 'эндинг': 'Эндинги',
                     'вставка': 'Вставки', 'OST': 'Саундтрек', '': 'Остальное' };

function showSource(name) {
  const { base } = sourceParts(name);
  // берём всю франшизу, а не только выбранный сезон
  const rows = ROWS.filter(r => r.source && sourceParts(r.source).base === base);
  if (!rows.length) { hideProfile(); return; }

  const a = avg(rows.map(r => r.rate.score));
  const best = [...rows].sort((x, y) => y.rate.score - x.rate.score)[0];
  // По порядку: сначала первая часть, потом вторая и так далее.
  // Номер бывает арабский («Season 2», «3rd Season») и римский («IV»).
  const ROMAN = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7, VIII:8, IX:9, X:10,
                  XI:11, XII:12, XIII:13, XIV:14, XV:15, XVI:16 };
  const partNo = t => {
    if (!t) return 0;                                  // база — самая первая
    const d = t.match(/\d+/);
    if (d) return +d[0];
    return ROMAN[t.toUpperCase()] ?? 99;
  };
  const parts = [...new Set(rows.map(r => sourceParts(r.source).part))]
    .sort((a, b) => partNo(a) - partNo(b));

  const kpi = [
    [num(rows.length), plural(rows.length, 'трек', 'трека', 'треков')],
    [f2(a), 'средний балл'],
    [best.rate.label, 'лучшая оценка', 1],
    [num(rows.filter(r => r.rate.tier === 'гениально').length), 'в «гениально»']
  ];

  // сколько чего принесли — по типам
  const byKind = KINDS.map(k => {
    const rs = rows.filter(r => r.kind === k);
    return rs.length ? { k, n: rs.length, avg: avg(rs.map(r => r.rate.score)) } : null;
  }).filter(Boolean);
  const kindRow = byKind.length
    ? `<div class="pf-tags">` + byKind.map(x =>
        `<span class="pf-tag">${esc(KIND_TITLE[x.k])} <b>${num(x.n)}</b> · ${f2(x.avg)}</span>`
      ).join('') + `</div>`
    : '';

  /* Внутри сезона — по типам, как в таблице: OP, ED, OST */
  const block = rs => KINDS.concat(['']).map(k => {
    const list = rs.filter(r => (r.kind || '') === k);
    if (!list.length) return '';
    return `<h4 class="pf-k">${esc(KIND_TITLE[k])}</h4>` +
      trackList(list.sort((x, y) => (x.date || 0) - (y.date || 0)),
        { showArtist: true, showStream: true });
  }).join('');

  const body = parts.length > 1
    ? parts.map(pt => {
        const rs = rows.filter(r => sourceParts(r.source).part === pt);
        return `<h3 class="pf-h pf-season">${esc(pt || 'Первый сезон')} ` +
          `<span>${num(rs.length)} ` + plural(rs.length, 'трек', 'трека', 'треков') + `</span></h3>` +
          block(rs);
      }).join('')
    : block(rows);

  openProfile(base,
    parts.length > 1
      ? `${num(parts.length)} ` + plural(parts.length, 'часть', 'части', 'частей') + ' во вселенной'
      : '',
    kpiBlock(kpi) + kindRow + body);
}

/* ---------- профиль стрима ---------- */
function showStream(numId) {
  const rows = ROWS.filter(r => r.streamNum === numId)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  if (!rows.length) { hideProfile(); return; }

  const st = STREAMS.find(s => s.num === numId);
  const a = avg(rows.map(r => r.rate.score));
  const len = Math.max(...rows.map(r => r.sec ?? 0));
  const date = st?.date ? st.date.toLocaleDateString('ru-RU',
    { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const kpi = [
    [num(rows.length), plural(rows.length, 'трек', 'трека', 'треков')],
    [f2(a), 'средний балл'],
    [len ? (len / 3600).toFixed(1) + ' ч' : '—', 'длина эфира'],
    [num(rows.filter(r => r.rate.tier === 'гениально').length), 'в «гениально»']
  ];

  const vod = st?.vod
    ? `<p class="pf-vod"><a class="tlink" href="${esc(st.vod)}" target="_blank" rel="noopener noreferrer">Смотреть запись целиком</a></p>`
    : '';

  openProfile('Стрим №' + numId, date,
    kpiBlock(kpi) +
    vod + tierBars(rows) +
    `<h3 class="pf-h">Все треки по порядку</h3>` +
    trackList(rows, { showArtist: true, showUser: true }));
}
