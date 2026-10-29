import { state } from '../state.js';
import { rig, camera } from './scene.js';
import { easeFn } from './easing.js';
import { devices } from '../ui/devices.js';

// Device poses, stored per keyframe
export const poseOf = g => ({ p: g.position.clone(), q: g.quaternion.clone(), s: g.scale.x });
export const clonePose = x => ({ p: x.p.clone(), q: x.q.clone(), s: x.s });

// Segment around time t: keyframes a → b and the eased progress k (keyframes sorted by t)
export function segmentAt(time){
  const kfs = state.keyframes, n = kfs.length;
  let i = 0;
  while (i < n - 1 && kfs[i + 1].t <= time) i++;
  const a = kfs[i], b = kfs[i + 1];
  if (!b || time <= a.t) return { a, b: a, k: 0 };
  const u = (time - a.t) / (b.t - a.t);
  return { a, b, k: b.ease === 'cut' ? (u < 1 ? 0 : 1) : easeFn(b)(u) };
}

export function cameraAt(time){
  const { a, b, k } = segmentAt(time);
  return { q: a.q.clone().slerp(b.q, k), p: a.p.clone().lerp(b.p, k) };
}

// Pose the camera rig and every animated device at time t
export function apply(time){
  camera.quaternion.identity();   // pov looks straight down -Z inside the rig (undo edit-view lookAt)
  const { a, b, k } = segmentAt(time);
  rig.quaternion.copy(a.q).slerp(b.q, k);
  camera.position.lerpVectors(a.p, b.p, k);
  for (const dev of devices) {
    if (!dev.animated) continue;
    const pa = a.devices?.[dev.uid] ?? dev.base, pb = b.devices?.[dev.uid] ?? dev.base, g = dev.group;
    g.position.lerpVectors(pa.p, pb.p, k);
    g.quaternion.copy(pa.q).slerp(pb.q, k);
    g.scale.setScalar(pa.s + (pb.s - pa.s) * k);
  }
}
