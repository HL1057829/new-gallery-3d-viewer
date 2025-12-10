/** @file Basic interaction controller for model rotation and zoom (stubs for future features). */

/**
 * Create an interaction controller for a model.
 * @param {import('three').Object3D} model
 * @param {import('three').Camera} camera
 * @param {HTMLElement} canvas
 * @param {Object} interactionConfig
 * @param {number} interactionConfig.spinAcceleration
 * @param {number} interactionConfig.spinFriction
 * @param {number} interactionConfig.idleSpinImpulse
 * @param {number} [interactionConfig.minZoom]
 * @param {number} [interactionConfig.maxZoom]
 * @param {number} [interactionConfig.zoomSpeed]
 * @param {number} [interactionConfig.pinchZoomMultiplier]
 * @param {number} [interactionConfig.xAxisMultiplier]
 * @param {number} [interactionConfig.yAxisMultiplier]
 * @param {number} [interactionConfig.minAngularSpeed]
 * @param {number} [interactionConfig.initialYawSpin]
 * @param {number} [interactionConfig.uprightStrength]
 * @param {number} [interactionConfig.uprightThreshold]
 * @param {Object} [debugConfig]
 * @param {boolean} [debugConfig.interactions=false]
 * @returns {{update: (delta: number) => void, dispose: () => void}}
 */
