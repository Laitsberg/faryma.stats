/* ============================================================
   ОБЩИЕ ЧАСТИ ИНТЕРФЕЙСА
   Таблицы, графики и мелкие помощники.
   ============================================================ */

const $  = id => document.getElementById(id);

/* Имя исполнителя как ссылка в его профиль.
   Строку с соавторами разбираем на участников: ссылкой становится
   каждый по отдельности, а «feat.» и «&» остаются простым текстом.
   Иначе клик по «Sawano Hiroyuki feat. Aimer» открывал карточку именно
   этой пары — с одним треком, — вместо карточки Савано или Аймер. */
function artistNames(name, cls) {
  if (!name || name === '—') return esc(name || '—');
  const c = cls || 'pf-link';
  return artistTokens(name, SOLO_KEYS).map(t => t.sep
    ? `<span class="sep">${esc(t.sep)}</span>`
    : `<a class="${c}" href="#artist=${encodeURIComponent(t.name)}" data-artist="${esc(t.name)}">${esc(t.name)}</a>`
  ).join('') || esc(name);
}

/* Обёртка для таблиц: имя лежит либо в a (сводные), либо в artist */
function artistLink(r) {
  return artistNames(r.a || r.artist || '');
}

/* Имя заказчика как ссылка в его профиль. Совместный заказ
   («kumashisan; Svd_bb») разбираем на двоих: каждый со своей ссылкой. */
function userNames(name) {
  if (!name || name === '—') return esc(name || '—');
  return userTokens(name).map(t => t.sep
    ? `<span class="sep">${esc(t.sep)}</span>`
    : `<a class="pf-link" href="#user=${encodeURIComponent(t.name)}" data-user="${esc(t.name)}">${esc(t.name)}</a>`
  ).join('') || esc(name);
}

/* Название вселенной как ссылка в её карточку */
function sourceLink(name) {
  return name
    ? `<a class="pf-link" href="#source=${encodeURIComponent(name)}" data-source="${esc(name)}">${esc(name)}</a>`
    : '';
}

function userLink(r) {
  return userNames(r.u || r.user || '');
}

/* Плашка оценки в цвет своей ступени */
function ratePill(label) {
  if (!label || label === '—') return '—';
  const tier = TIERS.find(t => label.startsWith(t.key));
  return `<span class="pill" style="color:${tier ? tier.c : 'inherit'}">${esc(label)}</span>`;
}
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const num = n => n.toLocaleString('ru-RU');
const f2  = n => n.toFixed(2);          // 9 → «9.00», иначе колонка прыгает

/* Склонение: plural(2,'стрим','стрима','стримов') → «стрима» */
/* Подсказка о том, что таблица прокручивается.
   Оборачиваем каждый прокручиваемый блок и красим низ, пока до конца
   не докрутили. Вызывается после каждой перерисовки: содержимое
   меняется вместе с фильтром, и высота вместе с ним. */
