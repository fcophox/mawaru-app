import { $ } from '../state.js';
import { MODELS } from '../core/device-model.js';
import { localTypes, DEVICE_TAGS } from '../core/local-models.js';
import { newProject } from './project.js';

// ---- Start screen: pick a device to start a project (filter by type, or search by name) ----
const splash = $('splash');
let dismissable = false;     // at launch a choice is required; "Nuevo" can be cancelled
let busy = false;
let activeTag = 'all';

// Small line icons for the filter chips (24×24, stroke = currentColor)
const ICONS = {
  all:     '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  iphone:  '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 5h3"/>',
  phone:   '<rect x="7" y="2.5" width="10" height="19" rx="2" fill="currentColor" fill-opacity=".35"/>',
  multi:   '<rect x="3" y="7" width="8" height="14" rx="1.5"/><rect x="13" y="3" width="8" height="14" rx="1.5"/>',
  generic: '<rect x="6.5" y="3.5" width="11" height="17" rx="3" fill="currentColor" fill-opacity=".35"/>',
  tablet:  '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M11 18.5h2"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  android: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><circle cx="12" cy="5.5" r=".8" fill="currentColor"/>',
  laptop:  '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 18.5h19"/>',
  watch:   '<rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9 6.5 9.5 3h5l.5 3.5M9 17.5l.5 3.5h5l.5-3.5"/>',
};
const LABELS = { all: 'All', iphone: 'iPhone', phone: 'Phone', multi: 'Multi', generic: 'Generic', tablet: 'Tablet',
  desktop: 'Desktop', android: 'Android', laptop: 'Laptop', watch: 'Watch' };
const icon = tag => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[tag]}</svg>`;

export function showSplash({ canCancel = false } = {}){
  dismissable = canCancel;
  $('splashStatus').textContent = '';
  splash.hidden = false;
  splash.querySelector('.chip.active, .local-item:not([hidden]), .templates:not([hidden]) .template')?.focus();
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

// Type chip + search box, combined
function applyFilter(){
  const q = $('localSearch').value.trim().toLowerCase();
  let shown = 0;
  for (const b of $('localGrid').children) {
    const ok = (activeTag === 'all' || b.dataset.tags.split(' ').includes(activeTag)) && (!q || b.dataset.search.includes(q));
    b.hidden = !ok; shown += ok;
  }
  $('localCount').textContent = `(${shown}${shown !== localTypes.length ? ' de ' + localTypes.length : ''})`;
  for (const c of $('localChips').children) {
    c.classList.toggle('active', c.dataset.tag === activeTag);
    c.setAttribute('aria-pressed', c.dataset.tag === activeTag);
  }
}

function renderChips(){
  const counts = { all: localTypes.length };
  for (const t of localTypes) for (const tag of MODELS[t].tags) counts[tag] = (counts[tag] ?? 0) + 1;
  $('localChips').innerHTML = '';
  for (const tag of ['all', ...DEVICE_TAGS]) {
    if (!counts[tag]) continue;                       // only types present in your downloads
    const c = document.createElement('button');
    c.className = 'chip'; c.dataset.tag = tag; c.title = `${LABELS[tag]} · ${counts[tag]}`;
    c.innerHTML = icon(tag) + `<span>${LABELS[tag]}</span>`;
    c.onclick = () => { activeTag = tag; applyFilter(); };
    $('localChips').append(c);
  }
}

// With imported models the start screen offers only those; the built-in
// generic templates remain as a fallback when local-models/ is empty (e.g. a fresh clone).
function renderLocalTemplates(){
  const box = $('localTemplates'), grid = $('localGrid');
  box.hidden = !localTypes.length;
  splash.querySelector('.templates').hidden = localTypes.length > 0;
  splash.querySelector('.splash-card').classList.toggle('only-local', localTypes.length > 0);
  if (!localTypes.length) return;
  grid.innerHTML = '';
  for (const type of localTypes) {
    const m = MODELS[type], b = document.createElement('button');
    b.className = 'local-item'; b.dataset.type = type; b.dataset.search = m.label.toLowerCase(); b.dataset.tags = m.tags.join(' ');
    b.innerHTML = (m.thumbnail ? `<img src="${m.thumbnail}" alt="" loading="lazy">` : '') + `<span>${m.label}</span>`;
    b.onclick = () => start(() => newProject(type), b);
    grid.append(b);
  }
  renderChips();
  $('localSearch').oninput = applyFilter;
  applyFilter();
}

export function initSplash(){
  for (const b of splash.querySelectorAll('.template')) b.onclick = () => start(() => newProject(b.dataset.type), b);
  renderLocalTemplates();
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
