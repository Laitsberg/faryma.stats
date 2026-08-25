/* ============================================================
   РАЗДЕЛЫ СТРАНИЦЫ
   Каждая функция получает уже отфильтрованные строки и рисует
   свой кусок. Порядок вызовов — в app.js.
   ============================================================ */

/* ---------- пульт: ступени шкалы ---------- */
function renderLadder() {
  const m = group(ROWS, r => r.rate.tier);
  const max = Math.max(...TIERS.map(t => (m.get(t.key) || []).length));
  $('ladder').innerHTML = TIERS.map(t => {
    const n = (m.get(t.key) || []).length;
    const pct = max ? (n / max * 100) : 0;
    return `<button class="rung${FILTER.tier === t.key ? ' on' : ''}" data-t="${esc(t.key)}"
      aria-pressed="${FILTER.tier === t.key}">
      <span class="nm">${esc(t.key)}</span>
      <span class="track"><span class="fill" style="width:calc(${pct}% - 2px);background:${t.c}"></span></span>
      <span class="val">${num(n)}</span></button>`;
  }).join('');
  document.querySelectorAll('.rung').forEach(b => b.onclick = () => {
    FILTER.tier = FILTER.tier === b.dataset.t ? null : b.dataset.t;
    render();
  });
}

/* ---------- плавающий дубль фильтра ----------
   Те же ступени, что в пульте, но компактно. Показывается только
   когда сам пульт уехал за верхнюю границу экрана — им занимается
   наблюдатель в initDock(). */
function renderDock() {
  const m = group(ROWS, r => r.rate.tier);
  $('dockChips').innerHTML = TIERS.map(t => {
    const n = (m.get(t.key) || []).length;
    const on = FILTER.tier === t.key;
    return `<button class="chip${on ? ' on' : ''}" data-t="${esc(t.key)}"
      aria-pressed="${on}" title="${esc(t.key)}: ${num(n)}">
      <i style="color:${t.c}"></i>${esc(t.key)}<b>${num(n)}</b></button>`;
  }).join('');
  $('dockChips').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    FILTER.tier = FILTER.tier === b.dataset.t ? null : b.dataset.t;
    render();
  });
  $('dockReset').hidden = !FILTER.tier;
}

