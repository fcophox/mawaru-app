import * as THREE from 'three';
import { state, $ } from '../state.js';
import { scene, renderer, camera } from '../core/scene.js';
import { MODELS, buildDeviceMesh } from '../core/device-model.js';
import { ensureModel, localTypes } from '../core/local-models.js';
import { apply, poseOf, clonePose } from '../core/animation.js';
import { stopVideo, showVideoId, showImageId, syncVideoUI, refitScreen } from './media.js';
import { applyLook, syncLookUI } from './look.js';
import { gizmo, syncFields } from './transform.js';
import { renderTimeline } from './timeline.js';
import { markChanged } from './project.js';

// Devices: each one has its own model (iPhone / iPad / MacBook), transform, case colour and screen.
export const devices = [];
export const selectedDevice = () => devices[state.selDevice];

function attachMesh(dev, mesh){
  delete dev.setLidAngle;            // optional per model: don't keep the previous model's lid
  Object.assign(dev, mesh);
  for (const p of mesh.pickables) p.userData.dev = dev;
  mesh.setLidAngle?.(dev.lidAngle);
  scene.add(mesh.group);
}
function disposeMesh(dev){
  scene.remove(dev.group);
  for (const m of dev.materials) m.dispose();
}

export function createDevice({ type = 'iphone', position = [0, 0, 0], rotation = [0, 0, 0], scale, caseColor, lidAngle = 110 } = {}){
  const model = MODELS[type];
  caseColor ??= model.caseColor;
  const dev = { uid: 'd' + Math.random().toString(36).slice(2, 8), type, lidAngle, animated: false, base: null, caseColor,
    imageId: null, videoId: null, video: null, opts: { loop: true, audio: true } };
  attachMesh(dev, buildDeviceMesh(type, caseColor));
  dev.group.position.fromArray(position); dev.group.rotation.set(...rotation); dev.group.scale.setScalar(scale ?? model.defaultScale);
  devices.push(dev);
  return dev;
}

export function disposeDevice(dev){
  for (const k of state.keyframes) if (k.devices) delete k.devices[dev.uid];
  stopVideo(dev);
  disposeMesh(dev);
  devices.splice(devices.indexOf(dev), 1);
}

// Swap the model of a device in place: keeps its id, transform, keyframes and screen content.
// rescale=false when the caller sets the final scale itself (restoring a saved project).
export function setDeviceType(dev, type, { rescale = true } = {}){
  if (dev.type === type) return;
  // keep the size relative to each model's default (a 1.2× iPhone becomes a 1.2× iPad)
  const k = rescale ? MODELS[type].defaultScale / MODELS[dev.type].defaultScale : 1;
  const pose = { p: dev.group.position.clone(), q: dev.group.quaternion.clone(), s: dev.group.scale.x * k };
  disposeMesh(dev);
  dev.type = type;
  attachMesh(dev, buildDeviceMesh(type, dev.caseColor));
  dev.group.position.copy(pose.p); dev.group.quaternion.copy(pose.q); dev.group.scale.setScalar(pose.s);
  if (dev.base) dev.base.s *= k;
  for (const kf of state.keyframes) if (kf.devices?.[dev.uid]) kf.devices[dev.uid].s *= k;
  refitScreen(dev);
  applyLook();
  if (dev === selectedDevice()) gizmo.attach(dev.group);
}

export function setLidAngle(dev, deg){
  dev.lidAngle = deg;
  dev.setLidAngle?.(deg);
}

const deviceListEl = $('deviceList');
export function renderDeviceList(){
  deviceListEl.innerHTML = '';
  const counts = {};
  devices.forEach((d, i) => {
    const n = counts[d.type] = (counts[d.type] ?? 0) + 1;
    const b = document.createElement('button');
    b.className = 'devbtn' + (i === state.selDevice ? ' active' : '');
    b.innerHTML = `<span class="dot" style="background:${d.caseColor}"></span>${MODELS[d.type].label} ${n}<span class="muted">${d.video ? ' · vídeo' : d.imageId ? ' · imagen' : ''}${d.animated ? ' · animado' : ''}</span>`;
    b.onclick = () => selectDevice(i);
    deviceListEl.append(b);
  });
  $('delDevice').disabled = devices.length < 2;
}

function syncDeviceUI(){
  const dev = selectedDevice();
  fillModelSelect(dev.type);
  $('devModel').value = dev.type;
  $('lidRow').hidden = !dev.setLidAngle;
  $('lidAngle').value = dev.lidAngle;
  $('scale').value = dev.group.scale.x;
  $('devAnimate').checked = dev.animated;
}

