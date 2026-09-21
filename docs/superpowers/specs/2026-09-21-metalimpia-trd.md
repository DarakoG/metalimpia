# MetaLimpia — Technical Requirements Document (TRD)

**Status**: Draft for review
**Date**: 2026-09-21
**Related**: [Design Spec](./2026-09-21-metalimpia-design.md), [PRD](./2026-09-21-metalimpia-prd.md)

---

## 1. Architecture Overview

MetaLimpia is a **single-page static web application** with strict client-side-only processing. There is no backend, no API, no database, no analytics endpoint.

### High-level architecture

```
+---------------------------------------------------+
|                  Browser                          |
|                                                   |
|  +-------------+        +-----------------------+ |
|  |  index.html | <----> |      main.js          | |
|  +-------------+        |  (orchestrator)       | |
|        |                +-------+---------------+ |
|        v                        |                 |
|  +-------------+                v                 |
|  | styles.css  |        +---------------+         |
|  +-------------+        |   Worker      |         |
|  +-------------+        |  exiftool     |         |
|  | locales/    |        |  .worker.js   |         |
|  | *.json      |        +-------+-------+         |
|  +-------------+                |                 |
|                                 v                 |
|                        +----------------+          |
|                        | exiftool.wasm  |          |
|                        | (lazy loaded)  |          |
|                        +----------------+          |
|                                                   |
+---------------------------------------------------+
        |                          ^
        | (only initial GETs)      | (cleaned file Blob URL)
        v                          |
+---------------------------------------------------+
|           User's local filesystem                 |
+---------------------------------------------------+
```

### Key architectural properties

1. **No upload** — files never leave the browser.
2. **Lazy WASM load** — ExifTool engine only downloads when user drops first file.
3. **Web Worker isolation** — ExifTool runs off main thread, UI never freezes.
4. **Static hosting** — deployable to any static host (GitHub Pages default).
5. **Verifiable** — open-source code, CSP enforced, no third-party requests.

---

## 2. Tech Stack

| Layer | Technology | Version (target) | Rationale |
|-------|-----------|------------------|-----------|
| Markup | HTML5 | Living standard | No framework needed |
| Styles | CSS3 (custom) | Living standard | Tailwind/Bootstrap would add bulk; custom is sufficient |
| Client logic | Vanilla JavaScript (ES2020+) | ES2020 baseline | No React/Vue/Svelte overhead; smaller bundle |
| Modules | ES Modules | Native | No bundler complexity for app code |
| Build tool | Vite | 5.x | Modern bundler, handles WASM imports cleanly |
| Metadata engine | ExifTool (compiled to WASM) | 12.x+ (latest stable) | Industry-standard, full format coverage |
| Process isolation | Web Workers | Native | Main thread stays responsive |
| Localized strings | JSON locale files | Native | No i18n framework needed for this scope |
| Hosting | GitHub Pages | n/a | Free, HTTPS automatic, sufficient for static site |

### Explicit non-choices

- **No React/Vue/Svelte/Solid/Preact**: the UI is simple enough that a framework would add more overhead than it saves.
- **No Tailwind/Bootstrap/Material/Chakra**: custom CSS is sufficient and produces a smaller bundle.
- **No jQuery, no Lodash**: native APIs cover everything we need.
- **No TypeScript at MVP**: vanilla JS keeps tooling simple; could be added later if needed.
- **No service worker**: out of MVP scope; would only matter if PWA is added.
- **No analytics SDK, no error reporting SDK**: violates strict privacy stance.

---

## 3. Component Architecture

### 3.1 Module map

```
js/
├── main.js                 # Entry point, state machine
├── i18n.js                 # Locale loader
├── fileHandler.js          # File API, ArrayBuffer conversion
├── exiftoolLoader.js       # Lazy WASM loader
├── metadataParser.js       # Parses ExifTool JSON to internal shape
├── ui/
│   ├── uploader.js         # Dropzone UI + drag/drop/click handlers
│   ├── metadataView.js     # Renders metadata list with checkboxes
│   ├── downloader.js       # Blob URL creation, download trigger
│   └── privacyVerifier.js  # performance.getEntries() monitor
└── workers/
    └── exiftool.worker.js  # WASM bridge, runs in Worker context
```