/* ---------- метрики ---------- */
function renderKpis(rows) {
  const arts  = new Set(rows.map(r => r.artistKey).filter(Boolean));
  const users = new Set(rows.map(r => r.userKey).filter(Boolean));
  const a = avg(rows.map(r => r.rate.score));
  const gen = rows.filter(r => r.rate.label === 'гениально').length;
  const k = [
    [num(rows.length), 'разносов'],
    [num(arts.size), 'исполнителей'],
    [num(users.size), 'заказчиков'],
    [f2(a), 'средний балл'],
    [num(gen), 'чистых «гениально»'],
    [(rows.length ? gen / rows.length * 100 : 0).toFixed(2) + '%', 'доля гениального']
  ];
  $('kpis').innerHTML = k.map(([n, l]) =>
    `<div class="kpi"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join('');
}

/* ---------- 01. распределение по шкале ---------- */
function renderScale() {
  const m = group(ROWS, r => r.rate.label);
  const labels = SCALE_ORDER.filter(l => m.has(l));
  hbar('cScale',
    labels.map(l => ({ k: l, v: m.get(l).length })),
    (_, i) => {
      const t = TIERS.find(t => labels[i].startsWith(t.key));
      return FILTER.tier && t.key !== FILTER.tier ? '#2E2925' : t.c;
    });
}

/* ---------- 02. тренд ----------
   Раньше по горизонтали шёл порядковый номер разноса: считалось, что
   дат в таблице нет. Даты есть — стримы отбиты строками
   «СТРИМ №271 (22.08.26)», и каждый трек наследует дату своего стрима.
   Теперь ось настоящая, и видно не только «стал ли добрее», но и когда. */
function renderTrend() {
  const seq = ROWS.filter(r => r.date).sort((a, b) => a.date - b.date || a.i - b.i);
  if (seq.length < 200) { renderTrendByOrder(); return; }

  const W = 150, pts = [];
  for (let i = W; i <= seq.length; i += 10) {
    const win = seq.slice(i - W, i);
    pts.push({ x: win[win.length - 1].date.getTime(),
               y: +avg(win.map(r => r.rate.score)).toFixed(3) });
  }
  $('cTrend').parentElement.style.height = '300px';
  draw('cTrend', {
    type: 'line',
    data: { datasets: [{
      data: pts, borderColor: C.brand, borderWidth: 2, pointRadius: 0,
      tension: .3, fill: true, backgroundColor: C.amberFill }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      parsing: false,
      scales: {
        // границы задаём явно: иначе Chart.js округляет их до «красивых»
        // значений и тянет ось на месяцы дальше последнего стрима
        x: { ...GRID, type: 'linear',
             min: pts[0].x, max: pts[pts.length - 1].x,
             ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5,
                      callback: v => new Date(v).toLocaleDateString('ru-RU',
                        { month: 'short', year: '2-digit' }) } },
        y: { ...GRID, title: { display: true, text: 'средний балл по 150 трекам', color: C.dim } }
      },
      plugins: { tooltip: { ...TOOLTIP, callbacks: {
        title: it => new Date(it[0].parsed.x).toLocaleDateString('ru-RU',
          { day: 'numeric', month: 'long', year: 'numeric' }),
        label: it => 'средний балл ' + f2(it.parsed.y)
      } } }
    }
  });
  const first = seq[0].date, last = seq[seq.length - 1].date;
  const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  $('trendNote').textContent =
    `${fmt(first)} — ${fmt(last)}, ${num(STREAMS.length)} ` +
    plural(STREAMS.length, 'стрим', 'стрима', 'стримов');
}

/* Запасной вариант, если дат вдруг не окажется */
function renderTrendByOrder() {
  const seq = [...ROWS].sort((a, b) => a.i - b.i);
  const W = 150, pts = [], lab = [];
  for (let i = W; i <= seq.length; i += 10) {
    pts.push(+avg(seq.slice(i - W, i).map(r => r.rate.score)).toFixed(3));
    lab.push(i);
  }
  $('cTrend').parentElement.style.height = '300px';
  draw('cTrend', {
    type: 'line',
    data: { labels: lab, datasets: [{
      data: pts, borderColor: C.brand, borderWidth: 2, pointRadius: 0,
      tension: .3, fill: true, backgroundColor: C.amberFill }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ...GRID, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { ...GRID, title: { display: true, text: 'средний балл по 150 трекам', color: C.dim } }
      },
      plugins: { tooltip: TOOLTIP }
    }
  });
}

/* ---------- 03. исполнители ---------- */
function renderArtists(rows) {
  // группируем по УЧАСТНИКАМ, а не по «главному» имени из строки:
  // иначе Hatsune Miku, которая почти всегда идёт после feat.,
  // попадает в статистику 5 раз вместо 59
  const m = group(rows, r => r.parts.length ? r.parts : (r.artistKey || null));
  const all = [...m].map(([key, rs]) => ({
    a: PART_NAMES.get(key) || ARTIST_NAMES.get(key) || key,
    n: rs.length,
    avg: +avg(rs.map(r => r.rate.score)).toFixed(2),
    top: rs.filter(r => r.rate.tier === 'гениально').length
  }));
  table('tArtCount',
    [{ k: 'a', t: 'исполнитель', lead: 1, f: artistLink }, { k: 'n', t: 'разносов', num: 1 },
     { k: 'avg', t: 'ср. балл', num: 1, f: r => f2(r.avg) },
     { k: 'top', t: 'гениально', num: 1 }],
    all.sort((x, y) => y.n - x.n).slice(0, 60), 'n');
  table('tArtAvg',
    [{ k: 'a', t: 'исполнитель', lead: 1, f: artistLink },
     { k: 'avg', t: 'ср. балл', num: 1, f: r => f2(r.avg) },
     { k: 'n', t: 'разносов', num: 1 }],
    all.filter(x => x.n >= MIN_N.artistAvg).sort((x, y) => y.avg - x.avg).slice(0, 60), 'avg');
}

/* ---------- 04. заказчики ---------- */
function renderUsers(rows) {
  const m = group(rows, r => r.userKey || null);
  const data = [...m].map(([key, rs]) => ({
    u: USER_NAMES.get(key) || key,
    n: rs.length,
    avg: +avg(rs.map(r => r.rate.score)).toFixed(2),
    gen: rs.filter(r => r.rate.label === 'гениально').length,
    genfam: rs.filter(r => r.rate.tier === 'гениально').length,
    best: SCALE_ORDER[Math.min(...rs.map(r => SCALE_ORDER.indexOf(r.rate.label)))] || '—',
    // балл лучшего результата — по нему и сортируем, подпись только показываем
    bestScore: Math.max(...rs.map(r => r.rate.score))
  })).filter(x => x.n >= MIN_N.user);
  table('tUsers',
    [{ k: 'u', t: 'заказчик', lead: 1, f: userLink }, { k: 'n', t: 'принёс', num: 1 },
     { k: 'avg', t: 'ср. балл', num: 1, f: r => f2(r.avg) },
     { k: 'genfam', t: 'в гениально', num: 1 }, { k: 'gen', t: 'чистых', num: 1 },
     // та же плашка, что в поиске: цвет ступени читается быстрее текста
     { k: 'best', t: 'лучший результат', mono: 1, sortK: 'bestScore',
       f: r => ratePill(r.best) }],
    data.sort((x, y) => y.n - x.n), 'n');
}

/* Пара графиков «объём / средний балл» — используется много где */
function pairCharts(idN, idAvg, items, limit) {
  const byN = [...items].sort((a, b) => b.n - a.n).slice(0, limit);
  hbar(idN, byN.map(x => ({ k: x.k, v: x.n })), C.brand);
  const byA = [...byN].sort((a, b) => b.avg - a.avg);
  hbar(idAvg, byA.map(x => ({ k: x.k, v: x.avg })), C.patch, 10);
}

/* ---------- 05. жанры ---------- */
function renderGenres(rows) {
  pairCharts('cGenreN', 'cGenreAvg',
    summarize(rows, r => r.genres, MIN_N.genre), 18);
}

/* ---------- 06. откуда трек ---------- */
function renderOrigin(rows) {
  pairCharts('cOrigin', 'cOriginAvg',
    summarize(rows, r => r.origin || null, MIN_N.origin), 10);
}

/* ---------- 08. как попал в очередь ---------- */
function renderType(rows) {
  pairCharts('cType', 'cTypeAvg',
    summarize(rows, r => r.type || null, MIN_N.type), 12);
}

/* ---------- 09. время внутри эфира ----------
   Прежняя версия обрезала всё после 7 часов и выбрасывала 812
   разносов, а последнее ведро выходило полупустым — линия среднего
   в нём падала и выглядела как вывод. Теперь ведро показывается,
   только если в нём набралось достаточно треков. */
function renderHour(rows) {
  const buckets = new Map();
  rows.forEach(r => {
    if (r.min == null) return;
    const b = Math.floor(r.min / 30) * 30;
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(r.rate.score);
  });
  const keys = [...buckets.keys()].sort((a, b) => a - b)
    .filter(k => buckets.get(k).length >= MIN_N.hourBucket);

  const scores = keys.map(k => +avg(buckets.get(k)).toFixed(2));
  const lo = Math.min(...scores), hi = Math.max(...scores);

  $('cHour').parentElement.style.height = '320px';
  draw('cHour', {
    data: {
      labels: keys.map(k => `${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')}`),
      datasets: [
        { type: 'bar', label: 'разносов', data: keys.map(k => buckets.get(k).length),
          backgroundColor: '#2E2925', yAxisID: 'y1', order: 2 },
        { type: 'line', label: 'средний балл', data: scores,
          borderColor: C.brand, borderWidth: 2, pointRadius: 2, tension: .3,
          yAxisID: 'y', order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ...GRID, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        // не от нуля: иначе вся разница (6,6–6,9) сплющивается в прямую
        y: { ...GRID, position: 'left', min: Math.floor(lo * 5 - 1) / 5, max: Math.ceil(hi * 5 + 1) / 5,
             title: { display: true, text: 'средний балл', color: C.brand } },
        y1: { ...GRID, position: 'right', beginAtZero: true, grid: { display: false },
              title: { display: true, text: 'разносов', color: C.dim } }
      },
      plugins: { tooltip: { ...TOOLTIP, mode: 'index', intersect: false } }
    }
  });
  $('hourNote').textContent =
    `показаны получасовые отрезки, где набралось хотя бы ${MIN_N.hourBucket} разносов`;
}

