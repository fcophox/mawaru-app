import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Procedural device models with real-world proportions (1 unit ≈ 23.5 mm, so the iPhone is 3 × 6.2).
// At defaultScale every model is shown at its REAL size relative to the others (1.7 → 1 unit ≈ 13.8 mm),
// so an iPad or a MacBook is bigger than an iPhone; templates and presets frame the scene to fit.
function roundedRect(w, h, r){
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function planarScreenGeo(w, h, r){
  const geo = new THREE.ShapeGeometry(roundedRect(w, h, r), 12);
  const p = geo.attributes.position, uv = geo.attributes.uv;      // planar UVs over the screen rect
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return geo;
}

const blackGlass = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.15, metalness: 0, clearcoat: 1 });
const keyboardMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0.2 });
const caseMaterial = color => new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2 });
const glassMaterial = () => new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, transparent: true,
  opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });

const placeholders = new Map();
// scene units per real centimetre at default scale: the built-in models are drawn at 1 unit = 2.35 cm
export const UNITS_PER_CM = 1.7 / 2.35;

export function placeholderTexture(aspect){
  const key = aspect.toFixed(3);
  if (placeholders.has(key)) return placeholders.get(key);
  const w = aspect >= 1 ? 1280 : Math.round(1280 * aspect), h = aspect >= 1 ? Math.round(1280 / aspect) : 1280;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#6a5cff'); grd.addColorStop(1, '#ff6ab0');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(Math.min(w, h) * 0.1)}px -apple-system,system-ui`; g.textAlign = 'center';
  g.fillText('Drop a', w / 2, h / 2 - Math.min(w, h) * 0.02); g.fillText('screenshot', w / 2, h / 2 + Math.min(w, h) * 0.11);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  placeholders.set(key, t);
  return t;
}

// Front of a slab-shaped device: black glass, screen, optional camera cut-out, reflective glass layer
function addFront(parent, { w, h, r, sw, sh, sr, z, screenY = 0, cutout }){
  const front = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 16), blackGlass);
  front.position.z = z + 0.001;
  const screenMat = new THREE.MeshBasicMaterial({ map: placeholderTexture(sw / sh), toneMapped: false });   // screens show their pixels as-is
  const screen = new THREE.Mesh(planarScreenGeo(sw, sh, sr), screenMat);
  screen.position.set(0, screenY, z + 0.002);
  parent.add(front, screen);
  if (cutout) {    // Dynamic Island / notch, drawn over the screen
    const c = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(cutout.w, cutout.h, cutout.r), 8), blackGlass);
    c.position.set(0, screenY + sh / 2 - cutout.top - cutout.h / 2, z + 0.0025);
    parent.add(c);
  }
  const glassMat = glassMaterial();
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, h, r), 16), glassMat);
  glass.position.z = z + 0.003;
  parent.add(glass);
  return { screen, screenMat, glass, glassMat };
}

function buildPhoneLike({ W, H, D, R, bezel, screenR, cutout }){
  return caseColor => {
    const group = new THREE.Group();
    const bodyMat = caseMaterial(caseColor);
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 8, Math.min(R, D / 2 - 0.001)), bodyMat);
    body.castShadow = true;
    group.add(body);
    const sw = W - 2 * bezel, sh = H - 2 * bezel;
    const front = addFront(group, { w: W - 0.06, h: H - 0.06, r: R - 0.03, sw, sh, sr: screenR, z: D / 2, cutout });
    return { group, ...front, glasses: [front.glass], glassMats: [front.glassMat], materials: [bodyMat, front.screenMat, front.glassMat],
      pickables: [body, front.screen], setCaseColor: c => bodyMat.color.set(c), screenAspect: sw / sh };
  };
}

