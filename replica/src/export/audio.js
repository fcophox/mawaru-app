import { state } from '../state.js';
import { devices } from '../ui/devices.js';
import { videos } from '../ui/media.js';

// Soundtracks of the screen videos, mixed and re-encoded to AAC with the same time
// mapping as the pictures (loop, or hold the last frame + silence), so they stay in sync.
async function audioBufferFor(id){
  const entry = videos.get(id);
  if (entry.audio === undefined) {
    try { entry.audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await entry.blob.arrayBuffer()); }
    catch { entry.audio = null; }   // no audio track or unsupported codec
  }
  return entry.audio;
}

// every device video with "audio in MP4" on contributes to the mix (all decoded at 48 kHz)
export async function audioSources(){
  const out = [];
  for (const dev of devices) {
    if (!dev.video || !dev.opts.audio) continue;
    const buffer = await audioBufferFor(dev.videoId);
    if (buffer) out.push({ buffer, loop: dev.opts.loop });
  }
  return out;
}

export async function pickAudioConfig(sources){
  if (!sources.length || !('AudioEncoder' in window)) return null;
  const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: Math.min(2, Math.max(...sources.map(s => s.buffer.numberOfChannels))), bitrate: 192000 };
  return (await AudioEncoder.isConfigSupported(config)).supported ? config : null;
}

// Mix the soundtracks for [0, duration]
export async function encodeAudio(muxer, sources, config){
  const sr = config.sampleRate, ch = config.numberOfChannels, total = Math.round(state.duration * sr);
  const tracks = sources.map(({ buffer, loop }) => ({ loop, len: buffer.length,
    data: Array.from({ length: ch }, (_, c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1))) }));
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(config);
  const FRAMES = 1024;
  for (let off = 0; off < total; off += FRAMES) {
    const n = Math.min(FRAMES, total - off), data = new Float32Array(n * ch);
    for (const tr of tracks) for (let c = 0; c < ch; c++) for (let i = 0; i < n; i++) {
      const k = tr.loop ? (off + i) % tr.len : off + i;
      if (k < tr.len) data[c * n + i] += tr.data[c][k];
    }
    if (tracks.length > 1) for (let i = 0; i < data.length; i++) data[i] = Math.max(-1, Math.min(1, data[i]));
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(off / sr * 1e6), data });
    enc.encode(ad); ad.close();
    while (enc.encodeQueueSize > 20) await new Promise(r => setTimeout(r));
    if (err) throw err;
  }
  await enc.flush(); enc.close();
  if (err) throw err;
}
