# Rotato Web (app.rotato.app): análisis y comparación con la réplica

Revisado el 2026-10-16 con la cuenta del usuario (plan Free), en el navegador integrado. Plantilla abierta: "Simple iPhone 15 Pro".

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js (Turbopack), React |
| 3D | Three.js r182 + React Three Fiber 9.5, `GLTFLoader` (+ Draco/KTX2/Meshopt), `RGBELoader` para HDRI, `EffectComposer` |
| Estado | zustand (un store con unas 70 acciones, listadas abajo) |
| Backend | Supabase (auth, REST `team_members`, proyectos) |
| Pagos y analítica | Paddle Billing, ProfitWell, PostHog, Microsoft Clarity |
| Assets | Modelos `.glb` en `template-3d.rotato.app` (p. ej. `Apple_iPhone_15_Pro_2023.glb`), HDR `legacy.hdr`, previews MP4 en `template-media.rotato.app` |
| Exportación | En el navegador, con **WebCodecs** + muxer propio (AVC/HEVC/VP9/AV1, AAC/Opus), contenedores MP4/WebM, PNG y fondo transparente |

## Funciones del editor (UI + acciones del store)

- **Modos:** Photo / Video (`setEditorMode`). Autoguardado (`setSaveStatus`, `setLastSavedAt`). Undo/Redo.
- **Device → Screen:** subir imagen o vídeo a la pantalla, tamaño de pantalla, landscape, biblioteca de assets (`setScreenContents`, `setScreenContentsLandscape`, `setScreenVideoPlayer`).
- **Device → Style:** color de carcasa, sombra con intensidad, reflejos del cristal con intensidad (`setCaseColor`, `setShadow`, `setShadowIntensity`, `toggleReflections`, `setGlassReflectionIntensity`). Varios dispositivos en escena (`addDevice`, `removeDevice`).
- **Camera:** posición x/y/z, rotación x/y/z en grados, offset, FOV, profundidad de campo con selector de foco (`setCameraPosition/Rotation/Offset`, `setFov`, `setDepthOfField`, `setFocusPickerActive`). Presets de cámara guardables (`addCameraPreset`, `deleteCameraPreset`). Cámara de edición separada (`setUseEditCamera`) y órbita en modo foto (`setStillCameraOrbitState`).
- **Background:** Color, Imagen, Gradiente, Vídeo o Transparente, más presets (`setBackgroundType/Color/Gradient/Image/Video`, `setTransparentBackgroundMode`).
- **Environment:** presets HDRI con intensidad y rotación (`setHdriPreset`, `setHdriIntensity`, `setHdriRotation`).
- **Formato:** relaciones de aspecto por red social (X 1:1, Facebook Post 1.19:1, Story 9:16, Snapchat 9:16, Portrait 4:5, Square 1:1, Landscape 5:4, Screen 4:3…) (`setAspectRatio`).
- **Colors:** paletas "mágicas" que se derivan del contenido de la pantalla (`setScreenContentsColors`, `setColorsOverlayTab`).
- **Timeline:** play, duración, "Add Animation" añade un par de keyframes de cámara, keytimes seleccionables y arrastrables, previsualización de easing (`setSelectedAnimationPairIndex`, `setSelectedKeytimes`, `setEasingPreview`, `setCurrentTime`).
- **Exportación:** tamaño, calidad, formato de vídeo y progreso (`setExportSize`, `setExportQuality`, `setVideoExportFormat`, `setRenderProgress`). El plan Free añade la marca de agua "rotato.app/free".
- **Plantillas:** galería con tags, clip templates, full templates (beta), plantillas públicas (`setActiveTemplate`, `setGalleryFilterTags`, `setIsPublicTemplate`).

## Comparación con la réplica (`replica/index.html`)

| Función | Rotato Web | Réplica |
|---|---|---|
| Modelo 3D real del dispositivo | GLB detallado | Caja redondeada genérica |
| Presets de animación de cámara | Plantillas + editor de keyframes | 11 presets reales de la app de escritorio (solo reproducir) |
| Timeline con keyframes editables | ✅ | ❌ |
| Easing por segmento | ✅ con previsualización | Bézier del preset, no editable |
| Mover/rotar el dispositivo por ejes | Cámara por campos numéricos | ✅ gizmo + campos (más directo que la web) |
| Imagen en pantalla | Imagen y vídeo, landscape | Solo imagen (drag & drop) |
| Fondo | Color/Imagen/Gradiente/Vídeo/Transparente | Solo color |
| HDRI e iluminación | Presets, intensidad, rotación | Luces fijas |
| Sombra de contacto y reflejos | Toggle + intensidad | ❌ |
| Color de carcasa | ✅ | ❌ (fijo) |
| Profundidad de campo | ✅ | ❌ |
| Formatos por red social | ✅ | Solo resolución de exportación |
| Export MP4 con WebCodecs | ✅ (+ WebM, PNG, transparente) | ✅ MP4 H.264 con supersampling y jitter |
| Export de imagen (Photo) | ✅ | ❌ |
| Proyectos guardados y undo/redo | ✅ (Supabase) | ❌ |
| Varios dispositivos | ✅ | ❌ |

## Prioridades propuestas

1. **Timeline con keyframes editables:** añadir keyframe desde la vista actual, mover keytimes, elegir easing. Es el corazón del producto.
2. **Fondo completo + formatos sociales:** gradiente, imagen, transparente y aspect ratios. Fácil y de mucho impacto.
3. **Look realista:** HDRI con `RGBELoader`/`PMREMGenerator`, sombra de contacto, reflejos y color de carcasa.
4. **Vídeo en la pantalla del dispositivo** (`VideoTexture`) y export PNG / WebM transparente.
5. **Guardar y abrir proyectos** (JSON local primero) y undo/redo.
6. **Modelo GLB propio:** usar un modelo con licencia libre; no reutilizar los `.glb` de Rotato.

> Nota: al abrir la plantilla se creó y autoguardó un proyecto "Simple iPhone 15 Pro" en la cuenta, con un segmento extra de animación que añadió "Add Animation". Se puede borrar desde el dashboard.