// MacBook: base with keyboard + trackpad, and a lid on a hinge (lidAngle = degrees between lid and base)
function buildLaptop({ W, LH, LT, BD, BT, R, sw, sh, screenY }){
  return caseColor => {
    const group = new THREE.Group();
    const bodyMat = caseMaterial(caseColor);
    const trackpadMat = caseMaterial(caseColor);
    trackpadMat.roughness = 0.45;
    const tint = c => trackpadMat.color.set(c).multiplyScalar(0.93);
    tint(caseColor);
    // lid: pivot on the hinge at the bottom edge of the screen
    const hinge = new THREE.Group();
    hinge.position.set(0, -LH / 2, 0);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(W, LH, LT, 6, Math.min(R, LT / 2 - 0.001)), bodyMat);
    lid.position.y = LH / 2; lid.castShadow = true;
    const lidFront = new THREE.Group(); lidFront.position.y = LH / 2;
    const front = addFront(lidFront, { w: W - 0.05, h: LH - 0.05, r: R - 0.02, sw, sh, sr: 0.12, z: LT / 2, screenY,
      cutout: { w: 1.0, h: 0.2, r: 0.08, top: 0 } });
    hinge.add(lid, lidFront);
    // base: the back edge sits under the hinge
    const base = new THREE.Mesh(new RoundedBoxGeometry(W, BT, BD, 6, Math.min(R, BT / 2 - 0.001)), bodyMat);
    base.position.set(0, -LH / 2 - BT / 2, BD / 2 - LT / 2);
    base.castShadow = true;
    const keyboard = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W * 0.86, BD * 0.4, 0.12), 6), keyboardMat);
    keyboard.rotation.x = -Math.PI / 2;
    keyboard.position.set(0, -LH / 2 + 0.001, -LT / 2 + 0.55 + BD * 0.2);
    const trackpad = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W * 0.42, BD * 0.32, 0.15), 6), trackpadMat);
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, -LH / 2 + 0.001, BD - LT / 2 - 0.45 - BD * 0.16);
    group.add(hinge, base, keyboard, trackpad);
    const setLidAngle = deg => { hinge.rotation.x = -THREE.MathUtils.degToRad(deg - 90); };
    setLidAngle(110);
    // pivot at the centre of the open laptop (not the lid), so the gizmo and "Centrar vista" sit in the middle
    group.updateMatrixWorld(true);
    const mid = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    for (const child of group.children) child.position.sub(mid);
    return { group, ...front, glasses: [front.glass], glassMats: [front.glassMat], materials: [bodyMat, trackpadMat, front.screenMat, front.glassMat],
      pickables: [lid, base, front.screen], screenAspect: sw / sh, setLidAngle, setCaseColor: c => { bodyMat.color.set(c); tint(c); } };
  };
}

// Built-in models; imported models are added at runtime (core/local-models.js)
export const MODELS = {
  iphone: {
    category: 'iphone', label: 'iPhone', subtitle: 'iPhone 15 Pro · 6,1"', defaultScale: 1.7, caseColor: '#ecebe7',
    build: buildPhoneLike({ W: 3.0, H: 6.2, D: 0.32, R: 0.42, bezel: 0.09, screenR: 0.34,
      cutout: { w: 0.78, h: 0.22, r: 0.11, top: 0.14 } }),
  },
  ipad: {
    category: 'ipad', label: 'iPad', subtitle: 'iPad Pro · 11"', defaultScale: 1.7, caseColor: '#d9dadc',
    build: buildPhoneLike({ W: 7.6, H: 10.53, D: 0.23, R: 0.75, bezel: 0.3, screenR: 0.48 }),
  },
  macbook: {
    category: 'macbook', label: 'MacBook Pro', subtitle: 'MacBook Pro · 14"', defaultScale: 1.7, caseColor: '#2e2f31', laptop: true,
    build: buildLaptop({ W: 13.3, LH: 9.25, LT: 0.2, BD: 9.4, BT: 0.42, R: 0.35, sw: 12.75, sh: 8.3, screenY: 0.12 }),
  },
};

export function buildDeviceMesh(type, caseColor){
  return MODELS[type].build(caseColor);
}
