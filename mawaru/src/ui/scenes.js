import * as THREE from 'three';
import { zipSync } from 'fflate';
import { state, $ } from '../state.js';
import { renderer, scene, camera } from '../core/scene.js';
import { apply } from '../core/animation.js';
import { frameRig } from '../core/framing.js';
import { MODELS } from '../core/device-model.js';
import { ensureModel } from '../core/local-models.js';
import { devices } from './devices.js';
import { gizmoHelper } from './transform.js';
import { updateShadowCatcher, LOOK_DEFAULTS } from './look.js';
import { BG_DEFAULTS, bg } from './frame.js';
import { renderTimeline } from './timeline.js';
import { addImage, imageFileToDataURL } from './media.js';
import { loadProject, snapshot, projName, projStatus } from './project.js';
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
  projName.value = name;
  renderScenes();
}

async function guarded(fn){
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; renderScenes(); }
}

export const switchScene = i => guarded(async () => {
  if (i === current || !scenes[i]) return;
  saveActive(); await openScene(i);
});

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

// Called by the project after every recorded change: keep the slide's snapshot and thumbnail fresh
let changeTimer;
export function sceneChanged(){
  if (!scenes.length) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    if (busy || !scenes.length) return;
    saveActive();
    const img = $('sceneList').children[current]?.querySelector('img');
    if (img) img.src = scenes[current].thumb;
  }, 350);
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
    if (append && scenes.length) saveActive(); else scenes.length = 0;
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
  return { scenes: scenes.map(s => ({ data: s.data, thumb: s.thumb })), activeScene: current };
}
export const sceneImageIds = () => scenes.flatMap(s => [...s.data.devices.map(d => d.screenImage), s.data.background?.imageId]).filter(Boolean);

export function setScenesFromFile(p){
  scenes.length = 0;
  for (const s of Array.isArray(p.scenes) ? p.scenes : []) if (s?.data?.timeline) scenes.push({ data: s.data, thumb: s.thumb ?? null });
  current = THREE.MathUtils.clamp(p.activeScene ?? 0, 0, Math.max(scenes.length - 1, 0));
  renderScenes();
}

// ---- Export: one 16:9 PNG per scene, in a ZIP ----
async function exportAllScenes(button){
  if (!scenes.length) return;
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
  $('exportScenesSide').onclick = e => exportAllScenes(e.currentTarget);
  // PageUp / PageDown step through the slides (outside of text fields)
  addEventListener('keydown', e => {
    if (!scenes.length || e.target.matches?.('input, select, textarea') || !$('splash').hidden) return;
    if (e.key === 'PageDown') { e.preventDefault(); switchScene(Math.min(current + 1, scenes.length - 1)); }
    else if (e.key === 'PageUp') { e.preventDefault(); switchScene(Math.max(current - 1, 0)); }
  });
  renderScenes();
}
