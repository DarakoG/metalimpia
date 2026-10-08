import { defineConfig } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = '/metalimpia/';

// Vite configuration for MetaLimpia.
// Notes:
// - `base: '/metalimpia/'` is set for a GitHub Pages project page
//   (https://<user>.github.io/metalimpia/). For a user/org site, change to `base: '/'`.
// - WASM support: Vite handles `.wasm?init` and `.wasm` imports natively from v3+.
//   No extra config needed for ExifTool WASM (configured in Phase 3).
//
// Privacy policy route and static asset delivery.
// GitHub Pages only serves what Vite outputs to dist/. Vite's
// default `public/` directory would auto-copy a file, but the
// privacy policy source lives at `docs/privacidad.html` per the
// Design Spec §3 file structure (so the policy sits next to the
// other documentation). A small inline plugin copies the file
// into the output bundle at the end of the build. Development
// serves the same source through a same-origin middleware route.
// No new npm dependencies — only Node built-ins are used.
export default defineConfig({
  base: BASE_URL,
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
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const requestPath = new URL(req.url, 'http://localhost').pathname;
          if (requestPath !== `${BASE_URL}privacidad.html`) {
            next();
            return;
          }
          const source = resolve(process.cwd(), 'docs/privacidad.html');
          const html = readFileSync(source, 'utf8').replaceAll('%BASE_URL%', BASE_URL);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        });
      },
      // closeBundle adds the policy and its external stylesheets
      // to the production output without relying on hashed names.
      closeBundle() {
        const src = resolve(process.cwd(), 'docs/privacidad.html');
        const dest = resolve(process.cwd(), 'dist/privacidad.html');
        try {
          const html = readFileSync(src, 'utf8').replaceAll('%BASE_URL%', BASE_URL);
          writeFileSync(dest, html);
          const cssDir = resolve(process.cwd(), 'dist/css');
          mkdirSync(cssDir, { recursive: true });
          for (const name of ['styles.css', 'privacy.css']) {
            writeFileSync(
              resolve(cssDir, name),
              readFileSync(resolve(process.cwd(), 'css', name))
            );
          }
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
