import { defineConfig } from 'vite';

// localhost is a secure context, which WebCodecs (video export) requires
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, open: false },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    // three.js alone is ~600 kB minified; keep it in its own cacheable chunk
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
