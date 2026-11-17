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

- **Publicación en Vercel:** hay dos proyectos que salen del mismo repositorio:
  - `mawaru-app` (Root Directory `mawaru`, Vite): el editor web, en https://mawaru-app.vercel.app. La landing lo enlaza como «pruébala en el navegador» (`WEBAPP_URL` en `site/site.js`).
  - el de la landing (Root Directory `site`, **Framework Preset** *Other*, sin comando de build). `site/vercel.json` define la caché de `assets/`, las URLs limpias y omite el build si el push no toca `site/`.
- **Dominio de la landing:** https://mawaru.fcophox.com. Las vistas previas al compartir (`og:url`, `og:image` en `site/index.html`) usan ese dominio; cámbialas si se muda.
- **Descargas:** los botones apuntan a la última release de GitHub. La URL está en `site/site.js` (`DOWNLOAD_URL`). Sube el `.dmg` (`npm run dist:mac` en `mawaru/`) como archivo de una release.
- **Firma:** cuando el `.dmg` esté firmado y notarizado, pon `SIGNED = true` en `site/site.js`. Así desaparece la nota sobre abrirla desde **Privacidad y seguridad**.
- **Imágenes y vídeo** (`site/assets/`): están hechos con la propia app y solo con sus modelos integrados, nunca con modelos importados de terceros.

## Homebrew

La app de Mac también se instala con Homebrew, desde el tap [fcophox/homebrew-tap](https://github.com/fcophox/homebrew-tap):

```bash
brew install --cask fcophox/tap/mawaru
```

El cask le quita la marca de cuarentena después de instalarla, así que abre sin el aviso de Gatekeeper aunque no esté notarizada. Al escribir el nombre completo (`fcophox/tap/mawaru`), Homebrew confía en el tap sin pedir `brew trust`.

**Al publicar una versión nueva:**
1. Sube el `.dmg` a la release `vX.Y.Z` de este repositorio.
2. En `Casks/mawaru.rb` del tap, actualiza `version` y `sha256`:
   ```bash
   shasum -a 256 mawaru/release/Mawaru-X.Y.Z-universal.dmg
   ```
