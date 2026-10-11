import { clamp } from './core.js';

export function syncRange(range, number, value) {
  range.value = String(value);
  number.value = range.value;
  const progress = (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min));
  range.style.setProperty('--range-progress', `${progress * 100}%`);
}

export function bindInterface() {
  const tooltip = document.getElementById('customTooltip');
  let tooltipTarget = null;

  function hideTooltip() {
    if (tooltipTarget) {
      const descriptions = (tooltipTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tooltip.id);
      if (descriptions.length) tooltipTarget.setAttribute('aria-describedby', descriptions.join(' '));
      else tooltipTarget.removeAttribute('aria-describedby');
    }
    tooltipTarget = null;
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  function showTooltip(target) {
    if (target === tooltipTarget) return;
    hideTooltip();
    tooltipTarget = target;
    tooltip.textContent = target.dataset.tooltip;
    const isCredits = target.id === 'creditsButton';
    tooltip.classList.toggle('credits-tooltip', isCredits);
    const bounds = target.getBoundingClientRect();
    const size = tooltip.getBoundingClientRect();
    const besideDock = Boolean(target.closest('.tool-dock'));
    const x = isCredits ? bounds.left : besideDock ? bounds.right + 10 : bounds.left + (bounds.width - size.width) / 2;
    const y = besideDock ? bounds.top + (bounds.height - size.height) / 2
      : bounds.top >= size.height + 18 ? bounds.top - size.height - 10 : bounds.bottom + 10;
    tooltip.style.left = `${clamp(x, 8, window.innerWidth - size.width - 8)}px`;
    tooltip.style.top = `${clamp(y, 8, window.innerHeight - size.height - 8)}px`;
    target.setAttribute('aria-describedby', [target.getAttribute('aria-describedby'), tooltip.id].filter(Boolean).join(' '));
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.classList.add('visible');
  }

  document.addEventListener('pointerover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
    if (target) showTooltip(target);
  });
  document.addEventListener('pointerout', (event) => {
    if (tooltipTarget?.contains(event.target) && !(event.relatedTarget instanceof Node && tooltipTarget.contains(event.relatedTarget))) hideTooltip();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
    if (target?.matches(':focus-visible')) showTooltip(target);
  });
  document.addEventListener('focusout', (event) => {
    if (tooltipTarget?.contains(event.target)) hideTooltip();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element && event.target.closest('#creditsButton'))) hideTooltip();
  });
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
  window.addEventListener('blur', hideTooltip);
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTooltip(); });

}
