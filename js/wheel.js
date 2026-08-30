/* ============================================================
   КОЛЕСО СУДЬБЫ
   ------------------------------------------------------------
   Раз в месяц композитор проводит благотворительный стрим и
   крутит колесо: чей ник выпал, того трек и слушают. Раньше для
   этого открывали сторонний сайт и переносили туда список руками.

   Здесь то же самое, но рядом с архивом — и потому умеет то, чего
   сторонний сайт не может: подставить заказчиков прямо из таблицы
   разносов.

   Повтор имени в списке даёт больше шансов. Так устроена и таблица
   композитора: у кого две строки, у того два сектора.
   ============================================================ */

const $ = id => document.getElementById(id);

/* Имена, как их ввёл человек: с повторами — они и есть шансы */
let ИМЕНА = [];
let ВЫБЫЛИ = [];        // кого убрали после выпадения
let ЖУРНАЛ = [];        // кто выпадал, по порядку
let УГОЛ = 0;           // текущий поворот колеса, радианы
let КРУТИМ = false;

const ХРАНИЛИЩЕ = 'faryma-wheel';
const ХРАНИЛИЩЕ_НАСТРОЕК = 'faryma-wheel-set';

/* Сколько крутить. На эфире это не мелочь: короткое вращение годится,
   когда розыгрышей подряд десяток, длинное — когда он один и надо
   нагнать напряжение. */
const ДЛИТЕЛЬНОСТИ = [
  { сек: 3,  имя: '3 с' },
  { сек: 6,  имя: '6 с' },
  { сек: 10, имя: '10 с' },
  { сек: 15, имя: '15 с' },
  { сек: 25, имя: '25 с' }
];
let ДЛИТ = 6;

/* Обновлять ли список из чата на ходу */
let ЖИВОЙ = false;
let живойТаймер = null;
let взятоИзЧата = 0;

/* Цвета секторов — фирменная палитра сайта. Соседние всегда разные:
   идём по кругу, а если сошлись концы — сдвигаем последний. */
const ЦВЕТА = ['#F2660F', '#F0A02A', '#4CC3C9', '#C8B08A', '#E5484D', '#7E9B93', '#F59B14', '#7D6B8F'];

/* ---------- список ---------- */

function разобрать(текст) {
  return String(текст || '').split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 2000);            // дальше колесо всё равно не читается
}

function сохранить() {
  try {
    localStorage.setItem(ХРАНИЛИЩЕ, JSON.stringify({ имена: ИМЕНА, выбыли: ВЫБЫЛИ, журнал: ЖУРНАЛ }));
  } catch { /* приватный режим — не беда, список живёт до перезагрузки */ }
}

function восстановить() {
  try {
    const v = JSON.parse(localStorage.getItem(ХРАНИЛИЩЕ));
    if (v && Array.isArray(v.имена)) {
      ИМЕНА = v.имена; ВЫБЫЛИ = v.выбыли || []; ЖУРНАЛ = v.журнал || [];
    }
  } catch { /* пусто и пусто */ }
  try {
    const n = JSON.parse(localStorage.getItem(ХРАНИЛИЩЕ_НАСТРОЕК));
    if (n && ДЛИТЕЛЬНОСТИ.some(d => d.сек === n.длит)) ДЛИТ = n.длит;
  } catch { /* значения по умолчанию */ }
}

function сохранитьНастройки() {
  try { localStorage.setItem(ХРАНИЛИЩЕ_НАСТРОЕК, JSON.stringify({ длит: ДЛИТ })); }
  catch { /* не беда */ }
}

function нарисоватьВыбор() {
  const где = $('spinTime');
  где.innerHTML = ДЛИТЕЛЬНОСТИ.map(d =>
    `<button type="button" class="chip${d.сек === ДЛИТ ? ' on' : ''}" data-sec="${d.сек}"
      aria-pressed="${d.сек === ДЛИТ}">${d.имя}</button>`).join('');
}

/* Сколько раз каждое имя встречается — это и есть его шансы */
function повторы() {
  const m = new Map();
  ИМЕНА.forEach(n => m.set(n, (m.get(n) || 0) + 1));
  return m;
}