### 3.2 Module responsibilities

#### `main.js`
- Owns the page state machine (`landing` | `analyzing` | `results` | `done` | `error`).
- Coordinates transitions between states.
- Wires UI events to handlers.
- Does not contain business logic directly.

#### `i18n.js`
- Loads the locale file matching the page's `lang` attribute.
- Exposes a `t(key, params)` function that looks up strings.
- Falls back to Spanish if a key is missing (defensive).
- Pure functions only.

#### `fileHandler.js`
- Receives a `File` object from the uploader.
- Validates size and extension against allowed list.
- Converts to `ArrayBuffer`.
- Returns a typed result object (success or error).

#### `exiftoolLoader.js`
- Dynamically imports the WASM module on first call.
- Caches the loaded module for subsequent calls.
- Returns a Promise resolving to the ExifTool API.

#### `metadataParser.js`
- Receives raw ExifTool JSON output.
- Groups tags by category using a known mapping (e.g. `GPS*` → "Location").
- Marks sensitive categories.
- Returns the internal `FileMetadata` structure.

#### `ui/uploader.js`
- Renders the dropzone.
- Listens to drag events (`dragenter`, `dragover`, `dragleave`, `drop`).
- Listens to click events.
- Validates the dropped file via `fileHandler`.
- Emits a `file-selected` event with the validated file.

#### `ui/metadataView.js`
- Renders the metadata list with checkboxes.
- Handles checkbox state changes.
- Exposes a function to get the current selection.
- Implements "select all per category".

#### `ui/downloader.js`
- Takes a cleaned `ArrayBuffer` and original filename.
- Creates a `Blob` with the correct MIME type.
- Creates an object URL.
- Triggers download via a synthetic `<a>` click.
- Revokes the object URL after download.

#### `ui/privacyVerifier.js`
- On page load, records the initial origin.
- Uses `performance.getEntries()` to enumerate loaded resources.
- Filters out non-origin entries.
- Exposes a `count` and `list` for rendering.
- Optionally re-runs on a timer or on user interaction.

#### `workers/exiftool.worker.js`
- Initializes the ExifTool WASM module.
- Exposes a message handler that accepts operations: `read`, `write`.
- Returns results via `postMessage`.
- Handles errors and reports them as data, not throws.

### 3.3 Inter-module contracts

#### Contract A: fileHandler → main

```typescript
type FileValidationResult =
  | { ok: true; file: File; buffer: ArrayBuffer }
  | { ok: false; error: 'too_large' | 'unsupported_format' | 'empty' };
```

#### Contract B: workers → main

```typescript
type WorkerReadResult = {
  ok: true;
  raw: ExifToolJson;
};
type WorkerReadError = {
  ok: false;
  error: 'corrupted' | 'unsupported' | 'worker_crashed';
};
type WorkerMessage = WorkerReadResult | WorkerReadError;

type WorkerWriteRequest = {
  operation: 'write';
  buffer: ArrayBuffer;
  tagsToRemove: string[]; // empty array means "all"
};
type WorkerWriteResult = {
  ok: true;
  cleaned: ArrayBuffer;
};
type WorkerWriteError = {
  ok: false;
  error: 'write_failed' | 'worker_crashed';
};
```

#### Contract C: metadataParser → metadataView

```typescript
type FileMetadata = {
  totalCount: number;
  groups: MetadataGroup[];
};

type MetadataGroup = {
  id: string;            // e.g. 'gps', 'author', 'dates'
  label: string;         // localized
  sensitive: boolean;    // true for GPS, author, etc.
  tags: MetadataTag[];
};

type MetadataTag = {
  id: string;            // canonical tag name, e.g. 'GPSLatitude'
  label: string;         // localized human label
  value: string;         // formatted value
  rawValue: unknown;     // raw value for debugging
  selected: boolean;     // checkbox state, default true
};
```

---

