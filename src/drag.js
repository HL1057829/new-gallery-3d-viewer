/** @file First-pass drag prototype for accessories from the tray. */
import { Box3, MathUtils, Plane, Quaternion, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { getModelMeta, getModelRegistry } from './loaders.js';

/**
 * Initialize drag-from-tray behavior.
 * @param {{
 *   scene: import('three').Scene,
 *   camera: import('three').Camera,
 *   renderer: import('three').WebGLRenderer,
 *   interaction: { disable: () => void, enable: () => void },
 *   accessories: { name: string, size?: number }[],
 *   baseSize: number,
 *   baseRadius: number,
 *   baseModel?: import('three').Object3D
 * }} options
 */
export function initDrag(options) {
  const {
    scene,
    camera,
    renderer,
    interaction,
    accessories = [],
    baseSize = 1,
    baseRadius = 1,
    baseModel,
    baseName,
    visibilityIntervalMs = 100,
    attachedParents = []
  } = options || {};
  const tray = document.getElementById('tray');
  if (!tray || !scene || !camera || !renderer || !interaction) return;

  const accessoryMap = new Map(accessories.map((a) => [a.name, a]));
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let active = null;
  const baseAnchor = computeBaseAnchor(baseModel);
  const visibilityCache = { time: 0, map: new Map() };
  const VISIBILITY_INTERVAL_MS = visibilityIntervalMs || 0;
  let lastViewHash = '';

  tray.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  function onPointerDown(event) {
    const target = event.target?.closest?.('[data-object-id]');
    if (!target) return;
    const objectId = target.dataset.objectId;
    const accessory = accessoryMap.get(objectId);
    if (!accessory) return;

    event.preventDefault();
    interaction.disable();

    const registryEntry = getModelMeta(objectId) || getModelRegistry().find((entry) => entry.id === objectId);
    if (!registryEntry?.model) {
      interaction.enable();
      return;
    }

    const clone = registryEntry.model.clone(true);
    clone.rotation.set(0, 0, 0);
    clone.renderOrder = 1;
    clone.visible = true;
    scene.add(clone);

    const attachedSources = normalizeParentSources(attachedParents);
    const parentSources = [{ name: baseName, model: baseModel }, ...attachedSources];

    const allowedSockets = accessory?.allowedSockets;

    const finalScale = clone.scale.x;

    const plane = makePlane(camera, baseAnchor);
    active = {
      model: clone,
      plane,
      thumbEl: target,
      objectId,
      finalScale,
      startScale: computeStartScale(registryEntry.radius, planeDistance(camera, plane), renderer, camera, target),
      startTime: null,
      returning: false,
      lastCandidatesKey: 'none',
      highlighted: null,
      parentSources,
      allowedSockets
    };

    if (active.startScale != null) {
      clone.scale.setScalar(finalScale * active.startScale);
      animateScale(clone, active.finalScale, active.startScale, 1, 200);
    }

    updatePointerFromEvent(event);
    updateModelPosition();
  }

  function onPointerMove(event) {
    if (!active || active.returning) return;
    updatePointerFromEvent(event);
    updateModelPosition();
    logSnapCandidates();
  }

  function onPointerUp(event) {
    if (!active) return;
    active.returning = true;
    updatePointerFromEvent(event);
    const targetPosition = worldPointFromElementCenter(active.thumbEl, active.plane);
    animateReturn(targetPosition, () => {
      scene.remove(active.model);
      active = null;
      interaction.enable();
    }, active.startScale ?? 0.25);
  }

  function updatePointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function updateModelPosition() {
    if (!active) return;
    raycaster.setFromCamera(pointer, camera);
    const point = new Vector3();
    const hit = raycaster.ray.intersectPlane(active.plane, point);
    if (hit) {
      active.model.position.copy(point);
    } else {
      // Fallback: place a short distance in front of the camera
      const dir = raycaster.ray.direction.clone().multiplyScalar(2);
      const pos = raycaster.ray.origin.clone().add(dir);
      active.model.position.copy(pos);
    }
  }

  function animateReturn(target, onComplete, targetScaleFactor = 0.25) {
    const duration = 250;
    const start = performance.now();
    const from = active.model.position.clone();
    const startScale = active.finalScale;

    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      active.model.position.lerpVectors(from, target, t);
      const scaleFactor = MathUtils.lerp(1, targetScaleFactor, t);
      active.model.scale.setScalar(startScale * scaleFactor);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        onComplete();
      }
    }

    requestAnimationFrame(step);
  }

  function makePlane(cam, anchor) {
    const normal = new Vector3();
    cam.getWorldDirection(normal).normalize();

    if (anchor?.center) {
      const toBase = anchor.center.clone().sub(cam.position);
      const distanceToBase = Math.max(toBase.dot(normal), 0.1);
      // Place plane just in front of the base surface toward the camera to avoid clipping and oversized perspective.
      const epsilon = Math.max(anchor.radius * 0.02, 0.05);
      const targetDistance = Math.max(distanceToBase - anchor.radius + epsilon, 0.05);
      const point = cam.position.clone().add(normal.clone().multiplyScalar(targetDistance));
      return new Plane().setFromNormalAndCoplanarPoint(normal, point);
    }

    const point = cam.position.clone().add(normal.clone().multiplyScalar(1));
    return new Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  function activePlaneDistance(cam, anchor) {
    const plane = makePlane(cam, anchor);
    return Math.abs(plane.distanceToPoint(cam.position)) || 1;
  }

  function worldPointFromElementCenter(el, plane) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((centerX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((centerY - canvasRect.top) / canvasRect.height) * 2 + 1
    );

    raycaster.setFromCamera(ndc, camera);
    const point = new Vector3();
    if (raycaster.ray.intersectPlane(plane, point)) {
      return point;
    }
    return raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(2));
  }

  function logSnapCandidates() {
    if (!active || !baseModel) return;
    active.model.updateMatrixWorld(true);
    baseModel.updateMatrixWorld(true);
    const childSockets = collectSocketsWorld(active.model, 'child');
    const parentSockets = collectParentSockets(active.parentSources);
    const occluderModels = active.parentSources.map((s) => s.model).filter(Boolean);
    const threshold = baseRadius > 0 ? baseRadius * 0.25 : 0.3;

    // Only consider the first child socket for the dragged accessory
    const child = childSockets[0];
    let best = null;
    if (child) {
      const visibleParents = filterVisibleParents(
        filterAllowedParents(parentSockets, active.allowedSockets),
        child.position,
        threshold,
        occluderModels
      );
      visibleParents.forEach((parent) => {
        const pPos = parent.helper ? parent.helper.getWorldPosition(new Vector3()) : parent.position;
        const distance = planarDistance(camera, child.position, pPos);
        if (distance <= threshold) {
          const camDistance = pPos.distanceTo(camera.position);
          if (
            !best ||
            distance < best.distance ||
            (Math.abs(distance - best.distance) < 1e-4 && camDistance < best.camDistance)
          ) {
            best = { parent, child, distance, camDistance };
          }
        }
      });
    }

    highlightParent(best?.parent);

    const key =
      best != null ? `${best.parent.socketId}:${best.child.socketId}:${best.distance.toFixed(3)}` : 'none';
    if (key !== active.lastCandidatesKey) {
      active.lastCandidatesKey = key;
      if (best) {
        console.info('Snap candidate', {
          accessory: active.objectId,
          base: baseName,
          candidate: {
            parentId: best.parent.socketId,
            childId: best.child.socketId,
            distance: best.distance
          }
        });
      } else {
        console.info('Snap candidate', { accessory: active.objectId, base: baseName, candidate: null });
      }
    }
  }

  function highlightParent(parent) {
    const previous = active.highlighted;
    if (previous && previous.helper && previous.role) {
      previous.helper.material.color.set(previous.role === 'parent' ? 0xff3333 : 0x33ff66);
    }
    active.highlighted = null;

    if (parent && parent.helper) {
      parent.helper.material.color.set(0xffd42a);
      active.highlighted = { helper: parent.helper, role: parent.role };
    }
  }

  function isVisibleParentSocket(socket, cam, occluder) {
    const pPos = socket.helper ? socket.helper.getWorldPosition(new Vector3()) : socket.position;
    const dir = pPos.clone().sub(cam.position);
    const dist = dir.length();
    if (dist <= 0) return false;
    dir.normalize();
    raycaster.set(cam.position, dir);
    const hits = Array.isArray(occluder)
      ? occluder.flatMap((o) => (o ? raycaster.intersectObject(o, true) : []))
      : occluder
        ? raycaster.intersectObject(occluder, true)
        : [];
    if (!hits || hits.length === 0) return true;
    const hit = hits.find((h) => !h.object.name?.startsWith?.('helper_'));
    if (!hit) return true;
    return hit.distance >= dist - 1e-3;
  }

  function filterVisibleParents(parents, childPos, threshold, occluders) {
    const now = performance.now();
    const shouldRefresh = now - visibilityCache.time > VISIBILITY_INTERVAL_MS;

    if (shouldRefresh) {
      visibilityCache.map.clear();
      visibilityCache.time = now;
    }

    return parents.filter((p) => {
      if (!shouldRefresh && visibilityCache.map.has(p.socketId)) {
        return visibilityCache.map.get(p.socketId);
      }

      const pPos = p.helper ? p.helper.getWorldPosition(new Vector3()) : p.position;

      // Quick reject if outside planar radius from the child
      const dist2d = planarDistance(camera, childPos, pPos);
      if (dist2d > threshold) {
        visibilityCache.map.set(p.socketId, false);
        return false;
      }

      // Quick reject if off-screen
      const screen = projectToScreen(camera, pPos);
      const onScreen = screen.x >= 0 && screen.x <= 1 && screen.y >= 0 && screen.y <= 1;
      if (!onScreen) {
        visibilityCache.map.set(p.socketId, false);
        return false;
      }

      const visible = isVisibleParentSocket(p, camera, occluders);
      visibilityCache.map.set(p.socketId, visible);
      return visible;
    });
  }
}

