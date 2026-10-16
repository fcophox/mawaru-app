import * as THREE from 'three';
import { state, $ } from '../state.js';
import { stage } from '../core/scene.js';
import { placeholderTexture } from '../core/device-model.js';
import { devices, selectedDevice, renderDeviceList, deviceAt, selectDevice } from './devices.js';
import { renderTimeline } from './timeline.js';
import { markChanged, openProjectFile, projStatus } from './project.js';

// ---- Screen media: images and videos, kept by id so undo snapshots stay small ----
export const images = new Map();   // id -> data URL
export const videos = new Map();   // id -> { blob, url, name, audio? }
const MAX_IMAGE_SIDE = 2560;

export function imageFileToDataURL(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function addImage(dataURL){
  let id = [...images].find(([, v]) => v === dataURL)?.[0];
  if (!id) { id = 'img' + (images.size + 1) + '-' + Date.now().toString(36); images.set(id, dataURL); }
  return id;
}

// Screen image of one device (null = placeholder), cropped to that model's screen like object-fit: cover
export function showImageId(dev, id){
  dev.imageId = id && images.has(id) ? id : null;
  if (!dev.imageId) { dev.screenMat.map = placeholderTexture(dev.screenAspect); dev.screenMat.needsUpdate = true; return Promise.resolve(); }
  return new THREE.TextureLoader().loadAsync(images.get(dev.imageId)).then(tex => {
    if (dev.imageId !== id || dev.video) { tex.dispose(); return; }     // replaced while loading
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    coverUV(tex, tex.image.width / tex.image.height, dev.screenAspect);
    dev.screenMat.map = tex; dev.screenMat.needsUpdate = true;
  });
}

// After a model change: put the same image/video on the new screen material, re-cropped
export function refitScreen(dev){
  if (dev.video) {
    const { el, tex } = dev.video;
    coverUV(tex, el.videoWidth / el.videoHeight, dev.screenAspect);
    dev.screenMat.map = tex; dev.screenMat.needsUpdate = true;
  } else showImageId(dev, dev.imageId);
}

// ---- Video on the device screens ----
// Preview: each <video> follows the timeline clock (play/pause/scrub, drift-corrected).
// Export: every output frame seeks each video to its exact time before rendering (seekVideosExact).
function coverUV(tex, ia, fa){     // crop like CSS object-fit: cover
  tex.repeat.set(1, 1); tex.offset.set(0, 0);
  if (ia > fa) { tex.repeat.x = fa / ia; tex.offset.x = (1 - tex.repeat.x) / 2; }
  else { tex.repeat.y = ia / fa; tex.offset.y = (1 - tex.repeat.y) / 2; }
}

export function addVideo(blob, name){
  let id = [...videos].find(([, v]) => v.blob === blob)?.[0];
  if (!id) { id = 'vid' + (videos.size + 1) + '-' + Date.now().toString(36); videos.set(id, { blob, name, url: URL.createObjectURL(blob) }); }
  return id;
}

export function stopVideo(dev){
  dev.videoId = null;
  if (!dev.video) return;
  const { el, tex } = dev.video;
  el.pause(); tex.dispose(); el.removeAttribute('src'); el.load();
  dev.video = null;
  if (dev === selectedDevice()) syncVideoUI();
}

export async function showVideoId(dev, id){
  stopVideo(dev);
  const entry = videos.get(id); if (!entry) return;
  dev.videoId = id;
  const el = document.createElement('video');
  Object.assign(el, { src: entry.url, muted: !$('videoSound').checked, playsInline: true, loop: dev.opts.loop, preload: 'auto' });
  await new Promise((ok, ko) => { el.onloadeddata = ok; el.onerror = () => ko(new Error('No se pudo leer el vídeo')); });
  if (dev.videoId !== id || !devices.includes(dev)) { el.removeAttribute('src'); return; }   // replaced while loading
  const tex = new THREE.VideoTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  coverUV(tex, el.videoWidth / el.videoHeight, dev.screenAspect);
  dev.video = { el, tex };
  dev.screenMat.map = tex; dev.screenMat.needsUpdate = true;
  if (dev === selectedDevice()) syncVideoUI();
  renderDeviceList();
}

export function videoTimeAt(dev, t){
  const d = dev.video?.el.duration;
  if (!d || !isFinite(d)) return 0;
  return dev.opts.loop ? t % d : Math.min(t, Math.max(0, d - 0.04));
}

// called every animation frame
export function syncVideoPreview(){
  if (state.exporting) return;
  const { currentTime, playing, viewDirty } = state;
  for (const dev of devices) {
    if (!dev.video) continue;
    const v = dev.video.el, vt = videoTimeAt(dev, currentTime);
    v.loop = dev.opts.loop;
    if (playing && !viewDirty) {
      if (v.paused && (dev.opts.loop || currentTime < v.duration)) v.play().catch(() => {});
      if (!v.seeking && Math.abs(v.currentTime - vt) > 0.15) v.currentTime = vt;   // drift / timeline loop
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - vt) > 0.02) v.currentTime = vt;   // scrubbing
    }
  }
}

