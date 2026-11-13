import * as THREE from 'three';
import { zipSync } from 'fflate';
import { state, $ } from '../state.js';
import { renderer, scene, camera, rig } from '../core/scene.js';
import { apply } from '../core/animation.js';
import { frameRig } from '../core/framing.js';
import { MODELS, placeholderTexture } from '../core/device-model.js';
import { ensureModel } from '../core/local-models.js';
import { devices, selectedDevice, setDeviceType, setLidAngle, renderDeviceList, createDevice, disposeDevice } from './devices.js';
import { gizmoHelper, editViewEl } from './transform.js';
import { updateShadowCatcher, applyLook, LOOK_DEFAULTS } from './look.js';
import { BG_DEFAULTS, bg } from './frame.js';
import { renderTimeline, updateTimelineState } from './timeline.js';
import { addImage, imageFileToDataURL, images, coverUV } from './media.js';
import { loadProject, snapshot, markChanged, projName, projStatus } from './project.js';
import { exportPNG } from '../export/exporter.js';

// ---- Scenes: a presentation made of 16:9 slides, each one a full project snapshot ----
// The editor always shows ONE scene (the active one); the others wait here as snapshots
// (screen images referenced by id, like the undo history). Switching scenes saves the active
// one and loads the next. Bulk creation lays out N devices side by side, like the Flow 3 template.
export const scenes = [];          // [{ data: snapshot, thumb: dataURL }]
let current = 0;
let busy = false;                  // creating / switching / exporting: ignore edits and clicks meanwhile
const GAP = 1.28;                  // device pitch, in device widths (Flow 3 look)
const THUMB_W = 384;

export const scenesDeviceType = () => scenes.length ? (scenes[current].data.devices[0]?.type ?? null) : null;

// Small picture of what the viewport shows now (rendered synchronously: no flash on screen)
function captureThumb(){
  if (!state.viewDirty) apply(state.currentTime);
  updateShadowCatcher();
  const vis = gizmoHelper.visible;
  gizmoHelper.visible = false;
  renderer.render(scene, camera);
  gizmoHelper.visible = vis;
  const src = renderer.domElement, c = document.createElement('canvas');
  c.width = THUMB_W; c.height = Math.round(THUMB_W * src.height / src.width);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return bg.type === 'transparent' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82);
}

function saveActive(){
  if (!scenes.length) return;
  scenes[current].data = snapshot();
  scenes[current].thumb = captureThumb();
}

async function openScene(i){
  const name = projName.value;             // the presentation keeps one name across scenes
  current = i;
  await loadProject(structuredClone(scenes[i].data), { keepScenes: true });
  clearTimeout(changeTimer); dirty = false;      // opening a scene is not an edit: nothing to propagate
  projName.value = name;
  renderScenes();
}

async function guarded(fn){
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; renderScenes(); }
}

export const switchScene = i => { flushChanges(); return guarded(async () => {
  if (i === current || !scenes[i]) return;
  // an animated slide's unsaved view (zoom, orbit, pan) goes along to the next slide
  const carry = state.viewDirty && syncOn() && !editViewEl.checked ? { q: rig.quaternion.clone(), p: camera.position.clone() } : null;
  saveActive(); await openScene(i);
  if (carry) { rig.quaternion.copy(carry.q); camera.position.copy(carry.p); state.viewDirty = true; updateTimelineState(); }
}); };

// The camera was framed by hand (wheel zoom, orbit, pan, «Encuadrar todo»). A slide is a still shot
// (one keyframe): the new framing is saved into it right away, so it survives a slide change and,
// with «Mismo estilo», reaches every slide. Animated slides keep the usual «+ Keyframe» workflow.
export function viewEdited(){
  if (!scenes.length || busy || !state.viewDirty || editViewEl.checked) return;
  if (state.keyframes.length !== 1 || devices.some(d => d.animated)) return;
  Object.assign(state.keyframes[0], { q: rig.quaternion.clone(), p: camera.position.clone() });
  state.viewDirty = false;
  renderTimeline(); markChanged();
}

const deleteScene = i => guarded(async () => {
  if (scenes.length < 2) return;
  if (i === current) { scenes.splice(i, 1); await openScene(Math.min(i, scenes.length - 1)); }
  else { scenes.splice(i, 1); if (i < current) current--; }
});

