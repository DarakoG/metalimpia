import { defineConfig } from 'vite';

// Vite configuration for MetaLimpia.
// Notes:
// - `base: '/'` is correct for a user/org site on GitHub Pages
//   (e.g. https://<user>.github.io/). For a project page (https://<user>.github.io/<repo>/),
//   change to `base: '/<repo>/'`. Update before first deploy.
// - WASM support: Vite handles `.wasm?init` and `.wasm` imports natively from v3+.
//   No extra config needed for ExifTool WASM (configured in Phase 3).
export default defineConfig({
  base: '/',
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
