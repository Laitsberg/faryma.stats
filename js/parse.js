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

  // Плюс к «гениально» и минус к «кринж-контенту» двигать некуда:
  // оценка уже на краю шкалы. Ставят их в шутку — «гениально+» стоит
  // в одном ряду с «ДЫНЯ 🍈 +» и «ИМБА+», — и считать такое всерьёз
  // нельзя ни десяткой, ни обычным «гениально»: во втором случае шутка
  // растворится среди сотни настоящих. Значит, это не оценка вовсе.
  if (!tier.mods.includes(mod)) return null;

  const m = MODS.find(x => x[0] === mod);
  const label = tier.key + modLabel(mod);
  return {
    label, tier: tier.key, mod,
    score: Math.max(0, Math.min(10, tier.base + m[1])),
    color: tier.c
  };
}

/* В названии повтора болтается служебная пометка: «(ПОВТОР: СТРИМ №17;
   1 трек от …)». В таблице и в карточках она лишняя. Пишут её двумя
   способами: своими скобками и внутри чужих, после точки с запятой —
   «(Lone Trail Boss theme; ПОВТОР: СТРИМ №22; …)». Второй случай режем
   до закрывающей скобки, не трогая саму скобку.
   Разбор повторов смотрит не сюда, а в целую ячейку «Что» (r.full),
   так что пометку можно смело убирать из названия. */