## 4. Performance Requirements

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial HTML+CSS+JS transfer | < 200 KB gzipped | Browser DevTools Network tab |
| Time to first paint | < 500 ms | Lighthouse |
| Time to interactive (dropzone usable) | < 1 s on broadband | Lighthouse |
| WASM download | ~10 MB, < 10 s on broadband | Browser DevTools |
| WASM parse + compile | < 2 s | Browser console (logged) |
| Metadata read (5 MB JPG) | < 1 s | Browser console |
| Metadata write (5 MB JPG) | < 1 s | Browser console |
| Memory peak during processing | < 500 MB for typical file | Browser Performance profiler |
| UI thread blocking | 0 ms (Worker mandatory) | Chrome DevTools Performance |

### Performance constraints

- The UI thread must NEVER block during file processing. Any blocking operation belongs in the Worker.
- The dropzone must be interactive within 1 second of page load. WASM download is deferred.
- Large files should be rejected before being loaded into memory to avoid OOM.

---

## 5. Browser Support

### Supported browsers

| Browser | Minimum version | Notes |
|---------|-----------------|-------|
| Chrome | Last 2 stable | Desktop and Android |
| Firefox | Last 2 stable | Desktop |
| Safari | Last 2 stable | macOS and iOS |
| Edge | Last 2 stable | Desktop (Chromium-based) |

### Required APIs

The page must feature-detect the following and gracefully degrade:

| API | Required for | Fallback |
|-----|--------------|----------|
| WebAssembly | ExifTool execution | Show "browser too old" message |
| `FileReader` / `File.arrayBuffer()` | Reading user files | Show "browser too old" message |
| `File` constructor | File handling | Show "browser too old" message |
| Web Workers | Off-thread processing | Show "browser too old" message (no fallback for sync processing) |
| Drag and Drop | File drop | Click-to-select still works |
| `performance.getEntries()` | Privacy verifier | Verifier shows "API not available" but rest of app works |

### Browsers explicitly NOT supported

- Internet Explorer (any version)
- Pre-2020 mobile browsers
- Browsers with JavaScript disabled

---

## 6. Security Requirements

### 6.1 Content Security Policy

A strict CSP must be set via HTTP header AND via meta tag (defense in depth):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  worker-src 'self' blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'none';
  frame-ancestors 'none';
```

Notes:
- `worker-src 'self' blob:` is required because the WASM is loaded as a module worker; the `blob:` allowance permits the worker to load its module.
- No `unsafe-inline`, no `unsafe-eval` anywhere.
- `data:` images allowed only for inline SVG icons.

### 6.2 HTTPS

- Site is HTTPS-only. HTTP requests are redirected to HTTPS.
- GitHub Pages enforces this automatically.

### 6.3 No third-party resources

- No CDN dependencies (no jsDelivr, no unpkg, no Cloudflare).
- No external fonts (no Google Fonts, no Adobe Fonts).
- No analytics scripts.
- No error tracking (no Sentry, no Bugsnag).
- No third-party CAPTCHA (no reCAPTCHA, no hCaptcha).
- No social widgets.

### 6.4 No cookies, no tracking

- No cookies set or read.
- `localStorage` only used for non-identifying preferences (theme).
- No `IndexedDB` usage.
- No `sessionStorage` usage.

### 6.5 XSS prevention

- All user-derived content (filenames, metadata values) rendered as text, never as HTML.
- No `innerHTML` for dynamic content. Use `textContent` or DOM construction.
- No `eval`, no `Function` constructor.

### 6.6 Supply chain

- No npm dependencies in the production runtime (the only "dependency" is ExifTool WASM, bundled directly).
- Dev dependencies (Vite, etc.) are listed in `package.json` but never deployed.
- ExifTool WASM binary is pinned to a specific version; updates require manual review.

### 6.7 What this TRD does NOT defend against

- Compromise of the user's device or browser.
- A malicious browser extension.
- The user voluntarily re-introducing metadata into a cleaned file.
- Network observers seeing that the user visited the page (use Tor for that).
- GitHub Pages availability (out of our control).

---

## 7. Build & Deploy

### 7.1 Local development

- `npm install` — install dev dependencies (Vite).
- `npm run dev` — Vite dev server with hot reload.
- `npm run build` — produce optimized static bundle in `dist/`.
- `npm run preview` — preview the built bundle locally.

### 7.2 Build outputs

```
dist/
├── index.html
├── assets/
│   ├── main-[hash].js
│   ├── styles-[hash].css
│   ├── exiftool-[hash].wasm
│   └── ...
└── locales/
    ├── es.json
    └── en.json
