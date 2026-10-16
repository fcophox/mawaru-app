import * as THREE from 'three';
import { camera } from './scene.js';
import { MODELS } from './device-model.js';

// Camera offset (inside the rig) that fits the given objects in frame for a rig rotation q.
// The rig pivots at the origin and the camera looks down -Z, so the target centre c is
// reached with p = q⁻¹·c + (0, 0, distance); the distance is the smallest one that keeps
// all 8 bounding-box corners inside both the vertical and the horizontal field of view.
export function frameRig(objects, q, { margin = 1.12, aspect = camera.aspect, fov = camera.fov } = {}){
  const box = new THREE.Box3();
  for (const o of objects) box.union(new THREE.Box3().setFromObject(o));
  const c = box.getCenter(new THREE.Vector3());
  const qi = q.clone().invert();
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2)), tanH = tanV * aspect;
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const v = corner.sub(c).applyQuaternion(qi);               // corner relative to the centre, in camera axes
    dist = Math.max(dist, v.z + Math.abs(v.x) * margin / tanH, v.z + Math.abs(v.y) * margin / tanV);
  }
  return c.applyQuaternion(qi).add(new THREE.Vector3(0, 0, dist));
}

const rigRotation = (pitchDeg, yawDeg) => new THREE.Quaternion().setFromEuler(
  new THREE.Euler(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ'));

// Starter animation for a template: a slow turn that always shows the whole device
const TEMPLATE_SHOTS = {
  iphone:  { pitch: -6,  yaw: [-22, 22], duration: 4 },
  ipad:    { pitch: -6,  yaw: [-18, 18], duration: 4 },
  macbook: { pitch: -16, yaw: [-24, 24], duration: 4.5 },
};
export function templateKeyframes(type, objects){
  const shot = TEMPLATE_SHOTS[MODELS[type]?.category] ?? TEMPLATE_SHOTS.iphone;
  return {
    duration: shot.duration,
    keyframes: shot.yaw.map((yaw, i) => {
      const q = rigRotation(shot.pitch, yaw);
      return { t: i * shot.duration, q, p: frameRig(objects, q), ease: i ? 'easeInOut' : 'rotato', devices: {} };
    }),
  };
}
