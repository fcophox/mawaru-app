import * as THREE from 'three';
import { state, $ } from '../state.js';
import { scene, camera } from '../core/scene.js';
import { EASES } from '../core/easing.js';
import { poseOf } from '../core/animation.js';
import { MODELS } from '../core/device-model.js';
import { templateKeyframes } from '../core/framing.js';
import { isLocal, ensureModel, modelReady } from '../core/local-models.js';
import { devices, createDevice, disposeDevice, selectDevice, setDeviceType, setLidAngle } from './devices.js';
import { images, videos, showImageId, showVideoId, stopVideo, blobToDataURL, dataURLToBlob } from './media.js';
import { look, LOOK_DEFAULTS, ENVIRONMENTS, applyLook, applyEnvironment } from './look.js';
import { bg, BG_DEFAULTS, FORMATS, applyBackground, setFormat } from './frame.js';
import { renderTimeline } from './timeline.js';

// ---- Project: save / open (.json), autosave, undo / redo ----
// One snapshot format feeds the JSON file, the local autosave and the undo history.
// Images and videos are kept out of history snapshots (referenced by id) so undo stays cheap.
export const projName = $('projName'), projStatus = $('projStatus');
const MAX_EMBED_VIDEO = 40e6;
const AUTOSAVE_KEY = 'mawaru:autosave';
const APP_ID = 'mawaru', LEGACY_APP_IDS = ['rotato-replica'];   // older project files keep opening
const round = (v, d = 5) => +v.toFixed(d);
let projectReady = false;

export function snapshot(){
  return {
    app: APP_ID, version: 4, name: projName.value,
    timeline: {
      duration: round(state.duration),
      keyframes: state.keyframes.map(k => ({ t: round(k.t, 3), rig: k.q.toArray().map(v => round(v)), camera: k.p.toArray().map(v => round(v)),
        ...(k.devices && Object.keys(k.devices).length ? { devices: Object.fromEntries(Object.entries(k.devices).map(([uid, x]) =>
          [uid, { position: x.p.toArray().map(v => round(v)), quaternion: x.q.toArray().map(v => round(v)), scale: round(x.s, 3) }])) } : {}),
        ease: k.ease, ...(k.ease === 'custom' ? { bezier: k.bez } : {}) })),
    },
    devices: devices.map(d => {
      // animated devices are saved with their base pose; the timeline holds the rest
      const p = d.animated ? d.base.p : d.group.position, q = d.animated ? d.base.q : d.group.quaternion, s = d.animated ? d.base.s : d.group.scale.x;
      const e = new THREE.Euler().setFromQuaternion(q);
      return { uid: d.uid, type: d.type, animated: d.animated, ...(d.setLidAngle ? { lidAngle: d.lidAngle } : {}),
        position: p.toArray().map(v => round(v)),
        rotation: [e.x, e.y, e.z].map(v => round(v)),
        scale: round(s, 3), caseColor: d.caseColor,
        screenImage: d.imageId, screenVideo: d.videoId, video: { ...d.opts } };
    }),
    selectedDevice: state.selDevice,
    camera: { fov: camera.fov },
    format: state.format,
    background: { ...bg },
    look: { ...look },
  };
}

// v1/v2 files had a single device at the top level
function devicesOf(s){
  if (Array.isArray(s.devices)) return s.devices;          // v3+: may be empty
  return [{ ...(s.device ?? {}), caseColor: s.look?.caseColor ?? '#ecebe7', screenImage: s.screenImage ?? null, screenVideo: s.screenVideo ?? null, video: s.video }];
}

