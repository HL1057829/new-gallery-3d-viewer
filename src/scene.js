/** @file Scene factory that applies defaults from config. */
import * as THREE from 'three';

const defaultSceneConfig = {
  background: '#eeeeee',
  camera: { fov: 50, position: [0, 0, 5] },
  lights: {
    directional: { color: '#ffffff', intensity: 1.0, position: [3, 5, 2] },
    ambient: { color: '#ffffff', intensity: 0.4 }
  }
};

/**
 * Create a Three.js scene with values merged from config.
 * @param {Object} [sceneConfig]
 * @returns {{scene: import('three').Scene, camera: import('three').Camera, renderer: import('three').WebGLRenderer}}
 */
export function createScene(sceneConfig = {}) {
  const background = sceneConfig.background ?? defaultSceneConfig.background;
  const cameraConfig = {
    ...defaultSceneConfig.camera,
    ...(sceneConfig.camera || {})
  };
  const lightsConfig = {
    directional: {
      ...defaultSceneConfig.lights.directional,
      ...(sceneConfig.lights?.directional || {})
    },
    ambient: {
      ...defaultSceneConfig.lights.ambient,
      ...(sceneConfig.lights?.ambient || {})
    }
  };

  const canvas = document.getElementById('app');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(new THREE.Color(background), 0);

  const scene = new THREE.Scene();
  scene.background = null;

  const { width: initialWidth, height: initialHeight } = getViewportSize();
  const camera = new THREE.PerspectiveCamera(
    cameraConfig.fov,
    initialWidth / initialHeight,
    0.1,
    100
  );
  camera.position.set(
    cameraConfig.position?.[0] ?? 0,
    cameraConfig.position?.[1] ?? 0,
    cameraConfig.position?.[2] ?? 5
  );

  const directional = new THREE.DirectionalLight(
    lightsConfig.directional.color,
    lightsConfig.directional.intensity
  );
  directional.position.set(
    lightsConfig.directional.position?.[0] ?? 3,
    lightsConfig.directional.position?.[1] ?? 5,
    lightsConfig.directional.position?.[2] ?? 2
  );
  scene.add(directional);

  const ambient = new THREE.AmbientLight(
    lightsConfig.ambient.color,
    lightsConfig.ambient.intensity
  );
  scene.add(ambient);

  function onResize() {
    const { width, height } = getViewportSize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, true);
  }
  window.addEventListener('resize', onResize);
  onResize();

  return { scene, camera, renderer };
}

function getViewportSize() {
  if (window.visualViewport) {
    return { width: window.visualViewport.width, height: window.visualViewport.height };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}