function moveScene(from, to){
  if (busy || from === to) return;
  saveActive();
  const [s] = scenes.splice(from, 1);
  scenes.splice(to, 0, s);
  // the active scene keeps being the active one, wherever it ends up
  if (from === current) current = to;
  else if (from < current && to >= current) current--;
  else if (from > current && to <= current) current++;
  renderScenes();
}

// ---- One style for the whole set ----
// The scenes are a set of designs shown the same way: with «Mismo estilo» on, an edit to a device
// applies to every device of the scene, and the scene's look (devices, background, appearance,
// format and camera) is copied to every other scene. Each scene keeps its own designs, and the
// device positions of a scene with a different number of devices (the last, partial one).
const syncOn = () => $('syncScenes').checked;

// Before a change is recorded: the selected device sets model, case colour, rotation, scale and lid for its siblings
export function syncSceneDevices(){
  if (!scenes.length || busy || !syncOn()) return;
  const src = selectedDevice();
  if (!src || src.animated) return;
  let changed = false;
  for (const d of devices) {
    if (d === src || d.animated) continue;
    if (d.type !== src.type) { setDeviceType(d, src.type, { rescale: false }); changed = true; }
    d.group.quaternion.copy(src.group.quaternion);
    d.group.scale.copy(src.group.scale);
    if (d.caseColor !== src.caseColor) { d.caseColor = src.caseColor; d.setCaseColor(src.caseColor); changed = true; }
    if (d.lidAngle !== src.lidAngle) setLidAngle(d, src.lidAngle);
  }
  if (changed) renderDeviceList();
}

function propagateStyle(){
  const a = scenes[current].data;
  const src = a.devices[a.selectedDevice] ?? a.devices[0];
  const animated = a.timeline.keyframes.some(k => k.devices);    // per-device keyframes belong to this scene's devices
  scenes.forEach((s, j) => {
    if (j === current) return;
    const d = s.data, sameLayout = d.devices.length === a.devices.length;
    Object.assign(d, { format: a.format, background: { ...a.background }, look: { ...a.look }, camera: { ...a.camera } });
    if (!animated) d.timeline = structuredClone(a.timeline);
    if (!src) return;
    d.devices = d.devices.map((x, i) => ({ ...x, type: src.type, rotation: [...src.rotation], scale: src.scale, caseColor: src.caseColor,
      ...(src.lidAngle !== undefined ? { lidAngle: src.lidAngle } : {}),
      position: sameLayout ? [...a.devices[i].position] : x.position }));
  });
}

// Thumbnails of the other scenes after a propagated change, without loading them: the live devices
// get each scene's positions and screen images for one synchronous render (no flash on screen).
const texCache = new Map();        // image id -> Promise<Texture>
const texReady = new Map();        // image id -> Texture
function texFor(id){
  if (!texCache.has(id)) texCache.set(id, new THREE.TextureLoader().loadAsync(images.get(id)).then(tex => {
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; texReady.set(id, tex); return tex;
  }));
  return texCache.get(id);
}
function clearTexCache(){
  for (const t of texReady.values()) t.dispose();
  texCache.clear(); texReady.clear();
}

let thumbSeq = 0;
async function refreshOtherThumbs(){
  const seq = ++thumbSeq;
  const ids = new Set(scenes.flatMap((s, j) => j === current ? [] : s.data.devices.map(d => d.screenImage)).filter(id => id && images.has(id)));
  await Promise.all([...ids].map(id => texFor(id).catch(() => null)));
  if (seq !== thumbSeq || busy || !scenes.length || !devices.length) return;
  const live = devices.slice(), first = live[0];
  const saved = live.map(d => ({ p: d.group.position.clone(), visible: d.group.visible, map: d.screenMat.map }));
  const temps = [];
  try {
    scenes.forEach((s, j) => {
      if (j === current) return;
      const sd = s.data.devices;
      while (live.length + temps.length < sd.length) {
        const t = createDevice({ type: first.type, caseColor: first.caseColor, lidAngle: first.lidAngle });
        t.group.quaternion.copy(first.group.quaternion); t.group.scale.copy(first.group.scale);
        temps.push(t);
      }
      if (temps.length) applyLook();
      [...live, ...temps].forEach((d, i) => {
        const x = sd[i];
        d.group.visible = !!x;
        if (!x) return;
        d.group.position.fromArray(x.position);
        const tex = x.screenImage && texReady.get(x.screenImage);
        if (tex) coverUV(tex, tex.image.width / tex.image.height, d.screenAspect);
        d.screenMat.map = tex || placeholderTexture(d.screenAspect); d.screenMat.needsUpdate = true;
      });
      s.thumb = captureThumb();
    });
  } finally {
    temps.forEach(disposeDevice);
    live.forEach((d, i) => { d.group.position.copy(saved[i].p); d.group.visible = saved[i].visible; d.screenMat.map = saved[i].map; d.screenMat.needsUpdate = true; });
    updateShadowCatcher();
  }
  [...$('sceneList').children].forEach((li, j) => { const img = li.querySelector('img'); if (img && scenes[j]?.thumb) img.src = scenes[j].thumb; });
}

