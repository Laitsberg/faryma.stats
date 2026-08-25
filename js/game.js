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
  // Только YouTube: он открывается без ВПН и без входа в аккаунт, а
  // Spotify у большей части зрителей просто не заработает. Заодно
  // ролик показывается прямо на странице, а не в новой вкладке.
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

  // youtube-nocookie отдаёт тот же плеер, но не ставит рекламные куки
  // тем, кто просто открыл страницу и ничего не запускал
  $('gPlayer').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${esc(gameTrack.ytId)}"
       title="${esc(gameTrack.artist)} — ${esc(gameTrack.title)}"
       loading="lazy" allow="encrypted-media; picture-in-picture"
       allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

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