/* ---------- 10. тэги ----------
   Средний балл раньше вписывали прямо в подпись, и она не влезала:
   «progressive» превращалось в «ogressive». Теперь два графика. */
function renderTags(rows) {
  pairCharts('cTagN', 'cTagAvg',
    summarize(rows, r => r.tags, MIN_N.tag), 14);
}

/* ---------- 11. площадки ---------- */
function renderPlatforms(rows) {
  pairCharts('cPlatN', 'cPlatAvg',
    summarize(rows, r => r.platform || null, MIN_N.platform), 10);
}

/* ---------- страны исполнителей ----------
   Берутся из data/countries.json, который наполняет
   scripts/countries.mjs через MusicBrainz. Пока файл пуст,
   раздел скрыт — письменность рядом работает всегда. */
function renderCountries(rows) {
  const sec = $('secCountry');
  const known = rows.filter(r => r.country);
  if (known.length < 50) { sec.style.display = 'none'; return; }
  sec.style.display = '';

  const items = summarize(known, r => r.country, 10);
  pairCharts('cCountryN', 'cCountryAvg', items, 14);

  const cov = (known.length / rows.length * 100).toFixed(0);
  $('countryNote').textContent =
    `страна известна у ${num(known.length)} из ${num(rows.length)} разносов (${cov}%), ` +
    `остальных MusicBrainz либо не знает, либо не уверен в совпадении`;
}

