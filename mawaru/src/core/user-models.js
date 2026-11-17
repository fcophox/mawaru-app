import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { registerModel, unregisterModel } from './local-models.js';

// ---- Device models the user imports from the app (.glb), kept in IndexedDB ----
// Each record: { id, name, tag, screens: [mesh names], colorable: [material names], cmPerUnit, glb: Blob, thumbnail: Blob }
// They register as 'local:user-<id>.glb', so projects, pickers and the scene treat them like any imported model.
const DB = 'mawaru', STORE = 'models';
const typeOf = id => `local:user-${id}.glb`;
export const isUserModel = type => typeof type === 'string' && type.startsWith('local:user-');

function db(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn){
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { d.close(); resolve(req?.result); };
    t.onerror = t.onabort = () => { d.close(); reject(t.error); };
  });
}

function register(rec){
  const type = typeOf(rec.id);
  registerModel(type, {
    label: rec.name, subtitle: 'Modelo importado', tags: [rec.tag, ...(rec.tag === 'iphone' || rec.tag === 'android' ? ['phone'] : [])],
    thumbnail: rec.thumbnail ? URL.createObjectURL(rec.thumbnail) : null,
    entry: { file: `user-${rec.id}.glb`, screens: rec.screens.map(node => ({ node })), exactScreens: true,
      colorableMaterials: rec.colorable, cmPerUnit: rec.cmPerUnit },
    load: () => rec.glb.arrayBuffer(),
  });
  return type;
}

export async function registerUserModels(){
  try {
    const all = await tx('readonly', s => s.getAll());
    return all.map(register).length;
  } catch (err) { console.warn('Modelos importados no disponibles:', err); return 0; }
}

// ---- Import: read a .glb, suggest its screen, material and real size; save after the user confirms ----
const SCREEN_RE = /screen|display|pantalla|lcd|oled/i;

export async function analyzeGLB(file){
  if (!/\.glb$/i.test(file.name)) throw new Error('Usa un archivo .glb (glTF binario con las texturas incluidas).');
  const buf = await file.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const meshes = [], materials = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = [].concat(o.material).map(m => m?.name).filter(Boolean);
    mats.forEach(m => materials.add(m));
    let p = o, screenish = false;
    while (p && !screenish) { screenish = SCREEN_RE.test(p.name); p = p.parent; }
    meshes.push({ name: o.name || '(sin nombre)', named: !!o.name, screenish: screenish || mats.some(m => SCREEN_RE.test(m)) });
  });
  if (!meshes.length) throw new Error('El archivo no tiene mallas.');
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  // guess the unit from the size: a device is roughly 3–80 cm long
  const cmPerUnit = longest < 3 ? 100 : longest > 300 ? 0.1 : 1;
  const nameOf = file.name.replace(/\.glb$/i, '').replace(/[-_]+/g, ' ').trim();
  return {
    file, root, longest, cmPerUnit, name: nameOf || 'Modelo',
    meshes, screen: meshes.find(m => m.screenish && m.named)?.name ?? null,
    materials: [...materials], colorable: [...materials].find(m => /body|case|frame|back|carcasa|chassis|shell/i.test(m)) ?? null,
  };
}

// A small transparent preview for the pickers, framed from the front
export async function renderThumbnail(root, w = 220, h = 116){
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const clone = root.clone(true);
    scene.add(clone);
    const box = new THREE.Box3().setFromObject(clone), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const camera = new THREE.PerspectiveCamera(25, w / h, 0.001, 1e5);
    const fit = Math.max(size.y, size.x / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(12.5)) * 1.1;
    camera.position.set(center.x, center.y, center.z + size.z / 2 + fit);
    camera.lookAt(center);
    renderer.render(scene, camera);
    pmrem.dispose();
    return await new Promise(r => renderer.domElement.toBlob(r, 'image/png'));
  } finally { renderer.dispose(); renderer.forceContextLoss(); }
}

export async function saveUserModel({ file, name, tag, screen, colorable, cmPerUnit, root }){
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || 'Modelo', tag, screens: screen ? [screen] : [], colorable: colorable ? [colorable] : [],
    cmPerUnit, glb: file, thumbnail: await renderThumbnail(root).catch(() => null),
  };
  // store the bytes, not the File handle: it must outlive the original file
  rec.glb = new Blob([await file.arrayBuffer()], { type: 'model/gltf-binary' });
  await tx('readwrite', s => s.put(rec));
  return register(rec);
}

export async function deleteUserModel(type){
  const id = type.slice('local:user-'.length, -'.glb'.length);
  await tx('readwrite', s => s.delete(id));
  unregisterModel(type);
}
