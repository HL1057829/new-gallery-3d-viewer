/** @file Renders the accessory thumbnail tray on the left side. */

/**
 * Initialize the tray UI with accessory thumbnails.
 * @param {{accessories: {name: string, thumbnail?: string}[]}} config
 */
export function initTray({ accessories = [] } = {}) {
  const tray = document.getElementById('tray');
  if (!tray) return;

  tray.replaceChildren();
  if (accessories.length === 0) return;

  const tooltip = ensureTooltip();
  const tooltipTimers = new Map();

  accessories.forEach((item) => {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = item.thumbnail || '';
    img.alt = item.name || '';
    img.title = '';
    img.dataset.tooltip = item.displayName || item.name || '';
    img.dataset.objectId = item.name || '';
    img.draggable = false;
    img.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') {
        showTooltip(img);
      }
    });
    img.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') {
        updateTooltipPosition(img);
      }
    });
    img.addEventListener('pointerleave', () => {
      hideTooltip(img);
    });
    img.addEventListener('pointerdown', (event) => {
      // Touch or pen tap shows briefly
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        showTooltip(img);
        if (tooltipTimers.has(img)) {
          clearTimeout(tooltipTimers.get(img));
        }
        const timer = setTimeout(() => {
          hideTooltip(img);
          tooltipTimers.delete(img);
        }, 1200);
        tooltipTimers.set(img, timer);
      }
    });
    tray.appendChild(img);
  });

  function showTooltip(el) {
    tooltip.textContent = el.dataset.tooltip || '';
    updateTooltipPosition(el);
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  function updateTooltipPosition(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.bottom;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}

function ensureTooltip() {
  let tip = document.querySelector('.tray-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tray-tooltip';
    document.body.appendChild(tip);
  }
  return tip;
}