function restore(s){
  projName.value = s.name ?? 'Sin título';
  const keyframes = s.timeline.keyframes.map(k => ({ t: k.t, q: new THREE.Quaternion().fromArray(k.rig), p: new THREE.Vector3().fromArray(k.camera),
    devices: Object.fromEntries(Object.entries(k.devices ?? {}).map(([uid, x]) =>
      [uid, { p: new THREE.Vector3().fromArray(x.position), q: new THREE.Quaternion().fromArray(x.quaternion), s: x.scale }])),
    ease: EASES[k.ease] || k.ease === 'custom' ? k.ease : 'mawaru', bez: k.bezier }));
  if (!keyframes.length) throw new Error('El proyecto no tiene keyframes');
  keyframes.sort((a, b) => a.t - b.t); keyframes[0].t = 0;
  state.keyframes = keyframes;
  state.duration = Math.max(s.timeline.duration, keyframes[keyframes.length - 1].t, 0.1);

  // devices: reuse the existing ones so unchanged screens (and their videos) are not reloaded
  const list = devicesOf(s);
  while (devices.length > list.length) disposeDevice(devices[devices.length - 1]);
  while (devices.length < list.length) createDevice();
  let missingVideo = false;
  list.forEach((sd, i) => {
    // a local model that is not on this machine (or failed to load) falls back to the built-in iPhone
    const d = devices[i], type = MODELS[sd.type] && modelReady(sd.type) ? sd.type : 'iphone';
    setDeviceType(d, type, { rescale: false });
    d.group.position.fromArray(sd.position ?? [0, 0, 0]); d.group.rotation.set(...(sd.rotation ?? [0, 0, 0]));
    d.group.scale.setScalar(sd.scale ?? MODELS[type].defaultScale);
    setLidAngle(d, sd.lidAngle ?? 110);
    if (sd.uid) d.uid = sd.uid;
    d.animated = !!sd.animated; d.base = d.animated ? poseOf(d.group) : null;
    d.caseColor = sd.caseColor ?? MODELS[type].caseColor; d.setCaseColor(d.caseColor);
    Object.assign(d.opts, { loop: true, audio: true }, sd.video ?? {});
    const wantVideo = sd.screenVideo && videos.has(sd.screenVideo) ? sd.screenVideo : null;
    if (sd.screenVideo && !wantVideo) missingVideo = true;
    if (wantVideo) { if (wantVideo !== d.videoId) showVideoId(d, wantVideo); }
    else {
      const hadVideo = !!d.video; stopVideo(d);
      const wantImage = sd.screenImage && images.has(sd.screenImage) ? sd.screenImage : null;
      if (hadVideo || wantImage !== d.imageId || d.imageId === undefined) showImageId(d, wantImage);
    }
  });
  if (missingVideo) projStatus.textContent = 'Algún vídeo de pantalla no está guardado aquí: vuelve a elegirlo.';

  camera.fov = s.camera.fov; camera.updateProjectionMatrix(); $('fov').value = s.camera.fov;
  if (typeof s.background === 'string') Object.assign(bg, { type: 'color', color: s.background });   // v1 files
  else Object.assign(bg, s.background);
  if (!images.has(bg.imageId)) bg.imageId = null;
  if (s.format && FORMATS[s.format] && s.format !== state.format) setFormat(s.format);
  const prevEnv = look.env;
  Object.assign(look, LOOK_DEFAULTS, s.look ?? {});
  delete look.caseColor;                                   // now per device
  if (!ENVIRONMENTS[look.env]) look.env = 'room';
  applyLook(); if (look.env !== prevEnv || !scene.environment) applyEnvironment();
  applyBackground();

  state.selected = Math.min(state.selected, keyframes.length - 1);
  state.currentTime = Math.min(state.currentTime, state.duration);
  state.playing = false; state.viewDirty = false;
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  selectDevice(s.selectedDevice ?? 0);
  renderTimeline();
}

// history holds JSON strings so equal states are cheap to detect
let history = [], historyIndex = -1;
export const historyInfo = () => ({ length: history.length, index: historyIndex });

export function markChanged(){
  if (!projectReady) return;
  const s = JSON.stringify(snapshot());
  if (s === history[historyIndex]) return;
  history = history.slice(0, historyIndex + 1); history.push(s);
  if (history.length > 100) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons(); scheduleAutosave();
}
function stepHistory(dir){
  const i = historyIndex + dir;
  if (i < 0 || i >= history.length) return;
  historyIndex = i; restore(JSON.parse(history[i]));
  updateHistoryButtons(); scheduleAutosave();
}
function updateHistoryButtons(){ $('undo').disabled = historyIndex <= 0; $('redo').disabled = historyIndex >= history.length - 1; }

// A saved file embeds the images it uses so it opens anywhere
export function projectFile(){
  const s = snapshot();
  const used = [...s.devices.map(d => d.screenImage), s.background.imageId].filter(id => id && images.has(id));
  return { ...s, images: Object.fromEntries(used.map(id => [id, images.get(id)])) };
}

