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
   из data/countries.json — см. scripts/countries.mjs. */
function scriptOf(s) {
  if (/[\uac00-\ud7af]/.test(s)) return 'Хангыль';        // корейский
  if (/[\u3040-\u30ff]/.test(s)) return 'Кана';           // японские слоговые
  if (/[\u4e00-\u9fff]/.test(s)) return 'Иероглифы';      // яп. или кит., не различить
  if (/[\u0400-\u04ff]/.test(s)) return 'Кириллица';
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
