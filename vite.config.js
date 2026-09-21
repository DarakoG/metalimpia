import { defineConfig } from 'vite';

// Vite configuration for MetaLimpia.
// Notes:
// - `base: '/metalimpia/'` is set for a GitHub Pages project page
//   (https://<user>.github.io/metalimpia/). For a user/org site, change to `base: '/'`.
// - WASM support: Vite handles `.wasm?init` and `.wasm` imports natively from v3+.
//   No extra config needed for ExifTool WASM (configured in Phase 3).
export default defineConfig({
  base: '/metalimpia/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  // WASM is loaded asynchronously in a Web Worker (Phase 3).
  // The Worker itself is created from a same-origin script, so CSP allows it.
  worker: {
    format: 'es',
  },
});