export async function loadProject(p){
  if (!(p.app === APP_ID || LEGACY_APP_IDS.includes(p.app)) || !p.timeline) throw new Error('No es un proyecto de Mawaru');
  projectReady = true;               // from here on changes are recorded and autosaved
  // models from local-models/ load asynchronously: fetch them before rebuilding the scene
  await Promise.all([...new Set(devicesOf(p).map(d => d.type).filter(isLocal))].map(t => ensureModel(t).catch(() => {})));
  for (const [id, url] of Object.entries(p.images ?? {})) images.set(id, url);
  for (const [id, v] of Object.entries(p.videos ?? {})) if (!videos.has(id)) videos.set(id, { blob: dataURLToBlob(v.dataURL), name: v.name, url: null });
  for (const v of videos.values()) v.url ??= URL.createObjectURL(v.blob);
  for (const d of devices) d.imageId = undefined;   // force the screens to refresh
  restore(p); state.currentTime = 0;
  history = []; historyIndex = -1; markChanged();
}

let autosaveTimer;
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(projectFile())); projStatus.textContent = 'Autoguardado ' + new Date().toLocaleTimeString(); }
    catch { // quota (large image) or storage blocked: keep the project without its images
      try {
        const s = snapshot();
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...s, devices: s.devices.map(d => ({ ...d, screenImage: null })), background: { ...s.background, imageId: null }, images: {} }));
        projStatus.textContent = 'Autoguardado (sin imagen: demasiado grande)';
      } catch { projStatus.textContent = 'Autoguardado no disponible'; }
    }
  }, 400);
}

async function saveProject(){
  const file = projectFile();
  let note = '';
  file.videos = {};                // embed screen videos when they are reasonably small
  for (const id of new Set(devices.map(d => d.videoId).filter(Boolean))) {
    const v = videos.get(id);
    if (v.blob.size <= MAX_EMBED_VIDEO) file.videos[id] = { name: v.name, dataURL: await blobToDataURL(v.blob) };
    else note = ' (sin algún vídeo: supera 40 MB)';
  }
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const name = (projName.value.trim() || 'proyecto').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '_') + '.mawaru.json';
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name }).click();
  projStatus.textContent = 'Guardado como ' + name + note;
}

export async function openProjectFile(file){
  try { await loadProject(JSON.parse(await file.text())); projStatus.textContent = 'Abierto: ' + file.name; }
  catch (err) { projStatus.textContent = 'No se pudo abrir: ' + err.message; }
}

export function initProject(){
  $('undo').onclick = () => stepHistory(-1);
  $('redo').onclick = () => stepHistory(1);
  projName.addEventListener('change', () => markChanged());
  const projFile = $('projFile');
  $('saveProj').onclick = saveProject;
  $('openProj').onclick = () => projFile.click();
  projFile.onchange = () => { if (projFile.files[0]) openProjectFile(projFile.files[0]); projFile.value = ''; };
  addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(); }
    else if (k === 'o') { e.preventDefault(); projFile.click(); }
    else if (e.target.matches?.('input, select')) return;   // let fields keep their own text undo
    else if (k === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 1 : -1); }
    else if (k === 'y') { e.preventDefault(); stepHistory(1); }
  });
}

// ---- Templates: a fresh project with one device and a starter shot that frames it whole ----
export async function newProject(type){
  await ensureModel(type);
  const m = MODELS[type];
  await loadProject({
    app: APP_ID, version: 4, name: `Mockup ${m.label}`,
    timeline: { duration: 4, keyframes: [{ t: 0, rig: [0, 0, 0, 1], camera: [0, 0, 30], ease: 'mawaru' }] },
    devices: [{ type, position: [0, 0, 0], rotation: [0, 0, 0], scale: m.defaultScale, caseColor: m.caseColor, lidAngle: 110 }],
    selectedDevice: 0, camera: { fov: 30 }, format: state.format, background: { ...BG_DEFAULTS }, look: { ...LOOK_DEFAULTS },
  });
  const shot = templateKeyframes(type, devices.map(d => d.group));
  // the project opens still at 0 s: the user starts playback when ready
  Object.assign(state, { keyframes: shot.keyframes, duration: shot.duration, currentTime: 0, selected: 1, playing: false, viewDirty: false });
  renderTimeline();
  history = []; historyIndex = -1; markChanged();
  projStatus.textContent = `Nuevo proyecto: ${m.label}`;
}

// History and autosave start with the project picked on the start screen (new or resumed),
// so opening the app never overwrites the autosave of the last project.
export function startProject(){
  projectReady = false;
}
