import { defineConfig } from 'vite';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vite configuration for MetaLimpia.
// Notes:
// - `base: '/metalimpia/'` is set for a GitHub Pages project page
//   (https://<user>.github.io/metalimpia/). For a user/org site, change to `base: '/'`.
// - WASM support: Vite handles `.wasm?init` and `.wasm` imports natively from v3+.
//   No extra config needed for ExifTool WASM (configured in Phase 3).
//
// Phase 7.5 — privacy policy copy plugin.
// GitHub Pages only serves what Vite outputs to dist/. Vite's
// default `public/` directory would auto-copy a file, but the
// privacy policy source lives at `docs/privacidad.html` per the
// Design Spec §3 file structure (so the policy sits next to the
// other documentation). A small inline plugin copies the file
// into the output bundle at the end of the build. No new npm
// dependencies — we use Node's built-in `fs` and `path`.
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
  plugins: [
    {
      name: 'copy-privacy-policy',
      // closeBundle runs once at the end of the production
      // build, after Vite has written index.html and the
      // hashed assets to dist/. We piggyback on it to add
      // docs/privacidad.html → dist/privacidad.html so the
      // deployed site serves the policy at the URL the
      // landing footer links to (/privacidad.html).
      closeBundle() {
        const src = resolve(process.cwd(), 'docs/privacidad.html');
        const dest = resolve(process.cwd(), 'dist/privacidad.html');
        try {
          copyFileSync(src, dest);
        } catch (err) {
          // Build does not fail if the policy file is missing —
          // it is documentation, not application code. We do
          // surface the error so a misconfigured repo (typo'd
          // path, missing file) is caught in CI.
          // eslint-disable-next-line no-console
          console.warn(
            '[copy-privacy-policy] could not copy ' +
              src +
              ' to ' +
              dest +
              ': ' +
              (err && err.message ? err.message : err)
          );
        }
      },
    },
  ],
});
