import * as THREE from 'three';
import { easeKey } from './easing.js';

// Camera presets are not in the repository: `npm run presets` imports them locally into
// local-models/presets.json (git-ignored). Without them the editor works with its templates.
let PRESETS = {};
export let presetNames = [];

export async function loadPresets(){
  try {
    const r = await fetch('/local-models/presets.json', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) PRESETS = await r.json();
  } catch { /* no local presets */ }
  presetNames = Object.keys(PRESETS);
  return presetNames.length;
}

export function presetKeyframes(name){
  let t = 0;
  const keyframes = PRESETS[name].map((kf, i) => {
    if (i > 0) t += kf.dur;          // decoded presets store per-segment durations
    const q = new THREE.Quaternion();
    new THREE.Matrix4().fromArray(kf.rig).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const ease = kf.jump ? 'cut' : (easeKey(kf.ease) ?? 'custom');
    return { t, q, p: new THREE.Vector3(...kf.pos), ease, bez: kf.ease };
  });
  return { keyframes, duration: Math.max(t, 0.5) };
}
