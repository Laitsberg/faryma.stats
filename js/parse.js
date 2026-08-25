/* ============================================================
   РАЗБОР ТАБЛИЦЫ
   Здесь всё, что превращает сырую строку CSV в понятные поля.
   ============================================================ */

/* ---------- защита от вставки HTML ----------
   Названия треков приходят из таблицы и попадают в разметку.
   В архиве есть, например, «Keep on keeping on <MODv>» —
   без экранирования браузер съедает это как тег. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

/* ---------- оценка ----------
   Шкала записана непоследовательно: «атлична+» и «атлична +»,
   «гениально--» и «гениально - -». Плюс комментарии в скобках.
   Возвращает null, если распознать не вышло. */
function parseRate(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();

  // комментарий в скобках отбрасываем, но если в скобках ВСЯ оценка
  // — «(кринж-контент)» — снимаем скобки вместо того чтобы стереть всё
  const onlyParens = s.match(/^\((.+)\)$/);
  if (onlyParens) s = onlyParens[1].trim();
  s = s.replace(/\(.*?\)/g, ' ').trim();

  // «хорошечно- / гениально-» — две оценки через слэш, берём первую
  s = s.split('/')[0].trim();

  s = s.replace(/[?!.,]+$/, '').trim();

  // опечатки, встречающиеся в архиве
  s = s.replace(/^отлично/, 'атлична')
       .replace(/^генитально/, 'гениально')
       .replace(/^кринж\s+контент/, 'кринж-контент');

  const tier = TIERS.find(t => s.startsWith(t.key));
  if (!tier) return null;

  let tail = s.slice(tier.key.length).replace(/\s+/g, '');
  let mod;
  if (tail === '++' || tail === '+++') mod = '++';
  else if (tail === '+') mod = '+';
  else if (tail === '--' || tail === '---') mod = '- -';
  else if (tail === '-') mod = '-';
  else if (tail === '') mod = '';
  else return null;   // хвост вроде «как идея» — не оценка

  // Крайние ступени односторонние: плюс к «гениально» и минус к
  // «кринж-контенту» ничего не значат — оценка уже на краю шкалы.
  if (!tier.mods.includes(mod)) mod = '';

  const m = MODS.find(x => x[0] === mod);
  const label = tier.key + modLabel(mod);
  return {
    label, tier: tier.key, mod,
    score: Math.max(0, Math.min(10, tier.base + m[1])),
    color: tier.c
  };
}

/* ---------- строка «12) Артист — Трек {альт} [источник]» ----------
   Разделитель — длинное тире в пробелах. Короткое тире тоже
   встречается, а вот дефис трогать нельзя: он живёт внутри
   названий («Hi-Fi», «HOYO-MiX»). */
function parseWhat(s) {
  const raw = String(s || '');
  // Номер трека внутри стрима. Это и есть настоящий порядок разносов:
  // тайм-коды кое-где расходятся с ним (в стриме №19 у второго трека
  // стоит 00:00, хотя первый идёт с 13:40), и сортировка по времени
  // ставила треки не в том порядке.
  const pm = raw.match(/^\s*(\d+)[).]/);
  const pos = pm ? +pm[1] : null;

  let t = raw.replace(/^\s*\d+[).]\s*/, '').trim();

  // иногда пробел вокруг тире забыт: «JAWS— VORTEX»
  const parts = t.split(/\s*[—–]\s+|\s+[—–]\s*/);

  if (parts.length >= 2 && parts[0].trim()) {
    const artist = parts[0].trim();
    let title = parts.slice(1).join(' — ').trim();
    title = title.replace(/\s*[\{\[].*$/, '').trim();   // альт. название и источник
    return { artist, title, full: t, pos };
  }
  return { artist: '', title: t, full: t, pos };
}

/* ---------- источник трека ----------
   В квадратных скобках «Что» лежит, откуда трек: «[1 Opening Durarara!!
   / Дюрарара!!]», «[OST; Final Fantasy XIV]». Колонка «Откуда» говорит
   только тип (аниме/игра/фильм) и заполнена у 43% строк, а скобки есть
   у 44% и несут само название.

   Убираем служебные префиксы («OST;», «2 Opening», «1 Ending») и берём
   часть до слэша — за ним идёт русский перевод названия. */
function parseSource(what) {
  const m = String(what || '').match(/\[([^\]]+)\]/);
  if (!m) return '';
  let t = m[1];

  // Перед названием стоят пометки о типе трека, иногда несколько подряд:
  // «OST; Final Fantasy», «ep 9; OST; Love Live!», «VN; Umineko».
  // Срезаем их по одной, пока начало не окажется собственно названием.
  const MARKER = /^\s*(?:OST|VN|UTA\s+OST|Character\s+Song|Main\s+Theme|Insert(?:\s+Song)?|Theme|ep\.?\s*\d+|\d+(?:\/\d+)?\s+(?:Opening|Ending|OP|ED))\s*[;:]\s*/i;
  let guard = 6;
  while (guard-- && MARKER.test(t)) t = t.replace(MARKER, '');

  // Форма без точки с запятой: «1 Opening Durarara!!»
  t = t.replace(/^\s*\d+(?:\/\d+)?\s+(?:Opening|Ending|OP|ED|Insert(?:\s+Song)?|Theme)\s+/i, '');

  return t
    .split('/')[0]
    // хвостовое «OST» в колонке «откуда» ничего не добавляет, зато
    // разводит «Genshin Impact» и «Genshin Impact OST» по разным строкам
    .replace(/\s+OST\s*$/i, '')
    .trim();
}

