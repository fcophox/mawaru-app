// Where the download buttons point. GitHub Releases' "latest" page always shows the newest .dmg.
const DOWNLOAD_URL = 'https://github.com/fcophox/mawaru-app/releases/latest';
// The web version of the editor (its own Vercel project, built from mawaru/)
const WEBAPP_URL = 'https://mawaru-app.vercel.app/';
// Set to true once the .dmg is signed with a Developer ID and notarized: hides the Gatekeeper tip.
const SIGNED = false;

for (const a of document.querySelectorAll('[data-download]')) a.href = DOWNLOAD_URL;
for (const a of document.querySelectorAll('[data-webapp]')) a.href = WEBAPP_URL;
// Copy buttons next to Terminal commands
for (const b of document.querySelectorAll('[data-copy]')) {
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copiado'; }
    catch {   // clipboard blocked: select the command so ⌘C copies it
      const code = b.parentElement.querySelector('code'), range = document.createRange();
      range.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(range);
      b.textContent = 'Pulsa ⌘C';
    }
    setTimeout(() => { b.textContent = 'Copiar'; }, 1600);
  });
}
if (SIGNED) for (const el of document.querySelectorAll('[data-unsigned]')) el.remove();

// The hero video only plays when it can be seen, and never for people who prefer less motion
const video = document.querySelector('.hero-media video');
if (video) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = visible => { if (visible && !reduce.matches) video.play().catch(() => {}); else video.pause(); };
  new IntersectionObserver(([e]) => sync(e.isIntersecting), { threshold: 0.2 }).observe(video);
  reduce.addEventListener('change', () => sync(true));
}
