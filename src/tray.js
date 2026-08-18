/** @file Renders the accessory thumbnail tray on the left side. */

/**
 * Initialize the tray UI with accessory thumbnails.
 * Duplicate display names are shown only once in the tray while preserving
 * all underlying accessory models and socket behavior.
 * @param {{accessories: {name: string, thumbnail?: string, displayName?: string}[]}} config
 */
export function initTray({ accessories = [] } = {}) {
  const tray = document.getElementById('tray');
  if (!tray) return;

  tray.replaceChildren();
  if (accessories.length === 0) return;

  const tooltip = ensureTooltip();

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'refresh';
  refreshBtn.textContent = '⟳';
  refreshBtn.setAttribute('aria-label', 'Refresh');
  refreshBtn.addEventListener('click', () => {
    window.location.reload();
  });
  tray.appendChild(refreshBtn);

  // The configuration contains two variants of Piggy Face, but the tray
  // should present one Piggy Face button. Likewise, if a duplicate Rabbit Ear
  // entry is ever introduced, only the first one is shown. The original
  // accessory objects remain loaded and usable internally.
  const seenDisplayNames = new Set();

  accessories.forEach((item) => {
    const displayName = item.displayName || item.name || '';
    const normalizedName = displayName.trim().toLowerCase();
    if (normalizedName === 'piggy face' || normalizedName === 'rabbit ear') {
      if (seenDisplayNames.has(normalizedName)) return;
      seenDisplayNames.add(normalizedName);
    }

    const img = document.createElement('img');
    img.src = item.thumbnail?.startsWith('/')
      ? `${import.meta.env.BASE_URL}${item.thumbnail.slice(1)}`
      : item.thumbnail || '';
    img.alt = displayName;
    img.title = '';
    img.dataset.tooltip = displayName;
    img.dataset.objectId = item.name || '';
    img.draggable = false;
    img.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') showTooltip(img);
    });
    img.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') updateTooltipPosition(img);
    });
    img.addEventListener('pointerleave', () => hideTooltip());
    img.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') showTooltip(img);
    });
    img.addEventListener('pointerup', () => hideTooltip());
    img.addEventListener('pointercancel', () => hideTooltip());
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
