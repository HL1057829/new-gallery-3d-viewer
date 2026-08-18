/** @file App entrypoint: create scene, load config, and add base model. */
import { Box3, MathUtils, Sphere, Vector3 } from 'three';
import { getModelMeta, loadModel } from './loaders.js';
import { createScene } from './scene.js';
import { loadObjectConfig } from './config.js';
import { createInteractionController } from './interaction.js';
import { initTray } from './tray.js';
import { initDrag } from './drag.js';

(async () => {
  const { base, accessories, debug } = await loadObjectConfig();
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

  // Mobile-safe test: show all seven tray items, but decode only ONE accessory
  // after the base has rendered. This identifies whether even a single
  // accessory GLB is enough to trigger the iPhone Safari crash.
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
    dragPlaneRadiusScale: base?.interaction?.dragPlaneRadiusScale
  });

  // Diagnostic only: after the dog has been visible for a few seconds, load
  // the first configured accessory and then stop. Do not load the other six.
  // This keeps the seven-item UI intact while isolating the accessory problem.
  void loadSingleAccessory(scene, accessories?.[0], baseSize, baseRadius, debug);

  let previousTime = 0;
  renderer.setAnimationLoop((time) => {
    const delta = (time - previousTime) / 1000;
    previousTime = time;
    interactions.update(delta);
    renderer.render(scene, camera);
  });
})();

async function loadSingleAccessory(scene, entry, baseSize, baseRadius, debug) {
  if (!entry) return;
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const model = await loadModel(scene, {
    ...entry,
    addToScene: false,
    visible: false,
    debug
  });
  if (!model) return;
  const meta = getModelMeta(entry.name);
  const accessoryRadius = Number.isFinite(meta?.radius) && meta.radius > 0 ? meta.radius : undefined;
  const scale = scaleForEntry(entry, baseSize, baseRadius, accessoryRadius);
  if (scale != null) model.scale.setScalar(scale);
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
