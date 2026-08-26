/* ============================================================
   ЧТО У ТАЙТЛА ЕСТЬ ЕЩЁ
   ------------------------------------------------------------
   Архив знает только то, что уже принесли. Список всех опенингов
   и эндингов тайтла берём из data/themes.json — его собирает
   scripts/animethemes.mjs с animethemes.moe.

   Здесь сводим одно с другим: показываем все темы сезона и
   помечаем, какие уже разносили, а какие ещё нет.
   ============================================================ */

/* Название темы у нас и у них пишут по-разному: «Kick Back (TV Size)»,
   «KICK BACK», «Kick Back - Chainsaw Man OP». Сравниваем по словам,
   выкинув скобки и знаки. */
const tkey = s => String(s || '').toLowerCase()
  .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  .replace(/\b(?:tv|full|size|ver|version|op|ed|opening|ending)\b/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sameTitle(a, b) {
  const x = tkey(a), y = tkey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return 2 * n / (A.size + B.size) >= 0.75;
}

const THEME_KIND = { OP: 'Опенинг', ED: 'Эндинг', IN: 'Вставка', OST: 'OST' };
const THEME_ORDER = { OP: 0, ED: 1, IN: 2, OST: 3 };

/* Запись каталога для набора названий сезона. Совпадение с тайтлом
   бывает неточным, поэтому ниже честно пишем, что именно нашлось. */
function themeEntry(names) {
  for (const n of names) {
    const h = THEMES[n];
    if (h && h.slug && h.themes && h.themes.length) return h;
  }
  return null;
}

/* Блок «что ещё есть у тайтла» для одного сезона.
   rows — разносы этого сезона. */
function themeBlock(rows, seen) {
  const h = themeEntry([...new Set(rows.map(r => r.source))]);
  if (!h) return '';
  // разные сезоны иногда сводятся к одному и тому же тайтлу каталога —
  // второй раз тот же список показывать незачем
  if (seen) { if (seen.has(h.slug)) return ''; seen.add(h.slug); }

  const list = [...h.themes].sort((a, b) =>
    (THEME_ORDER[a.t] ?? 9) - (THEME_ORDER[b.t] ?? 9) ||
    (a.seq ?? 0) - (b.seq ?? 0) || String(a.s).localeCompare(String(b.s)));

  // один разнос закрывает одну тему: если тайтл приносили дважды,
  // вторая строка не должна отметить заодно и соседний опенинг
  const used = new Set();
  const done = list.map(t => {
    const i = rows.findIndex((r, i) => !used.has(i) && sameTitle(r.title, t.title));
    if (i < 0) return null;
    used.add(i);
    return rows[i];
  });
  const got = done.filter(Boolean).length;

  const rowsHtml = list.map((t, i) => {
    const r = done[i];
    const who = t.artists && t.artists.length ? ' — ' + esc(t.artists.join(', ')) : '';
    const right = r
      ? ratePill(r.rate.label)
      : `<span class="th-no">ещё не приносили</span>`;
    const when = r
      ? `<a class="tlink nowrap" href="#stream=${r.streamNum}">стрим №${r.streamNum}</a>`
      : '';
    return `<div class="pf-row${r ? '' : ' th-miss'}">
      <div class="pf-t"><span class="th-s">${esc(t.s || THEME_KIND[t.t] || t.t)}</span>${esc(t.title)}${who}</div>
      <div class="pf-r">${right}</div>
      ${when ? `<div class="pf-d">${when}</div>` : ''}
    </div>`;
  }).join('');

  const link = `<a class="tlink" href="https://animethemes.moe/anime/${esc(h.slug)}" ` +
    `target="_blank" rel="noopener noreferrer">${esc(h.name)}</a>`;

  return `<h4 class="pf-k">Все опенинги и эндинги · разнесли ${num(got)} из ${num(list.length)}</h4>
    <p class="th-src">по каталогу ${link}${h.how === 'похоже' ? ' <span class="th-warn">(совпадение неточное)</span>' : ''}</p>
    <div class="pf-list th-list">${rowsHtml}</div>`;
}
