import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { state, $ } from '../state.js';
import { scene, renderer, camera, rig } from '../core/scene.js';
import { apply } from '../core/animation.js';
import { frameRig } from '../core/framing.js';
import { selectedDevice } from './devices.js';
import { updateTimelineState } from './timeline.js';
import { markChanged } from './project.js';

// ---- Device transform gizmo ----
// Per-axis arrows move the device along X/Y/Z only; rings rotate around a single axis;
// the inner trackball rotates freely.
export const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.9);
export const gizmoHelper = gizmo.getHelper();   // r169+: the visual part is a separate Object3D
scene.add(gizmoHelper);

export const editViewEl = $('editView');
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;
const fields = { px: ['position', 'x', 1], py: ['position', 'y', 1], pz: ['position', 'z', 1], rx: ['rotation', 'x', 0], ry: ['rotation', 'y', 0], rz: ['rotation', 'z', 0] };

export function syncFields(){
  const g = selectedDevice()?.group;
  if (!g) return;
  for (const [id, [prop, axis, isPos]] of Object.entries(fields)) {
    const el = $(id);
    if (document.activeElement === el) continue;
    const v = g[prop][axis];
    el.value = isPos ? v.toFixed(2) : deg(v).toFixed(1);
  }
}

// Animated devices are driven by the timeline: an edit holds the current frame until "+ Keyframe"
export function beginDeviceEdit(){
  state.playing = false;
  if (selectedDevice()?.animated && !state.viewDirty) { apply(state.currentTime); state.viewDirty = true; updateTimelineState(); }
}

// "Centrar vista": undo moves/turns of the selected device and look at it head-on, centred on screen.
// The camera change is a view edit like orbiting: "+ Keyframe" (K) keeps it in the timeline.
const FRONT = new THREE.Quaternion();
export function centerView(){
  if (!selectedDevice()) return;
  if (!state.viewDirty) { apply(state.currentTime); state.viewDirty = true; }
  state.playing = false;
  const g = selectedDevice().group;
  g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
  rig.quaternion.identity(); camera.quaternion.identity();
  camera.position.copy(frameRig([g], FRONT, { margin: 1.25 }));
  syncFields(); updateTimelineState(); markChanged();
}

function setMode(mode){
  gizmo.setMode(mode);
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

export function initTransform(){
  for (const [id, [prop, axis, isPos]] of Object.entries(fields)) {
    $(id).addEventListener('input', e => {
      const v = parseFloat(e.target.value); if (Number.isNaN(v)) return;
      if (!selectedDevice()) return;
      beginDeviceEdit();
      selectedDevice().group[prop][axis] = isPos ? v : rad(v);
    });
    $(id).addEventListener('change', () => markChanged());
  }
  gizmo.addEventListener('objectChange', syncFields);
  gizmo.addEventListener('dragging-changed', e => { if (e.value) beginDeviceEdit(); else { markChanged(); updateTimelineState(); } });

  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('resetDevice').onclick = () => {
    if (!selectedDevice()) return;
    beginDeviceEdit();
    const g = selectedDevice().group; g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
    syncFields(); markChanged();
  };
  $('centerView').onclick = centerView;
  editViewEl.addEventListener('change', () => updateTimelineState());
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, select')) return;
    if (e.key === 'w' || e.key === 'W') setMode('translate');
    if (e.key === 'e' || e.key === 'E') setMode('rotate');
    if (e.key === 'v' || e.key === 'V') { editViewEl.checked = !editViewEl.checked; updateTimelineState(); }
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey) centerView();
    if (e.key === 'Shift') { gizmo.setTranslationSnap(0.25); gizmo.setRotationSnap(rad(15)); }
  });
  addEventListener('keyup', e => { if (e.key === 'Shift') { gizmo.setTranslationSnap(null); gizmo.setRotationSnap(null); } });
}