export function selectDevice(i){
  state.selDevice = THREE.MathUtils.clamp(i, 0, devices.length - 1);
  gizmo.attach(selectedDevice().group);
  syncDeviceUI(); syncFields(); syncLookUI(); syncVideoUI(); renderDeviceList();
}

// Click a device in the viewport to select it; dropping a file on a device puts it on that screen
const picker = new THREE.Raycaster();
export function deviceAt(clientX, clientY){
  const r = renderer.domElement.getBoundingClientRect();
  picker.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = picker.intersectObjects(devices.flatMap(d => d.pickables), false)[0];
  return hit?.object.userData.dev ?? null;
}

function nextSlot(type){        // to the right of the right-most device, with a small gap
  const box = new THREE.Box3();
  for (const d of devices) box.union(new THREE.Box3().setFromObject(d.group));
  const probe = buildDeviceMesh(type, '#000');
  probe.group.scale.setScalar(MODELS[type].defaultScale);
  const half = new THREE.Box3().setFromObject(probe.group).getSize(new THREE.Vector3()).x / 2;
  for (const m of probe.materials) m.dispose();
  return box.max.x + half + 0.8;
}

// With models from the user's Rotato downloads the selector offers only those; the built-in
// models are listed only when there are none (or to show a generic device that is already in use).
export function fillModelSelect(currentType){
  const opt = (k, suffix = '') => `<option value="${k}">${MODELS[k].label}${suffix}</option>`;
  const sel = $('devModel');
  if (!localTypes.length) {
    sel.innerHTML = Object.keys(MODELS).filter(k => !MODELS[k].local).map(k => opt(k)).join('');
    return;
  }
  const current = currentType && !MODELS[currentType]?.local ? opt(currentType, ' (genérico)') : '';
  sel.innerHTML = current + localTypes.map(k => opt(k)).join('');
}

export function initDevices(){
  fillModelSelect();
  $('addDevice').onclick = () => {
    const src = selectedDevice();
    createDevice({ type: src.type, position: [nextSlot(src.type), 0, 0], caseColor: src.caseColor });
    applyLook(); selectDevice(devices.length - 1); markChanged();
  };
  $('dupDevice').onclick = () => {
    const src = selectedDevice(), g = src.group;
    const dev = createDevice({ type: src.type, position: [nextSlot(src.type), g.position.y, g.position.z], rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
      scale: g.scale.x, caseColor: src.caseColor, lidAngle: src.lidAngle });
    Object.assign(dev.opts, src.opts);
    if (src.videoId) showVideoId(dev, src.videoId); else showImageId(dev, src.imageId);
    applyLook(); selectDevice(devices.length - 1); markChanged();
  };
  $('delDevice').onclick = () => {
    if (devices.length < 2) return;
    disposeDevice(selectedDevice()); selectDevice(Math.min(state.selDevice, devices.length - 1)); markChanged();
  };
  $('devModel').onchange = async e => {
    const dev = selectedDevice(), type = e.target.value, sel = e.target;
    sel.disabled = true;
    try { await ensureModel(type); setDeviceType(dev, type); markChanged(); }
    catch (err) { console.error(err); }
    finally { sel.disabled = false; selectDevice(state.selDevice); }
  };
  $('lidAngle').oninput = e => setLidAngle(selectedDevice(), +e.target.value);
  $('lidAngle').addEventListener('change', () => markChanged());
  $('devAnimate').onchange = e => {
    const dev = selectedDevice();
    if (state.viewDirty) { state.viewDirty = false; apply(state.currentTime); }    // drop unsaved edits first
    if (e.target.checked) {          // start static: every keyframe gets the current pose
      dev.animated = true; dev.base = poseOf(dev.group);
      for (const k of state.keyframes) (k.devices ??= {})[dev.uid] = clonePose(dev.base);
    } else {                          // freeze at the pose shown now and forget its keyframes
      dev.animated = false; dev.base = null;
      for (const k of state.keyframes) if (k.devices) delete k.devices[dev.uid];
    }
    renderDeviceList(); renderTimeline(); markChanged();
  };
  $('scale').oninput = e => selectedDevice().group.scale.setScalar(+e.target.value);
  $('scale').addEventListener('change', () => markChanged());

  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = gizmo.axis === null ? { x: e.clientX, y: e.clientY } : null; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || gizmo.dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const dev = deviceAt(e.clientX, e.clientY);
    if (dev && dev !== selectedDevice()) selectDevice(devices.indexOf(dev));
  });
}
