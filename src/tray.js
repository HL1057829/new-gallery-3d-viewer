/** @file Renders the accessory thumbnail tray on the left side. */

/**
 * Initialize the accessory thumbnail tray.
 * The visible tray intentionally contains exactly the seven user-facing
 * accessories: Full Face, Half Face, Piggy Face, Rabbit Ear, Rabbit Nose,
 * Bear Nose, and Plunger. Bear Ear remains available as an underlying model
 * but is not shown as a tray item.
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
  refreshBtn.addEventListener('click', () => window.location.reload());
  tray.appendChild(refreshBtn);

  // Exact visible tray order. This also prevents duplicate display labels.
  const visibleIds = [
    'full_face',
    'half_face',
    'piggy_face1',
    'rabbit_ear',
    'rabbit_nose',
    'bear_nose',
    'plunger1'
  ];

  const byId = new Map(accessories.map((item) => [item.name, item]));

  visibleIds.forEach((id) => {
    const item = byId.get(id);
    if (!item) return;

    const displayName = item.displayName || item.name || '';
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
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.bottom}px`;
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
