import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { zipSync } from 'fflate';
import { state, $ } from '../state.js';
import { renderer, scene, camera } from '../core/scene.js';
import { apply } from '../core/animation.js';
import { outputSize, resize, bg } from '../ui/frame.js';
import { gizmoHelper } from '../ui/transform.js';
import { playhead, xOf } from '../ui/timeline.js';
import { seekVideosExact } from '../ui/media.js';
import { projName } from '../ui/project.js';
import { audioSources, pickAudioConfig, encodeAudio } from './audio.js';

// ---- Video export ----
// Each frame is rendered at a fixed time (i / fps), never from the wall clock, at a supersampled size
// and downscaled into a 2D canvas. Optional jittering re-renders the frame with sub-pixel camera
// offsets and averages them. Frames go to a WebCodecs VideoEncoder (waiting while its queue is full)
// with presentation time i / fps, and mp4-muxer writes the file.
const exportStatus = $('exportStatus');

// Halton(2,3) sub-pixel offsets in [-0.5, 0.5)
const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
const jitterOffsets = n => n === 1 ? [[0, 0]] : Array.from({ length: n }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

async function pickCodec(width, height, fps){
  for (const codec of ['avc1.640033', 'avc1.640034', 'avc1.4d0033']) {
    const config = { codec, width, height, framerate: fps, bitrate: Math.round(width * height * fps * 0.12), avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  throw new Error(`H.264 ${width}×${height} no soportado por este navegador`);
}

// Renders frames at fixed times (supersampling + jitter) into a 2D canvas handed to onFrame.
// With a transparent background the canvas keeps its alpha channel.
async function renderFrames(times, onFrame){
  const [width, height] = outputSize();
  const ss = +$('ss').value;
  const offsets = jitterOffsets(+$('jitter').value);
  const rw = width * ss, rh = height * ss;
  // Reuse the live renderer: PMREM environment textures belong to its WebGL context.
  const prevExporting = state.exporting;
  state.exporting = true;                              // pause the live loop while the canvas is resized
  renderer.setPixelRatio(1); renderer.setSize(rw, rh, false);
  const frame = new OffscreenCanvas(width, height);
  const g = frame.getContext('2d', { alpha: bg.type === 'transparent' });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  gizmoHelper.visible = false;
  try {
    for (let i = 0; i < times.length; i++) {
      await seekVideosExact(times[i] ?? state.currentTime);   // exact video frames for this time
      if (times[i] !== null) apply(times[i]);                 // null = keep the current (possibly unsaved) view
      g.globalAlpha = 1; g.clearRect(0, 0, width, height);
      for (let s = 0; s < offsets.length; s++) {              // jitter: running average of sub-pixel renders
        const [jx, jy] = offsets[s];
        if (offsets.length > 1) camera.setViewOffset(rw, rh, jx, jy, rw, rh); else camera.clearViewOffset();
        renderer.render(scene, camera);
        g.globalAlpha = 1 / (s + 1);
        g.drawImage(renderer.domElement, 0, 0, width, height);   // supersample → output size
      }
      g.globalAlpha = 1;
      await onFrame(frame, i);
      exportStatus.textContent = `Fotograma ${i + 1}/${times.length}`;
      if (times[i] !== null) playhead.style.left = xOf(times[i]) + 'px';
      if (i % 4 === 0) await new Promise(r => setTimeout(r));  // let the UI breathe
    }
  } finally {
    gizmoHelper.visible = true;
    camera.clearViewOffset(); camera.updateProjectionMatrix();
    renderer.setPixelRatio(devicePixelRatio); resize();
    state.exporting = prevExporting;
  }
  return { width, height };
}

const frameTimes = fps => Array.from({ length: Math.round(state.duration * fps) + 1 }, (_, i) => Math.min(i / fps, state.duration));
const baseName = () => (projName.value.trim() || 'mawaru').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '_') + `-${state.format.replace(':', 'x')}`;

export async function exportVideo(){
  if (!('VideoEncoder' in window)) throw new Error('WebCodecs no disponible en este navegador');
  const [width, height] = outputSize();
  const fps = +$('fps').value;
  const config = await pickCodec(width, height, fps);
  const sources = await audioSources();
  const audioConfig = await pickAudioConfig(sources);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps },
    ...(audioConfig ? { audio: { codec: 'aac', numberOfChannels: audioConfig.numberOfChannels, sampleRate: audioConfig.sampleRate } } : {}),
    fastStart: 'in-memory' });
  let encodeError = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encodeError = e; } });
  encoder.configure(config);
  const times = frameTimes(fps);
  try {
    if (audioConfig) { exportStatus.textContent = 'Codificando audio…'; await encodeAudio(muxer, sources, audioConfig); }
    await renderFrames(times, async (frame, i) => {
      while (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));   // like isReadyForMoreMediaData
      if (encodeError) throw encodeError;
      const vf = new VideoFrame(frame, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps), alpha: 'discard' });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
    });
    await encoder.flush();                           // markAsFinished + finishWriting
    if (encodeError) throw encodeError;
    muxer.finalize();
  } finally { encoder.state !== 'closed' && encoder.close(); }
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  return { blob, name: `${baseName()}-${width}x${height}@${fps}.mp4`, frameCount: times.length, width, height, fps, codec: config.codec, audio: !!audioConfig };
}

export async function exportPNG(){
  let blob;
  const { width, height } = await renderFrames([state.viewDirty ? null : state.currentTime], async frame => { blob = await frame.convertToBlob({ type: 'image/png' }); });
  return { blob, name: `${baseName()}-${width}x${height}-${state.currentTime.toFixed(2)}s.png`, frameCount: 1, width, height };
}

export async function exportPNGSequence(){
  const fps = +$('fps').value, files = {}, times = frameTimes(fps);
  const { width, height } = await renderFrames(times, async (frame, i) => {
    const png = await frame.convertToBlob({ type: 'image/png' });
    files[`frame_${String(i).padStart(5, '0')}.png`] = new Uint8Array(await png.arrayBuffer());
  });
  exportStatus.textContent = 'Comprimiendo ZIP…';
  const blob = new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });   // PNGs are already compressed
  return { blob, name: `${baseName()}-${width}x${height}@${fps}-png.zip`, frameCount: times.length, width, height, fps };
}

const EXPORTERS = { mp4: exportVideo, png: exportPNG, pngseq: exportPNGSequence };
const LABELS = { mp4: 'Exportar MP4', png: 'Exportar PNG', pngseq: 'Exportar secuencia PNG' };

export function initExport(){
  const exportBtn = $('export'), outFormat = $('outFormat');
  outFormat.onchange = () => { exportBtn.textContent = LABELS[outFormat.value]; };
  exportBtn.onclick = async () => {
    state.exporting = true; exportBtn.disabled = true;
    const t = performance.now(), prevTime = state.currentTime;
    try {
      const r = await EXPORTERS[outFormat.value]();
      Object.assign(document.createElement('a'), { href: URL.createObjectURL(r.blob), download: r.name }).click();
      exportStatus.textContent = `${r.name} · ${(r.blob.size / 1e6).toFixed(1)} MB · ${((performance.now() - t) / 1000).toFixed(1)} s`;
    } catch (e) { exportStatus.textContent = 'Error: ' + e.message; console.error(e); }
    finally {
      state.exporting = false; exportBtn.disabled = false;
      if (outFormat.value !== 'png') { state.currentTime = prevTime; state.viewDirty = false; }
    }
  };
}
