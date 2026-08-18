/** @file Renders the accessory thumbnail tray on the left side. */

/**
 * Initialize the accessory thumbnail tray.
 * The visible tray intentionally contains exactly the seven user-facing
 * accessories: Full Face, Half Face, Piggy Face, Rabbit Ear, Rabbit Nose,
 * Bear Nose, and Plunger. Bear Ear remains available as an underlying model
 * but is not shown as a tray item.
 */
export function initTray({ accessories = [], loadAccessory = null } = {}) {
  const tray = document.getElementById('tray');
  if (!tray) return;

  tray.replaceChildren();
  if (accessories.length === 0) return;

  // On phones the seven thumbnails can extend beyond the viewport. Make only
  // the tray scrollable so every mask remains reachable; the canvas and 3D
  // interaction are otherwise untouched.
  if (isNarrowTouchDevice()) {
    tray.style.maxHeight = 'calc(100dvh - 24px)';
    tray.style.overflowY = 'auto';
    tray.style.overflowX = 'hidden';
    tray.style.webkitOverflowScrolling = 'touch';
    tray.style.touchAction = 'pan-y';
    tray.style.paddingBottom = '12px';
    tray.style.boxSizing = 'border-box';
  }

  const tooltip = ensureTooltip();

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'refresh';
  refreshBtn.textContent = '⟳';
  refreshBtn.setAttribute('aria-label', 'Refresh');
  refreshBtn.addEventListener('click', () => window.location.reload());
  tray.appendChild(refreshBtn);

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
    img.dataset.modelReady = 'false';
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

  // This listener runs before drag.js's bubbling pointerdown listener.
  // If an accessory is not decoded yet, pause the original gesture, load only
  // that one GLB, then replay the pointerdown so the existing drag/snap code
  // continues unchanged.
  tray.addEventListener('pointerdown', async (event) => {
    const target = event.target?.closest?.('[data-object-id]');
    if (!target || target.dataset.modelReady === 'true' || !loadAccessory) return;

    const accessory = byId.get(target.dataset.objectId);
    if (!accessory) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    target.dataset.modelLoading = 'true';

    try {
      const loaded = await loadAccessory(accessory);
      if (!loaded) throw new Error(`Unable to load accessory: ${accessory.name}`);
      target.dataset.modelReady = 'true';

      const replay = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons
      });
      target.dispatchEvent(replay);
    } catch (error) {
      console.error('Failed to lazy-load accessory', accessory.name, error);
      target.dataset.modelReady = 'false';
    } finally {
      target.dataset.modelLoading = 'false';
    }
  }, true);

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

function isNarrowTouchDevice() {
  return window.matchMedia?.('(pointer: coarse) and (max-width: 700px)').matches
    || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
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
