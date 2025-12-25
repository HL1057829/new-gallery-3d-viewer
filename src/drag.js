/** @file First-pass drag prototype for accessories from the tray. */
import { Box3, MathUtils, Matrix4, Plane, Quaternion, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { getModelMeta, getModelRegistry, getSharedMarker } from './loaders.js';

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
 *   baseSizeRank?: number,
 *   baseModel?: import('three').Object3D
 *   dragOpacity?: number
 *   socketSelectionRadius?: number
 *   dragPlaneRadiusScale?: number
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
    baseSizeRank = Infinity,
    baseModel,
    baseName,
    attachedParents = [],
    dragOpacity = 0.5,
    socketSelectionRadius = 0.25,
    dragPlaneRadiusScale = 1.02
  } = options || {};
  const tray = document.getElementById('tray');
  if (!tray || !scene || !camera || !renderer || !interaction) return;

  const accessoryMap = new Map(accessories.map((a) => [a.name, a]));
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let active = null;
  const baseAnchor = computeBaseAnchor(baseModel);
  let attachedSources = normalizeParentSources(attachedParents);
  let sharedMarker = null;
  const occupiedSockets = new Set();

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
    if (target.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch (err) {
        // ignore if capture fails
      }
    }
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

    const parentSources = [{ name: baseName, model: baseModel, sizeRank: baseSizeRank }, ...attachedSources];

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
      allowedSockets,
      bestCandidate: null,
      sizeRank: Number.isFinite(accessory?.sizeRank) ? accessory.sizeRank : Infinity
    };

    if (active.startScale != null) {
      clone.scale.setScalar(finalScale * active.startScale);
      animateScale(clone, active.finalScale, active.startScale, 1, 200);
    }

    setModelOpacity(clone, dragOpacity);

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
    if (event.target?.releasePointerCapture) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (err) {
        // ignore
      }
    }
    updatePointerFromEvent(event);
    // Refresh candidate at release in case it changed on the final frame
    logSnapCandidates();
    const candidate = active.bestCandidate;

    if (candidate) {
      try {
        snapToParent(candidate);
      } catch (error) {
        console.error('Failed to snap accessory', error);
        // fall back to returning if snap failed
        const targetPosition = worldPointFromElementCenter(active.thumbEl, active.plane);
        animateReturn(
          targetPosition,
          () => {
            restoreModelOpacity(active.model);
            scene.remove(active.model);
            clearActiveDrag();
          },
          active.startScale ?? 0.25
        );
        return;
      }
      clearActiveDrag();
    } else {
      active.returning = true;
      const targetPosition = worldPointFromElementCenter(active.thumbEl, active.plane);
      animateReturn(
        targetPosition,
        () => {
          restoreModelOpacity(active.model);
          scene.remove(active.model);
          clearActiveDrag();
        },
        active.startScale ?? 0.25
      );
    }
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
      const scale =
        Number.isFinite(dragPlaneRadiusScale) && dragPlaneRadiusScale > 0 ? dragPlaneRadiusScale : 1.02;
      const targetDistance = Math.max(distanceToBase - anchor.radius * scale, 0.05);
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
    const radiusFactor =
      Number.isFinite(socketSelectionRadius) && socketSelectionRadius > 0 ? socketSelectionRadius : 0.25;
    const threshold = baseRadius > 0 ? baseRadius * radiusFactor : radiusFactor;

    // Only consider the first child socket for the dragged accessory
    const child = childSockets[0];
    let best = null;
    if (child) {
    const visibleParents = filterVisibleParents(
      filterOccupiedParents(
        filterAllowedParents(parentSockets, active.allowedSockets, active.sizeRank),
        occupiedSockets
      ),
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

    active.bestCandidate = best || null;
    if (best) {
      active.lastGoodCandidate = best;
    }

    const key =
      best != null ? `${best.parent.socketId}:${best.child.socketId}:${best.distance.toFixed(3)}` : 'none';
    if (key !== active.lastCandidatesKey) {
      active.lastCandidatesKey = key;
    }
  }

  function highlightParent(parent) {
    const previous = active.highlighted;
    if (previous) {
      if (previous.helper) {
        previous.helper.visible = false;
      }
      if (sharedMarker && sharedMarker.parent === previous.helper) {
        sharedMarker.visible = false;
      }
    }
    active.highlighted = null;

    if (!parent || !parent.helper) return;

    if (!sharedMarker) {
      sharedMarker = getSharedMarker(scene);
    }
    if (!sharedMarker) return;

    const markerMeta = getModelMeta('marker');
    const desiredRadius =
      (Number.isFinite(markerMeta?.targetRadius) && markerMeta.targetRadius > 0
        ? markerMeta.targetRadius
        : Number.isFinite(parent.helper.userData?.targetRadius) && parent.helper.userData.targetRadius > 0
          ? parent.helper.userData.targetRadius
          : Number.isFinite(parent.helper.userData?.outerRadius) && parent.helper.userData.outerRadius > 0
            ? parent.helper.userData.outerRadius
            : sharedMarker.userData?.baseRadius) || 1;
    const baseRadius =
      Number.isFinite(sharedMarker.userData?.baseRadius) && sharedMarker.userData.baseRadius > 0
        ? sharedMarker.userData.baseRadius
        : 1;
    const scaleFactor = desiredRadius > 0 ? desiredRadius / baseRadius : 1;

    parent.helper.visible = true;
    sharedMarker.visible = true;
    sharedMarker.position.set(0, 0, 0);
    sharedMarker.rotation.set(0, 0, Math.PI);
    sharedMarker.scale.setScalar(scaleFactor);
    parent.helper.add(sharedMarker);
    active.highlighted = { helper: parent.helper, role: parent.role };
  }

  function applyHelperHighlight(helper) {}

  function snapToParent(candidate) {
    const { parent, child } = candidate;
    if (!parent?.node || !child?.node || !active?.model) return;

    const model = active.model;
    const storedScale = model.scale.clone();
    model.updateMatrixWorld(true);
    parent.node.updateMatrixWorld(true);
    child.node.updateMatrixWorld(true);
    const hostRoot = getHostRoot(parent.node);
    hostRoot?.updateMatrixWorld(true);

    // Decompose child local transform (position/orientation relative to accessory).
    const childLocalPos = new Vector3();
    const childLocalQuat = new Quaternion();
    child.node.matrix.decompose(childLocalPos, childLocalQuat, new Vector3());

    // Desired world transform for the child socket (parent socket + 180° Y flip).
    const rotateY180 = new Matrix4().makeRotationY(Math.PI);
    const desiredChildWorld = parent.node.matrixWorld.clone().multiply(rotateY180);
    const desiredChildPos = new Vector3();
    const desiredChildQuat = new Quaternion();
    desiredChildWorld.decompose(desiredChildPos, desiredChildQuat, new Vector3());

    // Solve model rotation: R_model * R_childLocal = R_childDesired  =>  R_model = R_childDesired * inv(R_childLocal)
    const modelQuatWorld = desiredChildQuat.clone().multiply(childLocalQuat.clone().invert());

    // Solve model position so scaled, rotated child local origin lands on desired parent socket.
    const scaledChildOffset = childLocalPos.clone().multiply(storedScale).applyQuaternion(modelQuatWorld);
    const modelPosWorld = desiredChildPos.clone().sub(scaledChildOffset);

    if (hostRoot && model.parent !== hostRoot) {
      hostRoot.add(model);
    }

    if (hostRoot) {
      // Convert to host-local space.
      const hostQuat = new Quaternion();
      hostRoot.getWorldQuaternion(hostQuat);
      model.quaternion.copy(hostQuat.clone().invert().multiply(modelQuatWorld));
      model.position.copy(hostRoot.worldToLocal(modelPosWorld.clone()));
    } else {
      model.quaternion.copy(modelQuatWorld);
    model.position.copy(modelPosWorld);
  }

    model.scale.copy(storedScale);
    model.updateMatrixWorld(true);
    occupiedSockets.add(socketKey(parent));
    restoreModelOpacity(model);

    if (active.highlighted?.helper) {
      active.highlighted.helper.visible = false;
    }
    attachedSources = [
      ...attachedSources,
      { name: active.objectId, model, sizeRank: Number.isFinite(active.sizeRank) ? active.sizeRank : Infinity }
    ];
    console.info('Attached accessory', {
      accessory: active.objectId,
      parentSocket: parent.socketId,
      host: parent.hostName,
      position: model.position.toArray(),
      rotation: model.quaternion.toArray(),
      scale: model.scale.toArray()
    });
    active.highlighted = null;
    active.bestCandidate = null;
  }

  function getHostRoot(node) {
    let current = node;
    while (current.parent && !current.parent.isScene) {
      current = current.parent;
    }
    return current;
  }

  function clearActiveDrag() {
    if (sharedMarker) {
      sharedMarker.visible = false;
    }
    active = null;
    interaction.enable();
  }

  function isVisibleParentSocket(socket, cam, occluder) {
    const pPos = socket.helper ? socket.helper.getWorldPosition(new Vector3()) : socket.position;
    const dir = pPos.clone().sub(cam.position);
    const dist = dir.length();
    if (dist <= 0) return false;
    dir.normalize();
    raycaster.set(cam.position, dir);
    const socketRoot = getHostRoot(socket.node);
    const occluderList = Array.isArray(occluder)
      ? occluder.filter(Boolean)
      : occluder
        ? [occluder]
        : [];
    const filteredOccluders = socketRoot
      ? occluderList.filter((o) => getHostRoot(o) !== socketRoot)
      : occluderList;
    const hits = filteredOccluders.flatMap((o) => raycaster.intersectObject(o, true));
    if (!hits || hits.length === 0) return true;
    const hit = hits.find((h) => {
      if (h.object.name?.startsWith?.('helper_')) return false;
      const hitRoot = getHostRoot(h.object);
      return !socketRoot || hitRoot !== socketRoot;
    });
    if (!hit) return true;
    return hit.distance >= dist - 1e-3;
  }

  function filterVisibleParents(parents, childPos, threshold, occluders) {
    return parents.filter((p) => {
      const pPos = p.helper ? p.helper.getWorldPosition(new Vector3()) : p.position;

      // Quick reject if outside planar radius from the child
      const dist2d = planarDistance(camera, childPos, pPos);
      if (dist2d > threshold) {
        return false;
      }

      // Quick reject if off-screen
      const screen = projectToScreen(camera, pPos);
      const onScreen = screen.x >= 0 && screen.x <= 1 && screen.y >= 0 && screen.y <= 1;
      if (!onScreen) {
        return false;
      }

      return isVisibleParentSocket(p, camera, occluders);
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

function collectSocketsWorld(root, role, includeHelpers = false, skip = new Set()) {
  const sockets = [];
  root.updateMatrixWorld(true);
  const visit = (node) => {
    if (node !== root && skip.has(node)) return;
    if (node?.name && typeof node.name === 'string' && node.name.startsWith('socket_')) {
      const isParent = node.name.includes('socket_p');
      const isChild = node.name.includes('socket_c');
      if ((role === 'parent' && isParent) || (role === 'child' && isChild)) {
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
        sockets.push({ socketId: node.name, position: pos, normal, role, helper, node });
      }
    }
    if (!node?.children) return;
    node.children.forEach(visit);
  };
  visit(root);
  return sockets;
}

function planarDistance(camera, p1, p2) {
  const a = p1.clone().applyMatrix4(camera.matrixWorldInverse);
  const b = p2.clone().applyMatrix4(camera.matrixWorldInverse);
  a.z = 0;
  b.z = 0;
  return a.distanceTo(b);
}

function setModelOpacity(root, opacity = 0.75) {
  if (!root) return;
  root.traverse((node) => {
    const mat = node.material;
    if (!mat) return;
    const materials = Array.isArray(mat) ? mat : [mat];
    materials.forEach((m) => {
      if (m.userData && m.userData._origOpacity === undefined) {
        m.userData._origOpacity = typeof m.opacity === 'number' ? m.opacity : 1;
        m.userData._origTransparent = m.transparent;
      }
      if (typeof m.opacity === 'number') {
        m.opacity = opacity;
        m.transparent = true;
      }
    });
  });
}

function restoreModelOpacity(root) {
  if (!root) return;
  root.traverse((node) => {
    const mat = node.material;
    if (!mat) return;
    const materials = Array.isArray(mat) ? mat : [mat];
    materials.forEach((m) => {
      if (m.userData && m.userData._origOpacity !== undefined) {
        m.opacity = m.userData._origOpacity;
        m.transparent = m.userData._origTransparent;
      } else if (typeof m.opacity === 'number') {
        m.opacity = 1;
      }
    });
  });
}

function normalizeParentSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((src, index) => {
    if (!src) return null;
    if (src.model)
      return {
        name: src.name || `attached_${index}`,
        model: src.model,
        sizeRank: Number.isFinite(src.sizeRank) ? src.sizeRank : Infinity
      };
    return {
        name: src.name || `attached_${index}`,
        model: src,
        sizeRank: Number.isFinite(src.sizeRank) ? src.sizeRank : Infinity
      };
  }).filter(Boolean);
}

function collectParentSockets(sources) {
  if (!Array.isArray(sources)) return [];
  const parents = [];
  const skipSet = new Set(sources.map((s) => s?.model).filter(Boolean));
  sources.forEach((src) => {
    if (!src) return;
    const skipOthers = new Set(skipSet);
    skipOthers.delete(src.model);
    parents.push(
      ...collectSocketsWorld(src.model, 'parent', true, skipOthers).map((p) => ({
        ...p,
        hostName: src.name,
        hostSizeRank: Number.isFinite(src.sizeRank) ? src.sizeRank : Infinity
      }))
    );
  });
  return parents;
}

function projectToScreen(camera, pos) {
  const ndc = pos.clone().project(camera);
  return new Vector2((ndc.x + 1) / 2, (1 - ndc.y) / 2);
}

function filterAllowedParents(parents, allowedSockets, childSizeRank = Infinity) {
  if (!parents || parents.length === 0) return [];

  // Enforce sizeRank: host must be larger than the attaching accessory.
  const rankedParents = parents.filter((p) => {
    if (!Number.isFinite(childSizeRank)) return true;
    if (!Number.isFinite(p.hostSizeRank)) return true;
    return p.hostSizeRank > childSizeRank;
  });

  parents = rankedParents;
  if (parents.length === 0) return [];

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
    if (allowedList === undefined) {
      const wildcard = allowedSockets['*'];
      if (wildcard === undefined) return false; // host not listed; disallow
      if (Array.isArray(wildcard) && wildcard.length === 0) return true;
      return Array.isArray(wildcard) && wildcard.includes(p.socketId);
    }
    if (Array.isArray(allowedList) && allowedList.length === 0) return true;
    return Array.isArray(allowedList) && allowedList.includes(p.socketId);
  });
}

function filterOccupiedParents(parents, occupiedSet) {
  if (!parents || parents.length === 0) return [];
  return parents.filter((p) => {
    const key = socketKey(p);
    return key && !occupiedSet.has(key);
  });
}

function socketKey(parent) {
  if (!parent) return null;
  if (parent.node?.uuid) return parent.node.uuid;
  if (parent.socketId && parent.hostName) return `${parent.hostName}:${parent.socketId}`;
  return parent.socketId || null;
}
