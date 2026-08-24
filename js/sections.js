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

/* ---------- 02. тренд по порядку разносов ---------- */
function renderTrend() {
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
      data: pts, borderColor: C.amber, borderWidth: 2, pointRadius: 0,
      tension: .3, fill: true, backgroundColor: 'rgba(240,160,42,.08)' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ...GRID, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { ...GRID, title: { display: true, text: 'средний балл по 150 трекам', color: C.dim } }
      },
      plugins: {
        tooltip: { ...TOOLTIP, callbacks: {
          title: it => `разносы ${it[0].label - W + 1}–${it[0].label}`,
          label: it => 'средний балл ' + f2(it.raw)
        } }
      }
    }
  });
}

/* ---------- 03. исполнители ---------- */
function renderArtists(rows) {
  const m = group(rows, r => r.artistKey || null);
  const all = [...m].map(([key, rs]) => ({
    a: ARTIST_NAMES.get(key) || key,
    n: rs.length,
    avg: +avg(rs.map(r => r.rate.score)).toFixed(2),
    top: rs.filter(r => r.rate.tier === 'гениально').length
  }));
  table('tArtCount',
    [{ k: 'a', t: 'исполнитель', lead: 1 }, { k: 'n', t: 'разносов', num: 1 },
     { k: 'avg', t: 'ср. балл', num: 1, f: r => f2(r.avg) },
     { k: 'top', t: 'гениально', num: 1 }],
    all.sort((x, y) => y.n - x.n).slice(0, 60), 'n');
  table('tArtAvg',
    [{ k: 'a', t: 'исполнитель', lead: 1 },
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
    best: SCALE_ORDER[Math.min(...rs.map(r => SCALE_ORDER.indexOf(r.rate.label)))] || '—'
  })).filter(x => x.n >= MIN_N.user);
  table('tUsers',
    [{ k: 'u', t: 'заказчик', lead: 1 }, { k: 'n', t: 'принёс', num: 1 },
     { k: 'avg', t: 'ср. балл', num: 1, f: r => f2(r.avg) },
     { k: 'genfam', t: 'в гениально', num: 1 }, { k: 'gen', t: 'чистых', num: 1 },
     { k: 'best', t: 'лучший результат', mono: 1 }],
    data.sort((x, y) => y.n - x.n), 'n');
}

/* Пара графиков «объём / средний балл» — используется много где */
function pairCharts(idN, idAvg, items, limit) {
  const byN = [...items].sort((a, b) => b.n - a.n).slice(0, limit);
  hbar(idN, byN.map(x => ({ k: x.k, v: x.n })), C.amber);
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

/* ---------- 07. письменность ---------- */
function renderScriptChart(rows) {
  pairCharts('cLangN', 'cLangAvg',
    summarize(rows, r => r.script, MIN_N.script), 8);
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
          borderColor: C.amber, borderWidth: 2, pointRadius: 2, tension: .3,
          yAxisID: 'y', order: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ...GRID, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        // не от нуля: иначе вся разница (6,6–6,9) сплющивается в прямую
        y: { ...GRID, position: 'left', min: Math.floor(lo * 5 - 1) / 5, max: Math.ceil(hi * 5 + 1) / 5,
             title: { display: true, text: 'средний балл', color: C.amber } },
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
