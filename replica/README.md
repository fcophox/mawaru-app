# Rotato Replica

Editor web de mockups 3D de dispositivos, inspirado en Rotato. Tiene presets de cámara decodificados de Rotato.app, timeline con keyframes, varios dispositivos, fondos, HDRI y exportación a MP4/PNG.

Al abrirlo aparece una pantalla de inicio para elegir plantilla (iPhone, iPad o MacBook Pro) o continuar el último proyecto. Cada plantilla arranca con un giro suave que encuadra el dispositivo completo. Los modelos son procedurales, con proporciones reales: iPhone 15 Pro, iPad Pro 11" y MacBook Pro 14" con tapa abatible. Se puede cambiar el modelo de cualquier dispositivo y mezclar varios en la misma escena.

## Arrancar

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

- `npm run build`: genera `dist/` para producción.
- `npm run preview`: sirve `dist/` en http://127.0.0.1:4173.

La exportación de vídeo usa WebCodecs, que solo funciona en un contexto seguro (`localhost`/`127.0.0.1` o HTTPS) y en navegadores Chromium.

## Estructura

```
index.html              maquetación de la interfaz (sin lógica)
src/
  main.js               orden de arranque, bucle de render y hooks de depuración (window.*)
  state.js              estado mutable compartido (timeline, selección, formato, exportando…)
  styles.css
  core/                 lógica sin interfaz
    scene.js            renderer, escena, luces, receptor de sombra, rig de cámara
    easing.js           curvas Bézier (CAMediaTimingFunction) y tipos de easing
    presets.js          presets de cámara (opcionales, desde local-models/presets.json) → keyframes
    device-model.js     modelos procedurales (iPhone, iPad, MacBook Pro) y sus pantallas
    framing.js          encuadre automático (todo el dispositivo en cuadro) y tomas de plantilla
    local-models.js     modelos de local-models/: registro, carga GLB, pantalla/carcasa/cristal por dispositivo
    animation.js        interpolación de cámara y dispositivos en un instante t
  ui/                   cada panel con su función init…()
    devices.js          lista de dispositivos, añadir/duplicar/eliminar, selección por clic
    transform.js        gizmo de mover/rotar, campos X/Y/Z, vista de edición
    camera-controls.js  orbitar / desplazar / zoom de la cámara, FOV
    timeline.js         keyframes, easing por segmento, playhead, atajos
    look.js             HDRI, sombra, reflejos, color de carcasa
    frame.js            formato (16:9, 9:16, 1:1, 4:5) y fondo
    media.js            imagen o vídeo en pantalla, sincronizado con el timeline
    project.js          guardar/abrir .rotato.json, autoguardado, deshacer/rehacer, plantillas
    splash.js           pantalla de inicio: elegir plantilla o continuar
  export/
    exporter.js         render por fotograma (supersampling + jitter) → MP4 / PNG / ZIP
    audio.js            mezcla y codificación AAC del audio de los vídeos
```

Convención: al importarse, los módulos solo declaran cosas; el DOM se conecta en los `init…()`, que `main.js` llama en orden. Así los imports circulares entre paneles son seguros.

## Presets de cámara de Rotato (uso personal)

Los 11 presets de cámara de Rotato (topturn, flip in, dangle…) son datos de Rotato.app, así que no están en el repositorio. Si tienes la app instalada:

```bash
npm run presets      # lee /Applications/Rotato.app/Contents/Resources/*.keyframes → local-models/presets.json
```

Sin ellos el editor funciona igual con las plantillas.

## Modelos de tus descargas de Rotato (uso personal)

Si tienes Rotato instalado, los dispositivos que descargas se guardan en
`~/Library/Application Support/Rotato/Scenes/*.rotato`. El conversor los pasa a glTF binario:

```bash
npm run models                                   # todas las escenas descargadas
python3 tools/rotato2glb.py "iPhone 15 Pro"      # solo las que contengan ese texto
```

- La salida va a `local-models/` (`.glb`, la miniatura `.png` y `manifest.json` con el tamaño de pantalla, los nodos de pantalla y los materiales coloreables). **Esa carpeta está en `.gitignore`: los modelos son de Rotato y sus autores; no los publiques ni los subas al repositorio.**
- Visor de comprobación: `npm run dev` y abre http://127.0.0.1:5173/tools/model-viewer.html. Pone un patrón de prueba en la pantalla para verificar su orientación.
- **En el editor:** con `npm run dev`, si existe `local-models/manifest.json`, los modelos aparecen en la pantalla de inicio (sección «De tus descargas de Rotato», con buscador) y en el selector **Modelo** del panel Dispositivos. Cada dispositivo tiene su propia pantalla para imagen o vídeo y su color de carcasa, aplicado a los materiales `colorable` de Rotato. Al abrir un proyecto se precargan sus modelos locales; si alguno no está en esta máquina, se sustituye por el iPhone genérico. El build de producción no incluye `local-models/`.
- **Escala real:** Rotato modela en centímetros reales, y la réplica usa un único factor para todos los modelos, genéricos incluidos. Por eso un MacBook sale 2,1 veces más ancho que la altura de un iPhone, igual que en la realidad. Las plantillas encuadran el dispositivo completo y los presets de cámara se escalan según el tamaño del dispositivo principal. Excepción: el "iPad Pro 11" antiguo de Rotato viene a otra escala y sale más pequeño de lo real.
- Requiere macOS, porque usa `compression_tool` para descomprimir LZFSE. Solo usa la biblioteca estándar de Python.
- Qué se convierte: nodos y transformaciones, mallas (triángulos, strips, polígonos, índices multicanal, `SCNPlane`/`SCNBox`) y materiales PBR con sus texturas. El mapa `transparent` de SceneKit se combina en el alfa del color base. El cristal de pantalla aditivo se marca en `extras.rotato.blendMode = "add"`.
- Qué se omite: etiquetas de texto, la marca `rotatoTag`, placeholders, luces, cámaras y nodos ocultos. Los mapas de metal/rugosidad se convierten en factores, y los keyframes de Rotato no se exportan.

## Atajos

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausa |
| K | Añadir o actualizar keyframe |
| Supr | Eliminar keyframe |
| ← / → | Keyframe anterior / siguiente |
| W / E | Gizmo: mover / rotar |
| V | Vista de edición |
| F | Encuadrar todos los dispositivos |
| C | Centrar vista: restablece el dispositivo y lo encuadra de frente |
| ⌘/Ctrl + Z, ⌘/Ctrl + Mayús + Z | Deshacer / rehacer |
| ⌘/Ctrl + S, ⌘/Ctrl + O | Guardar / abrir proyecto |

## Créditos

- three.js, mp4-muxer y fflate (npm).
- HDRIs de [Poly Haven](https://polyhaven.com) (CC0), que se cargan en tiempo de ejecución.