function обновить({ изПоля = false } = {}) {
  if (!изПоля) $('names').value = ИМЕНА.join('\n');

  const счёт = повторы();
  $('count').textContent = ИМЕНА.length;

  const кратные = [...счёт].filter(([, n]) => n > 1);
  $('dupNote').textContent = кратные.length
    ? `${кратные.length} ${plural(кратные.length, 'участник', 'участника', 'участников')} ` +
      `${plural(кратные.length, 'вписан', 'вписаны', 'вписаны')} несколько раз — ` +
      `${plural(кратные.length, 'у него', 'у них', 'у них')} больше шансов`
    : 'Впишите имя дважды, чтобы удвоить его шансы';

  $('restore').hidden = !ВЫБЫЛИ.length;
  $('spin').disabled = ИМЕНА.length < 2;
  $('log').hidden = !ЖУРНАЛ.length;
  $('logList').innerHTML = ЖУРНАЛ.map(n => `<li>${esc(n)}</li>`).join('');

  нарисовать();
  сохранить();
}

const plural = (n, од, дв, мн) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return мн;
  if (b > 1 && b < 5) return дв;
  return b === 1 ? од : мн;
};

/* ---------- отрисовка ---------- */

function нарисовать(подсветить = -1) {
  const c = $('wheel'), ctx = c.getContext('2d');
  const R = c.width / 2;
  ctx.clearRect(0, 0, c.width, c.height);

  if (!ИМЕНА.length) {
    ctx.fillStyle = '#1F1F23';
    ctx.beginPath(); ctx.arc(R, R, R - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7C7583';
    ctx.font = '28px "Golos Text", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('добавьте имена', R, R);
    return;
  }

  const шаг = Math.PI * 2 / ИМЕНА.length;
  // Подписи читаются, только пока секторов немного. На двухстах именах
  // текст превращается в кашу — тогда показываем просто цвета, а имя
  // победителя всё равно выводится крупно под колесом.
  const сПодписями = ИМЕНА.length <= 60;

  ИМЕНА.forEach((имя, i) => {
    const от = УГОЛ + i * шаг, до = от + шаг;
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.arc(R, R, R - 6, от, до);
    ctx.closePath();

    let цвет = ЦВЕТА[i % ЦВЕТА.length];
    // на стыке круга последний сектор может совпасть с первым
    if (i === ИМЕНА.length - 1 && цвет === ЦВЕТА[0]) цвет = ЦВЕТА[1];
    ctx.fillStyle = i === подсветить ? '#FFFFFF' : цвет;
    ctx.fill();

    if (ИМЕНА.length <= 200) {
      ctx.strokeStyle = 'rgba(13,13,15,.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (сПодписями) {
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(от + шаг / 2);
      ctx.fillStyle = i === подсветить ? '#0D0D0F' : '#140A02';
      ctx.font = `600 ${Math.max(12, Math.min(22, 620 / ИМЕНА.length + 11))}px "Golos Text", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const текст = имя.length > 22 ? имя.slice(0, 21) + '…' : имя;
      ctx.fillText(текст, R - 26, 0);
      ctx.restore();
    }
  });

  // втулка
  ctx.beginPath(); ctx.arc(R, R, R * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#0D0D0F'; ctx.fill();
  ctx.strokeStyle = '#2C2C31'; ctx.lineWidth = 3; ctx.stroke();
}

/* ---------- вращение ---------- */

/* Победителя выбираем сразу, честным случайным числом, и уже потом
   докручиваем колесо к нему. Так надёжнее, чем вычислять сектор по
   конечному углу: там легко ошибиться на границе и показать одно, а
   объявить другое. */
function случайный(n) {
  if (window.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    // отсекаем хвост диапазона, иначе первые значения чуть вероятнее
    const предел = Math.floor(0xFFFFFFFF / n) * n;
    let v;
    do { crypto.getRandomValues(a); v = a[0]; } while (v >= предел);
    return v % n;
  }
  return Math.floor(Math.random() * n);
}

function крутить() {
  if (КРУТИМ || ИМЕНА.length < 2) return;
  КРУТИМ = true;
  $('spin').disabled = true;
  $('out').hidden = true;

  const победитель = случайный(ИМЕНА.length);
  const шаг = Math.PI * 2 / ИМЕНА.length;
  // указатель смотрит вправо, то есть на угол 0
  const кСередине = -(победитель * шаг + шаг / 2);
  /* Оборотов тем больше, чем дольше крутим: иначе длинное вращение
     превращается в вялое переползание. Держим примерно полтора оборота
     на секунду и добавляем случайность, чтобы не было заметно, что
     колесо каждый раз проходит одинаковый путь. */
  const обороты = Math.max(4, Math.round(ДЛИТ * 1.4)) + Math.floor(Math.random() * 3);
  const цель = кСередине + обороты * Math.PI * 2;

  const начало = УГОЛ % (Math.PI * 2);
  const путь = цель - начало;
  const длит = ДЛИТ * 1000;
  const t0 = performance.now();

  // замедление к концу: быстрый старт, долгое дотягивание
  const плавно = t => 1 - Math.pow(1 - t, 4);

  const шагАнимации = now => {
    const t = Math.min(1, (now - t0) / длит);
    УГОЛ = начало + путь * плавно(t);
    нарисовать();
    if (t < 1) return requestAnimationFrame(шагАнимации);

    КРУТИМ = false;
    $('spin').disabled = false;
    нарисовать(победитель);
    показать(ИМЕНА[победитель], победитель);
    // список, пришедший во время вращения, ждал своей очереди
    if (обновитьПотом) { обновитьПотом = false; if (ЖИВОЙ) изЧата({ тихо: true }); }
  };
  requestAnimationFrame(шагАнимации);
}

let последний = -1;

function показать(имя, индекс) {
  последний = индекс;
  $('winner').textContent = имя;
  $('out').hidden = false;
  ЖУРНАЛ.unshift(имя);
  if (ЖУРНАЛ.length > 30) ЖУРНАЛ.length = 30;
  $('log').hidden = false;
  $('logList').innerHTML = ЖУРНАЛ.map(n => `<li>${esc(n)}</li>`).join('');
  сохранить();
  $('out').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- наполнение из архива ---------- */

let АРХИВ = null;

async function архив() {
  if (АРХИВ) return АРХИВ;
  $('loadNote').textContent = 'читаю таблицу…';
  const текст = await fetch(LOCAL_CSV).then(r => r.text());
  const raw = Papa.parse(текст, { header: true, skipEmptyLines: 'greedy' }).data;

  const по = new Map();     // ключ → { имя, треков, гениально, годы }
  let stream = null;
  raw.forEach(r => {
    const st = parseStream(r['Что'], r['Где']);
    if (st) { stream = st; return; }
    const rate = parseRate(r['Оценка']);
    if (!rate) return;
    userParts((r['Кто'] || '').trim()).forEach(u => {
      const k = userKey(u);
      if (!k) return;
      if (!по.has(k)) по.set(k, { имя: u, треков: 0, гениально: 0, годы: new Set() });
      const o = по.get(k);
      o.треков++;
      if (rate.tier === 'гениально') o.гениально++;
      if (stream?.date) o.годы.add(stream.date.getFullYear());
    });
  });
  АРХИВ = [...по.values()];
  return АРХИВ;
}

async function изАрхива() {
  try {
    const все = await архив();
    const год = new Date().getFullYear();
    const режим = $('src').value;
    let список = все;
    if (режим === 'year')    список = все.filter(u => u.годы.has(год));
    if (режим === 'regular') список = все.filter(u => u.треков >= 5);
    if (режим === 'never')   список = все.filter(u => u.треков >= 3 && !u.гениально);

    ИМЕНА = список.sort((a, b) => b.треков - a.треков).map(u => u.имя);
    ВЫБЫЛИ = [];
    обновить();
    $('loadNote').textContent = ИМЕНА.length
      ? `${ИМЕНА.length} ${plural(ИМЕНА.length, 'участник', 'участника', 'участников')} — можно крутить`
      : 'по этому условию никого не нашлось';
  } catch (e) {
    $('loadNote').textContent = 'не получилось прочитать таблицу: ' + e.message;
  }
}

/* ---------- из чата ---------- */

/* Адрес сбора чата. Обычно берётся из config.js, но его можно
   перебить через window.CHAT_URL — так проверки натравливают колесо
   на свой сервис, не трогая настройки сайта. */
function адресЧата() {
  if (typeof window !== 'undefined' && typeof window.CHAT_URL === 'string' && window.CHAT_URL)
    return window.CHAT_URL;
  return typeof CHAT_URL === 'string' ? CHAT_URL : '';
}

/* Пока колесо крутится, список трогать нельзя: подменить участников
   в середине розыгрыша — верный способ объявить не того. Проверка
   стоит внутри самого обновления, а не только перед его запуском:
   запрос к чату занимает секунду-другую, и человек вполне может
   нажать «Крутить» ровно между отправкой и ответом. */
let обновитьПотом = false;

function живойРежим(включить) {
  ЖИВОЙ = включить;
  $('live').checked = включить;
  if (живойТаймер) { clearInterval(живойТаймер); живойТаймер = null; }
  if (!включить) { $('liveNote').textContent = ''; return; }
  живойТаймер = setInterval(() => изЧата({ тихо: true }), 30000);
  изЧата({ тихо: true });
}

function отметитьВремя() {
  взятоИзЧата = Date.now();
  if (!ЖИВОЙ) return;
  const тик = () => {
    if (!ЖИВОЙ) return;
    const сек = Math.round((Date.now() - взятоИзЧата) / 1000);
    $('liveNote').textContent = сек < 5 ? 'список только что обновлён'
      : `обновлено ${сек} ${plural(сек, 'секунду', 'секунды', 'секунд')} назад`;
  };
  тик();
  clearInterval(живойРежим.тик);
  живойРежим.тик = setInterval(тик, 5000);
}

async function изЧата({ тихо = false } = {}) {
  const где = $('chatNote');
  const адрес = адресЧата();
  if (!адрес) {
    где.textContent = 'Сбор из чата пока не подключён. Список можно вставить руками — ' +
      'например, из своего колеса.';
    return;
  }
  if (!тихо) где.textContent = 'спрашиваю чат…';
  try {
    const r = await fetch(адрес, { cache: 'no-store' });
    if (!r.ok) throw new Error('чат ответил ' + r.status);
    const j = await r.json();
    const ники = (j.chatters || []).filter(Boolean);
    if (!ники.length) {
      где.textContent = 'сейчас в чате никого нет — идёт ли эфир?';
      return;
    }
    if (КРУТИМ) {
      // ответ пришёл, пока колесо крутится: применим, когда остановится
      обновитьПотом = true;
      return;
    }
    // выбывших не возвращаем: если кого-то уже разыграли и убрали,
    // обновление списка не должно тащить его обратно
    const выбыли = new Set(ВЫБЫЛИ);
    ИМЕНА = ники.filter(n => !выбыли.has(n));
    обновить();
    отметитьВремя();
    где.textContent = `${ИМЕНА.length} ${plural(ИМЕНА.length, 'человек', 'человека', 'человек')} из чата`;
  } catch (e) {
    где.textContent = 'не вышло: ' + e.message;
    if (ЖИВОЙ) живойРежим(false);   // не долбим сервис, который лежит
  }
}

/* ---------- запуск ---------- */

function старт() {
  восстановить();
  обновить();

  $('spin').onclick = крутить;
  $('again').onclick = крутить;

  $('drop').onclick = () => {
    if (последний < 0) return;
    const имя = ИМЕНА[последний];
    // убираем один сектор, а не все повторы: у человека могло быть
    // несколько шансов, и выпал он одним из них
    ИМЕНА.splice(последний, 1);
    ВЫБЫЛИ.push(имя);
    последний = -1;
    $('out').hidden = true;
    обновить();
  };

  $('restore').onclick = () => {
    ИМЕНА = ИМЕНА.concat(ВЫБЫЛИ);
    ВЫБЫЛИ = [];
    обновить();
  };

  $('shuffle').onclick = () => {
    for (let i = ИМЕНА.length - 1; i > 0; i--) {
      const j = случайный(i + 1);
      [ИМЕНА[i], ИМЕНА[j]] = [ИМЕНА[j], ИМЕНА[i]];
    }
    обновить();
  };

  $('clear').onclick = () => {
    ИМЕНА = []; ВЫБЫЛИ = []; ЖУРНАЛ = [];
    $('out').hidden = true;
    обновить();
  };

  $('names').addEventListener('input', () => {
    ИМЕНА = разобрать($('names').value);
    обновить({ изПоля: true });
    // правки руками и автообновление несовместимы: через полминуты
    // список из чата затёр бы всё, что человек только что вписал
    if (ЖИВОЙ) { живойРежим(false); $('chatNote').textContent = 'обновление выключено — список правят вручную'; }
  });

  $('load').onclick = изАрхива;
  $('chat').onclick = () => изЧата();
  $('live').onchange = e => живойРежим(e.target.checked);

  нарисоватьВыбор();
  $('spinTime').onclick = e => {
    const b = e.target.closest('[data-sec]');
    if (!b || КРУТИМ) return;
    ДЛИТ = +b.dataset.sec;
    нарисоватьВыбор();
    сохранитьНастройки();
  };

  addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); крутить(); }
  });
}

старт();
