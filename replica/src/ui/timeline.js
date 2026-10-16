import * as THREE from 'three';
import { state, $ } from '../state.js';
import { rig, camera } from '../core/scene.js';
import { EASES } from '../core/easing.js';
import { presetNames, presetKeyframes } from '../core/presets.js';
import { apply, cameraAt, poseOf, clonePose } from '../core/animation.js';
import { devices } from './devices.js';
import { editViewEl } from './transform.js';
import { markChanged } from './project.js';

// ---- Keyframe timeline (Rotato web: camera keytimes with an easing per segment) ----
const track = $('track'), ruler = $('ruler');
export const playhead = $('playhead');
const playBtn = $('play'), tcur = $('tcur'), tdur = $('tdur');
const addBtn = $('addKf'), delBtn = $('delKf');
const easeSel = $('ease'), curvePath = $('curvePath');
const viewHint = $('viewHint');

export const xOf = t => (t / state.duration) * track.clientWidth;
const tOf = clientX => THREE.MathUtils.clamp((clientX - track.getBoundingClientRect().left) / track.clientWidth, 0, 1) * state.duration;
const kfAt = t => state.keyframes.findIndex(k => Math.abs(k.t - t) < 0.02);

export function seekTo(t){ state.currentTime = THREE.MathUtils.clamp(t, 0, state.duration); state.viewDirty = false; }

// Rotato's presets orbit the device at the origin and were framed for a phone (~10.5 units tall
// at default scale). Devices are now real-sized, so the camera offsets scale with the main device
// (the one closest to the origin) to keep it whole in the shot.
const PRESET_REFERENCE_SIZE = 6.2 * 1.7;
function presetScale(){
  if (!devices.length) return 1;
  const main = devices.reduce((a, b) => (b.group.position.lengthSq() < a.group.position.lengthSq() ? b : a));
  const s = new THREE.Box3().setFromObject(main.group).getSize(new THREE.Vector3());
  return THREE.MathUtils.clamp(Math.max(s.x, s.y) / PRESET_REFERENCE_SIZE, 0.3, 8);
}

export function setPreset(name){
  const { keyframes, duration } = presetKeyframes(name);
  const k = presetScale();
  for (const kf of keyframes) kf.p.multiplyScalar(k);
  state.keyframes = keyframes; state.duration = duration;
  for (const d of devices) if (d.animated) for (const k of keyframes) (k.devices ??= {})[d.uid] = clonePose(d.base);
  Object.assign(state, { currentTime: 0, playing: true, viewDirty: false, selected: Math.min(1, keyframes.length - 1) });
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.name === name));
  renderTimeline();
  markChanged();
}

