/* ============================================================
   УГАДАЙ ОЦЕНКУ
   Показывает случайный трек из архива и предлагает угадать, в какую
   ступень он попал. Угадывать надо ступень, а не точную подпись:
   различать «атлична+» и «атлична-» на слух невозможно даже автору.
   ============================================================ */

let gameTrack = null;      // текущий трек
let gameAnswered = false;

/* Счёт живёт в браузере игрока и никуда не отправляется. */
const SCORE_KEY = 'faryma-guess';
const SRC_KEY   = 'faryma-guess-src';

/* Откуда брать треки. У первых трёх площадок есть встроенный плеер,
   у остальных — только ссылка, поэтому они собраны в одну группу.
   Ютуб стоит первым и включён по умолчанию: он единственный
   открывается у большинства зрителей без ВПН. */
const SOURCES = [
  { k: 'yt',    name: 'YouTube',        has: r => !!r.ytId },
  { k: 'sp',    name: 'Spotify',        has: r => !!r.spId },
  { k: 'ya',    name: 'Яндекс.Музыка',  has: r => !!r.yaId },
  { k: 'other', name: 'остальное',      has: r => !!r.link && !r.ytId && !r.spId && !r.yaId }
];

function loadSources() {
  try {
    const v = JSON.parse(localStorage.getItem(SRC_KEY));
    if (Array.isArray(v) && v.length && v.every(k => SOURCES.some(s => s.k === k))) return v;
  } catch { /* приватный режим */ }
  return ['yt'];
}
function saveSources(v) {
  try { localStorage.setItem(SRC_KEY, JSON.stringify(v)); } catch { /* не беда */ }
}

let gameSrc = ['yt'];

function loadScore() {
  try {
    const v = JSON.parse(localStorage.getItem(SCORE_KEY));
    if (v && typeof v.hits === 'number' && typeof v.total === 'number') return v;
  } catch { /* приватный режим или запрет на хранилище */ }
  return { hits: 0, total: 0 };
}
function saveScore(s) {
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(s)); } catch { /* не беда */ }
}

function initGame() {
  $('gNext').onclick = nextTrack;
  gameSrc = loadSources();
  renderSources();
  renderScore();
  nextTrack();
}

/* Галочки площадок. Рядом с каждой — сколько там треков, чтобы было
   видно, во что превратится игра: у ютуба их пять тысяч, у остальных
   вместе меньше двухсот. */
function renderSources() {
  $('gSrc').innerHTML =
    `<div class="g-src-h">Откуда брать треки</div>` +
    SOURCES.map(src => {
      const n = ROWS.filter(r => r.artist && src.has(r)).length;
      const on = gameSrc.includes(src.k);
      return `<label class="g-src${n ? '' : ' off'}">
        <input type="checkbox" data-s="${src.k}"${on ? ' checked' : ''}${n ? '' : ' disabled'}>
        <span>${esc(src.name)}</span><b>${num(n)}</b></label>`;
    }).join('') +
    `<div class="g-src-n" id="gSrcNote"></div>`;

  $('gSrc').querySelectorAll('input[data-s]').forEach(b => b.onchange = () => {
    const picked = [...$('gSrc').querySelectorAll('input[data-s]:checked')].map(x => x.dataset.s);
    // Совсем без источников играть не во что — последнюю галочку
    // не даём снять, вместо этого возвращаем её на место.
    if (!picked.length) { b.checked = true; return; }
    gameSrc = picked;
    saveSources(gameSrc);
    renderSourceNote();
    nextTrack();
  });
  renderSourceNote();
}

function renderSourceNote() {
  const noPlayer = gameSrc.length === 1 && gameSrc[0] === 'other';
  $('gSrcNote').textContent = noPlayer
    ? 'У этих площадок плеера нет — будет только ссылка.'
    : (gameSrc.includes('sp')
        ? 'Spotify без ВПН и входа в аккаунт может не заиграть.'
        : '');
}

/* Все треки выбранных площадок */
function gamePool() {
  const picked = SOURCES.filter(s => gameSrc.includes(s.k));
  return ROWS.filter(r => r.artist && picked.some(s => s.has(r)));
}

