# Mawaru

Editor web de mockups 3D de dispositivos (iPhone, iPad, MacBook…) con animación por keyframes y exportación a vídeo. *Mawaru* (回る) significa «girar» en japonés.

- **`replica/`**: la aplicación (Vite + three.js). Instrucciones, estructura y atajos en [replica/README.md](replica/README.md).
- **`docs/`**: notas técnicas del desarrollo.

```bash
cd replica
npm install
npm run dev          # http://127.0.0.1:5173
```

## Qué no incluye este repositorio

Los presets de cámara y los modelos 3D de dispositivos de terceros no están incluidos. Si los tienes instalados, la app puede importarlos **solo en tu máquina**:
- `npm run presets` y `npm run models` los escriben en `replica/local-models/`, una carpeta que git ignora.
- Sin ellos, la app funciona con sus modelos y plantillas propios.

Detalles en [replica/README.md](replica/README.md#importar-presets-y-modelos-uso-personal).