/* ---------- склейка имён ----------
   В архиве «HOYO-MiX» и «HOYO-MIX» — один артист, но для скрипта
   это две разные строки, и статистика по ним считается порознь.
   Ключ для группировки делаем регистронезависимым, а показываем
   тот вариант написания, который встречается чаще. */
function nameKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function userKey(s) {
  // у заказчиков та же беда плюс собака: «@Sadierre» и «Sadierre»
  return nameKey(s).replace(/^@/, '');
}

/* ---------- соавторы заказа ----------
   Трек, принесённый вдвоём, записан через точку с запятой:
   «kumashisan; Svd_bb». Таких заказов 171, и без разбиения пара
   считается отдельным «человеком»: Ivan_Vitalyevich терял 32 разноса,
   kumashisan — 26. Возвращает всех участников заказа. */
function userParts(user) {
  return String(user || '').split(';').map(x => x.trim()).filter(Boolean);
}

/* Те же кусочки, но с разделителями — чтобы каждое имя стало ссылкой,
   а «;» осталось простым текстом. */
function userTokens(user) {
  const out = [];
  String(user || '').split(/(\s*;\s*)/).forEach(x => {
    if (!x) return;
    if (/^\s*;\s*$/.test(x)) out.push({ sep: x });
    else if (x.trim()) out.push({ name: x.trim() });
  });
  return out;
}

/* Строит карту ключ → самое частое написание */
function canonMap(values, keyfn) {
  const counts = new Map();
  values.forEach(v => {
    if (!v) return;
    const k = keyfn(v);
    if (!counts.has(k)) counts.set(k, new Map());
    const c = counts.get(k);
    c.set(v, (c.get(v) || 0) + 1);
  });
  const out = new Map();
  counts.forEach((variants, k) => {
    let best = null, n = -1;
    variants.forEach((cnt, v) => { if (cnt > n) { n = cnt; best = v; } });
    out.set(k, best);
  });
  return out;
}

/* Японские имена пишут в обоих порядках: «Hiroyuki Sawano» и
   «Sawano Hiroyuki» — один человек, но для скрипта это две разные
   строки, и его разносы делятся на две карточки. Склеиваем пары,
   которые отличаются только порядком слов, и оставляем то написание,
   что встречается чаще.

   Только имена ровно из двух слов: у трёх и больше совпадение по
   составу уже может оказаться случайным, а цена ошибки — двое разных
   исполнителей, слитых в одного. В нынешнем архиве правило находит
   16 пар, и все шестнадцать — японские имена вроде «Kana Hanazawa /
   Hanazawa Kana». */
function buildNameAliases(counts) {
  const bySig = new Map();
  counts.forEach((n, k) => {
    const w = k.split(' ').filter(Boolean);
    if (w.length !== 2) return;
    const sig = [...w].sort().join(' ');
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(k);
  });
  const alias = new Map();
  bySig.forEach(keys => {
    if (keys.length < 2) return;
    const main = keys.reduce((a, b) => (counts.get(b) > counts.get(a) ? b : a));
    keys.forEach(k => { if (k !== main) alias.set(k, main); });
  });
  return alias;
}

/* ---------- тайм-код внутри эфира ----------
   Форматы: «MM:SS» и «H:MM:SS». Проверено по архиву —
   двухчастные значения всегда минуты:секунды, часов там нет. */
function toMinutes(v) {
  const sec = toSeconds(v);
  return sec == null ? null : Math.floor(sec / 60);
}

/* Тот же тайм-код, но в секундах — нужен для ссылки на момент в записи.
   Разбор совпадает с ботом FarymaSearch: две части это минуты:секунды,
   три — часы:минуты:секунды. */
function toSeconds(v) {
  const m = String(v || '').trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return m[3] ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])
              : (+m[1]) * 60 + (+m[2]);
}

/* Время в том виде, который понимает VK Video: «1h23m45s».
   Нулевые части опускаются, но что-то остаться должно. */
function vkTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  let out = h ? h + 'h' : '';
  if (m) out += m + 'm';
  if (s || !out) out += s + 's';
  return out;
}

/* Ссылка на запись стрима лежит в колонке «Где» строки-разделителя.
   Обычно это чистый адрес, но пара штук записана как «ч.1) https://…»,
   поэтому вытаскиваем регуляркой, а не проверяем строку целиком. */
function extractUrl(cell) {
  const m = String(cell || '').match(/(https?:\/\/\S+)/);
  return m ? m[1] : '';
}

/* Идентификатор ролика на YouTube — нужен для встроенного плеера.
   Адреса в архиве встречаются во всех видах: youtu.be/ID,
   youtube.com/watch?v=ID, m. и music.youtube.com. */
function youtubeId(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (/(^|\.)youtube\.com$/.test(host)) id = u.searchParams.get('v') || '';
  return /^[\w-]{11}$/.test(id) ? id : '';
}

/* Id трека в Spotify. Ссылки на альбом не годятся: играть надо
   конкретный трек, а какой именно — из ссылки не узнать. */
function spotifyId(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/(^|\.)spotify\.com$/.test(u.hostname)) return '';
  const m = u.pathname.match(/\/track\/([A-Za-z0-9]{22})/);
  return m ? m[1] : '';
}

/* Трек в Яндекс.Музыке. Плееру достаточно номера трека, но с номером
   альбома он открывается на нужной записи, поэтому берём оба, когда есть. */
function yandexTrack(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/(^|\.)music\.yandex\.(ru|com|by|kz|uz)$/.test(u.hostname)) return '';
  const both = u.pathname.match(/\/album\/(\d+)\/track\/(\d+)/);
  if (both) return both[2] + '/' + both[1];
  const one = u.pathname.match(/\/track\/(\d+)/);
  return one ? one[1] : '';
}

/* Ссылка на нужную минуту записи. Без тайм-кода — просто на стрим. */
function momentUrl(vod, seconds) {
  if (!vod) return '';
  return seconds > 0 ? `${vod}?t=${vkTime(seconds)}` : vod;
}

/* ---------- ссылка на трек (колонка «Где») ---------- */
const PLATFORMS = [
  [/(^|\.)youtu\.be$|(^|\.)youtube\.com$/, 'YouTube'],
  [/(^|\.)spotify\.com$/,                  'Spotify'],
  [/(^|\.)music\.yandex\.(ru|com)$/,       'Яндекс.Музыка'],
  [/(^|\.)vk\.com$|(^|\.)vk\.ru$/,         'VK'],
  [/(^|\.)soundcloud\.com$/,               'SoundCloud'],
  [/(^|\.)t\.me$/,                         'Telegram'],
  [/(^|\.)drive\.google\.com$|(^|\.)disk\.yandex\.(ru|com)$/, 'Файл'],
  [/(^|\.)bandcamp\.com$/,                 'Bandcamp'],
  [/(^|\.)apple\.com$/,                    'Apple Music'],
  [/(^|\.)nicovideo\.jp$/,                 'Niconico']
];

function parseLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // в колонке попадается и не-ссылка: «На стриме», «Трек из ТГ», «-»
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  } catch { return null; }

  // только http(s) — чтобы в href не уехало javascript: из таблицы
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.replace(/^www\.|^m\./, '');
  const hit = PLATFORMS.find(([re]) => re.test(host));
  return { url: u.href, host, platform: hit ? hit[1] : 'Другое' };
}

/* ---------- строка-разделитель стрима ----------
   В архиве стримы отбиты строками вида «СТРИМ №271 (22.08.26)».
   Это единственное место, где в таблице есть даты: у самих треков
   их нет, но каждый трек лежит под своим стримом, и дату можно
   унаследовать. 272 стрима, номера идут подряд без пропусков. */
const STREAM_RE = /^\s*СТРИМ\s*№\s*(\d+)\s*\(([^)]+)\)/i;

function parseStream(what, where) {
  const m = String(what || '').match(STREAM_RE);
  if (!m) return null;
  return { num: +m[1], date: parseDate(m[2].trim()), vod: extractUrl(where) };
}

/* «22.08.26» и «7.08.26» → Date. Год двузначный. */
function parseDate(raw) {
  const m = String(raw).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  const d = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? null : d;
}

/* ---------- участники трека ----------
   «Utsu-P feat. Hatsune Miku» — это двое, и Мику заслуживает попасть
   в статистику: основным артистом она значится всего 5 раз, а поёт
   в 59 треках.

   С feat. просто: так название группы не пишут, режем всегда.
   С амперсандом опасно: «MYTH & ROID» — одно имя, а «Ado & Hatsune
   Miku» — двое, и по самой строке их не различить. Поэтому решаем
   по архиву: делим только если ОБЕ части где-то встречаются как
   самостоятельные исполнители. «MYTH» и «ROID» по отдельности не
   попадаются ни разу — значит это группа, не трогаем.

   soloKeys — множество ключей тех, кто хоть раз выступал один;
   его собирает build() в app.js. */