function relativeScale(entry, baseSize, baseRadius, accessoryRadius) {
  if (!entry || entry.objClass !== 'accessory') return undefined;
  const base = Number.isFinite(baseSize) && baseSize > 0 ? baseSize : 1;
  const size = Number.isFinite(entry.size) ? entry.size : null;
  if (size === null) return undefined;
  const relative = size / base;
  const radiusRatio =
    Number.isFinite(baseRadius) && Number.isFinite(accessoryRadius) && accessoryRadius > 0
      ? baseRadius / accessoryRadius
      : 1;
  const finalScale = relative * radiusRatio;
  return Number.isFinite(finalScale) && finalScale > 0 ? finalScale : undefined;
}

function computeBaseAnchor(baseModel) {
  if (!baseModel) return null;
  const box = new Box3().setFromObject(baseModel);
  if (box.isEmpty()) return null;
  const sphere = new Sphere();
  box.getBoundingSphere(sphere);
  return { center: sphere.center.clone(), radius: sphere.radius || 1 };
}

function computeStartScale(accessoryRadius, planeDistance, renderer, camera, thumbEl) {
  if (!accessoryRadius || accessoryRadius <= 0) return 0.25;
  const rect = thumbEl.getBoundingClientRect();
  const viewportHeight = renderer.domElement.clientHeight || window.innerHeight || 1;
  const worldPerPixel =
    (2 * planeDistance * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / viewportHeight;
  const desiredRadius = Math.max((rect.height * worldPerPixel) / 2, 0.01);
  const factor = desiredRadius / accessoryRadius;
  return MathUtils.clamp(factor, 0.05, 1);
}

  function planeDistance(cam, plane) {
    return Math.abs(plane.distanceToPoint(cam.position)) || 1;
  }

function animateScale(model, finalScale, fromFactor, toFactor, duration) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const factor = MathUtils.lerp(fromFactor, toFactor, t);
    model.scale.setScalar(finalScale * factor);
    if (t < 1) {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function collectSocketsWorld(root, role, includeHelpers = false) {
  const sockets = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node?.name || typeof node.name !== 'string') return;
    if (!node.name.startsWith('socket_')) return;
    const isParent = node.name.includes('socket_p');
    const isChild = node.name.includes('socket_c');
    if (role === 'parent' && !isParent) return;
    if (role === 'child' && !isChild) return;
    const pos = new Vector3();
    const normal = new Vector3(0, 1, 0);
    node.getWorldPosition(pos);
    const q = new Quaternion();
    node.getWorldQuaternion(q);
    normal.applyQuaternion(q);
    normal.normalize();
    const helper =
      includeHelpers && node.children
        ? node.children.find((c) => typeof c.name === 'string' && c.name.startsWith('helper_'))
        : null;
    sockets.push({ socketId: node.name, position: pos, normal, role, helper });
  });
  return sockets;
}