/* ---------- 11. сколько длится один разнос ----------
   Ведро — одна минута; всё длиннее DUR_CAP_MIN сводится в последнее. */
function renderDuration(rows) {
  const withDur = rows.filter(r => r.dur != null);
  if (withDur.length < 200) { $('durNote').textContent = ''; return; }

  const buckets = new Map();
  withDur.forEach(r => {
    const m = Math.min(DUR_CAP_MIN, Math.floor(r.dur / 60));
    if (!buckets.has(m)) buckets.set(m, []);
    buckets.get(m).push(r.rate.score);
  });
  const keys = [...buckets.keys()].sort((a, b) => a - b)
    .filter(k => buckets.get(k).length >= MIN_N.durBucket);
  const label = k => k >= DUR_CAP_MIN ? `${DUR_CAP_MIN}+ мин` : `${k}–${k + 1} мин`;

  hbar('cDurN', keys.map(k => ({ k: label(k), v: buckets.get(k).length })), C.brand);
  hbar('cDurAvg', keys.map(k => ({ k: label(k), v: +avg(buckets.get(k)).toFixed(2) })),
       C.patch, 10);

  const all = withDur.map(r => r.dur).sort((a, b) => a - b);
  const med = all[Math.floor(all.length / 2)] / 60;
  $('durNote').textContent =
    `Медиана — ${med.toFixed(0)} мин. Промежутки короче полутора минут и длиннее ` +
    `${DUR_MAX_SEC / 60} минут отброшены: это паузы и перерывы, а не разбор.`;
}

/* ---------- 12. ритм стримов ----------
   Считается по всем стримам, а не по отфильтрованным строкам: это
   характеристика эфиров, а не оценок, и фильтр по ступени её не меняет. */
function renderStreams() {
  const counts = new Map();
  ROWS.forEach(r => {
    if (r.streamNum == null) return;
    counts.set(r.streamNum, (counts.get(r.streamNum) || 0) + 1);
  });
  const pts = STREAMS.filter(s => counts.has(s.num) && s.date)
    .map(s => ({ x: s.date.getTime(), y: counts.get(s.num), n: s.num }))
    .sort((a, b) => a.x - b.x);

  $('cPerStream').parentElement.style.height = '300px';
  draw('cPerStream', {
    type: 'line',
    data: { datasets: [{ data: pts, borderColor: C.brand, borderWidth: 1.5,
      pointRadius: 2, pointBackgroundColor: C.brand, tension: .25,
      fill: true, backgroundColor: C.amberFill }] },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      scales: {
        x: { ...GRID, type: 'linear', min: pts[0].x, max: pts[pts.length - 1].x,
             ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5,
               callback: v => new Date(v).toLocaleDateString('ru-RU',
                 { month: 'short', year: '2-digit' }) } },
        y: { ...GRID, beginAtZero: true, title: { display: true, text: 'треков за эфир', color: C.dim } }
      },
      plugins: { tooltip: { ...TOOLTIP, callbacks: {
        title: it => `стрим №${it[0].raw.n}`,
        label: it => `${it.raw.y} ` + plural(it.raw.y, 'трек', 'трека', 'треков') +
          ' · ' + new Date(it.raw.x).toLocaleDateString('ru-RU')
      } } }
    }
  });

  const D = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const ORDER = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const wd = new Map(ORDER.map(d => [d, 0]));
  STREAMS.forEach(s => { if (s.date) wd.set(D[s.date.getUTCDay()], wd.get(D[s.date.getUTCDay()]) + 1); });
  hbar('cWeekday', ORDER.map(d => ({ k: d, v: wd.get(d) })), C.brand);

  const total = [...counts.values()];
  const med = [...total].sort((a, b) => a - b)[Math.floor(total.length / 2)];
  $('streamNote').textContent =
    `Всего ${num(STREAMS.length)} ` + plural(STREAMS.length, 'эфир', 'эфира', 'эфиров') +
    `, в среднем ${med} ` + plural(med, 'трек', 'трека', 'треков') +
    ` за раз, рекорд — ${Math.max(...total)}.`;
}

/* ---------- 03. рекорды ----------
   Считаются по всему архиву, а не по отфильтрованным строкам: рекорд
   на то и рекорд, что он один на всю историю. */