export function renderTimeline(){
  const { keyframes, duration, selected } = state;
  track.querySelectorAll('.tseg,.kf,.hold').forEach(el => el.remove());
  ruler.innerHTML = '';
  const step = duration > 12 ? 2 : duration > 5 ? 1 : 0.5;
  for (let t = 0; t <= duration + 1e-6; t += step) {
    const x = xOf(t);
    ruler.insertAdjacentHTML('beforeend', `<span style="left:${x}px">${+t.toFixed(1)}s</span><i style="left:${x}px"></i>`);
  }
  keyframes.forEach((kf, i) => {
    if (i > 0) {
      const a = keyframes[i - 1], seg = document.createElement('div');
      seg.className = 'tseg' + (kf.ease === 'cut' ? ' cut' : '') + (i === selected ? ' sel' : '');
      seg.style.left = (xOf(a.t) + 8) + 'px'; seg.style.width = Math.max(0, xOf(kf.t) - xOf(a.t) - 16) + 'px';
      seg.textContent = kf.ease === 'custom' ? 'preset' : EASES[kf.ease].label;
      seg.dataset.i = i;
      track.append(seg);
    }
    const d = document.createElement('div');
    d.className = 'kf' + (i === 0 ? ' first' : '') + (i === selected ? ' sel' : '');
    const nDev = Object.keys(kf.devices ?? {}).length;
    d.style.left = xOf(kf.t) + 'px'; d.dataset.i = i; d.title = `${kf.t.toFixed(2)} s` + (nDev ? ` · ${nDev} dispositivo${nDev > 1 ? 's' : ''}` : '');
    track.append(d);
  });
  const last = keyframes[keyframes.length - 1];
  if (last.t < duration - 1e-3) {
    const hold = document.createElement('div');
    hold.className = 'hold'; hold.style.left = (xOf(last.t) + 8) + 'px'; hold.style.width = Math.max(0, xOf(duration) - xOf(last.t) - 8) + 'px';
    hold.title = 'Mantiene la última vista';
    track.append(hold);
  }
  tdur.value = duration.toFixed(2); tdur.min = last.t.toFixed(2);
  // easing controls act on the segment that ends at the selected keyframe
  easeSel.innerHTML = Object.entries(EASES).map(([k, e]) => `<option value="${k}">${e.label}</option>`).join('')
    + (keyframes[selected]?.ease === 'custom' ? '<option value="custom">Preset (bezier)</option>' : '');
  easeSel.disabled = selected < 1;
  easeSel.value = selected >= 1 ? keyframes[selected].ease : 'mawaru';
  drawCurve();
  updateTimelineState();
}

function drawCurve(){
  const kf = state.keyframes[state.selected];
  if (!kf || state.selected < 1) { curvePath.setAttribute('d', ''); return; }
  if (kf.ease === 'cut') { curvePath.setAttribute('d', 'M0 30 H40 V0 H44'); return; }
  const [x1, y1, x2, y2] = kf.ease === 'custom' ? kf.bez : EASES[kf.ease].v;
  curvePath.setAttribute('d', `M0 30 C${x1 * 44} ${30 - y1 * 30} ${x2 * 44} ${30 - y2 * 30} 44 0`);
}

let hereKf = -2;
export function updateTimelineState(){
  const i = kfAt(state.currentTime); hereKf = i;
  addBtn.textContent = i >= 0 ? 'Actualizar keyframe' : '+ Keyframe';
  delBtn.disabled = state.keyframes.length < 2;
  track.querySelectorAll('.kf').forEach(el => el.classList.toggle('here', +el.dataset.i === i));
  viewHint.textContent = editViewEl.checked
    ? (state.viewDirty ? 'Vista de edición · dispositivo modificado: pulsa "+ Keyframe" (K)' : 'Vista de edición: anima dispositivos con + Keyframe; desactívala (V) para encuadrar la cámara')
    : state.viewDirty ? (i >= 0 ? 'Vista modificada · pulsa "Actualizar keyframe" (K)' : 'Vista modificada · pulsa "+ Keyframe" (K)')
    : 'Arrastra para orbitar · Mayús/clic derecho: desplazar · rueda: zoom';
}

// called every animation frame
export function updatePlayhead(time = state.currentTime){
  if (kfAt(state.currentTime) !== hereKf) updateTimelineState();
  playhead.style.left = xOf(time) + 'px';
  tcur.textContent = state.currentTime.toFixed(2);
  playBtn.textContent = state.playing ? '❚❚' : '▶';
}

function select(i){ state.selected = i; renderTimeline(); }

export function addKeyframe(){
  if (!state.viewDirty) apply(state.currentTime);
  // in the edit view the camera is not the shot's camera: keep the interpolated one
  const cam = editViewEl.checked ? cameraAt(state.currentTime) : { q: rig.quaternion.clone(), p: camera.position.clone() };
  const devPoses = Object.fromEntries(devices.filter(d => d.animated).map(d => [d.uid, poseOf(d.group)]));
  const kfs = state.keyframes;
  let i = kfAt(state.currentTime);
  if (i >= 0) Object.assign(kfs[i], cam, { devices: { ...kfs[i].devices, ...devPoses } });
  else {
    kfs.push({ t: state.currentTime, ease: 'mawaru', ...cam, devices: devPoses });
    kfs.sort((a, b) => a.t - b.t);
    i = kfs.findIndex(k => k.t === state.currentTime);
  }
  state.viewDirty = false; select(i);
  markChanged();
}