// Called by the project after every recorded change (and undo / redo): keep the slides fresh
let changeTimer, dirty = false;
export function sceneChanged(){
  if (!scenes.length) return;
  dirty = true;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(flushChanges, 350);
}
function flushChanges(){
  clearTimeout(changeTimer);
  if (!dirty || busy || !scenes.length) return;
  dirty = false;
  saveActive();
  const img = $('sceneList').children[current]?.querySelector('img');
  if (img) img.src = scenes[current].thumb;
  if (syncOn() && scenes.length > 1) { propagateStyle(); refreshOtherThumbs(); }
}

// ---- Bulk creation ----
// Designs fill the scenes in order: perScene devices per slide, the last one may have fewer.
// Every slide uses the same camera (taken from the first, fullest one) so the devices keep
// the same size from slide to slide, and a partial slide stays centred.
export async function createScenes({ files, type, perScene = 3, append = false, onProgress = () => {} }){
  if (!files.length) throw new Error('No hay diseños');
  busy = true;
  try {
    await ensureModel(type);
    const m = MODELS[type], ids = [];
    for (let i = 0; i < files.length; i++) {
      onProgress(`Preparando diseño ${i + 1} de ${files.length}…`);
      ids.push(addImage(await imageFileToDataURL(files[i])));
    }
    const name = append && scenes.length ? projName.value : `Escenas · ${m.label}`;
    if (append && scenes.length) { flushChanges(); saveActive(); } else { scenes.length = 0; clearTexCache(); }
    const first = scenes.length, total = Math.ceil(ids.length / perScene);
    let camP = null;
    for (let g = 0; g < total; g++) {
      onProgress(`Creando escena ${g + 1} de ${total}…`);
      const group = ids.slice(g * perScene, (g + 1) * perScene), n = group.length;
      await loadProject({
        app: 'mawaru', version: 4, name,
        timeline: { duration: 4, keyframes: [{ t: 0, rig: [0, 0, 0, 1], camera: [0, 0, 30], ease: 'mawaru' }] },
        devices: group.map(id => ({ type, position: [0, 0, 0], rotation: [0, 0, 0], scale: m.defaultScale, caseColor: m.caseColor, screenImage: id })),
        selectedDevice: 0, camera: { fov: 30 }, format: '16:9', background: { ...BG_DEFAULTS }, look: { ...LOOK_DEFAULTS },
      }, { keepScenes: true });
      const groups = devices.map(d => d.group);
      const w = new THREE.Box3().setFromObject(groups[0]).getSize(new THREE.Vector3()).x;
      groups.forEach((gr, i) => gr.position.set((i - (n - 1) / 2) * w * GAP, 0, 0));
      const q = new THREE.Quaternion();
      camP ??= frameRig(groups, q, { margin: 1.4 });
      Object.assign(state, { keyframes: [{ t: 0, q, p: camP.clone(), ease: 'mawaru', devices: {} }],
        duration: 4, currentTime: 0, selected: 0, playing: false, viewDirty: false });
      renderTimeline();
      scenes.push({ data: snapshot(), thumb: captureThumb() });
    }
    current = first;
    await openScene(first);
    projName.value = name;
    projStatus.textContent = `${total} escena${total > 1 ? 's' : ''} creada${total > 1 ? 's' : ''} con ${m.label}`;
  } finally { busy = false; renderScenes(); }
}

// ---- Project file ----
export function scenesFileData(){
  if (!scenes.length) return null;
  if (!busy) scenes[current].data = snapshot();
  return { scenes: scenes.map(s => ({ data: s.data, thumb: s.thumb })), activeScene: current, sceneSync: syncOn() };
}
export const sceneImageIds = () => scenes.flatMap(s => [...s.data.devices.map(d => d.screenImage), s.data.background?.imageId]).filter(Boolean);

