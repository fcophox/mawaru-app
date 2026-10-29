import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { $ } from '../state.js';
import { renderer, scene, hemi, key, shadowMat, shadowPlane } from '../core/scene.js';
import { MODELS } from '../core/device-model.js';
import { devices, selectedDevice, renderDeviceList } from './devices.js';
import { markChanged } from './project.js';

// ---- Look: HDRI environment, shadow, reflections, case colour ----
const PH = n => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${n}_1k.hdr`;   // Poly Haven, CC0
export const ENVIRONMENTS = {
  room:    { label: 'Estudio (sin conexión)' },
  studio:  { label: 'Estudio pequeño', url: PH('studio_small_09') },
  photo:   { label: 'Estudio fotográfico', url: PH('brown_photostudio_02') },
  loft:    { label: 'Loft', url: PH('photo_studio_loft_hall') },
  sunset:  { label: 'Atardecer', url: PH('venice_sunset') },
  sky:     { label: 'Cielo abierto', url: PH('kloofendal_48d_partly_cloudy_puresky') },
  none:    { label: 'Sin entorno' },
};
const CASE_COLORS = [['#ecebe7', 'Blanco'], ['#bdb7ab', 'Titanio natural'], ['#2b2b2e', 'Titanio negro'], ['#3b4a5e', 'Azul'], ['#c4a986', 'Desierto']];
export const LOOK_DEFAULTS = { env: 'room', envIntensity: 1, envRotation: 0,
  shadow: true, shadowIntensity: 0.35, shadowSoftness: 16, reflections: true, reflectionIntensity: 0.18 };
export const look = { ...LOOK_DEFAULTS };

const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = new Map();
const envStatus = $('envStatus');
async function loadEnvironment(name){
  if (name === 'none') return null;
  if (!envCache.has(name)) {
    envCache.set(name, (async () => {
      if (!ENVIRONMENTS[name].url) return pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const hdr = await new RGBELoader().loadAsync(ENVIRONMENTS[name].url);
      const tex = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
      return tex;
    })());
  }
  return envCache.get(name);
}

let envRequest = 0;
export async function applyEnvironment(){
  const req = ++envRequest, name = look.env;
  envStatus.hidden = !ENVIRONMENTS[name].url; envStatus.textContent = 'Cargando HDRI…';
  try {
    const tex = await loadEnvironment(name);
    if (req !== envRequest) return;               // a newer choice won
    scene.environment = tex; envStatus.hidden = true;
  } catch {
    envCache.delete(name);
    if (req !== envRequest) return;
    envStatus.hidden = false; envStatus.textContent = 'No se pudo cargar el HDRI; usando el estudio sin conexión.';
    scene.environment = await loadEnvironment('room');
  }
}

// Shadow catcher: a backdrop behind phones/tablets; with a laptop in the scene it becomes the floor,
// so the keyboard base casts a natural ground shadow instead of a slab on the wall.
const box = new THREE.Box3(), tmp = new THREE.Box3(), center = new THREE.Vector3();
// Devices now come in real sizes (a watch to an iMac), so the catcher and the shadow camera follow the scene.
const lightDir = key.position.clone().normalize();
export function updateShadowCatcher(){
  box.makeEmpty();
  for (const d of devices) box.union(tmp.setFromObject(d.group));
  if (box.isEmpty()) return;
  box.getCenter(center);
  const radius = Math.max(box.getSize(tmp.min).length() / 2, 4);
  if (devices.some(d => MODELS[d.type]?.category === 'macbook')) {
    shadowPlane.rotation.set(-Math.PI / 2, 0, 0);
    shadowPlane.position.set(center.x, box.min.y - 0.02, center.z);
  } else {
    shadowPlane.rotation.set(0, 0, 0);
    shadowPlane.position.set(center.x, center.y, box.min.z - Math.max(1.3, radius * 0.12));
  }
  // orthographic shadow camera sized to the scene (keeps the blur consistent for small and big devices)
  const cam = key.shadow.camera, r = radius * 1.6;
  if (Math.abs(cam.right - r) > 0.5 || key.target.position.distanceToSquared(center) > 0.25) {
    key.position.copy(center).addScaledVector(lightDir, radius * 3);
    key.target.position.copy(center); key.target.updateMatrixWorld();
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: radius * 6 });
    cam.updateProjectionMatrix();
  }
}

export function applyLook(){
  scene.environmentIntensity = look.envIntensity;
  scene.environmentRotation.set(0, THREE.MathUtils.degToRad(look.envRotation), 0);
  shadowPlane.visible = look.shadow; key.castShadow = look.shadow;
  shadowMat.opacity = look.shadowIntensity; key.shadow.radius = look.shadowSoftness;
  for (const d of devices) {
    for (const g of d.glasses) g.visible = look.reflections;
    // built-in glass: opacity = strength; imported additive glass is calibrated at 1 for the default strength
    for (const m of d.glassMats) m.opacity = m.userData.relativeReflection ? Math.min(1, look.reflectionIntensity / LOOK_DEFAULTS.reflectionIntensity) : look.reflectionIntensity;
  }
  hemi.intensity = look.env === 'none' ? 1.4 : 0.25;
  syncLookUI();
}

function setCaseColor(color){      // case colour of the selected device
  const d = selectedDevice(); if (!d) return;
  d.caseColor = color; d.setCaseColor(color);
  $('caseColor').value = color;
  renderDeviceList();
}

export function syncLookUI(){
  const set = (id, v) => { const el = $(id); if (el.type === 'checkbox') el.checked = v; else el.value = v; };
  set('envPreset', look.env); set('envIntensity', look.envIntensity); set('envRotation', look.envRotation);
  set('caseColor', selectedDevice()?.caseColor ?? '#ecebe7'); set('shadowOn', look.shadow); set('shadowIntensity', look.shadowIntensity);
  set('shadowSoftness', look.shadowSoftness); set('reflectOn', look.reflections); set('reflectIntensity', look.reflectionIntensity);
}

export function initLook(){
  const envSel = $('envPreset');
  envSel.innerHTML = Object.entries(ENVIRONMENTS).map(([k, e]) => `<option value="${k}">${e.label}</option>`).join('');
  envSel.onchange = () => { look.env = envSel.value; applyLook(); applyEnvironment(); markChanged(); };
  for (const [id, keyName] of [['envIntensity', 'envIntensity'], ['envRotation', 'envRotation'],
      ['shadowIntensity', 'shadowIntensity'], ['shadowSoftness', 'shadowSoftness'], ['reflectIntensity', 'reflectionIntensity']]) {
    const el = $(id);
    el.addEventListener('input', () => { look[keyName] = Number(el.value); applyLook(); });
    el.addEventListener('change', () => markChanged());
  }
  for (const [id, keyName] of [['shadowOn', 'shadow'], ['reflectOn', 'reflections']]) {
    const el = $(id);
    el.addEventListener('change', () => { look[keyName] = el.checked; applyLook(); markChanged(); });
  }
  const caseEl = $('caseColor');
  caseEl.addEventListener('input', () => setCaseColor(caseEl.value));
  caseEl.addEventListener('change', () => markChanged());
  for (const [color, name] of CASE_COLORS) {
    const b = document.createElement('button'); b.style.background = color; b.title = name;
    b.onclick = () => { setCaseColor(color); markChanged(); };
    $('casePresets').append(b);
  }
  applyLook(); applyEnvironment();
}
