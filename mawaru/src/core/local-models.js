import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODELS, placeholderTexture, UNITS_PER_CM } from './device-model.js';

// ---- Imported device models (tools/rotato2glb.py → local-models/) ----
// Personal use only: the folder is git-ignored and only exists on this machine. When it is
// missing (or in a production build) the editor simply offers the built-in models.
const BASE = '/local-models/';
const loader = new GLTFLoader();
const loading = new Map();         // type -> Promise<template>
const templates = new Map();       // type -> prepared template, ready to clone

export const isLocal = type => typeof type === 'string' && type.startsWith('local:');
export const localTypes = [];

function categoryOf(name){
  const n = name.toLowerCase();
  if (/macbook|laptop|surface/.test(n)) return 'macbook';
  if (/ipad|tablet|imac|xdr|tv|display/.test(n)) return 'ipad';
  return 'iphone';
}

// Filter tags for the start screen (a model can have several: an iPhone is also a Phone)
export const DEVICE_TAGS = ['iphone', 'phone', 'multi', 'generic', 'tablet', 'desktop', 'android', 'laptop', 'watch'];
function tagsFor(label, entry){
  const n = label.toLowerCase();
  const screens = entry.screens.filter(s => /screen/i.test(s.node)).length;
  if (screens > 1 || /\+| on a |family|flow|toss-up|double|triple/.test(n)) return ['multi'];
  const t = new Set();
  if (/watch/.test(n)) t.add('watch');
  if (/macbook|laptop|surface/.test(n)) t.add('laptop');
  if (/imac|xdr|\btv\b|monitor/.test(n)) t.add('desktop');
  if (/ipad|tablet/.test(n)) t.add('tablet');
  if (/galaxy|samsung s|pixel|^9 pro|android/.test(n)) t.add('android');
  if (/iphone|pro max notchless/.test(n)) t.add('iphone');
  if (/generic|universal|clean|glass phone|phone display|infinity/.test(n)) t.add('generic');
  if (t.has('iphone') || t.has('android') || /phone/.test(n)) t.add('phone');
  return [...t];
}

export async function registerLocalModels(){
  let manifest;
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return 0;
    manifest = await r.json();
  } catch { return 0; }
  const seen = new Map();
  for (const e of manifest.models ?? []) {
    const fromFile = e.source?.replace(/\.rotato$/, '') ?? e.file;
    let label = e.name && e.name !== 'Scene' ? e.name : fromFile;     // several source scenes are just called "Scene"
    if (seen.has(label)) label = fromFile;
    seen.set(label, true);
    const type = 'local:' + e.file;
    MODELS[type] = {
      local: true, label, subtitle: 'Modelo local', category: categoryOf(label), defaultScale: 1,
      caseColor: '#cccccc', file: e.file, thumbnail: e.thumbnail ? BASE + e.thumbnail : null, entry: e, tags: tagsFor(label, e),
      build: caseColor => buildLocal(type, caseColor),
    };
    localTypes.push(type);
  }
  localTypes.sort((a, b) => MODELS[a].label.localeCompare(MODELS[b].label, 'es', { numeric: true }));
  return localTypes.length;
}

// Load + prepare once; every device then gets a cheap clone
export function ensureModel(type){
  if (!isLocal(type)) return Promise.resolve();
  if (!MODELS[type]) return Promise.reject(new Error('Modelo local no disponible: ' + type));
  if (!loading.has(type)) {
    loading.set(type, loader.loadAsync(BASE + MODELS[type].file).then(gltf => {
      templates.set(type, prepare(type, gltf.scene));
    }));
    loading.get(type).catch(() => loading.delete(type));
  }
  return loading.get(type);
}
export const modelReady = type => !isLocal(type) || templates.has(type);

function prepare(type, root){
  const model = MODELS[type], entry = model.entry;
  // baked shadow meshes: the editor draws its own
  const drop = [];
  root.traverse(o => { if (o.isMesh && (/shadow/i.test(o.name) || /shadow/i.test(o.material?.name ?? ''))) drop.push(o); });
  drop.forEach(o => o.removeFromParent());

  // screens: glTF puts the UV origin top-left; the editor's textures assume bottom-left → flip once here
  const screenNames = new Set(entry.screens.map(s => s.node).filter(n => /screen/i.test(n)));
  let screenBox = null;
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    let p = o, hit = false;
    while (p && !hit) { hit = screenNames.has(p.name); p = p.parent; }
    if (!hit) return;
    o.userData.isScreen = true;
    o.geometry = o.geometry.clone();
    const uv = o.geometry.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    o.geometry.computeBoundingBox();
    screenBox ??= o.geometry.boundingBox.getSize(new THREE.Vector3());
  });
  const colorable = new Set(entry.colorableMaterials);
  let caseColor = null;
  root.traverse(o => {
    if (o.isMesh && !caseColor && colorable.has(o.material?.name)) caseColor = '#' + o.material.color.getHexString();
  });

  // imported models are in real centimetres: one shared factor keeps their true relative sizes
  // (and matches the built-in models). Centred on the origin; outer group scale 1 = real size.
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.scale.setScalar(UNITS_PER_CM);
  root.position.sub(center);
  inner.add(root);

  const [sw, sh] = entry.screenSize ?? [];
  model.screenAspect = sw && sh ? sw / sh : screenBox ? screenBox.x / Math.max(screenBox.y, 1e-6) : 0.5;
  model.caseColor = caseColor ?? '#cccccc';
  model.hasScreen = screenNames.size > 0;
  return { inner, colorable };
}

function buildLocal(type, caseColor){
  const t = templates.get(type), model = MODELS[type];
  if (!t) throw new Error('Modelo local sin cargar: ' + type);
  const group = new THREE.Group();
  group.add(t.inner.clone(true));
  const screenMat = new THREE.MeshBasicMaterial({ map: placeholderTexture(model.screenAspect), toneMapped: false });
  const caseMats = new Map(), glassMats = [], glasses = [], pickables = [], materials = [screenMat];
  group.traverse(o => {
    if (!o.isMesh) return;
    pickables.push(o);
    if (o.userData.isScreen) { o.material = screenMat; return; }
    const src = o.material;
    if (t.colorable.has(src.name)) {
      if (!caseMats.has(src)) { const m = src.clone(); m.color.set(caseColor); caseMats.set(src, m); materials.push(m); }
      o.material = caseMats.get(src);
    } else if (src.userData?.rotato?.blendMode === 'add') {    // SceneKit additive screen glass
      const m = src.clone();
      Object.assign(m, { blending: THREE.AdditiveBlending, opacity: 1, transparent: true, depthWrite: false });
      m.userData.relativeReflection = true;
      o.material = m; glasses.push(o); glassMats.push(m); materials.push(m);
      return;
    }
    o.castShadow = !src.transparent;
  });
  return {
    group, screenMat, glasses, glassMats, materials, pickables, screenAspect: model.screenAspect,
    screen: pickables.find(o => o.userData.isScreen) ?? pickables[0],
    setCaseColor: c => { for (const m of caseMats.values()) m.color.set(c); },
  };
}