export function createInteractionController(
  model,
  camera,
  canvas,
  interactionConfig = {},
  debugConfig = {}
) {
  const {
    spinAcceleration = 2.0,
    spinFriction = 0.3,
    idleSpinImpulse = 0.2,
    minZoom = 2,
    maxZoom = 12,
    zoomSpeed = 0.002,
    pinchZoomMultiplier = 4,
    xAxisMultiplier = 0.6,
    yAxisMultiplier = 1.0,
    minAngularSpeed = 0.0,
    initialYawSpin = 0.0,
    uprightStrength = 0.0,
    uprightThreshold = 0.0
  } = interactionConfig;
  const { interactions: debugInteractions = false } = debugConfig;

  const debugLog = (...args) => {
    if (debugInteractions) {
      // eslint-disable-next-line no-console
      console.log('[interaction]', ...args);
    }
  };

  // Internal state
  let enabled = true;
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastMoveTime = 0;
  let velocityX = 0;
  let velocityY = 0;
  let coasting = true;
  let zoomDistance = camera.position.z;
  let pinchStartDistance = 0;
  const activePointers = new Map();

  // Idle spin: give a gentle initial impulse
  velocityX = idleSpinImpulse;
  // Add optional initial yaw spin that follows the same friction rules
  velocityX += initialYawSpin;
  debugLog('idle spin impulse applied', { velocityX });

  function onPointerDown(event) {
    if (!enabled) return;
    if (event.cancelable) event.preventDefault();
    activePointers.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });
    const points = Array.from(activePointers.values());

    if (points.length === 1) {
      isDragging = true;
      coasting = false;
      lastX = points[0].clientX;
      lastY = points[0].clientY;
      lastMoveTime = event.timeStamp || performance.now();
      pinchStartDistance = 0;
    } else if (points.length === 2) {
      isDragging = false; // avoid rotation while pinching
      pinchStartDistance = distance(points[0], points[1]);
    }

    debugLog('pointerdown', { x: event.clientX, y: event.clientY, pointers: points.length });
  }

  function onPointerMove(event) {
    if (!enabled) return;
    if (event.cancelable) event.preventDefault();
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const points = Array.from(activePointers.values());
    const now = event.timeStamp || performance.now();
    const dtMs = Math.max(now - lastMoveTime, 1);
    const dtSeconds = dtMs / 1000;
    lastMoveTime = now;

    // Handle pinch zoom when two pointers are active
    if (points.length === 2) {
      const pinchDist = distance(points[0], points[1]);
      if (pinchStartDistance === 0) pinchStartDistance = pinchDist;
      const distDelta = pinchDist - pinchStartDistance;
      pinchStartDistance = pinchDist;

      const zoomDelta = -distDelta * (zoomSpeed * pinchZoomMultiplier);
      zoomDistance = clamp(zoomDistance + zoomDelta, minZoom, maxZoom);
      camera.position.set(camera.position.x, camera.position.y, zoomDistance);
      debugLog('pinch', { distDelta, zoomDistance });
      return;
    }

    if (!isDragging || points.length === 0) return;

    const dx = points[0].clientX - lastX;
    const dy = points[0].clientY - lastY;
    lastX = points[0].clientX;
    lastY = points[0].clientY;

    const accel = spinAcceleration * 0.002;
    const rotY = dx * accel * yAxisMultiplier;
    const rotX = dy * accel * xAxisMultiplier;

    // Immediate rotation feedback while dragging
    model.rotation.y += rotY;
    model.rotation.x += rotX;

    // Set angular velocity for inertial spin after release
    const safeDt = Math.max(dtSeconds, 0.001);
    velocityX = rotY / safeDt; // rad/s matching final gesture speed
    velocityY = rotX / safeDt;

  }

  function onPointerUp() {
    if (!enabled) return;
    activePointers.delete(event.pointerId);
    const points = Array.from(activePointers.values());

    if (points.length === 1) {
      isDragging = true;
      lastX = points[0].clientX;
      lastY = points[0].clientY;
      pinchStartDistance = 0;
    } else {
      isDragging = false;
      pinchStartDistance = 0;
    }
    const minSpeed = Math.max(minAngularSpeed, 0);
    const speedMag = Math.max(Math.abs(velocityX), Math.abs(velocityY));
    coasting = speedMag >= minSpeed;
    if (!coasting) {
      velocityX = 0;
      velocityY = 0;
    }
    debugLog('pointerup');
  }

  function onWheel(event) {
    if (!enabled) return;
    event.preventDefault();
    const isPinchLike = event.ctrlKey === true || event.deltaMode === 1;
    const effectiveSpeed = isPinchLike ? zoomSpeed * pinchZoomMultiplier : zoomSpeed;
    const zoomDelta = event.deltaY * effectiveSpeed;
    zoomDistance = clamp(zoomDistance + zoomDelta, minZoom, maxZoom);
    camera.position.set(camera.position.x, camera.position.y, zoomDistance);
    debugLog('wheel', { deltaY: event.deltaY, zoomDistance, isPinchLike, effectiveSpeed });
  }

  function distance(p1, p2) {
    const dx = p1.clientX - p2.clientX;
    const dy = p1.clientY - p2.clientY;
    return Math.hypot(dx, dy);
  }

  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('wheel', onWheel, { passive: false });

  debugLog('listeners attached');

  function update(delta) {
    // Apply angular velocity to model (yaw/pitch)
    model.rotation.y += velocityX * delta;
    model.rotation.x += velocityY * delta;
    // Lock roll; no changes to model.rotation.z

    // Apply friction to angular velocity
    const frictionClamped = clamp(spinFriction, 0, 1);
    // Frame-rate–independent damping: friction applied per second
    const damping = Math.pow(1 - frictionClamped, delta); // friction=1 -> stop, friction=0 -> never stop
    velocityX *= damping;
    velocityY *= damping;

    // Gentle self-righting near the floor while coasting
    const speedMag = Math.max(Math.abs(velocityX), Math.abs(velocityY));
    const minSpeed = Math.max(minAngularSpeed, 0);
    const uprightKickIn = Math.max(uprightThreshold, minSpeed);
    const uprightActive = coasting && uprightStrength > 0 && speedMag <= uprightKickIn;
    if (uprightActive) {
      const uprightDamping = Math.exp(-uprightStrength * delta);
      velocityY *= uprightDamping;
      const angleX = normalizeAngle(model.rotation.x);
      const correction = -angleX * uprightStrength * delta;
      velocityY += correction;
      if (Math.abs(velocityY) < 1e-5) velocityY = 0;
    }

    // Clamp to minimum angular speed while coasting; allow user to stop below the floor
    if (coasting && minSpeed > 0) {
      if (Math.abs(velocityX) < minSpeed) velocityX = Math.sign(velocityX) * minSpeed;
      if (!uprightActive && Math.abs(velocityY) < minSpeed) {
        velocityY = Math.sign(velocityY) * minSpeed;
      }
    }

    // When not coasting, allow the velocity to decay to zero without enforcing the floor
    if (!coasting && !isDragging && minSpeed > 0) {
      if (Math.abs(velocityX) < minSpeed) velocityX = 0;
      if (Math.abs(velocityY) < minSpeed) velocityY = 0;
    }
  }

  function dispose() {
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('wheel', onWheel);
  }

  function disable() {
    enabled = false;
    isDragging = false;
    activePointers.clear();
  }

  function enable() {
    enabled = true;
  }

  return { update, dispose, enable, disable };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  // Normalize to [-PI, PI] to find the shortest path to upright
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
