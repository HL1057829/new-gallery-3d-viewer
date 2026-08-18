/** @file App entrypoint: create scene, load config, and add base model. */
import { Box3, MathUtils, Sphere, Vector3 } from 'three';
import { getModelMeta, loadModel } from './loaders.js';
import { createScene } from './scene.js';
import { loadObjectConfig } from './config.js';
import { createInteractionController } from './interaction.js';
import { initTray } from './tray.js';
import { initDrag } from './drag.js';

(async () => {
  const { base, bases, accessories, markers, debug } = await loadObjectConfig();
  const { scene, renderer, camera } = createScene(base.scene);
  const model = await loadModel(scene, { ...base, debug });
  if (!model) {
    console.error('Failed to load base model; aborting scene setup.');
    return;
  }

  const baseSize = Number.isFinite(base.size) ? base.size : 1;
  const baseSizeRank = Number.isFinite(base.sizeRank) ? base.sizeRank : Infinity;
  const baseMeta = getModelMeta(base.name);
  const baseRadius = Number.isFinite(baseMeta?.radius) && baseMeta.radius > 0 ? baseMeta.radius : 1;

  // Start the viewer as soon as the base model is ready. Accessories are loaded
  // one at a time after startup so iOS Safari does not have to decode several
  // GLBs simultaneously. The tray still contains all configured accessories.
  initTray({ accessories });

  const baseCameraZ = camera.position.z;
  const fitDistance = fitCameraToModel(camera, model, {
    padding: base.scene?.fitPadding ?? 1.0,
    portraitScale: base.scene?.fitPaddingPortraitScale ?? 1.25
  });
  const adjustedInteraction = scaleZoomRange(base.interaction || {}, baseCameraZ, fitDistance);

  const interactions = createInteractionController(
    model,
    camera,
    renderer.domElement,
    adjustedInteraction,
    debug || {}
  );

  initDrag({
    scene,
    camera,
    renderer,
    interaction: interactions,
    accessories,
    baseSize,
    baseRadius,
    baseSizeRank,
    baseModel: model,
    baseName: base.name,
    visibilityIntervalMs: base?.interaction?.socketVisibilityIntervalMs,
    dragOpacity: base?.interaction?.dragOpacity,
    socketSelectionRadius: base?.interaction?.socketSelectionRadius,
    dragPlaneRadiusScale: base?.interaction?.dragPlaneRadiusScale
  });

  // Keep alternate bases and markers out of the critical startup path.
  void preloadRemainingBases(scene, bases, base.name, baseSize, debug);
  void preloadAccessoriesSequentially(scene, accessories, baseSize, baseRadius, debug);
  void preloadMarkers(scene, markers, baseSize, baseRadius, debug);

  let previousTime = 0;
  renderer.setAnimationLoop((time) => {
    const delta = (time - previousTime) / 1000;
    previousTime = time;
    interactions.update(delta);
    renderer.render(scene, camera);
  });
})();

async function preloadAccessoriesSequentially(scene, accessories, baseSize, baseRadius, debug) {
  // Give Safari a chance to render the base scene before starting GLB decoding.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const entry of accessories) {
    if (getModelMeta(entry?.name)?.model) continue;
    await loadModel(scene, {
      ...entry,
      addToScene: false,
      visible: false,
      debug
    });
    const meta = getModelMeta(entry?.name);
    if (meta?.model) {
      const accessoryRadius = Number.isFinite(meta.radius) && meta.radius > 0 ? meta.radius : undefined;
      const scale = scaleForEntry(entry, baseSize, baseRadius, accessoryRadius);
      if (scale != null) meta.model.scale.setScalar(scale);
    }
    // Release the main thread between GLB decodes on mobile Safari.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function preloadRemainingBases(scene, bases, displayedBaseName, baseSize, debug) {
  const remainingBases = bases.filter((entry) => entry.name !== displayedBaseName);
  for (const entry of remainingBases) {
    const scale = scaleForEntry(entry, baseSize);
    await loadModel(scene, {
      ...entry,
      ...(scale != null ? { scale } : {}),
      addToScene: false,
      visible: false,
      debug
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function preloadMarkers(scene, markers, baseSize, baseRadius, debug) {
  if (!markers || markers.length === 0) return [];
  const results = [];
  for (const entry of markers) {
    const result = await loadModel(scene, {
      ...entry,
      targetRadius:
        Number.isFinite(entry?.size) && Number.isFinite(baseSize) && Number.isFinite(baseRadius) && baseSize > 0
          ? (entry.size / baseSize) * baseRadius
          : undefined,
      addToScene: false,
      visible: false,
      debug
    });
    if (result) results.push(result);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return results;
}

function fitCameraToModel(camera, model, options = {}) {
  const padding = options.padding ?? 1.0;
  const portraitScale = options.portraitScale ?? 1.0;
  const box = new Box3().setFromObject(model);
  const sphere = new Sphere();
  box.getBoundingSphere(sphere);
  const aspect = camera.aspect || 1;
  const aspectScale = aspect < 1 ? portraitScale : 1;
  const radius = sphere.radius * padding * aspectScale;
  if (!isFinite(radius) || radius <= 0) return camera.position.z;
  const vFov = MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distV = radius / Math.tan(vFov / 2);
  const distH = radius / Math.tan(hFov / 2);
  const distance = Math.max(distV, distH);
  const center = new Vector3();
  box.getCenter(center);
  camera.position.set(center.x, center.y, center.z + distance);
  camera.lookAt(center);
  return distance;
}

function scaleZoomRange(interaction, baseDistance, fitDistance) {
  if (!baseDistance || !fitDistance || !isFinite(baseDistance) || !isFinite(fitDistance)) return interaction;
  const scale = fitDistance / baseDistance;
  if (!isFinite(scale) || scale <= 0) return interaction;
  const next = { ...interaction };
  if (interaction.minZoom != null) next.minZoom = interaction.minZoom * scale;
  if (interaction.maxZoom != null) next.maxZoom = interaction.maxZoom * scale;
  return next;
}

function scaleForEntry(entry, baseSize, baseRadius, accessoryRadius) {
  if (!entry || entry.objClass !== 'accessory') return undefined;
  const base = Number.isFinite(baseSize) && baseSize > 0 ? baseSize : 1;
  const size = Number.isFinite(entry.size) ? entry.size : null;
  if (size === null) return undefined;
  const relativeScale = size / base;
  const radiusRatio = Number.isFinite(baseRadius) && Number.isFinite(accessoryRadius) && accessoryRadius > 0
    ? baseRadius / accessoryRadius
    : 1;
  const finalScale = relativeScale * radiusRatio;
  return Number.isFinite(finalScale) && finalScale > 0 ? finalScale : undefined;
}
