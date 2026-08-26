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
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  // цифра, слипшаяся с буквами, — отдельное слово: «BREAK IN2 THE NITE»
  // и «Break in 2 the Nite» это одна и та же песня
  .replace(/(\p{L})(\p{N})/gu, '$1 $2')
  .replace(/(\p{N})(\p{L})/gu, '$1 $2')
  .replace(/\s+/g, ' ').trim();

/* Ромадзи пишут по-разному: «Shougeki» и «Shogeki», «Hadaka no Yuusha»
   и «Hadaka no Yusha», «Tabi no Tochuu» и «Tochu». Схлопываем удвоенные
   гласные и «ou» с обеих сторон — тогда написания сходятся. */
const foldWord = w => w.replace(/ou/g, 'o').replace(/(\p{L})\1+/gu, '$1');
const tfold = s => tkey(s).split(' ').map(foldWord).join(' ');

function sameTitle(a, b) {
  const x = tfold(a), y = tfold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x))) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return 2 * n / (A.size + B.size) >= 0.75;
}

/* Название темы у нас и у них может не совпасть вовсе: в архиве пишут
   «My War», а в каталоге «Boku no Sensou» — это перевод, а не опечатка.
   Тогда спасает исполнитель: если он тот же и тип совпадает (опенинг с
   опенингом), это почти наверняка та самая тема. Исполнитель известен
   у трети тем, так что путь запасной. */
const KIND_OF = { OP: 'опенинг', ED: 'эндинг', IN: 'вставка' };

function sameArtist(row, theme) {
  if (!theme.artists || !theme.artists.length) return false;
  if (KIND_OF[theme.t] && row.kind !== KIND_OF[theme.t]) return false;
  const mine = new Set(row.parts.map(nameKey));
  return theme.artists.some(a => mine.has(nameKey(a)));
}

const THEME_KIND = { OP: 'Опенинг', ED: 'Эндинг', IN: 'Вставка', OST: 'OST' };
const THEME_ORDER = { OP: 0, ED: 1, IN: 2, OST: 3 };

/* Запись каталога для набора названий сезона. Совпадение с тайтлом
   бывает неточным, поэтому ниже честно пишем, что именно нашлось. */
function themeEntry(names) {
  for (const n of names) {
    if (!isAnimeSource(n)) return null;
    const h = THEMES[n];
    if (h && h.slug && h.themes && h.themes.length) return h;
  }
  return null;
}

/* Все разносы, попавшие в один и тот же тайтл каталога.
   Одну вселенную в архиве пишут по-разному: «Initial D» и «Initial D
   First Stage» — это один тайтл, и опенинг, принесённый под одним
   именем, засчитывается под обоими. Иначе в соседней карточке он
   числится непринесённым, хотя разнос был. */
let BY_SLUG = null;
function rowsOfSlug(slug) {
  if (!BY_SLUG) {
    BY_SLUG = new Map();
    ROWS.forEach(r => {
      const h = r.source && THEMES[r.source];
      if (!h || !h.slug) return;
      if (!BY_SLUG.has(h.slug)) BY_SLUG.set(h.slug, []);
      BY_SLUG.get(h.slug).push(r);
    });
  }
  return BY_SLUG.get(slug) || [];
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
  // считаем по всем разносам этого тайтла, а не только по этой карточке
  rows = rowsOfSlug(h.slug).length ? rowsOfSlug(h.slug) : rows;

  const used = new Set();
  const done = list.map(t => {
    const i = rows.findIndex((r, i) => !used.has(i) && sameTitle(r.title, t.title));
    if (i < 0) return null;
    used.add(i);
    return rows[i];
  });
  // второй заход — по исполнителю, для переведённых названий
  list.forEach((t, k) => {
    if (done[k]) return;
    const i = rows.findIndex((r, i) => !used.has(i) && sameArtist(r, t));
    if (i < 0) return;
    used.add(i);
    done[k] = rows[i];
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