function planarDistance(camera, p1, p2) {
  const a = p1.clone().applyMatrix4(camera.matrixWorldInverse);
  const b = p2.clone().applyMatrix4(camera.matrixWorldInverse);
  a.z = 0;
  b.z = 0;
  return a.distanceTo(b);
}

function normalizeParentSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src, index) => {
    if (!src) return null;
    if (src.model) return { name: src.name || `attached_${index}`, model: src.model };
    return { name: src.name || `attached_${index}`, model: src };
  }).filter(Boolean);
}

function collectParentSockets(sources) {
  if (!Array.isArray(sources)) return [];
  const parents = [];
  sources.forEach((src) => {
    if (!src) return;
    parents.push(
      ...collectSocketsWorld(src.model, 'parent', true).map((p) => ({
        ...p,
        hostName: src.name
      }))
    );
  });
  return parents;
}

function projectToScreen(camera, pos) {
  const ndc = pos.clone().project(camera);
  return new Vector2((ndc.x + 1) / 2, (1 - ndc.y) / 2);
}

function filterAllowedParents(parents, allowedSockets) {
  if (!parents || parents.length === 0) return [];

  // No restrictions
  if (!allowedSockets) return parents;
  if (Array.isArray(allowedSockets)) {
    if (allowedSockets.length === 0) return parents;
    const set = new Set(allowedSockets);
    return parents.filter((p) => set.has(p.socketId));
  }
  const hostKeys = Object.keys(allowedSockets);
  if (hostKeys.length === 0) return parents;

  return parents.filter((p) => {
    const allowedList = allowedSockets[p.hostName];
    if (allowedList === undefined) return true; // no host-specific restriction
    if (Array.isArray(allowedList) && allowedList.length === 0) return true;
    return Array.isArray(allowedList) && allowedList.includes(p.socketId);
  });
}