function nextTrack() {
  const pool = gamePool();
  if (!pool.length) return;
  gameTrack = pool[Math.floor(Math.random() * pool.length)];
  gameAnswered = false;

  // Имя пока просто текст: в карточке исполнителя видны оценки всех его
  // треков, включая загаданный, — ссылка тут была бы подсказкой.
  // Она появится в ответе, когда спойлерить уже нечего.
  $('gArtist').textContent = gameTrack.artist;
  $('gTitle').innerHTML =
    `<a href="${esc(gameTrack.link.url)}" target="_blank" rel="noopener noreferrer">${esc(gameTrack.title)}</a>`;

  showPoster(gameTrack);
  $('gEscape').innerHTML = '';

  const bits = [];
  if (gameTrack.genres.length) bits.push(gameTrack.genres.join(' / '));
  if (gameTrack.source) bits.push(gameTrack.source);
  $('gMeta').textContent = bits.join(' · ');

  $('gAnswer').hidden = true;
  $('gAnswer').className = 'g-answer';
  $('gAnswer').innerHTML = '';    // чтобы от прошлого трека ничего не осталось
  $('gNext').textContent = 'пропустить';
  renderTiers();
}

/* ---------- плеер ----------
   Ролик не вставляется сразу: сначала показываем обложку с кнопкой.
   Так страница не тянет плеер на каждый трек, а главное — если ютуб
   у человека не открывается (провайдер режет, или он под ВПН и ютуб
   требует войти в аккаунт), вместо серого битого окна он видит
   понятное объяснение и ссылку. Починить это со своей стороны
   нельзя — это между зрителем и гуглом, — но сломанным сайт
   выглядеть не должен. */
function showPoster(t) {
  const box = $('gPlayer');
  box.className = 'g-player';

  // Обложка есть только у ютуба. У Spotify и Яндекса плеер вставляем
  // сразу: их виджеты сами показывают карточку и ничего не играют,
  // пока не нажмут. У остальных площадок плеера нет вовсе.
  if (!t.ytId) {
    if (t.spId || t.yaId) { playHere(t); return; }
    box.innerHTML =
      `<div class="g-off">
         <b>${esc(t.link ? t.link.platform : 'Без ссылки')}</b>
         <span>Плеера у этой площадки нет — только ссылка.</span>
         ${t.link ? `<span class="g-off-act"><a href="${esc(t.link.url)}"
             target="_blank" rel="noopener noreferrer">открыть трек</a></span>` : ''}
       </div>`;
    return;
  }

  const url = 'https://youtu.be/' + t.ytId;
  box.innerHTML =
    `<img class="g-poster" alt="" src="https://i.ytimg.com/vi/${esc(t.ytId)}/hqdefault.jpg">
     <button class="g-play" type="button" aria-label="Слушать">▶</button>`;

  box.querySelector('.g-play').onclick = () => playHere(t);

  // Обложка лежит на другом домене ютуба: не загрузилась — значит
  // ютуб отсюда недоступен целиком, и плеер тоже не откроется.
  const off = () => {
    if (gameTrack !== t) return;              // трек уже сменился
    clearTimeout(wait);
    box.innerHTML =
      `<div class="g-off">
         <b>Ютуб отсюда не открывается</b>
         <span>Провайдер режет, либо ютуб просит войти в аккаунт из-под ВПН.
               Угадывать можно и без прослушивания.</span>
         <span class="g-off-act">
           <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">открыть в новой вкладке</a>
           <button type="button" class="g-anyway">всё равно попробовать</button>
         </span>
       </div>`;
    // проверка по обложке — только догадка, поэтому оставляем выход
    box.querySelector('.g-anyway').onclick = () => playHere(t);
  };

  const img = box.querySelector('.g-poster');
  img.onerror = off;
  // Соединение может не оборваться, а просто висеть — именно так ютуб
  // ведёт себя при замедлении. Ждать вечно нельзя: пять секунд, и
  // показываем то же объяснение, что и при явной ошибке.
  const wait = setTimeout(() => { if (!img.naturalWidth) off(); }, 5000);
  img.onload = () => clearTimeout(wait);
  // картинка могла отвалиться ещё до того, как мы повесили обработчик
  if (img.complete && !img.naturalWidth) off();
}

