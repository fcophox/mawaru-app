# Rotato: pipeline de exportación de vídeo (REA + Ghidra 12.1.4)

Binario: `Rotato.app/Contents/MacOS/Rotato`, slice arm64 (`bin/Rotato-arm64`).
Las funciones Swift están sin símbolos (`FUN_…`); se localizaron por referencias
cruzadas a selectores de AVFoundation, SceneKit y Metal. Pseudocódigo en `out/mcp2/dec-*.c`.

## Flujo de render 3D → MP4

| Paso | Función | Qué hace |
|---|---|---|
| 1. Render offscreen | `FUN_10045ce58` | `scnRenderer.sceneTime = t` → `FUN_100462c58` (aplica la animación de cámara en t) → crea `MTLRenderPassDescriptor` con loadAction=clear, `clearColor`, textura MSAA + `resolveTexture` → `renderAtTime:viewport:commandBuffer:passDescriptor:` |
| 2. Zero-copy a vídeo | mismo | El destino es un `CVPixelBuffer` del pool del writer envuelto como `MTLTexture` vía `CVMetalTextureCacheCreateTextureFromImage` (sin copia GPU→CPU) |
| 3. Escalado | mismo | Si la resolución de render ≠ salida: `setScaleTransform:` + `encodeToCommandBuffer:sourceTexture:destinationTexture:` (Metal Performance Shaders, supersampling → downscale) |
| 4. Entrega | `addCompletedHandler:` → `FUN_100461280` | Al terminar la GPU: `appendPixelBuffer:withPresentationTime:`, publica progreso con `NSNotificationCenter` |
| Alternativa CPU | `FUN_10045dd4c`, `FUN_1001d6694` | `snapshotAtTime:withSize:antialiasingMode:` → `NSImage` (exportar imágenes / miniaturas) |

## Secuencia de imágenes → vídeo (`FUN_1004781ac`)

Bucle `while frame < total`:
1. `writerInput.isReadyForMoreMediaData`; si no, reintenta (back-pressure).
2. Carga el fotograma (`NSImage(byReferencingURL:)` o de un array en memoria) → `CGImageForProposedRect`.
3. `FUN_100478ea4`: `CVPixelBufferCreate` + `CGBitmapContextCreate` sobre la memoria del buffer → dibuja el CGImage.
4. PTS = `CMTimeAdd(CMTimeMake(frame - 1, fps), offset)`; el primer fotograma usa `kCMTimeZero`.
5. Tras el bucle, `markAsFinished` → `finishWritingWithCompletionHandler:`.

`MovieRenderer` (la clase Obj-C visible) solo es el `SCNSceneRendererDelegate`; sus métodos únicamente registran logs.

## Opciones de `RenderConfig`
`fps, codec, size, jittering, compression, container, imageSequenceFormat, preferredBitrateFraction`.
El jittering (`backgroundRendersPerFrame`) renderiza varias veces cada fotograma con subpíxeles desplazados para el antialiasing temporal.