export function deleteKeyframe(){
  const kfs = state.keyframes;
  if (kfs.length < 2) return;
  kfs.splice(state.selected, 1);
  kfs[0].t = 0;                       // the first view always starts the clip
  state.selected = Math.min(state.selected, kfs.length - 1);
  state.viewDirty = false; renderTimeline();
  markChanged();
}

export function initTimeline(){
  const list = $('presets');
  if (!presetNames.length) $('presetsHint').innerHTML = 'Sin presets de cámara importados. Ejecuta <code>npm run presets</code> para añadirlos (solo en local).';
  for (const name of presetNames) {
    const b = document.createElement('button');
    b.className = 'preset'; b.dataset.name = name;
    b.textContent = name.replace(/^\d+-/, '').replace(/-/g, ' ');
    b.onclick = () => setPreset(name);
    list.append(b);
  }

  // Track interaction: drag keyframes to move keytimes, click segments to pick them, drag elsewhere to scrub
  track.addEventListener('pointerdown', e => {
    state.playing = false;
    const kfs = state.keyframes;
    const kfEl = e.target.closest('.kf'), segEl = e.target.closest('.tseg');
    track.setPointerCapture(e.pointerId);
    if (kfEl) {
      const i = +kfEl.dataset.i; select(i); seekTo(kfs[i].t);
      if (i === 0) return;
      const grab = tOf(e.clientX) - kfs[i].t;
      const move = ev => {
        const prev = kfs[i - 1].t + 0.05, next = kfs[i + 1] ? kfs[i + 1].t - 0.05 : Infinity;
        let t = THREE.MathUtils.clamp(Math.round((tOf(ev.clientX) - grab) * 100) / 100, prev, next);
        if (!kfs[i + 1] && t > state.duration) t = state.duration;  // extend the clip with the duration field
        kfs[i].t = t; seekTo(t); renderTimeline();
      };
      const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); markChanged(); };
      track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
      return;
    }
    if (segEl) select(+segEl.dataset.i);
    seekTo(tOf(e.clientX));
    const move = ev => seekTo(tOf(ev.clientX));
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', move); track.addEventListener('pointerup', up);
  });

  easeSel.onchange = () => { if (state.selected >= 1) { state.keyframes[state.selected].ease = easeSel.value; renderTimeline(); markChanged(); } };
  tdur.onchange = () => {
    const last = state.keyframes[state.keyframes.length - 1].t;
    state.duration = Math.max(last, 0.1, parseFloat(tdur.value) || state.duration);
    state.currentTime = Math.min(state.currentTime, state.duration); renderTimeline();
    markChanged();
  };
  playBtn.onclick = () => {
    if (!state.playing && state.currentTime >= state.duration) state.currentTime = 0;
    state.playing = !state.playing; state.viewDirty = false;
  };
  addBtn.onclick = addKeyframe;
  delBtn.onclick = deleteKeyframe;
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, select')) return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.metaKey || e.ctrlKey) return;
    if (e.key === 'k' || e.key === 'K') addKeyframe();
    if (e.key === 'Delete' || e.key === 'Backspace') deleteKeyframe();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const kfs = state.keyframes, t = state.currentTime;
      const target = e.key === 'ArrowRight' ? kfs.find(k => k.t > t + 1e-3) : [...kfs].reverse().find(k => k.t < t - 1e-3);
      if (target) { state.playing = false; seekTo(target.t); select(kfs.indexOf(target)); }
    }
  });
  new ResizeObserver(() => renderTimeline()).observe(track);
}