```

### 7.3 CI/CD

- GitHub Actions workflow on every push to `main`:
  1. Install dependencies
  2. Run `npm run build`
  3. Run privacy guard test (headless browser checks zero non-origin requests)
  4. Deploy `dist/` to GitHub Pages
- Build fails if any step fails.
- Deploy only happens if all prior steps pass.

### 7.4 Privacy guard test (CI)

A headless-browser test that:
1. Loads the built page in a clean browser context.
2. Performs a full user flow (drop file → review → clean → download trigger).
3. Captures all network requests during the flow.
4. Asserts every request's URL starts with the page's own origin.
5. Fails the build if any external request is detected.

This is a **release gate** — a regression that breaks the privacy guarantee blocks the deploy.

---

## 8. Non-Functional Requirements (Technical)

### 8.1 Maintainability

- Code is organized by responsibility, not by type (components in `ui/`, not all JS in one folder).
- Each module has a single, clear responsibility.
- Functions are pure where possible.
- Comments explain WHY, not WHAT.
- No dead code, no commented-out blocks.
- Public API of each module is documented in a comment header.

### 8.2 Testability

- Pure functions are unit-testable (though we defer unit tests for MVP).
- The privacy guard test is automated.
- Manual test plan covers all user flows (see [Design Spec §6](./2026-09-21-metalimpia-design.md#6-testing-and-verification)).

### 8.3 Portability

- The static site runs on any static host.
- No environment-specific code (no Node-only APIs in the browser bundle).
- WASM module is portable across browsers.

### 8.4 Upgradability

- ExifTool updates: replace the WASM binary, no code changes needed.
- Locale additions: add a new JSON file, no code changes.
- Visual refresh: replace CSS, no logic changes.
- Dependency upgrades (Vite etc.): tested in dev, then in CI.

---

## 9. Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| ExifTool WASM too large | Poor first-use experience | Medium | Lazy load; document size; cache aggressively |
| ExifTool WASM slow on mobile | Frustration on phones | Medium | Show progress; consider mobile-specific optimizations later |
| Browser API changes | Feature breaks | Low | Feature-detect; show upgrade message |
| GitHub Pages outage | Service unavailable | Very low | Static site; can mirror to other hosts |
| ExifTool version drift | New metadata formats not handled | Low | Pin version; review updates manually |
| WASM memory leaks | Tab crashes on large files | Low | Reject files > 200 MB; clean up Worker after each file |
| MIME spoofing | User uploads malicious file disguised as JPG | Low | ExifTool detects actual file type via magic bytes; warn user |
| ZIP bomb (Office formats) | Memory exhaustion | Low | 200 MB cap covers most cases; consider further mitigations later |
| Supply-chain attack on Vite/npm | Build compromised | Very low | Pin versions; review updates; build deterministically |

---

## 10. Future Technical Considerations (not MVP)

- **PWA support**: add service worker for offline use and installability.
- **WebGPU processing**: if ExifTool WASM is too slow on some devices, evaluate WebGPU-based metadata parsing for common formats.
- **Streaming processing**: for very large files, consider streaming the read/write instead of loading fully into memory.
- **Metadata editing**: extend the UI to let users edit tags before saving.
- **Selective group deletion**: let users keep color profiles but strip everything else with one click.

---

## Appendix A — Environment Variables

There are NO environment variables at runtime. The build has none either (no API keys, no backend URLs). This is intentional.

If a future feature requires configuration, it should be build-time only and committed to the repo.

## Appendix B — Dependency List

### Production runtime dependencies

- **ExifTool WASM** (~10 MB, bundled directly, no npm package). License: Artistic License / GPL (Phil Harvey). Used: at runtime in Web Worker.

### Development dependencies

- **Vite** (build tool). License: MIT. Used: build only, not deployed.

### Transitive dependencies

ExifTool WASM may pull in additional Perl modules; these are compiled in. License terms apply per Phil Harvey's distribution.

### Dependency-update policy

- ExifTool: review changelog quarterly, upgrade if security-relevant or coverage-relevant.
- Vite: minor and patch updates OK; major versions require testing.
- All dev dependencies pinned to exact versions in `package.json` and `package-lock.json`.
