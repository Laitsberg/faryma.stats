/* ============================================================
   РАЗДЕЛЫ СТРАНИЦЫ
   Каждая функция получает уже отфильтрованные строки и рисует
   свой кусок. Порядок вызовов — в app.js.
   ============================================================ */

/* ---------- пульт: ступени шкалы ---------- */
function renderLadder(rows = ROWS) {
  const m = group(rows, r => r.rate.tier);
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
function renderDock(rows = ROWS) {
  const m = group(rows, r => r.rate.tier);
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
  $('dockReset').hidden = !FILTER.tier && !FILTER.year;
}

/* ---------- пульт: годы ----------
   Вторая ось фильтра. Кнопка «весь архив» — то же, что снятый фильтр:
   так виднее, что год вообще можно выбрать, чем если бы отмена
   пряталась в повторном клике по активному году. */
function renderYears() {
  const годы = [...new Set(ROWS.filter(r => r.date).map(r => r.date.getFullYear()))]
    .sort((a, b) => a - b);
  const места = [$('years'), $('dockYears')].filter(Boolean);
  if (годы.length < 2) { места.forEach(el => el.hidden = true); return; }

  const счёт = new Map(годы.map(y =>
    [y, ROWS.filter(r => r.date && r.date.getFullYear() === y).length]));

  const кнопки = (cls) =>
    `<button class="${cls}${FILTER.year ? '' : ' on'}" data-y="">весь архив` +
    `<b>${num(ROWS.length)}</b></button>` +
    годы.map(y => `<button class="${cls}${FILTER.year === y ? ' on' : ''}" data-y="${y}">` +
      `${y}<b>${num(счёт.get(y))}</b></button>`).join('');

  места.forEach(el => {
    el.hidden = false;
    el.innerHTML = (el.id === 'years' ? '<span class="years-t">год</span>' : '') +
      кнопки(el.id === 'years' ? 'yr' : 'chip yr-chip');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {
      FILTER.year = b.dataset.y ? +b.dataset.y : null;
      render();
    });
  });
}

