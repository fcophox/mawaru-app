// Where the download buttons point. GitHub Releases' "latest" page always shows the newest .dmg.
const DOWNLOAD_URL = 'https://github.com/fcophox/mawaru-app/releases/latest';
// Set to true once the .dmg is signed with a Developer ID and notarized: hides the Gatekeeper tip.
const SIGNED = false;

for (const a of document.querySelectorAll('[data-download]')) a.href = DOWNLOAD_URL;
if (SIGNED) for (const el of document.querySelectorAll('[data-unsigned]')) el.remove();

// The hero video only plays when it can be seen, and never for people who prefer less motion
const video = document.querySelector('.hero-media video');
if (video) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = visible => { if (visible && !reduce.matches) video.play().catch(() => {}); else video.pause(); };
  new IntersectionObserver(([e]) => sync(e.isIntersecting), { threshold: 0.2 }).observe(video);
  reduce.addEventListener('change', () => sync(true));
}
