/* ============================================================
   МЕЛОЧИ, ОБЩИЕ ДЛЯ ВСЕХ СТРАНИЦ
   ------------------------------------------------------------
   Две функции, которые нужны и главной, и колесу, и очереди.
   Раньше они лежали в js/ui.js — но тот тянет за собой Chart.js,
   а страницам без графиков он ни к чему. Копировать их по файлам
   тоже нельзя: копии расходятся, и склонение «1 трек / 2 трека»
   начинает работать по-разному в разных углах сайта.
   ============================================================ */

/* Русское склонение после числа: 1 трек, 2 трека, 5 треков.
   Отдельная ветка для 11–14: они ведут себя как «много»,
   хотя оканчиваются на 1, 2, 3, 4. */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* Списки длиннее экрана прокручиваются внутри себя. Без подсказки
   нижняя строка выглядит просто обрезанной пополам — будто сломалась
   вёрстка. Затемнение у края говорит: там продолжение. Класс ставится
   и снимается по мере прокрутки. */
function markScrollables() {
  document.querySelectorAll('.scroll').forEach(el => {
    let wrap = el.parentElement;
    if (!wrap.classList.contains('scroll-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'scroll-wrap';
      el.parentElement.insertBefore(wrap, el);
      wrap.appendChild(el);
      el.addEventListener('scroll', () => update(el, wrap), { passive: true });
    }
    update(el, wrap);
  });

  function update(el, wrap) {
    const ещё = el.scrollHeight - el.clientHeight - el.scrollTop > 8;
    wrap.classList.toggle('more', ещё);
  }
}
