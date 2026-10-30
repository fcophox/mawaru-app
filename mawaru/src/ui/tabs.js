import { $ } from '../state.js';

// ---- Side panel tabs ----
const TAB_KEY = 'mawaru.sideTab';

export function initTabs() {
  const list = $('sideTabs'), tabs = [...list.children];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    try { localStorage.setItem(TAB_KEY, tab.id); } catch {}
  };
  list.onclick = e => { const t = e.target.closest('.tab'); if (t) select(t); };
  // stopPropagation: arrows must not also reach the global shortcuts while on a tab
  list.onkeydown = e => {
    const i = tabs.indexOf(document.activeElement), n = tabs.length;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault(); e.stopPropagation();
    select(tabs[next % n], true);
  };
  let saved = null;
  try { saved = localStorage.getItem(TAB_KEY); } catch {}
  const tab = tabs.find(t => t.id === saved);
  if (tab) select(tab);
}
