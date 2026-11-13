import * as THREE from 'three';
import { state, $ } from '../state.js';
import { renderer, rig, camera } from '../core/scene.js';
import { apply } from '../core/animation.js';
import { frameRig } from '../core/framing.js';
import { devices, deviceAt, selectDevice } from './devices.js';
import { screenOverflows, setScreenScroll } from './media.js';
import { gizmo, editViewEl } from './transform.js';
import { updateTimelineState } from './timeline.js';
import { markChanged } from './project.js';
import { viewEdited } from './scenes.js';

// ---- Camera framing with the mouse (sets the view that "+ Keyframe" captures) ----
// Drag: orbit the rig around the device · Shift/right-drag: pan · Wheel: dolly.
// Pointer presses that land on the device gizmo are left to TransformControls.
function markViewEdited(){
  if (!state.viewDirty) { apply(state.currentTime); state.viewDirty = true; }
}

// Keep the current camera angle and move it so every device is fully in frame
export function fitAll(){
  if (!devices.length) return;
  markViewEdited();
  state.playing = false;
  camera.quaternion.identity();
  camera.position.copy(frameRig(devices.map(d => d.group), rig.quaternion));
  updateTimelineState();
  viewEdited();
}

export function initCameraControls(){
  $('fitView').onclick = fitAll;
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, select') || e.metaKey || e.ctrlKey) return;
    if (e.key === 'f' || e.key === 'F') fitAll();
  });

  $('fov').oninput = e => { camera.fov = +e.target.value; camera.updateProjectionMatrix(); };
  $('fov').addEventListener('change', () => markChanged());

  const canvas = renderer.domElement;
  let orbit = null, wheelTimer, scrollTimer;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (gizmo.axis !== null || gizmo.dragging || editViewEl.checked) return;
    orbit = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
    canvas.setPointerCapture(e.pointerId);
    state.playing = false;
  });
  canvas.addEventListener('pointermove', e => {
    if (!orbit) return;
    const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
    orbit.x = e.clientX; orbit.y = e.clientY;
    markViewEdited();
    if (orbit.pan) {
      const s = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2 / canvas.clientHeight;
      camera.position.x -= dx * s; camera.position.y += dy * s;
    } else {
      rig.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.004));
      rig.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.004));
    }
    updateTimelineState();
  });
  canvas.addEventListener('pointerup', () => { if (orbit) viewEdited(); orbit = null; });
  canvas.addEventListener('wheel', e => {
    // Alt/Option + wheel over a device scrolls the design on its screen (that device only)
    const dev = e.altKey ? deviceAt(e.clientX, e.clientY) : null;
    if (dev && screenOverflows(dev)) {
      e.preventDefault();
      if (dev !== devices[state.selDevice]) selectDevice(devices.indexOf(dev));
      setScreenScroll(dev, dev.screenScroll + e.deltaY * 0.0012);
      clearTimeout(scrollTimer); scrollTimer = setTimeout(() => markChanged(), 250);
      return;
    }
    if (editViewEl.checked) return;
    e.preventDefault();
    markViewEdited();
    state.playing = false;
    camera.position.z = THREE.MathUtils.clamp(camera.position.z * Math.exp(e.deltaY * 0.001), 3, 80);
    updateTimelineState();
    clearTimeout(wheelTimer); wheelTimer = setTimeout(viewEdited, 250);   // once the wheel stops
  }, { passive: false });
}
