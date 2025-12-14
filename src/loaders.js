/** @file Generic loader for scene models based on config. */
import {
  Box3,
  Color,
  TorusGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sphere,
  Vector3
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const socketRegistry = [];
const modelRegistry = new Map();

/**
 * Load a model into the scene using a config-driven path and transforms.
 * @param {import('three').Scene} scene
 * @param {Object} options
 * @param {string} options.modelPath - Path to the GLB asset.
 * @param {number[]} [options.position=[0,0,0]] - XYZ position.
 * @param {number[]} [options.rotation=[0,0,0]] - Euler rotation in radians.
 * @param {number|number[]} [options.scale=1] - Uniform or per-axis scale.
 * @param {boolean} [options.addToScene=true] - Whether to add the model to the scene.
 * @param {boolean} [options.visible=true] - Initial visibility for the model.
 * @param {string} [options.name] - Human-friendly name for logging.
 * @returns {Promise<import('three').Object3D | null>}
 */
export async function loadModel(scene, options = {}) {
  const {
    modelPath,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = 1,
    addToScene = true,
    visible = true,
    name
  } = options;

  if (!modelPath) {
    throw new Error('modelPath is required to load a model.');
  }

  const label = name || modelPath;

  const assetOk = await preflightAsset(modelPath, label, addToScene);
  if (!assetOk) {
    return null;
  }

  const loader = new GLTFLoader();
  try {
    const glb = await loader.loadAsync(modelPath);
    const model = glb.scene;

    model.position.set(position[0], position[1], position[2]);
    model.rotation.set(rotation[0], rotation[1], rotation[2]);

    if (Array.isArray(scale)) {
      model.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
    } else {
      model.scale.set(scale, scale, scale);
    }

    model.visible = visible;

    if (addToScene && scene) {
      scene.add(model);
    }
    model.updateMatrixWorld(true);
    registerModel(label, modelPath, model);
    collectSockets(model, label, scene, options?.debug?.showSocketHelpers);
    console.info(`Loaded model "${label}" from ${modelPath}`);
    return model;
  } catch (error) {
    console.warn(`WARNING: Failed to load model "${label}" from ${modelPath}: ${error?.message || error}`);
    return null;
  }
}

/**
 * Get the current socket registry.
 * @returns {{objectId: string, socketId: string, threeJsNode: import('three').Object3D}[]}
 */
export function getSocketRegistry() {
  return socketRegistry;
}

/**
 * Get registry of successfully loaded models.
 * @returns {{id: string, modelPath: string, model: import('three').Object3D}[]}
 */
export function getModelRegistry() {
  return Array.from(modelRegistry.entries()).map(([id, value]) => ({
    id,
    modelPath: value.modelPath,
    model: value.model,
    radius: value.radius
  }));
}

/**
 * Get a single model meta entry.
 * @param {string} id
 * @returns {{id: string, modelPath: string, model: import('three').Object3D, radius: number} | undefined}
 */
export function getModelMeta(id) {
  const entry = modelRegistry.get(id);
  if (!entry) return undefined;
  return { id, ...entry };
}

async function preflightAsset(modelPath, label, addToScene) {
  try {
    const response = await fetch(modelPath, { method: 'HEAD' });
    if (!response.ok) {
      console.warn(
        `WARNING: Model "${label}" not found at ${modelPath} (HTTP ${response.status} ${response.statusText})`
      );
      return false;
    }

    const contentType = response.headers.get('content-type') || '';
    const looksLikeGlb =
      contentType.toLowerCase().includes('model/gltf-binary') ||
      contentType.toLowerCase().includes('application/octet-stream');
    if (!looksLikeGlb) {
      console.warn(
        `WARNING: Model "${label}" at ${modelPath} has unexpected content-type "${contentType}" (expected GLB)`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `WARNING: Could not verify model "${label}" at ${modelPath}: ${error?.message || error}`
    );
    return false;
  }
}

function collectSockets(model, objectId, scene, showHelpers = false) {
  // Remove stale entries for this objectId before adding new ones.
  for (let i = socketRegistry.length - 1; i >= 0; i -= 1) {
    if (socketRegistry[i].objectId === objectId) {
      socketRegistry.splice(i, 1);
    }
  }

  const sockets = [];
  model.traverse((node) => {
    if (!node?.name || typeof node.name !== 'string') return;
    if (!node.name.startsWith('socket_')) return;
    const role = node.name.includes('socket_p') ? 'parent' : node.name.includes('socket_c') ? 'child' : 'unknown';
    const position = new Vector3();
    const quaternion = new Quaternion();
    node.updateWorldMatrix?.(true, false);
    node.getWorldPosition(position);
    node.getWorldQuaternion(quaternion);
    const entry = {
      objectId,
      socketId: node.name,
      role,
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      threeJsNode: node
    };
    sockets.push(entry);

    if (showHelpers && scene && node.parent) {
      attachSocketHelper(node, role, scene, objectId);
    }
  });

  socketRegistry.push(...sockets);
  if (sockets.length > 0) {
    const parents = sockets.filter((s) => s.role === 'parent').map((s) => s.socketId);
    const children = sockets.filter((s) => s.role === 'child').map((s) => s.socketId);
    console.info(`Socket inventory for "${objectId}"`, {
      parents,
      children,
      sockets: sockets.map(({ threeJsNode, ...rest }) => rest)
    });
  }
}

function registerModel(id, modelPath, model) {
  const box = new Box3().setFromObject(model);
  const sphere = new Sphere();
  box.getBoundingSphere(sphere);
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

  modelRegistry.set(id, { modelPath, model, radius });
}

function attachSocketHelper(node, role, scene, objectId) {
  const color = new Color(0xff0000);
  const scale = node.parent ? node.parent.worldToLocal(new Vector3(1, 1, 1)).length() : 1;
  const markerSize = 0.02 * scale;
  const radius = markerSize * 3; // 25% smaller diameter than previous
  const tube = markerSize * 1.5; // 200% thicker than previous
  const geometry = new TorusGeometry(radius, tube, 8, 24);
  const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
  const helper = new Mesh(geometry, material);
  helper.name = `helper_${objectId}_${node.name}`;
  // Keep prior orientation that visually matched sockets, and sink it slightly so it sits embedded.
  helper.rotation.set(0, 0, Math.PI / 2);
  helper.position.set(0, 0, 0);
  helper.visible = false;
  node.add(helper);
}
