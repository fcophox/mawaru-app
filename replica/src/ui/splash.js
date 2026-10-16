import { $ } from '../state.js';
import { MODELS } from '../core/device-model.js';
import { localTypes } from '../core/local-models.js';
import { newProject, loadProject, savedProject, projStatus } from './project.js';

// ---- Start screen: pick a template (built-in or from your Rotato downloads) or resume the last project ----
const splash = $('splash');
let dismissable = false;     // at launch a choice is required; "Nuevo" can be cancelled
let busy = false;

export function showSplash({ canCancel = false } = {}){
  dismissable = canCancel;
  const saved = savedProject(), btn = $('continueProj');
  btn.hidden = !saved;
  if (saved) {
    const types = [...new Set((saved.devices ?? [{ type: 'iphone' }]).map(d => MODELS[d.type]?.label ?? 'iPhone'))].join(' + ');
    btn.textContent = `Continuar «${saved.name ?? 'Sin título'}» (${types})`;
  }
  $('splashStatus').textContent = '';
  splash.hidden = false;
  splash.querySelector('.template').focus();
}

function hideSplash(){ splash.hidden = true; }

// Run a start action, showing progress (local models can take a moment to load)
async function start(action, button){
  if (busy) return;
  busy = true; button?.classList.add('loading');
  $('splashStatus').textContent = 'Cargando…';
  try { await action(); hideSplash(); }
  catch (err) { console.error(err); $('splashStatus').textContent = 'No se pudo abrir: ' + err.message; }
  finally { busy = false; button?.classList.remove('loading'); }
}

function renderLocalTemplates(){
  const box = $('localTemplates'), grid = $('localGrid');
  box.hidden = !localTypes.length;
  if (!localTypes.length) return;
  $('localCount').textContent = `(${localTypes.length})`;
  grid.innerHTML = '';
  for (const type of localTypes) {
    const m = MODELS[type], b = document.createElement('button');
    b.className = 'local-item'; b.dataset.type = type; b.dataset.search = m.label.toLowerCase();
    b.innerHTML = (m.thumbnail ? `<img src="${m.thumbnail}" alt="" loading="lazy">` : '') + `<span>${m.label}</span>`;
    b.onclick = () => start(() => newProject(type), b);
    grid.append(b);
  }
  $('localSearch').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of grid.children) b.hidden = q && !b.dataset.search.includes(q);
  };
}

export function initSplash(){
  for (const b of splash.querySelectorAll('.template')) b.onclick = () => start(() => newProject(b.dataset.type), b);
  renderLocalTemplates();
  $('continueProj').onclick = e => start(async () => {
    await loadProject(savedProject());
    projStatus.textContent = 'Recuperado el último autoguardado';
  }, e.currentTarget);
  $('newProj').onclick = () => showSplash({ canCancel: true });
  splash.addEventListener('click', e => { if (dismissable && e.target === splash) hideSplash(); });
  // capture phase: while the start screen is open, editor shortcuts (Space, K, …) must not fire behind it
  addEventListener('keydown', e => {
    if (splash.hidden) return;
    if (e.target.matches?.('input')) return;                 // typing in the search box
    e.stopPropagation();
    if (e.key === 'Escape' && dismissable) hideSplash();
  }, true);
}
