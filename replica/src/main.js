import './styles.css';
import { state, $ } from './state.js';
import { renderer, scene, rig, camera } from './core/scene.js';
import { presetNames, loadPresets } from './core/presets.js';
import { templateKeyframes } from './core/framing.js';
import * as THREE from 'three';
import { apply } from './core/animation.js';
import { frameRig } from './core/framing.js';
import { devices, createDevice, selectDevice, selectedDevice, initDevices } from './ui/devices.js';
import { initLook, updateShadowCatcher } from './ui/look.js';
import { initFrame } from './ui/frame.js';
import { initTransform, syncFields, editViewEl } from './ui/transform.js';
import { initCameraControls } from './ui/camera-controls.js';
import { initTimeline, setPreset, seekTo, updatePlayhead, renderTimeline } from './ui/timeline.js';
import { initMedia, syncVideoPreview } from './ui/media.js';
import { initProject, startProject, newProject, snapshot, loadProject, projectFile, historyInfo } from './ui/project.js';
import { initSplash, showSplash } from './ui/splash.js';
import { registerLocalModels } from './core/local-models.js';
import { initExport, exportVideo, exportPNG, exportPNGSequence } from './export/exporter.js';

// Boot order matters: modules only declare things on import; DOM wiring happens here.
await registerLocalModels();       // models from local-models/ (only on this machine, if converted)
await loadPresets();               // Rotato's camera presets, if extracted locally (npm run presets)
createDevice();
initLook();
initFrame();
initTransform();
initCameraControls();
initTimeline();
initMedia();
initDevices();
initExport();
initProject();
initSplash();
if (presetNames.length) setPreset(presetNames[0]);
else {                             // no local presets: start from the template shot
  const shot = templateKeyframes('iphone', devices.map(d => d.group));
  Object.assign(state, { keyframes: shot.keyframes, duration: shot.duration, selected: 1 });
  renderTimeline();
}
selectDevice(0);
startProject();
showSplash();

// Live preview loop: advances the timeline clock and renders the shot
const IDENTITY = new THREE.Quaternion();
let lastNow = performance.now();
renderer.setAnimationLoop(now => {
  const dt = (now - lastNow) / 1000; lastNow = now;
  if (state.exporting) return;
  if (state.playing) {
    state.currentTime += dt;
    if (state.currentTime > state.duration) {
      if ($('loop').checked) state.currentTime = 0; else { state.currentTime = state.duration; state.playing = false; }
    }
  }
  if (!state.viewDirty) apply(state.currentTime);
  if (editViewEl.checked) {          // neutral front camera that frames the selected device, gizmo centred
    rig.quaternion.identity(); camera.quaternion.identity();
    camera.position.copy(frameRig([selectedDevice().group], IDENTITY, { margin: 1.3 }));
  }
  if (selectedDevice()?.animated && !state.viewDirty) syncFields();
  updateShadowCatcher();
  syncVideoPreview();
  updatePlayhead();
  renderer.render(scene, camera);
});

// Console / automation hooks (used by the browser tests)
Object.assign(window, {
  seek: s => { state.playing = false; seekTo(s); },
  setPreset, newProject, showSplash,
  timeline: { get keyframes(){ return state.keyframes; }, get duration(){ return state.duration; }, get currentTime(){ return state.currentTime; } },
  project: { snapshot, loadProject, projectFile, devices, get screenVideo(){ return selectedDevice().video?.el; }, get history(){ return historyInfo(); } },
  exportVideo, exportPNG, exportPNGSequence,
});
