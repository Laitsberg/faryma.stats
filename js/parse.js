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

  const m = MODS.find(x => x[0] === mod);
  const label = tier.key + (mod ? (mod === '- -' ? ' - -' : mod) : '');
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
  let t = String(s || '').replace(/^\s*\d+[).]\s*/, '').trim();

  // иногда пробел вокруг тире забыт: «JAWS— VORTEX»
  const parts = t.split(/\s*[—–]\s+|\s+[—–]\s*/);

  if (parts.length >= 2 && parts[0].trim()) {
    const artist = parts[0].trim();
    let title = parts.slice(1).join(' — ').trim();
    title = title.replace(/\s*[\{\[].*$/, '').trim();   // альт. название и источник
    return { artist, title, full: t };
  }
  return { artist: '', title: t, full: t };
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

/* ---------- тайм-код внутри эфира ----------
   Форматы: «MM:SS» и «H:MM:SS». Проверено по архиву —
   двухчастные значения всегда минуты:секунды, часов там нет. */
function toMinutes(v) {
  const m = String(v || '').trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  return m[3] ? (+m[1]) * 60 + (+m[2]) : (+m[1]);
}

/* ---------- письменность названия ----------
   Грубое приближение. Настоящие страны приезжают отдельно,
   из data/countries.json — см. scripts/countries.mjs.

   Тонкость, из-за которой считать надо по двум разным строкам.
   Оригинальное название лежит в фигурных скобках — «Sou — Chocolate
   Town {Шоколадный город / チョコレートタウン}» — и если скобки
   отрезать, японского почти не остаётся: имена артистов записаны
   латиницей. Но в тех же скобках лежит и русский ПЕРЕВОД, поэтому
   искать там кириллицу нельзя — половина японского архива уехала бы
   в русское. Итого: кана, иероглифы и хангыль ищутся во всей строке
   (им больше негде взяться), а кириллица — по артисту и названию,
   но без скобок. */
function scriptOf(full, clean) {
  if (/[\uac00-\ud7af]/.test(full)) return 'Хангыль';        // корейский
  if (/[\u3040-\u30ff]/.test(full)) return 'Кана';           // японские слоговые
  if (/[\u4e00-\u9fff]/.test(full)) return 'Иероглифы';      // яп. или кит., не различить
  if (/[\u0400-\u04ff]/.test(clean ?? full)) return 'Кириллица';
  return 'Латиница';
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

function parseStream(what) {
  const m = String(what || '').match(STREAM_RE);
  if (!m) return null;
  return { num: +m[1], date: parseDate(m[2].trim()) };
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
    if (bits.length > 1 && soloKeys && bits.every(b => soloKeys.has(nameKey(b)))) out.push(...bits);
    else if (chunk.trim()) out.push(chunk.trim());
  });
  return [...new Set(out)];
}

/* Артист без соавторов — по нему собирается soloKeys */
function isSolo(artist) {
  return !/\b(feat\.?|ft\.?|featuring)\b|&|,/i.test(String(artist || ''));
}