/* Вставить настоящий плеер.
   Домен именно youtube.com, а не youtube-nocookie.com. Второй красивее
   по части куков, но у части зрителей он оказался наглухо закрыт, хотя
   обычный ютуб при этом открывался: обходы блокировок и списки
   провайдеров знают youtube.com и не знают nocookie-зеркало. Плеер
   вставляется только по нажатию, так что куки всё равно получает лишь
   тот, кто сам решил послушать. */
function playHere(t) {
  const box = $('gPlayer');
  const title = `${esc(t.artist)} — ${esc(t.title)}`;
  // Виджеты Spotify и Яндекса — не видео, а карточки, и высота у них
  // своя: 152px против 180px. Одна общая коробка оставляла бы под
  // спотифаем пустую полосу.
  let src, kind = '', where = '';

  if (t.ytId) {
    src = `https://www.youtube.com/embed/${esc(t.ytId)}?autoplay=1`;
    where = 'на ютубе';
  } else if (t.spId) {
    src = `https://open.spotify.com/embed/track/${esc(t.spId)}`;
    kind = ' sp'; where = 'в Spotify';
  } else {
    src = `https://music.yandex.ru/iframe/track/${esc(t.yaId)}`;
    kind = ' ya'; where = 'в Яндекс.Музыке';
  }

  box.className = 'g-player' + kind;
  box.innerHTML =
    `<iframe src="${src}" title="${title}"
       allow="autoplay; encrypted-media; picture-in-picture"
       allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

  // Понять из скрипта, что ролик внутри не открылся, нельзя — рамка
  // чужая. Поэтому просто держим рядом запасной выход.
  $('gEscape').innerHTML = t.link
    ? `не играет? <a href="${esc(t.link.url)}" target="_blank" rel="noopener noreferrer">открыть ${where}</a>`
    : '';
}

function renderTiers() {
  $('gTiers').innerHTML = TIERS.map(t =>
    `<button class="g-tier" data-t="${esc(t.key)}">
       <i style="color:${t.c}"></i>${esc(t.key)}</button>`).join('');
  $('gTiers').querySelectorAll('.g-tier').forEach(b => b.onclick = () => answer(b.dataset.t));
}

function answer(tier) {
  if (gameAnswered || !gameTrack) return;
  gameAnswered = true;

  const real = gameTrack.rate.tier;
  const hit = tier === real;

  // на сколько ступеней промахнулся
  const idx = k => TIERS.findIndex(t => t.key === k);
  const off = Math.abs(idx(tier) - idx(real));

  $('gTiers').querySelectorAll('.g-tier').forEach(b => {
    b.disabled = true;
    if (b.dataset.t === real) b.classList.add('right');
    else if (b.dataset.t === tier) b.classList.add('wrong');
  });

  const when = gameTrack.date
    ? gameTrack.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const link = gameTrack.moment
    ? ` — <a href="${esc(gameTrack.moment)}" target="_blank" rel="noopener noreferrer">посмотреть разнос</a>`
    : '';

  const a = $('gAnswer');
  a.className = 'g-answer ' + (hit ? 'hit' : 'miss');
  a.innerHTML = (hit ? 'Точно. ' : `Мимо на ${off} ` + plural(off, 'ступень', 'ступени', 'ступеней') + '. ') +
    `Он поставил ${ratePill(gameTrack.rate.label)}` +
    (when ? ` <span class="g-meta">${esc(when)}, <a class="pf-link" href="#stream=${gameTrack.streamNum}" data-stream="${gameTrack.streamNum}">стрим №${gameTrack.streamNum}</a></span>` : '') + link;
  a.hidden = false;

  // теперь можно и в карточку исполнителя
  $('gArtist').innerHTML =
    `<a class="pf-link" href="#artist=${encodeURIComponent(gameTrack.artist)}" data-artist="${esc(gameTrack.artist)}">${esc(gameTrack.artist)}</a>`;

  const s = loadScore();
  s.total++;
  if (hit) s.hits++;
  saveScore(s);
  renderScore();
  $('gNext').textContent = 'следующий';
}

function renderScore() {
  const s = loadScore();
  $('gScore').textContent = s.total
    ? `угадано ${s.hits} из ${s.total} · ${Math.round(s.hits / s.total * 100)}%`
    : 'выбери ступень';
}
