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
    baseName
  } = options || {};
  const tray = document.getElementById('tray');
  if (!tray || !scene || !camera || !renderer || !interaction) return;

  const accessoryMap = new Map(accessories.map((a) => [a.name, a]));
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let active = null;
  const baseAnchor = computeBaseAnchor(baseModel);

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
      highlighted: null
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
    const parentSockets = collectSocketsWorld(baseModel, 'parent', true);
    const threshold = baseRadius > 0 ? baseRadius * 0.75 : 0.9;

    let best = null;
    childSockets.forEach((child) => {
      parentSockets.forEach((parent) => {
        const dist = planarDistanceWithZAllowance(camera, child.position, parent.position);
        if (dist <= threshold) {
          if (!best || dist < best.distance) {
            best = { parent, child, distance: dist };
          }
        }
      });
    });

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

function planarDistanceWithZAllowance(camera, p1, p2, zAllowanceFactor = 0.2) {
  const a = p1.clone().applyMatrix4(camera.matrixWorldInverse);
  const b = p2.clone().applyMatrix4(camera.matrixWorldInverse);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const planar = Math.hypot(dx, dy);
  // If either point is closer to the camera (more negative z), allow a bit more reach.
  const allowance = Math.max(0, -Math.min(a.z, b.z)) * zAllowanceFactor;
  return Math.max(0, planar - allowance);
}
