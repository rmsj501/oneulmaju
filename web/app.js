(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const hearts = [...document.querySelectorAll('[data-rating]')];
  let rating = 0;
  const setRating = value => {
    rating = value;
    hearts.forEach((heart, index) => {
      heart.classList.toggle('filled', index < rating);
      heart.setAttribute('aria-checked', String(index + 1 === rating));
      heart.tabIndex = index === (rating ? rating - 1 : 0) ? 0 : -1;
    });
    $('interest-status').textContent = rating ? `관심도 ${rating}개 선택` : '관심도 선택 전';
  };
  hearts.forEach(heart => {
    heart.addEventListener('click', () => {
      const value = Number(heart.dataset.rating);
      setRating(value === rating ? 0 : value);
    });
    heart.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(3, rating + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(1, rating - 1);
      else if (event.key === 'Home') next = 1;
      else if (event.key === 'End') next = 3;
      else if (event.key === 'Delete' || event.key === 'Backspace') next = 0;
      else return;
      event.preventDefault();
      setRating(next);
      hearts[next ? next - 1 : 0].focus();
    });
  });
  const dialog = $('criteria-dialog');
  $('criteria-open').addEventListener('click', () => dialog.showModal());
  [$('criteria-close'), $('criteria-done')].forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  setRating(0);
})();