/* ---------- метрики ---------- */
function renderKpis(rows) {
  const arts  = new Set(rows.map(r => r.artistKey).filter(Boolean));
  const users = new Set(rows.flatMap(r => r.userParts));
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
function renderScale(rows = ROWS) {
  const m = group(rows, r => r.rate.label);

  // Числа живые: цифра в тексте не должна разойтись с цифрой в шапке.
  // И «за всю историю» врать не должно — под фильтром по году период
  // другой, так что подпись меняется вместе с ним.
  const когда = FILTER.year ? `в ${FILTER.year}-м` : 'за всю историю';
  const разы = n => num(n) + ' ' + plural(n, 'раз', 'раза', 'раз') + ' ' + когда;

  // «Чистое гениально» — без плюсов и минусов.
  $('pureNote').textContent = разы((m.get('гениально') || []).length);

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
function renderTrend(rows = ROWS) {
  const seq = rows.filter(r => r.date).sort((a, b) => a.date - b.date || a.i - b.i);
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
  // Эфиров столько, сколько их в показанном срезе: при фильтре по году
  // «273 эфира» рядом с датами одного года выглядело ложью.
  const эфиров = new Set(seq.map(r => r.streamNum).filter(n => n != null)).size;
  $('trendNote').textContent =
    `Охвачен путь от ${fmt(first)} до ${fmt(last)} — ${num(эфиров)} ` +
    plural(эфиров, 'эфир', 'эфира', 'эфиров') + '.';
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
  // по участникам заказа, а не по строке целиком: совместный заказ
  // должен засчитаться обоим
  const m = group(rows, r => r.userParts.length ? r.userParts : null);
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

/* ---------- 05. какие бывают заказчики ----------
   Идея подсмотрена в «Итогах 2025», которые собрал один из зрителей:
   таблица «кто сколько принёс» говорит только про объём, а самое
   интересное в заказчиках — их вкус.

   Фильтр по ступени сюда не доходит: это характеристика человека, а не
   оценки. А вот год доходит — и должен. Без него номинации замерзают за
   теми, кто на стримы давно не ходит: их рекорд уже никому не побить,
   потому что новых треков они не приносят. */
function renderFans(rows = ROWS) {
  const g = group(rows, r => r.userParts.length ? r.userParts : null);
  const users = [...g].map(([k, rs]) => ({ k, name: USER_NAMES.get(k) || k, rs, n: rs.length }))
                      .filter(u => u.n >= MIN_N.fan);

  const link = u => `<a class="pf-link" href="#user=${encodeURIComponent(u.name)}" data-user="${esc(u.name)}">${esc(u.name)}</a>`;

  /* Доля самого частого значения: кто носит одно и то же */
  const loyal = (pick, minTot) => users.map(u => {
    const m = new Map(); let tot = 0;
    u.rs.forEach(r => { const v = pick(r); if (!v) return; tot++; m.set(v, (m.get(v) || 0) + 1); });
    if (tot < minTot) return null;
    const [top, c] = [...m].sort((a, b) => b[1] - a[1])[0];
    return { u, top, c, tot, pct: c / tot * 100 };
  }).filter(Boolean).sort((a, b) => b.pct - a.pct || b.c - a.c);

  /* Сколько разного принёс */
  const wide = pick => users.map(u => ({
    u, uniq: new Set(u.rs.flatMap(r => { const v = pick(r); return v ? (Array.isArray(v) ? v : [v]) : []; })).size
  })).sort((a, b) => b.uniq - a.uniq || b.u.n - a.u.n);

  /* Доля треков из аниме / игр / кино */
  const from = origin => users.map(u => {
    const c = u.rs.filter(r => r.origin === origin).length;
    return { u, c, pct: c / u.n * 100 };
  }).filter(x => x.c >= MIN_N.fan).sort((a, b) => b.pct - a.pct || b.c - a.c);

  const rows5 = (list, val) => list.slice(0, 5).map(x =>
    `<div class="fan-row"><span class="fan-n">${link(x.u)}</span>
      <span class="fan-v">${val(x)}</span></div>`).join('');

  const card = (title, cap, body) => body
    ? `<div class="card fan"><h3>${esc(title)}</h3><div class="cap">${esc(cap)}</div>${body}</div>`
    : '';

  const pctVal = x => `${esc(x.top)} <b>${x.pct.toFixed(0)}%</b> <i>${x.c} из ${x.tot}</i>`;

  const cards = [
    card('Верен одной стране', 'какая доля треков из одной страны',
         rows5(loyal(r => r.country, MIN_N.fan), pctVal)),
    card('Верен одному жанру', 'какая доля треков одного жанра',
         rows5(loyal(r => r.genres[0], MIN_N.fan), pctVal)),
    card('Верен одному исполнителю', 'какая доля треков одного артиста',
         rows5(loyal(r => r.artistKey, MIN_N.fan),
               x => `${esc(ARTIST_NAMES.get(x.top) || x.top)} <b>${x.pct.toFixed(0)}%</b> <i>${x.c} из ${x.tot}</i>`)),
    card('Больше всего разных стран', 'кто возит со всего света',
         rows5(wide(r => r.country), x => `<b>${num(x.uniq)}</b> <i>из ${x.u.n} треков</i>`)),
    card('Больше всего разных жанров', 'кого не отнести к одному вкусу',
         rows5(wide(r => r.genres), x => `<b>${num(x.uniq)}</b> <i>из ${x.u.n} треков</i>`)),
    card('Аниме', 'доля треков из аниме',
         rows5(from('Аниме'), x => `<b>${x.pct.toFixed(0)}%</b> <i>${x.c} из ${x.u.n}</i>`)),
    card('Игры', 'доля треков из игр',
         rows5(from('Игра'), x => `<b>${x.pct.toFixed(0)}%</b> <i>${x.c} из ${x.u.n}</i>`)),
    card('Кино', 'доля треков из фильмов',
         rows5(from('Фильм'), x => `<b>${x.pct.toFixed(0)}%</b> <i>${x.c} из ${x.u.n}</i>`))
  ];

  /* Альянсы: кто носит треки вдвоём */
  const пары = new Map();
  rows.forEach(r => {
    if (r.userParts.length < 2) return;
    const k = [...r.userParts].sort().join('\u0000');
    пары.set(k, (пары.get(k) || 0) + 1);
  });
  const alli = [...пары].filter(([, n]) => n >= MIN_N.ally)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => {
      const names = k.split('\u0000').map(x => USER_NAMES.get(x) || x);
      return `<div class="fan-row"><span class="fan-n">` +
        names.map(x => `<a class="pf-link" href="#user=${encodeURIComponent(x)}" data-user="${esc(x)}">${esc(x)}</a>`).join('<span class="sep"> + </span>') +
        `</span>
        <span class="fan-v"><b>${num(n)}</b> <i>${plural(n, 'трек', 'трека', 'треков')} вместе</i></span></div>`;
    }).join('');

  $('fans').innerHTML = cards.join('') +
    card('Альянсы', 'кто приносит треки вдвоём', alli);
}

/* Пара графиков «объём / средний балл» — используется много где */
function pairCharts(idN, idAvg, items, limit) {
  const byN = [...items].sort((a, b) => b.n - a.n).slice(0, limit);
  hbar(idN, byN.map(x => ({ k: x.k, v: x.n })), C.brand);
  const byA = [...byN].sort((a, b) => b.avg - a.avg);
  hbar(idAvg, byA.map(x => ({ k: x.k, v: x.avg })), C.patch, 10);
}

/* ---------- менял ли он мнение ----------
   Повтор помечен прямо в названии: «(ПОВТОР: СТРИМ №113; 1 трек от
   Hantrik)». По номеру стрима и номеру трека находим исходный разнос
   и сравниваем оценки. Совпало 27 пар из 35 помеченных: у остальных
   ссылка ведёт в стрим, которого в архиве нет. */
/* Повтором считаем второй разнос: он и должен попасть в выбранный год.
   Исходный ищем по всему архиву — он вполне мог быть годом раньше, и
   отбрасывать пару из-за этого было бы неверно. */
function repeatPairs(rows = ROWS) {
  const RE = /ПОВТОР:\s*СТРИМ\s*№\s*(\d+)\s*;\s*(\d+)\s*трек/i;
  const out = [];
  rows.forEach(r => {
    const m = (r.full || '').match(RE);
    if (!m) return;
    const src = ROWS.find(x => x.streamNum === +m[1] && x.pos === +m[2]);
    if (!src || src === r) return;
    out.push({ src, again: r, d: r.rate.score - src.rate.score,
               days: src.date && r.date ? Math.round((r.date - src.date) / 864e5) : null });
  });
  return out;
}

function renderRepeats(rows = ROWS) {
  const pairs = repeatPairs(rows);
  if (pairs.length < 5) { $('secRepeat').style.display = 'none'; return; }
  $('secRepeat').style.display = '';

  const up = pairs.filter(x => x.d > 0).length;
  const down = pairs.filter(x => x.d < 0).length;
  const same = pairs.length - up - down;
  const avg = pairs.reduce((a, x) => a + x.d, 0) / pairs.length;

  $('repNote').textContent =
    `${num(pairs.length)} ` + plural(pairs.length, 'трек', 'трека', 'треков') +
    ` приносили дважды. Выше — ${up}, ниже — ${down}, ровно так же — ${same}; ` +
    `в среднем на повторе ${avg >= 0 ? '+' : ''}${f2(avg)} балла.`;

  table('tRepeat',
    [{ k: 'name', t: 'трек', lead: 1, w: '34%',
       f: r => artistNames(r.artist) + ' — ' + esc(r.title) },
     { k: 'was', t: 'было', mono: 1, w: '15%', sortK: 'wasScore', f: r => ratePill(r.was) },
     { k: 'now', t: 'стало', mono: 1, w: '15%', sortK: 'nowScore', f: r => ratePill(r.now) },
     { k: 'd', t: 'разница', num: 1, w: '12%',
       f: r => `<b style="color:${r.d > 0 ? C.patch : r.d < 0 ? C.peak : 'inherit'}">` +
               `${r.d > 0 ? '+' : ''}${f2(r.d)}</b>` },
     { k: 'when', t: 'между', mono: 1, w: '24%',
       f: r => `<a class="pf-link nowrap" href="#stream=${r.s1}" data-stream="${r.s1}">№${r.s1}</a>` +
               ` <span class="sep">→</span> ` +
               `<a class="pf-link nowrap" href="#stream=${r.s2}" data-stream="${r.s2}">№${r.s2}</a>` +
               (r.days != null ? ` <span class="plat">${num(r.days)} дн.</span>` : '') }],
    pairs.map(x => ({
      artist: x.again.artist, title: x.again.title,
      name: x.again.artist + ' — ' + x.again.title,
      was: x.src.rate.label, now: x.again.rate.label,
      wasScore: x.src.rate.score, nowScore: x.again.rate.score,
      d: +x.d.toFixed(1), s1: x.src.streamNum, s2: x.again.streamNum, days: x.days
    })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)), 'd');
}

/* ---------- откуда трек родом ----------
   В квадратных скобках названия лежит источник: игра, аниме, фильм.
   Раздел «Откуда трек» говорит только тип, а здесь — конкретные
   вселенные: Genshin Impact, Chainsaw Man, Смешарики. */
function renderUniverses(rows) {
  pairCharts('cSrcN', 'cSrcAvg',
    summarize(rows, r => r.source || null, MIN_N.source), 16);
}

/* ---------- оценки вне шкалы ----------
   Раз в сто разносов композитор выдаёт что-то своё вместо ступени.
   В статистику это не пустить, но и терять жалко. */
function renderOffscale() {
  // год фильтруем и здесь: у этих строк ступени нет, но дата есть
  const список = FILTER.year
    ? OFFSCALE.filter(o => o.date && o.date.getFullYear() === FILTER.year)
    : OFFSCALE;
  if (!список.length) { $('secOff').style.display = 'none'; return; }
  $('secOff').style.display = '';
  $('offNote').textContent =
    `${num(список.length)} ` + plural(список.length, 'раз', 'раза', 'раз') +
    (FILTER.year ? ` за ${FILTER.year} год.` : ' за всю историю архива.') +
    ` В графики они не идут: ступени у них нет.`;

  $('offList').innerHTML = [...список].reverse().map(o => {
    const name = (o.artist ? artistNames(o.artist) + ' — ' : '') + esc(o.title);
    const link = o.moment
      ? ` <a class="mom" href="${esc(o.moment)}" target="_blank" rel="noopener noreferrer">▶ разнос</a>`
      : '';
    const when = o.date ? o.date.toLocaleDateString('ru-RU') : '';
    return `<div class="off-row">
      <div class="off-r">${esc(o.raw)}</div>
      <div class="off-t">${name}</div>
      <div class="off-d">${esc(when)}` +
      (o.streamNum ? ` <a class="pf-link nowrap" href="#stream=${o.streamNum}" data-stream="${o.streamNum}">стрим №${o.streamNum}</a>` : '') +
      `${link}</div>
    </div>`;
  }).join('');
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
    `Показаны получасовые отрезки, где набралось хотя бы ${MIN_N.hourBucket} разносов.`;
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
    `Страна известна у ${num(known.length)} из ${num(rows.length)} разносов (${cov}%); ` +
    `остальных MusicBrainz либо не знает, либо не уверен в совпадении.`;
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
   Считается по строкам, а не по всем стримам: при фильтре по году
   должны остаться эфиры этого года. Фильтр по ступени сюда не доходит
   — это характеристика эфиров, а не оценок. */
function renderStreams(rows = ROWS) {
  const counts = new Map();
  rows.forEach(r => {
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
    `Всего ${num(pts.length)} ` + plural(pts.length, 'эфир', 'эфира', 'эфиров') +
    `, в среднем ${med} ` + plural(med, 'трек', 'трека', 'треков') +
    ` за раз, рекорд — ${Math.max(...total)}.`;
}

/* ---------- 03. рекорды ----------
   Считаются по всему архиву, а не по отфильтрованным строкам: рекорд
   на то и рекорд, что он один на всю историю. */
function renderRecords(rows = ROWS) {
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

  /* Самый короткий разбор. Самого долгого здесь нет намеренно:
     тайм-коды не отличают долгий разнос от разноса, после которого
     композитор ушёл на перерыв, так что «рекорд» всегда упирался
     в верхнюю отсечку и означал не разнос, а паузу. */
  const dur = rows.filter(r => r.dur != null).sort((a, b) => a.dur - b.dur);
  if (dur.length) {
    const b = dur[0];
    push(mins(b.dur) + ' мин', 'самый короткий разнос', track(b),
      `${b.rate.label} · стрим №${b.streamNum}`);
  }

  /* стримы: считаем средний балл и длину */
  const byStream = new Map();
  rows.forEach(r => {
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

    // Темп эфира: в отличие от длины одного разноса он измерим —
    // перерывы входят в общее время у всех стримов одинаково.
    const темп = st.filter(x => x.len >= 3600)
      .map(x => ({ ...x, ph: x.cnt / (x.len / 3600) }))
      .sort((a, b) => b.ph - a.ph)[0];
    if (темп) push(f2(темп.ph), 'трека в час — самый быстрый эфир', strm(темп.n),
      `${fmtDate(темп.date)} · ${темп.cnt} ` +
      plural(темп.cnt, 'трек', 'трека', 'треков') + ` за ${(темп.len / 3600).toFixed(1)} ч`);
  }

  /* серии по хронологии */
  // внутри эфира порядок задаёт номер трека, а не тайм-код: в таблице
  // тайм-коды местами разъезжаются, а нумерация идёт подряд
  const chron = rows.filter(r => r.date)
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