function participants(artist, soloKeys) {
  if (!artist) return [];
  const out = [];
  String(artist).split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i).forEach(chunk => {
    const bits = chunk.split(/\s*&\s*|\s*,\s*/).map(x => x.trim()).filter(Boolean);
    if (splitsApart(bits, soloKeys)) out.push(...bits);
    else if (chunk.trim()) out.push(chunk.trim());
  });
  return [...new Set(out)];
}

/* Делить ли кусок с амперсандами и запятыми на отдельных людей.
   Требовать самостоятельности от ВСЕХ частей было слишком строго:
   «Toby Fox, Tensei, Clark Powell & Malcolm Brown» оставался одним
   «исполнителем», хотя двое из четырёх в архиве выступают сами.
   Хватает половины — при условии, что таких хотя бы двое.

   Проверено на названиях групп, которые нельзя разрывать: у «Earth,
   Wind & Fire», «Emerson, Lake & Palmer», «Tyler, The Creator»,
   «MYTH & ROID» и «Fear, and Loathing in Las Vegas» сольных частей
   ноль, так что все они остаются целыми и при мягком правиле. */
function splitsApart(bits, soloKeys) {
  if (bits.length < 2 || !soloKeys) return false;
  const solo = bits.filter(b => soloKeys.has(nameKey(b))).length;
  return solo >= 2 && solo * 2 >= bits.length;
}

/* То же разбиение, но с сохранением разделителей — чтобы показать
   строку как есть, сделав ссылкой каждого участника по отдельности,
   а «feat.» и «&» оставив простым текстом. Возвращает список кусочков:
   {name} — участник, {sep} — то, что между ними. */
function artistTokens(artist, soloKeys) {
  if (!artist) return [];
  const out = [];
  const FEAT = /^\s+(?:feat\.?|ft\.?|featuring)\s+$/i;
  const AMP  = /^\s*[&,]\s*$/;

  String(artist).split(/(\s+(?:feat\.?|ft\.?|featuring)\s+)/i).forEach(piece => {
    if (!piece) return;
    if (FEAT.test(piece)) { out.push({ sep: piece }); return; }
    if (!piece.trim()) return;

    const bits = piece.split(/\s*&\s*|\s*,\s*/).map(x => x.trim()).filter(Boolean);
    if (splitsApart(bits, soloKeys)) {
      piece.split(/(\s*&\s*|\s*,\s*)/).forEach(x => {
        if (!x) return;
        if (AMP.test(x)) out.push({ sep: x });
        else if (x.trim()) out.push({ name: x.trim() });
      });
    } else out.push({ name: piece.trim() });
  });
  return out;
}

/* Артист без соавторов — по нему собирается soloKeys */
function isSolo(artist) {
  return !/\b(feat\.?|ft\.?|featuring)\b|&|,/i.test(String(artist || ''));
}

/* ---------- жанры ----------
   В таблице их пишут руками, поэтому один жанр разъезжается на варианты:
   «электронное» и «электронная», «оркестровое», «оркестровая», «оркестровый»,
   «окрестровое», «оркстровое». По отдельности мелкие варианты не проходят
   порог в 15 упоминаний и просто исчезают с графика, а крупные теряют часть
   веса. Сводим к одному написанию.

   Правим только формы одного и того же слова и явные опечатки. Разные слова
   не трогаем: «рэп» и «хип-хоп» оставлены порознь — это решение о смысле,
   а не об орфографии, и принимать его должен человек. */
const GENRE_ALIASES = {
  'электронная': 'электронное', 'элктронное': 'электронное',
  'оркестровая': 'оркестровое', 'оркестровый': 'оркестровое',
  'окрестровое': 'оркестровое', 'оркстровое': 'оркестровое',
  'оркестрое':   'оркестровое', 'окрестровый': 'оркестровое',
  'оркестр':     'оркестровое',
  'иструментал': 'инструментал',
  'мюзико':      'мюзикл',
  'фортепиао':   'фортепиано',
  'симфо':       'симфоническое'
};

function normGenre(raw) {
  let g = String(raw || '')
    .replace(/\(.*?\)/g, ' ')       // «неформат (НЕ ДЛЯ ВСЕХ)» → «неформат»
    .replace(/^[\'"`]+/, '')         // в одной строке жанр начинается с апострофа
    .trim().toLowerCase();
  if (!g) return '';
  return GENRE_ALIASES[g] || g;
}

/* Жанры перечисляют и через слэш, и через запятую */
function splitGenres(cell) {
  return String(cell || '').split(/[\/,]/).map(normGenre).filter(Boolean);
}