// exact frames for export: seek every screen video, wait until the frame is presented, upload it
export async function seekVideosExact(t){
  await Promise.all(devices.filter(d => d.video).map(async dev => {
    const v = dev.video.el, vt = videoTimeAt(dev, t);
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - vt) > 1e-4) {
      await new Promise(res => { v.addEventListener('seeked', res, { once: true }); v.currentTime = vt; });
      await new Promise(res => { let done = false; const fin = () => { if (!done) { done = true; res(); } };
        v.requestVideoFrameCallback?.(fin); setTimeout(fin, 80); });
    }
    dev.video.tex.needsUpdate = true;
  }));
}

export function syncVideoUI(){
  const dev = selectedDevice();
  $('videoRow').hidden = !dev?.video;
  if (!dev) return;
  $('videoLoop').checked = dev.opts.loop; $('videoAudio').checked = dev.opts.audio;
  if (dev.video) {
    const e = videos.get(dev.videoId), v = dev.video.el;
    $('videoInfo').textContent = `${e.name} · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(2)} s`;
  }
}

async function setScreenMedia(file, dev = selectedDevice()){
  if (!dev) { projStatus.textContent = 'Elige primero un dispositivo.'; return; }
  if (file.type.startsWith('video/')) {
    try { await showVideoId(dev, addVideo(file, file.name)); dev.imageId = null; renderDeviceList(); markChanged(); }
    catch (err) { projStatus.textContent = err.message; }
  } else if (file.type.startsWith('image/')) {
    stopVideo(dev);
    await showImageId(dev, addImage(await imageFileToDataURL(file))); renderDeviceList(); markChanged();
  }
}

export function blobToDataURL(blob){
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(blob); });
}
export function dataURLToBlob(url){
  const [head, b64] = url.split(','), bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/:(.*?);/)[1] });
}

export function initMedia(){
  const mediaFile = $('mediaFile');
  $('mediaBtn').onclick = () => mediaFile.click();
  mediaFile.onchange = () => { const f = mediaFile.files[0]; mediaFile.value = ''; if (f) setScreenMedia(f); };
  $('videoLoop').onchange = e => { if (selectedDevice()) { selectedDevice().opts.loop = e.target.checked; markChanged(); } };
  $('videoAudio').onchange = e => { if (selectedDevice()) { selectedDevice().opts.audio = e.target.checked; markChanged(); } };
  $('videoSound').onchange = e => { for (const d of devices) if (d.video) d.video.el.muted = !e.target.checked; };
  $('fitDuration').onclick = () => {
    const v = selectedDevice()?.video; if (!v) return;
    state.duration = Math.max(v.el.duration, state.keyframes[state.keyframes.length - 1].t);
    renderTimeline(); markChanged();
  };
  $('removeMedia').onclick = () => { const d = selectedDevice(); if (!d) return; stopVideo(d); showImageId(d, null); renderDeviceList(); markChanged(); };

  // Drag & drop onto the viewport (Rotato's DragReceiverScnView): media goes to the device under the pointer
  const drop = $('drop');
  stage.addEventListener('dragover', e => { e.preventDefault(); drop.style.display = 'flex'; });
  stage.addEventListener('dragleave', () => drop.style.display = 'none');
  stage.addEventListener('drop', e => {
    e.preventDefault(); drop.style.display = 'none';
    const f = e.dataTransfer.files[0]; if (!f) return;
    if (f.name.endsWith('.json') || f.type === 'application/json') return openProjectFile(f);
    const target = deviceAt(e.clientX, e.clientY);
    if (target) selectDevice(devices.indexOf(target));
    setScreenMedia(f);
  });
}
