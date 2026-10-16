# Mawaru

Editor web de mockups 3D de dispositivos (iPhone, iPad, MacBook…) con animación por keyframes y exportación a vídeo. Está inspirado en Rotato y la mecánica se reconstruyó analizando la app de escritorio con [REA](https://github.com/morluto/rea) y Ghidra. *Mawaru* (回る) significa «girar» en japonés.

- **`replica/`**: la aplicación (Vite + three.js). Instrucciones, estructura y atajos en [replica/README.md](replica/README.md).
- **`docs/`**: notas del análisis:
  - [rotato-video-render.md](docs/rotato-video-render.md): cómo Rotato renderiza y exporta vídeo.
  - [rotato-web-analysis.md](docs/rotato-web-analysis.md): funciones de la versión web y comparación con esta réplica.

```bash
cd replica
npm install
npm run dev          # http://127.0.0.1:5173
```

## Qué no incluye este repositorio

Los presets de cámara, los modelos 3D y los binarios de Rotato son de sus autores. Si tienes Rotato instalado, la réplica puede importarlos **solo en tu máquina**:
- `npm run presets` y `npm run models` los escriben en `replica/local-models/`, una carpeta que git ignora.
- Sin ellos, la app funciona con sus modelos y plantillas propios.
