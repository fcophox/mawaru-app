import { $ } from '../state.js';
import { MODELS } from '../core/device-model.js';
import { localTypes, DEVICE_TAGS, hasFolderModels, pickerTypes } from '../core/local-models.js';
import { isUserModel, analyzeGLB, renderThumbnail, saveUserModel, deleteUserModel } from '../core/user-models.js';
import { fillModelSelect } from './devices.js';
import { newProject } from './project.js';
import { createScenes, scenes, scenesDeviceType } from './scenes.js';

// ---- Start screen: home (two modes) → pick a device, or bulk-load designs into 16:9 scenes ----
const splash = $('splash');
let dismissable = false;     // at launch a choice is required; "Nuevo" can be cancelled
let busy = false;
let activeTag = 'all';
let view = 'home';
const VIEWS = { home: 'splashHome', devices: 'splashDevices', scenes: 'splashScenes' };

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

export function showSplash({ canCancel = false, mode = 'home', append = false } = {}){
  dismissable = canCancel;
  appendMode = append;
  splash.hidden = false;
  showView(mode);
}

function showView(name){
  view = name;
  $('splashStatus').textContent = '';
  for (const [k, id] of Object.entries(VIEWS)) $(id).hidden = k !== name;
  const section = $(VIEWS[name]);
  splash.querySelector('.splash-card').setAttribute('aria-labelledby', section.dataset.title);
  splash.querySelector('.splash-card').classList.toggle('wide-card', name !== 'home');
  if (name === 'scenes') prepareScenesView();
  const focus = name === 'home' ? '#modeDevices'
    : name === 'devices' ? '.chip.active, .local-item:not([hidden]), .templates:not([hidden]) .template'
    : '#designDrop';
  section.querySelector(focus)?.focus();
}

function hideSplash(){ splash.hidden = true; }

// Run a start action, showing progress (local models can take a moment to load)
async function start(action, button){
  if (busy) return;
  busy = true; button?.classList.add('loading'); if (button) button.disabled = true;
  $('splashStatus').textContent = 'Cargando…';
  try { await action(); hideSplash(); }
  catch (err) { console.error(err); $('splashStatus').textContent = 'No se pudo abrir: ' + err.message; }
  finally { busy = false; button?.classList.remove('loading'); if (button) button.disabled = false; if (view === 'scenes') updatePlan(); }
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

// A local-models/ folder replaces the built-in templates on the start screen; models imported
// from the app are listed below whichever set is shown (and can be removed from here).
function renderLocalTemplates(){
  const box = $('localTemplates'), grid = $('localGrid');
  box.hidden = !localTypes.length;
  splash.querySelector('.templates').hidden = hasFolderModels();
  splash.querySelector('.splash-card').classList.toggle('only-local', hasFolderModels());
  $('localNote').textContent = hasFolderModels() ? 'Modelos importados en este equipo · solo para uso personal.' : '';
  grid.innerHTML = '';
  if (!localTypes.length) return;
  for (const type of localTypes) {
    const m = MODELS[type], b = document.createElement('button');
    b.className = 'local-item'; b.dataset.type = type;
    b.innerHTML = (m.thumbnail ? `<img src="${m.thumbnail}" alt="" loading="lazy">` : '') + `<span>${m.label}</span>`;
    b.onclick = () => start(() => newProject(type), b);
    let cell = b;
    if (isUserModel(type)) {          // own imports can be removed: the button sits next to the item, not inside it
      cell = document.createElement('div');
      cell.className = 'local-cell';
      const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '×', title: 'Quitar modelo' });
      x.setAttribute('aria-label', `Quitar ${m.label}`);
      x.onclick = async () => {
        if (!confirm(`¿Quitar «${m.label}» de tus modelos? Los proyectos que lo usen mostrarán un iPhone genérico.`)) return;
        await deleteUserModel(type);
        refreshModels();
      };
      cell.append(b, x);
    }
    cell.dataset.search = m.label.toLowerCase(); cell.dataset.tags = m.tags.join(' ');
    grid.append(cell);
  }
  renderChips();
  $('localSearch').oninput = applyFilter;
  applyFilter();
}

// ---- Scenes wizard: designs (bulk) + one device + devices per scene → 16:9 scenes ----
let designs = [];            // [{ file, url }] in the order they will fill the scenes
let sceneType = null, perScene = 3, appendMode = false;

const sceneDeviceTypes = () => pickerTypes().filter(t => !MODELS[t].tags?.includes('multi'));   // one screen per device: the template places three

function defaultSceneType(){
  const list = sceneDeviceTypes();
  return list.find(t => MODELS[t].label === 'iPhone 15 Pro') ?? list.find(t => MODELS[t].tags?.includes('iphone') || t === 'iphone') ?? list[0];
}

