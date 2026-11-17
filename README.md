# Mawaru

Editor web de mockups 3D de dispositivos (iPhone, iPad, MacBook…) con animación por keyframes y exportación a vídeo. *Mawaru* (回る) significa «girar» en japonés.

- **`mawaru/`**: la aplicación (Vite + three.js). Instrucciones, estructura y atajos en [mawaru/README.md](mawaru/README.md).
- **`site/`**: la landing page (HTML y CSS estáticos, sin build). Se publica en GitHub Pages con `.github/workflows/pages.yml`.

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

- **Descargas:** los botones apuntan a la última release de GitHub. La URL está en `site/site.js` (`DOWNLOAD_URL`). Sube el `.dmg` (`npm run dist:mac` en `mawaru/`) como archivo de una release.
- **Firma:** cuando el `.dmg` esté firmado y notarizado, pon `SIGNED = true` en `site/site.js`. Así desaparece la nota sobre abrir con clic derecho.
- **Publicación:** activa *Settings → Pages → Source: GitHub Actions* en el repositorio. Cada push a `main` que cambie `site/` vuelve a publicarla. Con un plan gratuito, Pages y las descargas de releases requieren que el repositorio sea público.
- **Imágenes y vídeo** (`site/assets/`): están hechos con la propia app y solo con sus modelos integrados, nunca con modelos importados de terceros.
