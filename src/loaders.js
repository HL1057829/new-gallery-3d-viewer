/** @file Generic loader for scene models based on config. */
import {
  Box3,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sphere,
  Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const socketRegistry = [];
const modelRegistry = new Map();
let sharedMarker = null;

const isMobileDevice = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export async function loadModel(scene, options = {}) {
  const {
    modelPath,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = 1,
    addToScene = true,
    visible = true,
    name,
    targetRadius
  } = options;

  if (!modelPath) throw new Error('modelPath is required to load a model.');
  const label = name || modelPath;
  const resolvedModelPath = modelPath.startsWith('/')
    ? `${import.meta.env.BASE_URL}${modelPath.slice(1)}`
    : modelPath;

  const loader = new GLTFLoader();
  try {
    const glb = await loader.loadAsync(resolvedModelPath);
    const model = glb.scene;

    // iOS Safari has a relatively small practical WebGL memory budget. Keep
    // desktop assets untouched, but make mobile texture/geometry allocations
    // substantially smaller before the scene is rendered.
    if (isMobileDevice()) optimizeModelForMobile(model);

    model.position.set(position[0], position[1], position[2]);
    model.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (Array.isArray(scale)) model.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
    else model.scale.set(scale, scale, scale);
    model.visible = visible;
    if (addToScene && scene) scene.add(model);
    model.updateMatrixWorld(true);
    registerModel(label, resolvedModelPath, model, targetRadius);
    collectSockets(model, label, scene, options?.debug?.showSocketHelpers);
    console.info(`Loaded model "${label}" from ${modelPath}`);
    return model;
  } catch (error) {
    console.warn(`WARNING: Failed to load model "${label}" from ${modelPath}: ${error?.message || error}`);
    return null;
  }
}

function optimizeModelForMobile(model) {
  const MAX_TEXTURE_SIZE = 512;
  const seenTextures = new Set();
  const seenGeometries = new Set();

  model.traverse((node) => {
    if (!node?.isMesh) return;

    // These attributes are not required by the current mask materials and can
    // consume a surprising amount of GPU memory on mobile.
    const geometry = node.geometry;
    if (geometry && !seenGeometries.has(geometry)) {
      seenGeometries.add(geometry);
      geometry.deleteAttribute('tangent');
      geometry.deleteAttribute('uv1');
    }

    node.frustumCulled = true;
    node.castShadow = false;
    node.receiveShadow = false;

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (!value?.isTexture || seenTextures.has(value)) return;
        seenTextures.add(value);
        downscaleTexture(value, MAX_TEXTURE_SIZE);
      });
    });
  });
}

function downscaleTexture(texture, maxSize) {
  const image = texture.image;
  const width = image?.width || image?.videoWidth || 0;
  const height = image?.height || image?.videoHeight || 0;
  if (!width || !height || Math.max(width, height) <= maxSize) {
    if (image && !image.isCompressedTexture) {
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
    }
    return;
  }

  const scale = maxSize / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  if (typeof image.close === 'function') {
    try { image.close(); } catch (_) { /* ignore */ }
  }
}

export function getSocketRegistry() { return socketRegistry; }

export function getModelRegistry() {
  return Array.from(modelRegistry.entries()).map(([id, value]) => ({
    id, modelPath: value.modelPath, model: value.model, radius: value.radius, targetRadius: value.targetRadius
  }));
}

export function getModelMeta(id) {
  const entry = modelRegistry.get(id);
  if (!entry) return undefined;
  return { id, ...entry };
}

export function getSharedMarker(scene) {
  if (sharedMarker) {
    if (scene && !sharedMarker.parent) scene.add(sharedMarker);
    return sharedMarker;
  }
  const markerMeta = getModelMeta('marker');
  if (markerMeta?.model) {
    sharedMarker = markerMeta.model.clone(true);
    sharedMarker.visible = false;
    sharedMarker.userData.baseRadius = Number.isFinite(markerMeta.radius) && markerMeta.radius > 0 ? markerMeta.radius : 1;
    if (scene) scene.add(sharedMarker);
    return sharedMarker;
  }
  const fallbackRadius = 0.05;
  const height = fallbackRadius * 2;
  const geometry = new CylinderGeometry(fallbackRadius, fallbackRadius, height, 16, 1, false);
  const material = new MeshBasicMaterial({ color: new Color(0xff0000), transparent: true, opacity: 0.5 });
  const fallback = new Mesh(geometry, material);
  fallback.visible = false;
  fallback.userData.baseRadius = fallbackRadius;
  sharedMarker = fallback;
  if (scene) scene.add(sharedMarker);
  return sharedMarker;
}

function collectSockets(model, objectId, scene, showHelpers = false) {
  for (let i = socketRegistry.length - 1; i >= 0; i -= 1) {
    if (socketRegistry[i].objectId === objectId) socketRegistry.splice(i, 1);
  }
  const sockets = [];
  model.traverse((node) => {
    if (!node?.name || typeof node.name !== 'string' || !node.name.startsWith('socket_')) return;
    const role = node.name.includes('socket_p') ? 'parent' : node.name.includes('socket_c') ? 'child' : 'unknown';
    const position = new Vector3();
    const quaternion = new Quaternion();
    node.updateWorldMatrix?.(true, false);
    node.getWorldPosition(position);
    node.getWorldQuaternion(quaternion);
    const entry = { objectId, socketId: node.name, role, position: [position.x, position.y, position.z], quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w], threeJsNode: node };
    sockets.push(entry);
    if (showHelpers && scene && node.parent) attachSocketHelper(node, role, scene, objectId);
  });
  socketRegistry.push(...sockets);
  if (sockets.length > 0) {
    console.info(`Socket inventory for "${objectId}"`, {
      parents: sockets.filter((s) => s.role === 'parent').map((s) => s.socketId),
      children: sockets.filter((s) => s.role === 'child').map((s) => s.socketId),
      sockets: sockets.map(({ threeJsNode, ...rest }) => rest)
    });
  }
}

function registerModel(id, modelPath, model, targetRadius) {
  const box = new Box3().setFromObject(model);
  const sphere = new Sphere();
  box.getBoundingSphere(sphere);
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  const storedTarget = Number.isFinite(targetRadius) && targetRadius > 0 ? Number(targetRadius) : undefined;
  modelRegistry.set(id, { modelPath, model, radius, targetRadius: storedTarget });
}

function attachSocketHelper(node, role, scene, objectId) {
  const scale = node.parent ? node.parent.worldToLocal(new Vector3(1, 1, 1)).length() : 1;
  const markerSize = 0.02 * scale;
  const radius = markerSize * 2.25;
  const tube = markerSize * 1.125;
  const outerRadius = radius + tube;
  const height = tube * 2;
  const helper = new Group();
  helper.name = `helper_${objectId}_${node.name}`;
  helper.userData.outerRadius = outerRadius;
  helper.userData.targetRadius = Number.isFinite(getModelMeta('marker')?.targetRadius) ? getModelMeta('marker').targetRadius : undefined;
  helper.rotation.set(Math.PI / 2, 0, 0);
  helper.position.set(0, 0, 0);
  helper.visible = false;
  node.add(helper);
}