function addDesigns(files){
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  designs.push(...imgs.map(file => ({ file, url: URL.createObjectURL(file) })));
  designs.sort((a, b) => a.file.name.localeCompare(b.file.name, 'es', { numeric: true }));   // 01.png, 02.png, …
  renderDesigns();
}

function renderDesigns(){
  const grid = $('designGrid');
  grid.innerHTML = '';
  designs.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'design'; el.title = d.file.name;
    el.innerHTML = `<img src="${d.url}" alt=""><span class="n">${i + 1}</span><button class="x" aria-label="Quitar ${d.file.name.replace(/"/g, '')}">×</button>`;
    el.querySelector('.x').onclick = () => { URL.revokeObjectURL(d.url); designs.splice(i, 1); renderDesigns(); };
    grid.append(el);
  });
  $('designCount').textContent = designs.length ? `(${designs.length})` : '';
  $('clearDesigns').hidden = !designs.length;
  updatePlan();
}

function renderSceneDevices(){
  const grid = $('sceneDevGrid'), q = $('sceneDevSearch').value.trim().toLowerCase();
  grid.innerHTML = '';
  for (const type of sceneDeviceTypes()) {
    const m = MODELS[type];
    if (q && !m.label.toLowerCase().includes(q)) continue;
    const b = document.createElement('button');
    b.className = 'local-item' + (type === sceneType ? ' selected' : '');
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', type === sceneType);
    b.innerHTML = (m.thumbnail ? `<img src="${m.thumbnail}" alt="" loading="lazy">` : '') + `<span>${m.label}</span>`;
    b.onclick = () => { sceneType = type; renderSceneDevices(); updatePlan(); };
    grid.append(b);
  }
  if (!grid.children.length) grid.innerHTML = '<div class="muted">Ningún modelo coincide.</div>';
}

function updatePlan(){
  for (const b of $('perScene').children) {
    b.classList.toggle('active', +b.dataset.n === perScene); b.setAttribute('aria-checked', +b.dataset.n === perScene);
  }
  const n = designs.length, count = Math.ceil(n / perScene);
  $('scenePlan').textContent = !n ? 'Añade al menos un diseño.'
    : `${n} diseño${n > 1 ? 's' : ''} → ${count} escena${count > 1 ? 's' : ''} 16:9 · ${MODELS[sceneType]?.label ?? ''}`
      + (appendMode ? ` · se añaden a las ${scenes.length} actuales` : '');
  $('createScenes').disabled = !n || !sceneType || busy;
  $('createScenes').textContent = appendMode ? 'Añadir escenas' : 'Crear escenas';
}

function prepareScenesView(){
  // adding to an existing presentation keeps its device; otherwise suggest an iPhone
  sceneType = (appendMode && scenesDeviceType()) || (sceneDeviceTypes().includes(sceneType) ? sceneType : defaultSceneType());
  renderSceneDevices(); renderDesigns();
  requestAnimationFrame(() => $('sceneDevGrid').querySelector('.selected')?.scrollIntoView({ block: 'nearest' }));
}

function initScenesWizard(){
  const input = $('designFiles'), drop = $('designDrop');
  drop.onclick = () => input.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addDesigns(input.files); input.value = ''; };
  // the whole card accepts dropped designs; outside of it the browser must not open the file
  splash.addEventListener('dragover', e => { e.preventDefault(); if (view === 'scenes') drop.classList.add('over'); });
  splash.addEventListener('dragleave', e => { if (!splash.contains(e.relatedTarget)) drop.classList.remove('over'); });
  splash.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (view === 'scenes') addDesigns(e.dataTransfer.files); });
  $('clearDesigns').onclick = () => { designs.forEach(d => URL.revokeObjectURL(d.url)); designs = []; renderDesigns(); };
  $('sceneDevSearch').oninput = renderSceneDevices;
  for (const b of $('perScene').children) b.onclick = () => { perScene = +b.dataset.n; updatePlan(); };
  $('createScenes').onclick = () => start(async () => {
    await createScenes({ files: designs.map(d => d.file), type: sceneType, perScene, append: appendMode,
      onProgress: msg => { $('splashStatus').textContent = msg; } });
    designs.forEach(d => URL.revokeObjectURL(d.url)); designs = []; renderDesigns();
  }, $('createScenes'));
}

// ---- Import a .glb: suggest name, screen, case material and real size; the user confirms ----
function refreshModels(){
  renderLocalTemplates();
  fillModelSelect();
  if (view === 'scenes') renderSceneDevices();
}

