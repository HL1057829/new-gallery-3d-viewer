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

  // Diagnostic iPhone build: load ONLY the base model. No accessories,
  // alternate bases, or markers are decoded. This isolates whether Safari's
  // crash is caused by the base GLB/WebGL renderer or by additional assets.
  initTray({ accessories: [] });

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
    accessories: [],
    baseSize,
    baseRadius,
    baseSizeRank,
    baseModel: model,
    baseName: base.name,
    visibilityIntervalMs: base?.interaction?.socketVisibilityIntervalMs,
    dragOpacity: base?.interaction?.dragOpacity,
    dragPlaneRadiusScale: base?.interaction?.dragPlaneRadiusScale
  });

  let previousTime = 0;
  renderer.setAnimationLoop((time) => {
    const delta = (time - previousTime) / 1000;
    previousTime = time;
    interactions.update(delta);
    renderer.render(scene, camera);
  });
})();

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
