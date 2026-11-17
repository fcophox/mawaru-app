# Mawaru

Editor web de mockups 3D de dispositivos (iPhone, iPad, MacBook…) con animación por keyframes y exportación a vídeo. *Mawaru* (回る) significa «girar» en japonés.

- **`mawaru/`**: la aplicación (Vite + three.js). Instrucciones, estructura y atajos en [mawaru/README.md](mawaru/README.md).
- **`site/`**: la landing page (HTML y CSS estáticos, sin build). Se publica en Vercel.

```bash
cd mawaru
npm install
npm run dev          # http://127.0.0.1:5173
```

## Qué no incluye este repositorio

Los presets de cámara y los modelos 3D de dispositivos de terceros no están incluidos. Si los tienes instalados, la app puede importarlos **solo en tu máquina**:
- `npm run presets` y `npm run models` los escriben en `mawaru/local-models/`, una carpeta que git ignora.
- Sin ellos, la app funciona con sus modelos y plantillas propios.

Detalles en [mawaru/README.md](mawaru/README.md#importar-presets-y-modelos-uso-personal).

## Landing page

```bash
node mawaru/node_modules/vite/bin/vite.js site   # vista previa local
```

- **Publicación en Vercel:** importa el repositorio en Vercel con **Root Directory** `site`, **Framework Preset** *Other* y sin comando de build. Cada push a `main` la publica, y cada PR tiene su URL de vista previa. `site/vercel.json` define la caché de `assets/`, las URLs limpias y omite el build si el push no toca `site/`.
- **Dominio:** las vistas previas al compartir (`og:url`, `og:image` en `site/index.html`) usan `https://mawaru-app.vercel.app`. Cámbialas si Vercel asigna otro dominio o usas uno propio.
- **Descargas:** los botones apuntan a la última release de GitHub. La URL está en `site/site.js` (`DOWNLOAD_URL`). Sube el `.dmg` (`npm run dist:mac` en `mawaru/`) como archivo de una release.
- **Firma:** cuando el `.dmg` esté firmado y notarizado, pon `SIGNED = true` en `site/site.js`. Así desaparece la nota sobre abrir con clic derecho.
- **Imágenes y vídeo** (`site/assets/`): están hechos con la propia app y solo con sus modelos integrados, nunca con modelos importados de terceros.
