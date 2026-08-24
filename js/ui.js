/* ============================================================
   ОБЩИЕ ЧАСТИ ИНТЕРФЕЙСА
   Таблицы, графики и мелкие помощники.
   ============================================================ */

const $  = id => document.getElementById(id);
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const num = n => n.toLocaleString('ru-RU');
const f2  = n => n.toFixed(2);          // 9 → «9.00», иначе колонка прыгает

/* Группировка. keyfn может вернуть строку или массив строк
   (жанры и тэги перечислены через слэш и запятую). */
function group(rows, keyfn) {
  const m = new Map();
  rows.forEach(r => {
    const ks = keyfn(r);
    if (!ks) return;
    (Array.isArray(ks) ? ks : [ks]).forEach(k => {
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
  });
  return m;
}

/* Сводка по группам: сколько раз и с каким средним баллом */
function summarize(rows, keyfn, minN) {
  return [...group(rows, keyfn)]
    .map(([k, rs]) => ({ k, n: rs.length, avg: +avg(rs.map(r => r.rate.score)).toFixed(2) }))
    .filter(x => x.n >= minN);
}

/* ============================================================
   ГРАФИКИ
   ============================================================ */
Chart.defaults.color = C.dim;
Chart.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.display = false;
/* Анимацию выключаем намеренно: графиков на странице тринадцать, каждый
   подгоняет свою высоту под число делений, и вызванные этим пересчёты
   размера успевали сбросить анимацию до того, как столбцы дорисуются —
   график оставался пустым. Заодно страница легче открывается на телефоне. */
Chart.defaults.animation = false;
Chart.defaults.animations.colors = false;
Chart.defaults.animations.x = false;
Chart.defaults.animations.y = false;

const GRID = { grid: { color: C.grid }, border: { color: C.line } };
const TOOLTIP = {
  backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, padding: 10,
  titleFont: { family: "'JetBrains Mono', monospace" },
  bodyFont:  { family: "'JetBrains Mono', monospace" }
};

const charts = {};
function draw(id, cfg) {
  const el = $(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(el, cfg);
}

/* Горизонтальная линейка высотой под число делений.
   Фиксированная высота заставляла Chart.js прятать подписи:
   у полной шкалы 26 значений, и через одно они пропадали. */
function fitHeight(id, count, perRow = 22, min = 180) {
  const box = $(id)?.parentElement;
  if (box) box.style.height = Math.max(min, count * perRow + 56) + 'px';
}

function hbar(id, items, color, maxX) {
  fitHeight(id, items.length);
  draw(id, {
    type: 'bar',
    data: {
      labels: items.map(x => x.k),
      datasets: [{
        data: items.map(x => x.v),
        backgroundColor: typeof color === 'function' ? items.map(color) : color,
        borderWidth: 0
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 8 } },
      scales: {
        x: { ...GRID, max: maxX, beginAtZero: true },
        y: { ...GRID, ticks: { autoSkip: false, font: { size: 11 } } }
      },
      plugins: { tooltip: TOOLTIP }
    }
  });
}

/* ============================================================
   ТАБЛИЦЫ
   На узком экране превращаются в карточки — за это отвечает
   класс .cards и подписи data-label у ячеек.
   ============================================================ */
function table(elId, cols, rows, defaultSort, limit) {
  const t = $(elId);
  if (!t) return;
  t.classList.add('cards');
  t.dataset.sort = t.dataset.sort || defaultSort;

  const sk = t.dataset.sort;
  const dir = t.dataset.dir === 'asc' ? 1 : -1;

  // Сортируем ВЕСЬ набор и только потом обрезаем. Если резать раньше,
  // сортировка переставляет лишь первые строки, а таблица при этом
  // уверяет, что показывает весь архив.
  const sorted = [...rows].sort((a, b) => {
    const x = a[sk], y = b[sk];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'ru') * dir;
  });
  const shown = limit ? sorted.slice(0, limit) : sorted;

  const head = '<thead><tr>' + cols.map(c =>
    `<th data-k="${esc(c.k)}" class="${c.num ? 'num' : ''}">${esc(c.t)}${
      sk === c.k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('') + '</tr></thead>';

  const body = '<tbody>' + shown.map(r => '<tr>' + cols.map(c => {
    const val = c.f ? c.f(r) : esc(r[c.k]);
    const cls = [c.num ? 'num mono' : (c.mono ? 'mono' : ''), c.lead ? 'lead' : '',
      String(val).trim() === '' ? 'empty' : ''].filter(Boolean).join(' ');
    return `<td class="${cls}" data-label="${esc(c.t)}">${val}</td>`;
  }).join('') + '</tr>').join('') + '</tbody>';

  t.innerHTML = head + body;

  t.querySelectorAll('th').forEach(th => th.onclick = () => {
    if (t.dataset.sort === th.dataset.k) t.dataset.dir = t.dataset.dir === 'asc' ? 'desc' : 'asc';
    else { t.dataset.sort = th.dataset.k; t.dataset.dir = 'desc'; }
    table(elId, cols, rows, defaultSort, limit);
  });

  buildSortbar(t, cols, elId, rows, defaultSort, limit);
}

/* На мобильном заголовков нет, поэтому сортировку даём списком */
function buildSortbar(t, cols, elId, rows, defaultSort, limit) {
  const holder = t.closest('.card')?.querySelector('.sortbar');
  if (!holder) return;
  const cur = t.dataset.sort, dir = t.dataset.dir === 'asc' ? 'asc' : 'desc';
  holder.innerHTML = '<span>сортировка</span>';
  const sel = document.createElement('select');
  cols.forEach(c => {
    const o = new Option(c.t + (c.num ? ' ↓' : ''), c.k);
    if (c.k === cur) o.selected = true;
    sel.add(o);
  });
  sel.onchange = () => {
    t.dataset.sort = sel.value;
    t.dataset.dir = 'desc';
    table(elId, cols, rows, defaultSort, limit);
  };
  holder.appendChild(sel);
}