function renderRecords() {
  const fmtDate = d => d
    ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const mins = sec => Math.round(sec / 60);
  const link = (r, text) => r.moment
    ? `<a href="${esc(r.moment)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
    : esc(text);
  const track = r => `${link(r, r.artist + ' — ' + r.title)}`;
  const strm = n => `<a class="pf-link" href="#stream=${n}" data-stream="${n}">Стрим №${n}</a>`;

  const out = [];
  const push = (rv, rl, rw, rn) => out.push({ rv, rl, rw, rn });

  /* самый долгий и самый короткий разбор */
  const dur = ROWS.filter(r => r.dur != null).sort((a, b) => b.dur - a.dur);
  if (dur.length) {
    const a = dur[0], b = dur[dur.length - 1];
    push(mins(a.dur) + ' мин', 'самый долгий разнос', track(a),
      `${a.rate.label} · стрим №${a.streamNum}`);
    push(mins(b.dur) + ' мин', 'самый короткий', track(b),
      `${b.rate.label} · стрим №${b.streamNum}`);
  }

  /* стримы: считаем средний балл и длину */
  const byStream = new Map();
  ROWS.forEach(r => {
    if (r.streamNum == null) return;
    if (!byStream.has(r.streamNum)) byStream.set(r.streamNum, []);
    byStream.get(r.streamNum).push(r);
  });
  const st = [...byStream].map(([n, l]) => ({
    n, cnt: l.length, date: l[0].date,
    avg: avg(l.map(r => r.rate.score)),
    len: Math.max(...l.map(r => r.sec ?? 0))
  })).filter(x => x.cnt >= MIN_N.recordStream);

  if (st.length) {
    const byAvg = [...st].sort((a, b) => b.avg - a.avg);
    const top = byAvg[0], low = byAvg[byAvg.length - 1];
    push(f2(top.avg), 'лучший эфир', strm(top.n),
      `${fmtDate(top.date)} · ${top.cnt} ` + plural(top.cnt, 'трек', 'трека', 'треков'));
    push(f2(low.avg), 'худший эфир', strm(low.n),
      `${fmtDate(low.date)} · ${low.cnt} ` + plural(low.cnt, 'трек', 'трека', 'треков'));

    const byLen = [...st].sort((a, b) => b.len - a.len)[0];
    push((byLen.len / 3600).toFixed(1) + ' ч', 'самый длинный эфир', strm(byLen.n),
      `${fmtDate(byLen.date)} · ${byLen.cnt} ` + plural(byLen.cnt, 'трек', 'трека', 'треков'));

    const byCnt = [...st].sort((a, b) => b.cnt - a.cnt)[0];
    push(num(byCnt.cnt), plural(byCnt.cnt, 'трек', 'трека', 'треков') + ' за один эфир', strm(byCnt.n),
      `${fmtDate(byCnt.date)} · ${(byCnt.len / 3600).toFixed(1)} ч`);
  }

  /* серии по хронологии */
  // внутри эфира порядок задаёт номер трека, а не тайм-код: в таблице
  // тайм-коды местами разъезжаются, а нумерация идёт подряд
  const chron = ROWS.filter(r => r.date)
    .sort((a, b) => a.date - b.date || a.streamNum - b.streamNum || (a.pos ?? 0) - (b.pos ?? 0));

  let run = 0, runTier = null, bestRun = 0, bestTier = null, bestAt = null;
  let dry = 0, bestDry = 0, dryAt = null;
  chron.forEach(r => {
    if (r.rate.tier === runTier) run++; else { runTier = r.rate.tier; run = 1; }
    if (run > bestRun) { bestRun = run; bestTier = runTier; bestAt = r; }

    if (r.rate.tier === 'гениально') dry = 0;
    else { dry++; if (dry > bestDry) { bestDry = dry; dryAt = r; } }
  });

  if (bestRun > 1) push(num(bestRun) + ' подряд', 'одна ступень без перерыва',
    `«${bestTier}»`, bestAt ? `закончилось на стриме №${bestAt.streamNum}` : '');
  if (bestDry > 1) push(num(bestDry), 'разносов без «гениально»',
    'самая долгая засуха', dryAt ? `до стрима №${dryAt.streamNum}` : '');

  $('recs').innerHTML = out.map(r => `<div class="rec">
    <div class="rv">${r.rv}</div>
    <div class="rl">${esc(r.rl)}</div>
    <div class="rw">${r.rw}</div>
    ${r.rn ? `<div class="rn">${esc(r.rn)}</div>` : ''}
  </div>`).join('');
}