const dropRepeatMark = t => String(t || '')
  .replace(/\s*\(\s*ПОВТОР:[^)]*\)/gi, '')
  .replace(/\s*[;,]\s*ПОВТОР:[^)]*(?=\))/gi, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

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
  // Номер бывает дробным: «18.5) признаки того, что…» — так в таблицу
  // вставляют то, что случилось между восемнадцатым и девятнадцатым
  // треком. Без дроби регулярка съедала «18.» и оставляла «5)» в
  // названии.
  const pm = raw.match(/^\s*(\d+(?:[.,]\d+)?)[).]/);
  const pos = pm ? parseFloat(pm[1].replace(',', '.')) : null;

  let t = raw.replace(/^\s*\d+(?:[.,]\d+)?[).]\s*/, '').trim();

  // иногда пробел вокруг тире забыт: «JAWS— VORTEX»
  const parts = t.split(/\s*[—–]\s+|\s+[—–]\s*/);

  if (parts.length >= 2 && parts[0].trim()) {
    const artist = parts[0].trim();
    let title = parts.slice(1).join(' — ').trim();
    title = title.replace(/\s*[\{\[].*$/, '').trim();   // альт. название и источник
    return { artist, title: dropRepeatMark(title), full: t, pos };
  }
  return { artist: '', title: dropRepeatMark(t), full: t, pos };
}

/* ---------- источник трека ----------
   В квадратных скобках «Что» лежит, откуда трек: «[1 Opening Durarara!!
   / Дюрарара!!]», «[OST; Final Fantasy XIV]». Колонка «Откуда» говорит
   только тип (аниме/игра/фильм) и заполнена у 43% строк, а скобки есть
   у 44% и несут само название.

   Убираем служебные префиксы («OST;», «2 Opening», «1 Ending») и берём
   часть до слэша — за ним идёт русский перевод названия. */
function parseSource(what) {
  // Скобки ищем только в названии трека, после тире. У «F4chick [Dr] —
  // ФНАФИЛИЯ» скобки стоят в имени исполнителя и вселенной не несут —
  // раньше три таких разноса уезжали во вселенную «Dr». Разделитель тот
  // же, что в parseWhat: тире в пробелах, иногда с забытым пробелом.
  const целиком = String(what || '').replace(/^\s*\d+(?:[.,]\d+)?[).]\s*/, '');
  const тире = целиком.split(/\s*[—–]\s+|\s+[—–]\s*/);
  const где = тире.length >= 2 && тире[0].trim() ? тире.slice(1).join(' — ') : целиком;

  const m = где.match(/\[([^\]]+)\]/);
  if (!m) return '';
  let t = m[1];

  // Перед названием стоят пометки о типе трека, иногда несколько подряд:
  // «OST; Final Fantasy», «ep 9; OST; Love Live!», «VN; Umineko».
  // Срезаем их по одной, пока начало не окажется собственно названием.
  // Разделитель после пометки бывает любым: «OST; Final Fantasy»,
  // «OST, Hunter x Hunter», «ep 15, OST; Re:Zero». Запятая встречается
  // чаще точки с запятой — из-за неё 150 источников оставались с
  // хвостом «OST, …» и уезжали в отдельные карточки.
  const MARKER = new RegExp('^\\s*(?:' + [
    'OST(?:\\s+[^;:,\\]]{1,24})?',
    'VN', 'UTA(?:\\s+OST)?',
    // «Theme Song, Library of Ruina», «2 Insert Song; Hazbin Hotel»
    '\\d*\\s*(?:Character|Main|Theme|Insert|Opening|Ending)\\s+Song',
    'Main\\s+Theme', 'Insert(?:\\s+Song)?', 'Theme',
    // «ep 19», «ep 11/24», «ep.3-4»
    'ep\\.?\\s*\\d+(?:\\s*(?:[-–/]|and)\\s*\\d+)?',
    '\\d+\\s+(?:OST|OP|ED)',
    '(?:OP|ED)\\s+Theme',
    // «Track 10; Naruto», «OVA 5; OST; Hellsing», «5 & 6 Ending Hunter x Hunter»
    'Track\\s*\\d+', 'OVA\\s*\\d*', 'Disc\\s*\\d+',
    // «2003г.; Сорвиголова» — год стоит перед названием, а не после
    '\\d{4}\\s*г\\.?',
    '\\d+\\s*(?:&|and)\\s*\\d+\\s+(?:Opening|Ending|OP|ED)',
    // «OP 1, Vinland Saga» — номер стоит и до пометки, и после неё
    '(?:Opening|Ending|OP|ED)\\s*\\d+(?:\\/\\d+)?',
    '\\d+(?:\\/\\d+)?\\s+(?:Opening|Ending|OP|ED)',
    'Opening', 'Ending', 'OP', 'ED'
  ].join('|') + ')\\s*[;:,]\\s*', 'i');
  // Перед пометкой иногда стоит вид носителя: «Game Opening; …»,
  // «Movie Kaguya-sama …», «OST; webcomic Homestuck».
  const MEDIA = /^\s*(?:Game|Movie|Anime|Film|Series|TV|web\s*comic|webcomic|дорама|аниме|фильм|сериал|мюзикл)\s*:?\s*(?:[-–]\s*)?(?=[^\s])/i;
  // как записано, а не откуда: «Piano, Howl's Moving Castle»,
  // «Concert Live, OST, Evangelion 3.0»
  const FORMAT = /^\s*(?:Piano|Concert(?:\s+Live)?|Live|Orchestra|Orchestral|Acoustic|Vocal|Instrumental|Remix|Cover|Medley|Arrange|Arrangement)\s*[,;]\s*/i;

  const срезатьПометки = () => {
    let guard = 8;
    while (guard--) {
      if (MARKER.test(t)) { t = t.replace(MARKER, ''); continue; }
      if (FORMAT.test(t)) { t = t.replace(FORMAT, ''); continue; }
      // «Game» срезаем только как вид носителя: «Game of Thrones» —
      // это название, а не игра
      if (MEDIA.test(t) && !/^\s*Game\s+of\b/i.test(t) &&
          !/^\s*(?:Movie|Film|Series)\s+(?:of|the)\b/i.test(t)) {
        const cut = t.replace(MEDIA, '');
        if (cut && cut !== t) { t = cut; continue; }
      }
      break;
    }
  };
  срезатьПометки();

  // Форма без разделителя вовсе: «1 Opening Durarara!!», «Ending Re:Zero»,
  // «OST Hannibal», «UTA from One Piece Film: Red»
  t = t.replace(/^\s*(?:\d+(?:\s*(?:&|and|\/|[-–])\s*\d+)?\s+)?(?:Opening|Ending|OP|ED|Insert(?:\s+Song)?|Theme)\s+/i, '');
  t = t.replace(/^\s*UTA\s+from\s+/i, '');
  // «Theme from Dark, A Netflix Original Series» — но «From Dusk Till
  // Dawn» это название, поэтому голое «from» в начале не трогаем
  t = t.replace(/^\s*(?:Theme|Song|Music)\s+from\s+(?:the\s+series\s+)?/i, '');
  t = t.replace(/^\s*from\s+the\s+series\s+/i, '');
  t = t.replace(/^\s*from\s+(?=["«])/i, '');   // «From "Wicked"»
  // «19 OST of Asuna, Sword Art Online» — сначала о ком, потом откуда
  t = t.replace(/^\s*(?:\d+\s+)?(?:OST|Theme)\s+of\s+[^,;]{1,40}[,;]\s*/i, '');
  // «Belphegor OST, Katekyou Hitman Reborn!» — имя героя перед пометкой
  t = t.replace(/^\s*[^;:,\]]{1,24}\s+OST\s*[,;]\s*/i, '');
  t = t.replace(/^\s*(?:OST|VN)\s+(?=[A-ZА-Я0-9])/, '');
  t = t.replace(/^\s*ep\.?\s*\d+(?:\s*(?:[-–]|and)\s*\d+)?\s+(?=[A-ZА-Я0-9])/i, '');
  // номер трека перед пометкой: «3 OST Bleach», «26 OP One Piece»
  t = t.replace(/^\s*\d+\s+(?:OST|OP|ED)\s+(?=[A-ZА-Я0-9])/i, '');

  // Сняв пометку без разделителя, можно открыть следующую:
  // «Opening game - SCARLET NEXUS» → «game - SCARLET NEXUS» → «SCARLET NEXUS».
  срезатьПометки();

  return t
    // За слэшем в пробелах идёт русский перевод: «Fate/Zero / Судьба:
    // Начало». Слэш без пробелов — часть названия, и резать по нему
    // нельзя: иначе вся франшиза Fate схлопывается в одно «Fate», а
    // «.hack//Sign» и «.hack//Roots» — в «.hack».
    .split(/\s+\/|\/\s+/)[0]
    // хвостовое «OST» в колонке «откуда» ничего не добавляет, зато
    // разводит «Genshin Impact» и «Genshin Impact OST» по разным строкам
    // хвостовые пометки, иногда пачкой: «Fate/hollow ataraxia
    // Opening/Ending/OST», «Genshin Impact OST»
    .replace(/\s+(?:OST|OP|ED|Opening|Ending)(?:\s*\/\s*(?:OST|OP|ED|Opening|Ending))*\s*$/i, '')
    // «Song, Film "Gintama THE FINAL"» — кавычки вокруг всего названия
    // лишние; одиночную кавычку внутри трогать нельзя
    .replace(/^\s*"(.+)"\s*$/, '$1')
    .replace(/^\s*«(.+)»\s*$/, '$1')
    // год в конце пишут по-русски: «Doom 2016г.», «Devil May Cry 2025 г.».
    // Приводим к общему виду, иначе одно и то же название с годом и без
    // расходится по разным вселенным
    .replace(/\s*[,;]?\s*(\d{4})\s*г\.?\s*$/, ' ($1)')
    .trim()
    // В скобках бывает одна пометка и ничего больше: «[MV]», «[OST]».
    // Вселенной там нет — название игры или фильма стоит в самом
    // треке, — а раньше пометка сама становилась вселенной.
    // Список нарочно короткий: «86», «Up», «Air», «Pet», «Два» — это
    // настоящие названия, и под раздачу они попасть не должны.
    .replace(/^(?:OST|OP|ED|MV|PV|VN|UTA|OVA|Opening|Ending|Insert|Theme|Song|Live|Cover|Piano|Remix|Instrumental|Acoustic|Vocal)$/i, '');
}

/* ---------- что это за трек во вселенной ----------
   В скобках рядом с источником написано, чем трек был: «1 Opening
   Durarara!!», «ep 11; Ending Re:Zero», «OST; Final Fantasy XIV».
   Пометка есть у 97% строк со скобками, так что заставку, концовку
   и саундтрек можно развести — как в таблице аниме, которую зрители
   ведут руками. */
function sourceKind(what) {
  const m = String(what || '').match(/\[([^\]]+)\]/);
  if (!m) return '';
  const t = m[1];
  if (/\b(?:OP|Opening)\b/i.test(t)) return 'опенинг';
  if (/\b(?:ED|Ending)\b/i.test(t)) return 'эндинг';
  if (/\bInsert\b/i.test(t))         return 'вставка';
  if (/\bOST\b/i.test(t))            return 'OST';
  return '';
}

