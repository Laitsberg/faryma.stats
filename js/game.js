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
  renderScore();
  nextTrack();
}

function nextTrack() {
  // Только YouTube: у Spotify без ВПН и входа в аккаунт не работает
  // вообще ничего, а ютуб хотя бы открывается у большинства. У кого
  // не открывается — см. showPoster(): игра там всё равно работает.
  const pool = ROWS.filter(r => r.ytId && r.artist);
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

/* Вставить настоящий плеер. youtube-nocookie отдаёт тот же ролик,
   но не ставит рекламные куки тем, кто ничего не запускал. */
function playHere(t) {
  $('gPlayer').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${esc(t.ytId)}?autoplay=1"
       title="${esc(t.artist)} — ${esc(t.title)}"
       allow="autoplay; encrypted-media; picture-in-picture"
       allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
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