export function setScenesFromFile(p){
  scenes.length = 0; clearTexCache();
  $('syncScenes').checked = p.sceneSync ?? true;
  for (const s of Array.isArray(p.scenes) ? p.scenes : []) if (s?.data?.timeline) scenes.push({ data: s.data, thumb: s.thumb ?? null });
  current = THREE.MathUtils.clamp(p.activeScene ?? 0, 0, Math.max(scenes.length - 1, 0));
  renderScenes();
}

// ---- Export: one 16:9 PNG per scene, in a ZIP ----
async function exportAllScenes(button){
  if (!scenes.length) return;
  flushChanges();
  const status = $('exportStatus'), files = {}, back = current, t0 = performance.now();
  const buttons = [$('exportScenes'), $('exportScenesSide')];
  await guarded(async () => {
    buttons.forEach(b => b.disabled = true);
    saveActive();
    try {
      for (let i = 0; i < scenes.length; i++) {
        if (i !== current) await openScene(i);
        const r = await exportPNG();
        files[`escena-${String(i + 1).padStart(2, '0')}.png`] = new Uint8Array(await r.blob.arrayBuffer());
        status.textContent = `Escena ${i + 1} de ${scenes.length}…`;
      }
      status.textContent = 'Comprimiendo ZIP…';
      const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
      const name = (projName.value.trim() || 'escenas').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '_') + '-16x9.zip';
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name }).click();
      status.textContent = `${name} · ${scenes.length} PNG · ${(blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (e) { status.textContent = 'Error: ' + e.message; console.error(e); }
    finally {
      if (current !== back) await openScene(back);
      buttons.forEach(b => b.disabled = false);
    }
  });
  button?.focus();
}

// ---- Slides panel ----
let dragFrom = null;
export function renderScenes(){
  const panel = $('scenesPanel'), list = $('sceneList');
  const had = !panel.hidden;
  panel.hidden = !scenes.length;
  document.body.classList.toggle('has-scenes', scenes.length > 0);
  $('scenesExport').hidden = !scenes.length;
  $('scenesExportInfo').textContent = `${scenes.length} escena${scenes.length !== 1 ? 's' : ''} · un PNG 16:9 por escena a la calidad elegida.`;
  $('sceneCount').textContent = `(${scenes.length})`;
  list.innerHTML = '';
  scenes.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'scene' + (i === current ? ' active' : '');
    li.draggable = true;
    li.innerHTML = `<span class="num">${i + 1}</span><button class="thumb" aria-label="Escena ${i + 1}" ${i === current ? 'aria-current="true"' : ''}>`
      + (s.thumb ? `<img src="${s.thumb}" alt="">` : `<span class="empty">Escena ${i + 1}</span>`) + `</button>`
      + (scenes.length > 1 ? `<button class="del" title="Eliminar escena ${i + 1}" aria-label="Eliminar escena ${i + 1}">×</button>` : '');
    li.querySelector('.thumb').onclick = () => switchScene(i);
    li.querySelector('.del')?.addEventListener('click', () => deleteScene(i));
    li.ondragstart = e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; };
    li.ondragover = e => { if (dragFrom !== null) { e.preventDefault(); li.classList.add('drop'); } };
    li.ondragleave = () => li.classList.remove('drop');
    li.ondrop = e => { e.preventDefault(); e.stopPropagation(); li.classList.remove('drop'); if (dragFrom !== null) moveScene(dragFrom, i); dragFrom = null; };
    li.ondragend = () => { dragFrom = null; };
    list.append(li);
  });
  if (!had && scenes.length) dispatchEvent(new Event('resize'));    // the viewport got narrower
  list.children[current]?.scrollIntoView({ block: 'nearest' });
}

export function initScenes(showSplash){
  $('addScenes').onclick = () => showSplash({ canCancel: true, mode: 'scenes', append: true });
  $('exportScenes').onclick = e => exportAllScenes(e.currentTarget);
  // turning it back on unifies the set right away, from the scene on screen
  $('syncScenes').onchange = e => { if (e.target.checked) { syncSceneDevices(); sceneChanged(); } };
  $('exportScenesSide').onclick = e => exportAllScenes(e.currentTarget);
  // PageUp / PageDown step through the slides (outside of text fields)
  addEventListener('keydown', e => {
    if (!scenes.length || e.target.matches?.('input, select, textarea') || !$('splash').hidden) return;
    if (e.key === 'PageDown') { e.preventDefault(); switchScene(Math.min(current + 1, scenes.length - 1)); }
    else if (e.key === 'PageUp') { e.preventDefault(); switchScene(Math.max(current - 1, 0)); }
  });
  renderScenes();
}
