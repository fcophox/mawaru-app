# Mawaru

Editor web de mockups 3D de dispositivos: timeline con keyframes, varios dispositivos, fondos, HDRI y exportación a MP4/PNG.

Al abrirlo, el lienzo está vacío y aparece una pantalla de inicio para elegir el dispositivo, con filtros por tipo (iPhone, Phone, Multi, Tablet, Laptop, Watch…) y un buscador. Cada proyecto arranca con un giro suave que encuadra el dispositivo completo, con el timeline en pausa. Se puede cambiar el modelo de cualquier dispositivo y mezclar varios en la misma escena, a su tamaño real relativo.

Si no hay modelos importados (ver más abajo), la app ofrece sus modelos procedurales: iPhone 15 Pro, iPad Pro 11" y MacBook Pro 14" con tapa abatible.

## Arrancar

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

- `npm run build`: genera `dist/` para producción.
- `npm run preview`: sirve `dist/` en http://127.0.0.1:4173.
- `npm start`: compila y sirve `dist/` junto con `local-models/` en http://127.0.0.1:4317. Lo abre en una ventana propia de Chrome o, si no está instalado, en el navegador por defecto.

### Como app de Mac

```bash
npm run app
```

Crea `~/Applications/Mawaru.app`, que se abre desde Launchpad, Spotlight o el Dock sin usar la terminal:
- Al abrirla, levanta el servidor de `npm start` en segundo plano. Si las fuentes cambiaron desde la última compilación, recompila antes.
- Apunta a esta carpeta y al Node con el que se creó. Si mueves el repositorio o cambias de Node, vuelve a ejecutar `npm run app`.
- El registro está en `~/Library/Logs/Mawaru.log`.
- El servidor sigue activo hasta cerrar sesión. Para pararlo: `pkill -f tools/serve.mjs`.

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
    easing.js           curvas Bézier y tipos de easing
    presets.js          presets de cámara (opcionales, desde local-models/presets.json) → keyframes
    device-model.js     modelos procedurales (iPhone, iPad, MacBook Pro) y sus pantallas
    framing.js          encuadre automático (todo el dispositivo en cuadro) y tomas de plantilla
    local-models.js     modelos importados: registro, carga GLB, pantalla/carcasa/cristal por dispositivo
    animation.js        interpolación de cámara y dispositivos en un instante t
  ui/                   cada panel con su función init…()
    devices.js          lista de dispositivos, añadir/duplicar/eliminar, selección por clic
    transform.js        gizmo de mover/rotar, campos X/Y/Z, vista de edición, centrar vista
    camera-controls.js  orbitar / desplazar / zoom de la cámara, FOV, encuadrar todo
    timeline.js         keyframes, easing por segmento, playhead, atajos
    look.js             HDRI, sombra, reflejos, color de carcasa
    frame.js            formato (16:9, 9:16, 1:1, 4:5) y fondo
    media.js            imagen o vídeo en pantalla, sincronizado con el timeline
    project.js          guardar/abrir .mawaru.json, autoguardado, deshacer/rehacer, proyecto nuevo
    splash.js           pantalla de inicio: filtros, buscador y elección del dispositivo
  export/
    exporter.js         render por fotograma (supersampling + jitter) → MP4 / PNG / ZIP
    audio.js            mezcla y codificación AAC del audio de los vídeos
tools/                  importación local de presets y modelos, y visor de comprobación
```

Convención: al importarse, los módulos solo declaran cosas; el DOM se conecta en los `init…()`, que `main.js` llama en orden. Así los imports circulares entre paneles son seguros.

## Importar presets y modelos (uso personal)

Los presets de cámara y los modelos 3D de dispositivos no están en el repositorio. Si tienes Rotato instalado en macOS, puedes importar los tuyos **solo en tu máquina**. Ambos comandos escriben en `local-models/`, que está en `.gitignore`: no publiques ni subas ese contenido.

```bash
npm run presets                                  # presets de cámara: /Applications/Rotato.app → local-models/presets.json
npm run models                                   # modelos: ~/Library/Application Support/Rotato/Scenes/*.rotato → local-models/*.glb
python3 tools/rotato2glb.py "iPhone 15 Pro"      # solo los modelos que contengan ese texto
```

- **Requisitos:** macOS, porque el conversor usa `compression_tool` para descomprimir LZFSE. Solo usa la biblioteca estándar de Python.
- **Salida de `npm run models`:** un `.glb` por modelo, su miniatura `.png` y `manifest.json` con el tamaño de pantalla, los nodos de pantalla y los materiales coloreables.
- **Visor de comprobación:** con `npm run dev`, abre http://127.0.0.1:5173/tools/model-viewer.html. Pone un patrón de prueba en la pantalla para verificar su orientación.
- **En el editor:** si existe `local-models/manifest.json`, los modelos importados sustituyen a los procedurales en la pantalla de inicio y en el selector **Modelo**. Cada dispositivo tiene su propia pantalla para imagen o vídeo y su color de carcasa. Al abrir un proyecto se precargan sus modelos; si alguno no está en esta máquina, se usa el iPhone procedural. El build de producción no incluye `local-models/`.
- **Escala real:** los modelos están en centímetros reales y se usa un único factor para todos, procedurales incluidos. Por eso un MacBook sale 2,1 veces más ancho que la altura de un iPhone.
- **Qué convierte:**
  - nodos y transformaciones;
  - mallas: triángulos, strips, polígonos, índices multicanal, `SCNPlane` y `SCNBox`;
  - materiales PBR con sus texturas. El mapa `transparent` se combina en el alfa del color base, y el cristal de pantalla aditivo se marca en `extras.rotato.blendMode = "add"`.
- **Qué omite:** etiquetas de texto, marcas, placeholders, luces, cámaras y nodos ocultos. Los mapas de metal/rugosidad se convierten en factores.

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