/* Аниме ли это. Западные мультсериалы вроде Arcane в каталоге японской
   анимации искать бессмысленно — списка тем у них там нет. */
function isAnimeSource(source) {
  if (!source) return false;
  const base = nameKey(sourceParts(source).base);
  const whole = nameKey(source);
  return !NOT_ANIME.some(x => { const k = nameKey(x); return k === base || k === whole; });
}

/* Сезон или часть внутри франшизы.
   «Boku no Hero Academia 3rd Season» → база «Boku no Hero Academia»,
   часть «3rd Season». Римские цифры тоже считаются частью: у игр
   «Final Fantasy IX» и «Final Fantasy XVI» — одна вселенная. */
const PART_RE = /\s+(?:\d+(?:nd|rd|th|st)?\s+(?:Season|Сезон)|(?:Season|Сезон)\s*\d+|(?:Part|Часть)\s*\d+|[IVX]{1,4})\s*$/i;

function sourceParts(source) {
  const s = String(source || '').trim();
  const m = s.match(PART_RE);
  return m
    ? { base: s.slice(0, m.index).trim(), part: m[0].trim() }
    : { base: s, part: '' };
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

/* «Opening 2 Fate/Stay Night» — номер темы прилипает к названию, когда
   после пометки нет разделителя. По виду его не отличить от настоящего
   названия: «Ending 5 Centimeters per Second» — это фильм «5 сантиметров
   в секунду», а не пятая концовка. Зато видно по архиву: если такой же
   источник без номера уже есть, номер лишний. */
function dropNumberPrefix(canon) {
  canon.forEach((display, key) => {
    const m = key.match(/^\d{1,2}\s+(.+)$/);
    if (m && canon.has(m[1])) canon.set(key, canon.get(m[1]));
  });
  return canon;
}

/* Свести написания одной вселенной к одному: список в js/aliases.js.
   Работает поверх той же карты, что и склейка регистра, поэтому
   действует и на сайте, и в скриптах, которые собирают каталог. */
function applySourceAlias(canon) {
  if (typeof SOURCE_ALIAS !== 'object') return canon;
  for (const [из, во] of Object.entries(SOURCE_ALIAS)) canon.set(nameKey(из), во);
  return canon;
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
