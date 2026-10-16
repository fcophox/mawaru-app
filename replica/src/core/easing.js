// CAMediaTimingFunction cubic-bezier, solved for x→y
export function bezier(c1x, c1y, c2x, c2y){
  const cx = 3 * c1x, bx = 3 * (c2x - c1x) - cx, ax = 1 - cx - bx, cy = 3 * c1y, by = 3 * (c2y - c1y) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || !d) break; t -= e / d; }
    t = Math.min(1, Math.max(0, t)); return sy(t);
  };
}

// The segment that ENDS at keyframe i uses keyframes[i].ease.
export const EASES = {
  rotato:    { label: 'Rotato',        v: [0.25, 0.1, 0.25, 1] },
  linear:    { label: 'Lineal',        v: [0, 0, 1, 1] },
  easeIn:    { label: 'Ease in',       v: [0.42, 0, 1, 1] },
  easeOut:   { label: 'Ease out',      v: [0, 0, 0.58, 1] },
  easeInOut: { label: 'Ease in-out',   v: [0.42, 0, 0.58, 1] },
  smooth:    { label: 'Suave',         v: [0.65, 0, 0.35, 1] },
  overshoot: { label: 'Sobrepaso',     v: [0.34, 1.56, 0.64, 1] },
  cut:       { label: 'Corte (salto)', v: null },
};

export const easeKey = arr => Object.keys(EASES).find(k => EASES[k].v && EASES[k].v.every((x, i) => Math.abs(x - arr[i]) < 1e-3));

const easeFns = new Map();
export function easeFn(kf){
  const v = kf.ease === 'custom' ? kf.bez : EASES[kf.ease].v;
  const key = v.join();
  if (!easeFns.has(key)) easeFns.set(key, bezier(...v));
  return easeFns.get(key);
}
