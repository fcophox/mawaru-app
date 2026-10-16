import * as THREE from 'three';

export const stage = document.getElementById('viewport');

// logarithmic depth: real-sized scenes (a watch next to an iMac) put the camera far away, and the
// screen/glass layers of the converted models are almost coplanar → avoid z-fighting at any distance
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;     // VSM gives the blurred, Rotato-like soft drop shadow
stage.prepend(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9e6ff');

export const hemi = new THREE.HemisphereLight(0xffffff, 0x8888aa, 0.25);
scene.add(hemi);
// Key light only casts the drop shadow; image-based lighting from the HDRI does the shading.
export const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(-7, 9, 16); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
key.shadow.bias = -0.0005; key.shadow.blurSamples = 24;
scene.add(key);

// Shadow catcher: an invisible backdrop behind the devices that only shows the shadow
export const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35, transparent: true });
export const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), shadowMat);
shadowPlane.position.z = -1.6; shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// Camera rig: same structure as Rotato's Keyframe (rigTransform = pivot rotation, povTransform = camera offset inside rig).
export const rig = new THREE.Group();
export const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
rig.add(camera);
scene.add(rig);