function markScrollables() {
  document.querySelectorAll('.scroll').forEach(el => {
    let wrap = el.parentElement;
    if (!wrap.classList.contains('scroll-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'scroll-wrap';
      el.parentElement.insertBefore(wrap, el);
      wrap.appendChild(el);
      el.addEventListener('scroll', () => update(el, wrap), { passive: true });
    }
    update(el, wrap);
  });

  function update(el, wrap) {
    const ещё = el.scrollHeight - el.clientHeight - el.scrollTop > 8;
    wrap.classList.toggle('more', ещё);
  }
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

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

/* Подпись значения прямо у столбца.
   Без неё, чтобы узнать число, надо было попасть пальцем ровно в столбец,
   а у мелких категорий (Telegram, SoundCloud) он в пару пикселей шириной.
   Число рисуем за концом столбца, а если там уже нет места — внутри. */
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, args, opts) {
    const fmt = opts?.fmt || (v => v);
    const { ctx } = chart;
    ctx.save();
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = 'middle';
    chart.getDatasetMeta(0).data.forEach((el, i) => {
      const v = chart.data.datasets[0].data[i];
      if (v == null) return;
      const text = fmt(v);
      const w = ctx.measureText(text).width;
      const room = chart.chartArea.right - el.x - 6;
      const inside = room < w;
      ctx.fillStyle = inside ? '#0D0D0F' : C.dim;
      ctx.textAlign = inside ? 'right' : 'left';
      ctx.fillText(text, inside ? el.x - 6 : el.x + 6, el.y);
    });
    ctx.restore();
  }
};

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
      // справа оставляем место под подпись значения
      layout: { padding: { right: 46 } },
      scales: {
        x: { ...GRID, max: maxX, beginAtZero: true },
        /* Длинные подписи Chart.js обрезает слева, и от «Rift of the
           NecroDancer» на телефоне оставалось «ift of the NecroDancer».
           Режем сами и с многоточием, а полное название остаётся
           в подсказке при наведении. */
        y: { ...GRID, ticks: { autoSkip: false, font: { size: 11 },
          callback(v) {
            const t = String(this.getLabelForValue(v));
            const max = (this.chart.width || 400) < 520 ? 19 : 32;
            return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
          } } }
      },
      plugins: {
        tooltip: TOOLTIP,
        valueLabels: { fmt: maxX === 10 ? (v => f2(v)) : (v => num(v)) }
      }
    },
    plugins: [valueLabels]
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

  // Колонка может показывать одно, а сортироваться по другому. Оценка
  // выводится подписью («атлична - -»), но сравнивать её как текст
  // нельзя: по алфавиту «атлична» встаёт выше «хорошечно», хотя это
  // разные концы шкалы. У таких колонок есть sortK с числом.
  const col = cols.find(c => c.k === sk);
  const key = (col && col.sortK) || sk;

  if (!t.dataset.dir) t.dataset.dir = defaultDirFor(rows, key);
  const dir = t.dataset.dir === 'asc' ? 1 : -1;

  // Сортируем ВЕСЬ набор и только потом обрезаем. Если резать раньше,
  // сортировка переставляет лишь первые строки, а таблица при этом
  // уверяет, что показывает весь архив.
  // Пустые значения всегда внизу, в какую бы сторону ни сортировали:
  // иначе по возрастанию список открывается прочерками — у четырёх
  // записей в архиве исполнитель не разбирается, да и жанр с источником
  // заполнены не везде.
  const blank = v => v == null || v === '' || v === '—';

  const sorted = [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (blank(x) !== blank(y)) return blank(x) ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x).localeCompare(String(y), 'ru') * dir;
  });
  const shown = limit ? sorted.slice(0, limit) : sorted;

  // Ширины колонок задаются долями, а таблица переводится в режим
  // фиксированной раскладки. Без этого браузер раздаёт ширину по
  // содержимому: одно длинное название трека растягивает свою колонку,
  // таблица вылезает за рамку и внизу появляется горизонтальная
  // прокрутка, а правые колонки уезжают за край.
  const widths = cols.every(c => c.w)
    ? '<colgroup>' + cols.map(c => `<col style="width:${c.w}">`).join('') + '</colgroup>'
    : '';
  t.classList.toggle('fixed', !!widths);

  const head = widths + '<thead><tr>' + cols.map(c =>
    `<th data-k="${esc(c.k)}" class="${c.num ? 'num' : ''}">${esc(c.t)}${
      sk === c.k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('') + '</tr></thead>';

  const body = '<tbody>' + shown.map(r => '<tr>' + cols.map(c => {
    const val = c.f ? c.f(r) : esc(r[c.k]);
    const cls = [c.num ? 'num mono' : (c.mono ? 'mono' : ''), c.lead ? 'lead' : '',
      String(val).trim() === '' ? 'empty' : ''].filter(Boolean).join(' ');
    return `<td class="${cls}" data-label="${esc(c.t)}">${val}</td>`;
  }).join('') + '</tr>').join('') + '</tbody>';

  t.innerHTML = head + body;
  capRows(t, elId, cols, rows, defaultSort, limit);

  // Обработчик висит на самой таблице, а не на каждом заголовке.
  // table() заменяет innerHTML целиком, и если между нажатием и
  // отпусканием кнопки успевает пройти перерисовка, старый <th>
  // исчезает вместе со своим onclick и клик пропадает. Таблица же
  // переживает перерисовку, поэтому до неё событие доходит всегда.
  t._args = { elId, cols, rows, defaultSort, limit };
  if (!t.dataset.bound) {
    t.dataset.bound = '1';
    t.addEventListener('click', e => {
      const th = e.target.closest('th');
      if (!th || !t.contains(th) || !th.dataset.k) return;
      if (t.dataset.sort === th.dataset.k) {
        t.dataset.dir = t.dataset.dir === 'asc' ? 'desc' : 'asc';
      } else {
        // новая колонка — начинаем с направления, осмысленного для неё
        const c = cols.find(x => x.k === th.dataset.k);
        t.dataset.sort = th.dataset.k;
        t.dataset.dir = defaultDirFor(rows, (c && c.sortK) || th.dataset.k);
      }
      const a = t._args;
      table(a.elId, a.cols, a.rows, a.defaultSort, a.limit);
    });
  }

  buildSortbar(t, cols, elId, rows, defaultSort, limit);
}

/* Направление сортировки по умолчанию зависит от того, что в колонке.
   У чисел осмысленно убывание — больше значит выше. У текста наоборот:
   убывание даёт список с конца алфавита, что выглядит поломкой.
   Смотрим на само значение, а не на пометку колонки: у «оценки»
   сравнение идёт по скрытому баллу, и она тоже должна идти по убыванию. */
function defaultDirFor(rows, key) {
  const row = rows.find(r => r[key] != null);
  return row && typeof row[key] === 'number' ? 'desc' : 'asc';
}

/* Сколько карточек показывать на телефоне до нажатия «показать все» */
const MOBILE_ROWS = 12;

/* Прячет хвост списка и вешает кнопку. Работает через класс, без
   перерисовки: нажатие мгновенное и не сбрасывает сортировку. */
function capRows(t, elId, cols, rows, defaultSort, limit) {
  const trs = [...t.querySelectorAll('tbody tr')];
  const extra = trs.length - MOBILE_ROWS;
  const card = t.closest('.card');
  if (!card) return;
  let btn = card.querySelector('.morebtn');
  if (extra <= 0) { if (btn) btn.classList.remove('on'); return; }

  trs.slice(MOBILE_ROWS).forEach(tr => tr.classList.add('over'));
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'morebtn';
    card.appendChild(btn);
  }
  const setLabel = () => btn.textContent = t.classList.contains('all')
    ? 'свернуть' : `показать все — ещё ${num(extra)}`;
  btn.classList.add('on');
  btn.onclick = () => { t.classList.toggle('all'); setLabel(); };
  setLabel();
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
    const c = cols.find(x => x.k === sel.value);
    t.dataset.sort = sel.value;
    t.dataset.dir = defaultDirFor(rows, (c && c.sortK) || sel.value);
    table(elId, cols, rows, defaultSort, limit);
  };
  holder.appendChild(sel);
}
