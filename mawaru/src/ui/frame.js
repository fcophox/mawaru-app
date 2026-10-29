import * as THREE from 'three';
import { state, $ } from '../state.js';
import { stage, renderer, scene, camera } from '../core/scene.js';
import { images, addImage, imageFileToDataURL } from './media.js';
import { markChanged } from './project.js';

// ---- Output format: the viewport is letterboxed to the export aspect (what you see is what you export) ----
export const FORMATS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
export const formatAspect = () => FORMATS[state.format];

export function outputSize(){
  const short = +$('quality').value, a = formatAspect();
  const even = v => Math.round(v / 2) * 2;
  return a >= 1 ? [even(short * a), short] : [short, even(short / a)];
}

export function resize(){
  const W = stage.clientWidth - 32, H = stage.clientHeight - 32, a = formatAspect();
  const w = Math.max(50, Math.floor(Math.min(W, H * a))), h = Math.max(50, Math.floor(w / a));
  renderer.setSize(w, h);
  Object.assign(renderer.domElement.style, { left: ((stage.clientWidth - w) / 2) + 'px', top: ((stage.clientHeight - h) / 2) + 'px' });
  camera.aspect = a; camera.updateProjectionMatrix();
  const [ow, oh] = outputSize();
  $('outSize').textContent = `Salida: ${ow}×${oh}`;
}

// ---- Background: color · gradient · image · transparent ----
export const BG_DEFAULTS = { type: 'color', color: '#e9e6ff', from: '#6a5cff', to: '#ff6ab0', angle: 135, imageId: null };
export const bg = { ...BG_DEFAULTS };
const GRADIENT_PRESETS = [['#6a5cff', '#ff6ab0'], ['#0f2027', '#2c5364'], ['#f7971e', '#ffd200'], ['#11998e', '#38ef7d'], ['#fbc2eb', '#a6c1ee']];
let bgTexture = null;

function gradientTexture(){
  const a = formatAspect(), w = a >= 1 ? 1024 : Math.round(1024 * a), h = a >= 1 ? Math.round(1024 / a) : 1024;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), th = THREE.MathUtils.degToRad(bg.angle), dx = Math.sin(th), dy = -Math.cos(th);
  const L = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;          // CSS linear-gradient geometry
  const grad = g.createLinearGradient(w / 2 - dx * L, h / 2 - dy * L, w / 2 + dx * L, h / 2 + dy * L);
  grad.addColorStop(0, bg.from); grad.addColorStop(1, bg.to);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function coverFit(tex){       // scene.background honours texture.matrix: crop like CSS background-size: cover
  const ia = tex.image.width / tex.image.height, fa = formatAspect();
  tex.repeat.set(1, 1); tex.offset.set(0, 0);
  if (ia > fa) { tex.repeat.x = fa / ia; tex.offset.x = (1 - tex.repeat.x) / 2; }
  else { tex.repeat.y = ia / fa; tex.offset.y = (1 - tex.repeat.y) / 2; }
}

export async function applyBackground(){
  if (bgTexture) { bgTexture.dispose(); bgTexture = null; }
  stage.classList.toggle('transparent', bg.type === 'transparent');
  if (bg.type === 'color') scene.background = new THREE.Color(bg.color);
  else if (bg.type === 'gradient') scene.background = bgTexture = gradientTexture();
  else if (bg.type === 'transparent') scene.background = null;
  else if (bg.type === 'image') {
    if (!bg.imageId || !images.has(bg.imageId)) scene.background = new THREE.Color('#2a2b33');
    else {
      const tex = await new THREE.TextureLoader().loadAsync(images.get(bg.imageId));
      tex.colorSpace = THREE.SRGBColorSpace; coverFit(tex);
      if (bg.type === 'image') scene.background = bgTexture = tex; else tex.dispose();
    }
  }
  syncBackgroundUI();
}

function syncBackgroundUI(){
  $('bgType').value = bg.type;
  for (const [type, id] of [['color', 'bgColorRow'], ['gradient', 'bgGradientRow'], ['image', 'bgImageRow'], ['transparent', 'bgTransparentRow']])
    $(id).hidden = bg.type !== type;
  $('bgc').value = bg.color;
  $('g1').value = bg.from; $('g2').value = bg.to;
  $('gAngle').value = bg.angle;
  $('bgImageBtn').textContent = bg.imageId ? 'Cambiar imagen…' : 'Elegir imagen…';
  $('format').value = state.format;
}

export function setFormat(format){
  state.format = format; resize(); applyBackground();
}

export function initFrame(){
  addEventListener('resize', resize);
  new ResizeObserver(() => resize()).observe(stage);
  $('format').onchange = e => { setFormat(e.target.value); markChanged(); };
  $('quality').onchange = () => resize();

  const bgFile = $('bgFile');
  $('bgType').onchange = e => { bg.type = e.target.value; applyBackground(); markChanged(); if (bg.type === 'image' && !bg.imageId) bgFile.click(); };
  for (const [id, key] of [['bgc', 'color'], ['g1', 'from'], ['g2', 'to'], ['gAngle', 'angle']]) {
    const el = $(id);
    el.addEventListener('input', () => { bg[key] = key === 'angle' ? +el.value : el.value; applyBackground(); });
    el.addEventListener('change', () => markChanged());
  }
  for (const [from, to] of GRADIENT_PRESETS) {
    const b = document.createElement('button');
    b.style.background = `linear-gradient(135deg, ${from}, ${to})`; b.title = `${from} → ${to}`;
    b.onclick = () => { Object.assign(bg, { from, to }); applyBackground(); markChanged(); };
    $('gPresets').append(b);
  }
  $('bgImageBtn').onclick = () => bgFile.click();
  bgFile.onchange = async () => {
    const f = bgFile.files[0]; bgFile.value = ''; if (!f) return;
    bg.imageId = addImage(await imageFileToDataURL(f)); bg.type = 'image';
    await applyBackground(); markChanged();
  };
  resize(); applyBackground();
}