const TAG_GUESS = [[/watch|reloj/i, 'watch'], [/macbook|laptop|notebook|port[aá]til/i, 'laptop'],
  [/ipad|tablet/i, 'tablet'], [/imac|monitor|display|\btv\b/i, 'desktop'], [/phone|iphone|pixel|galaxy|m[oó]vil/i, 'phone']];
function guessTag(name, cm){
  return TAG_GUESS.find(([re]) => re.test(name))?.[1]
    ?? (cm < 6 ? 'watch' : cm < 20 ? 'phone' : cm < 35 ? 'tablet' : 'laptop');
}

let thumbURL = null;
async function importModelFile(file){
  const dialog = $('importDialog'), status = $('splashStatus');
  status.textContent = 'Leyendo ' + file.name + '…';
  let info;
  try { info = await analyzeGLB(file); }
  catch (err) { console.error(err); status.textContent = 'No se pudo importar: ' + err.message; return; }
  status.textContent = '';
  const opts = (list, none) => `<option value="">${none}</option>` + list.map(n => `<option>${n.replace(/</g, '&lt;')}</option>`).join('');
  const screens = [...new Set(info.meshes.filter(m => m.named).map(m => m.name))];
  $('impName').value = info.name;
  $('impScreen').innerHTML = opts(screens, 'Sin pantalla');
  $('impScreen').value = info.screen ?? '';
  $('impColor').innerHTML = opts(info.materials, 'Ninguno');
  $('impColor').value = info.colorable ?? '';
  const cm = Math.round(info.longest * info.cmPerUnit * 10) / 10;
  $('impSize').value = cm;
  $('impTag').value = guessTag(info.name, cm);
  $('impNote').textContent = !screens.length ? 'Las mallas no tienen nombre: no se puede elegir la pantalla.'
    : info.screen ? 'Pantalla detectada por su nombre. Cámbiala si no es la correcta.'
    : 'No se detectó la pantalla: elige la malla donde irá tu diseño.';
  if (thumbURL) URL.revokeObjectURL(thumbURL);
  const thumb = await renderThumbnail(info.root).catch(() => null);
  thumbURL = thumb && URL.createObjectURL(thumb);
  $('impThumb').src = thumbURL ?? '';
  dialog.returnValue = '';
  dialog.showModal();
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'ok') return;
    status.textContent = 'Guardando modelo…';
    try {
      const type = await saveUserModel({ file, root: info.root, name: $('impName').value, tag: $('impTag').value,
        screen: $('impScreen').value || null, colorable: $('impColor').value || null,
        cmPerUnit: (+$('impSize').value || cm) / info.longest });
      refreshModels();
      status.textContent = `Importado: ${MODELS[type].label}`;
      $('localGrid').querySelector(`[data-type="${type}"]`)?.focus();
    } catch (err) { console.error(err); status.textContent = 'No se pudo guardar: ' + err.message; }
  };
}

// Opens the file picker (from the start screen, the desktop menu or the console)
export function importModel(){
  if (splash.hidden || view !== 'devices') showSplash({ canCancel: true, mode: 'devices' });
  $('modelFile').click();
}

export function initSplash(){
  const modelFile = $('modelFile');
  $('importModel').onclick = () => modelFile.click();
  modelFile.onchange = () => { if (modelFile.files[0]) importModelFile(modelFile.files[0]); modelFile.value = ''; };
  // keys typed in the import dialog stay there: no editor shortcuts, no start-screen Escape
  $('importDialog').addEventListener('keydown', e => e.stopPropagation());
  $('modeDevices').onclick = () => showView('devices');
  $('modeScenes').onclick = () => showView('scenes');
  for (const b of splash.querySelectorAll('[data-back]')) b.onclick = () => showView('home');
  initScenesWizard();
  for (const b of splash.querySelectorAll('.template')) b.onclick = () => start(() => newProject(b.dataset.type), b);
  renderLocalTemplates();
  $('newProj').onclick = () => showSplash({ canCancel: true });
  splash.addEventListener('click', e => { if (dismissable && !busy && e.target === splash) hideSplash(); });
  // capture phase: while the start screen is open, editor shortcuts (Space, K, …) must not fire behind it
  addEventListener('keydown', e => {
    if (splash.hidden) return;
    if ($('importDialog').open) { e.stopPropagation(); return; }
    if (e.target.matches?.('input') && e.key !== 'Escape') return;   // typing in a search box
    e.stopPropagation();
    if (e.key !== 'Escape' || busy) return;
    if (view !== 'home' && !appendMode) showView('home');            // Esc steps back, then closes
    else if (dismissable) hideSplash();
  }, true);
}
