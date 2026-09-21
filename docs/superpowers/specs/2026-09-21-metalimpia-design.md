# MetaLimpia — Design Specification

**Status**: Draft for review
**Date**: 2026-09-21
**Working name**: MetaLimpia (subject to confirmation of domain availability)

---

## 1. Executive Summary

### What it is
A web page that lets users **review and remove metadata** from their files (JPG, PNG, TIFF, PDF, DOCX, XLSX, PPTX) **directly in the browser**, with zero upload to any server.

### Why it exists
Existing metadata-cleaning tools either:
- Require command-line knowledge (ExifTool)
- Upload user files to remote servers (privacy risk)
- Are limited to one format or provide shallow metadata coverage

MetaLimpia combines **ExifTool-grade metadata coverage** with **client-side processing** so files never leave the user's machine.

### Key differentiator
> "Tu archivo nunca sale del navegador. No podemos verlo aunque quisiéramos."

This is not a marketing claim — it is a **technically enforced property** of the architecture (no backend). A "Privacy Verifier" widget in the UI shows the user in real time that zero external connections are made.

### Audience
Spanish-speaking users who want to clean metadata from files before sharing them. Use cases include: photographers avoiding GPS leaks, journalists protecting sources, employees sharing documents externally, and any privacy-conscious user. The page is intentionally **not region-specific** — Spanish copy must be neutral.

---

## 2. Product Scope (MVP)

### In scope (MVP)
- Upload a single file (drag & drop or click-to-select)
- Process common formats: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX
- Show all metadata found in the file, grouped by category (Author, Location, Dates, Comments, etc.)
- Allow the user to choose between "remove all metadata" (aggressive: ExifTool `-all= -unsafe`, removing even tags ExifTool considers "unsafe" because privacy is the explicit goal) and selective removal (per-tag checkboxes)
- Generate the cleaned file and trigger download
- Display a confirmation screen ("X metadatos eliminados")
- Responsive layout (mobile + desktop)
- Spanish-neutral UI copy, with structured i18n ready for additional languages
- Strict privacy: no CDN, no analytics, no Google Fonts, no third-party scripts, open-source code

### Out of scope (deferred — explicitly rejected for MVP)
- User accounts / login / registration
- File history (would require storing any info about the user — explicitly rejected for privacy)
- Batch processing of multiple files
- PWA / installable / offline mode
- Native mobile apps
- Dark mode
- Temas / branding customizations
- Sharing / collaboration features
- Server-side fallback for browsers without WebAssembly

### Edge cases handled in MVP
- File too large (>200 MB): reject with friendly message
- Unsupported format: reject with helpful message listing supported types
- Corrupted file: reject with friendly message
- File with no metadata: show positive message ("ya está limpio") + offer download anyway
- Browser without WebAssembly: show upgrade-browser message
- WASM fails to load (network): show retry message
- Worker crash: show generic error + reload suggestion

---

## 3. Technical Stack and Architecture

### Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Markup | HTML5 | Minimal, no framework needed |
| Styles | CSS3 (custom, no framework) | Keeps bundle small, full control, no Bootstrap/Tailwind needed for this size |
| Client logic | Vanilla JavaScript (ES modules) | No React/Vue/Svelte overhead; bundle under 50 KB |
| Build tooling | Vite | Modern, fast, bundles WASM cleanly |
| Metadata engine | ExifTool compiled to WebAssembly | Industry-standard metadata coverage; single dependency for all formats |
| Processing | Web Worker | Keeps UI responsive while ExifTool processes |
| i18n | JSON locale files + thin JS helper | All strings in `locales/*.json`; no hardcoded UI copy |
| Hosting | GitHub Pages | Free, HTTPS automatic, fits static-site model |
| Typography | System UI font stack | Zero external font requests, native feel per OS |

### File / folder structure

```
metalimpia/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── main.js              # Orchestrator
│   ├── i18n.js              # Locale loader and string lookup
│   ├── fileHandler.js       # Reads user files into ArrayBuffer
│   ├── exiftoolLoader.js    # Lazy-loads WASM module
│   ├── metadataParser.js    # Parses ExifTool JSON output, groups by category
│   ├── ui/
│   │   ├── uploader.js      # Drag & drop + click-to-select
│   │   ├── metadataView.js  # Renders metadata list with checkboxes
│   │   └── downloader.js    # Triggers file download
│   └── workers/
│       └── exiftool.worker.js  # Runs ExifTool WASM off the main thread
├── assets/
│   └── exiftool.wasm        # ExifTool engine (~10 MB)
├── locales/
│   ├── es.json              # Spanish (neutral)
│   └── en.json              # English (placeholder for future)
├── docs/
│   └── privacidad.html      # Plain-language privacy policy
├── README.md
├── LICENSE                  # MIT
└── .github/
    └── workflows/
        └── deploy.yml       # Auto-deploy to GitHub Pages
```

### Architectural rules

1. **Single page, no router**: SPA with view states, not multi-page navigation.
2. **Lazy load the WASM**: do not include in initial bundle; download only when user drops first file.
3. **Web Worker mandatory**: ExifTool runs off main thread to keep UI responsive.
4. **All async file handling**: never block the main thread on file I/O or ExifTool processing.
5. **No global mutable state**: each module exposes pure functions; main.js orchestrates.
6. **All UI strings via i18n**: never hardcode Spanish (or any other language) in HTML/JS.

---

## 4. Components and User Flow

### UI view states (single page, state-driven)

The page has 4 states. Only one is visible at a time.

1. **`landing`** — Dropzone, privacy verifier collapsed, headline, brief instructions.
2. **`analyzing`** — Progress indicator while ExifTool reads the file.
3. **`results`** — Metadata list with checkboxes, action buttons (remove all / selected), back option.
4. **`done`** — Confirmation, download button, "process another file" option.

### User journey

```
[landing]  --user drops file-->  [analyzing]
   ^                                  |
   |                                  v
   |                            [results]
   |                                  |
   |                                  --user clicks "remove"--> [done]
   |                                                                   |
   <-------------------------user clicks "another file"-----------------
```

### Data flow

```
User's disk
    | (FileReader / File API)
    v
Main thread memory (ArrayBuffer)
    | (postMessage to Worker)
    v
Web Worker
    | (calls ExifTool WASM)
    v
ExifTool reads metadata -> returns JSON
    | (postMessage back to main)
    v
Main thread renders [results] state
    | (user confirms)
    v
Web Worker (ExifTool writes with -all= or selected tags removed)
    | (returns ArrayBuffer of cleaned file)
    v
Main thread creates Blob, generates object URL
    | (triggers download via <a download>)
    v
User's disk (cleaned file)
```

**Key invariant**: the file content never leaves the browser. The only network requests during a session are:
1. Initial page load (HTML/CSS/JS/WASM, all from origin)
2. WASM download on first use (cached afterwards)

---

## 5. Error Handling

### Error scenarios and user-facing messages

All messages are in **neutral Spanish** (no regionalismos). The strings live in `locales/es.json`.

| Scenario | Detection | User-facing message |
|----------|-----------|---------------------|
| Archivo demasiado grande | Check `file.size > 200 MB` before processing | "Este archivo es muy grande (X MB). El máximo permitido es 200 MB." |
| Formato no soportado | Check file extension against allowlist | "No reconocemos este formato de archivo. Formatos soportados: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX." |
| Archivo corrupto | ExifTool returns read error | "El archivo parece estar dañado. No pudimos leerlo. Probá con otra copia del archivo." |
| Archivo sin metadatos | ExifTool returns empty result | "Buenas noticias: este archivo no tiene metadatos. Ya está limpio." + offer download anyway |
| Navegador sin WebAssembly | Feature detect `typeof WebAssembly` | "Tu navegador es muy antiguo. Actualizalo o usá Chrome, Firefox, Safari o Edge en sus últimas versiones." |
| WASM no se carga | Worker fails to instantiate | "No pudimos cargar el motor. Verificá tu conexión a internet y recargá la página." |
| Worker crashea | `worker.onerror` | "Ocurrió un error inesperado. Recargá la página y probá de nuevo." |
| Cancelación de descarga | User clicks outside / cancels | No error UI; this is normal browser behavior |

### Principles

1. **No technical jargon in user messages** (no "null pointer", no stack traces, no HTTP codes).
2. **Always offer a next step** ("recargá", "probá con otro archivo", "actualizá el navegador").
3. **Tono humano**, not system-like ("Ocurrió un error inesperado" beats "Error 500").
4. **Privacy**: no error reports are sent to external services (no Sentry, no remote logging). The site owner only learns about errors if the user reports them manually.

---

## 6. Testing and Verification

### Manual test checklist (pre-release)

- [ ] Upload a JPG with GPS data → verify metadata appears in results → select "remove all" → verify downloaded file passes `exiftool -all= cleaned.jpg` (returns no metadata)
- [ ] Repeat with PDF, DOCX, XLSX, PPTX
- [ ] Test with a file that has no metadata (result: "ya está limpio" + download offered)
- [ ] Test with corrupted file (truncated JPG, fake PDF) → friendly error message
- [ ] Test with file >200 MB → rejected with size message
- [ ] Test in latest Chrome, Firefox, Safari, Edge (desktop)
- [ ] Test in iPhone Safari and Android Chrome (mobile)
- [ ] Open DevTools → Network tab → reload → confirm **zero requests to non-origin domains** during full flow
- [ ] Test slow network: cancel WASM mid-download → verify graceful error
- [ ] Test all keyboard navigation paths (dropzone accessible via Tab + Enter)

### Automated checks

- **Privacy guard test**: headless browser script that opens the page, performs a full flow, and asserts zero requests to non-origin domains. Runs in CI before deploy. Blocks release if it fails.
- **HTML/CSS validation**: standard lints, no console errors.
- **Accessibility quick check**: WCAG AA contrast on all text, focus states visible, ARIA labels on interactive elements.

### Out of scope for testing (YAGNI)

- Unit tests for UI logic (the logic is too small to be worth the test infrastructure)
- E2E test frameworks (Playwright/Cypress) — overkill for a single-page tool
- Performance benchmarks — ExifTool WASM is benchmarked upstream

### Definition of "ready to ship"

The product is ready to ship when, in order:
1. All manual checklist items pass.
2. The privacy guard test passes.
3. **The owner can personally answer "yes" to: "If I were a privacy-paranoid user, would I trust this page to clean a sensitive file?"**

---

## 7. Visual Design System

### Design principles

1. **Calm competence**: trust is communicated quietly. No alarmist banners, no exclamations, no alarm emojis.
2. **Clarity over complexity**: metadata is dense; the UI must dismantle it. Group, hierarchize, label with human language.
3. **Absence as statement**: minimalism *is* the promise. No clutter, no decorative elements that distract.
4. **Proof, not claims**: the privacy verifier shows, not tells.

### Color palette

```css
:root {
  /* Brand */
  --color-primary:        #1E3A5F;   /* Deep blue — trust, stability */
  --color-primary-hover:  #15293F;
  --color-success:        #2D8659;   /* Muted green — clean file, success */
  --color-warning:        #C87520;   /* Warm amber — sensitive data (GPS, author) */
  --color-danger:         #B23A3A;   /* Muted red — errors only when needed */

  /* Surfaces */
  --color-bg:             #FAF8F5;   /* Warm off-white */
  --color-surface:        #FFFFFF;
  --color-surface-alt:    #F2EFE9;

  /* Text */
  --color-text-primary:   #1A1A1A;
  --color-text-secondary: #5A5A5A;
  --color-text-muted:     #8A8A8A;
  --color-text-inverse:   #FFFFFF;

  /* Borders */
  --color-border:         #E5E1D8;
  --color-border-strong:  #C9C4B8;
}
```

**Why these choices**:
- No purple/pink "AI gradients" — those signal the opposite of trust.
- No pure black (#000) — too aggressive for a privacy tool.
- Off-white instead of pure white — easier on the eyes, warmer.
- Muted deep blue + green — serious without being corporate.
- Amber reserved for sensitive-metadata tags.

### Typography

System font stack only (zero external font requests):

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI",
               Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
}
```

| Token | Size / weight | Use |
|-------|---------------|-----|
| `text-display` | 36px / 700 | Landing headline |
| `text-h1` | 28px / 700 | Results screen title |
| `text-h2` | 22px / 600 | Category headers (Author, Location, etc.) |
| `text-h3` | 18px / 600 | Subtitles |
| `text-body` | 16px / 400 | Body copy |
| `text-small` | 14px / 400 | Secondary metadata |
| `text-tiny` | 12px / 500 | Labels, tags |
| `text-mono` | 14px / 400 | Tag names, technical values |

### Spacing and radii

```css
:root {
  /* 4px-based scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* Soft radii */
  --radius-sm: 4px;   /* Tags, chips */
  --radius-md: 8px;   /* Buttons, inputs */
  --radius-lg: 12px;  /* Cards, dropzone */
  --radius-xl: 20px;  /* Main container */
}
```

### Motion

- Minimal and purposeful — never animate for the sake of animation.
- Fade-in 200ms for new screens / state transitions.
- Micro-interactions 100–150ms on hover and focus.
- Honor `prefers-reduced-motion` (mandatory a11y).
- No decorative loaders (skeleton and progress are fine; no bouncing bars).

### Layout

- **Mobile-first**: dropzone is full-width on mobile.
- **Tablet/desktop**: max-width 720px centered, generous whitespace on both sides — reinforces focus.
- **Results table on mobile**: vertical accordion, not horizontal scroll.

### The Privacy Verifier (key differentiator)

A persistent widget in the footer / sidebar area:

```
+----------------------------------------+
|  Privacy Verifier                      |
|                                        |
|  Esta página está haciendo 0           |
|  conexiones con servidores externos.   |
|                                        |
|  [Ver detalle técnico]                 |
+----------------------------------------+
```

When expanded, shows a live list of all loaded resources, all from origin:

```
Conexiones externas: 0
Recursos cargados:
  [OK] metalimpia.app/index.html
  [OK] metalimpia.app/styles.css
  [OK] metalimpia.app/main.js
  [OK] metalimpia.app/exiftool.wasm
```

This turns the privacy promise into **visible proof**.

**Implementation note**: the verifier reads `performance.getEntries()` from the browser's Performance API to enumerate every resource loaded by the page since session start. It filters out anything whose origin is not the page's own origin and exposes the count + list to the widget.

---

## 8. Privacy and Security Model

### The strict privacy model

MetaLimpia commits to:

1. **Zero file upload** — files never leave the browser. This is a hard architectural property: there is no backend server to receive them.
2. **Zero analytics** — no Google Analytics, no Plausible, no Matomo, no error tracking services.
3. **Zero CDN dependencies** — every byte the browser loads comes from the MetaLimpia origin.
4. **Zero external fonts** — system font stack only; no Google Fonts, no Adobe Fonts.
5. **Zero cookies, zero localStorage tracking** — only non-identifying preferences (e.g. theme).
6. **Zero telemetry** — no `fetch` calls to any external endpoint for any purpose.

### Implementation rules

- **CSP header** with `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; font-src 'self';` — set via meta tag in HTML and via HTTP header on GitHub Pages.
- **No `unsafe-inline` and no `unsafe-eval`** in CSP.
- **Subresource Integrity (SRI)** is not needed because no resources are loaded from third-party origins.
- **HTTPS only** — GitHub Pages enforces this by default.
- **No service worker registration** (out of MVP scope; would be required for PWA later).

### Auditability

- The complete source code is public on GitHub under the MIT license.
- The privacy policy is published at `/privacidad` in plain Spanish, with technical claims verifiable by anyone reading the code.

### The privacy policy statement (plain Spanish)

> En MetaLimpia no podemos ver tus archivos aunque quisiéramos. Tu archivo se abre, se procesa y se descarga limpio, todo dentro de tu navegador. No tenemos servidor que reciba archivos. No usamos analytics, ni cookies de rastreo, ni servicios externos. Todo el código es público y auditable.

### Threat model

MetaLimpia reasonably protects against:
- Network observers seeing the file contents (HTTPS + no upload)
- The site owner collecting files (architectural impossibility)
- Tracking via cookies or analytics (none used)
- Supply-chain attacks via CDN (no CDN)
- XSS / injection attacks (CSP, no inline scripts)

MetaLimpia does **not** protect against:
- Malware on the user's device (out of scope)
- The user voluntarily copying the cleaned file's metadata elsewhere
- A compromised browser extension (out of scope)
- Network observers seeing that the user visited metalimpia.app (HTTPS hides content, not the visit itself; this is what Tor is for)

---

## 9. Future Roadmap (post-MVP, not committed)

These are explicitly out of scope for MVP but worth considering later:

- **PWA**: installable, works offline. ~1 day of work once core is stable.
- **Batch processing**: multiple files at once. Requires UX rework.
- **Additional languages**: English first (already stubbed), then Portuguese, French.
- **Dark mode**: design tokens are already structured to support it.
- **Metadata editing**: let users edit tags before saving (advanced feature).
- **Custom "presets"**: e.g. "remove only GPS" with one click.
- **Onion service**: `.onion` version for Tor users (privacy-hardcore audience).
- **Verifiable builds**: signed releases so users can verify they're running the audited version.

---

## 10. Open Questions / Deferred Decisions

These were identified during brainstorming but not resolved:

- **Domain**: MetaLimpia.com and MetaLimpia.app availability must be confirmed by the owner before launch.
- **Analytics replacement**: if we ever want basic usage stats, the privacy-respecting option is a self-hosted, cookieless counter. Deferred until there's a concrete need.
- **Branding**: no logo or icon yet. The `.app` icon should be a simple SVG (lock + document motif) when designed.
- **"Metadata verificador" name**: the privacy widget name is a placeholder; can be refined.

---

## Appendix A — Decision Log

| Decision | Choice | Rejected alternatives | Reason |
|----------|--------|----------------------|--------|
| Architecture | Client-side pure | Backend, hybrid | Hard privacy guarantee; zero hosting cost; matches differentiator |
| Metadata engine | ExifTool WASM | Per-format JS libs | Single dependency, full coverage, battle-tested |
| File formats (MVP) | JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX | RAW, video, audio | User-stated scope; rest comes "free" via ExifTool but not tested |
| Mobile | Responsive only | PWA, native apps | Lower complexity; PWA easy to add later |
| Privacy level | Strict | Basic, hardcore | Best differentiator; not much extra cost with static hosting |
| Language | Spanish neutral, i18n-ready | Spanish only, multi-language now | Neutral Spanish is the broadest reach; structure ready for more |
| Hosting | GitHub Pages | Netlify, Vercel, self-host | Free, HTTPS auto, fits static model |
| Typography | System fonts | Google Fonts, custom | Strict privacy; zero requests |
| Framework | Vanilla JS | React, Vue, Svelte | Bundle size, no need for framework at this scale |
| Name | MetaLimpia | Other candidates | Spanish-friendly, descriptive, memorable |

---

## Appendix B — Glossary

- **EXIF**: Exchangeable Image File Format. Metadata standard for images, includes GPS, camera model, etc.
- **IPTC**: International Press Telecommunications Council. Metadata standard used by news organizations.
- **XMP**: Extensible Metadata Platform. Adobe's metadata standard, used across formats.
- **MakerNotes**: Vendor-specific EXIF data (Canon, Nikon, Apple, etc.).
- **WASM (WebAssembly)**: binary instruction format that runs in browsers at near-native speed.
- **Web Worker**: a JavaScript thread that runs in the background, separate from the page's main thread.
- **CSP (Content Security Policy)**: HTTP header that tells the browser which resources are allowed to load.
- **SRI (Subresource Integrity)**: cryptographic hash check for loaded resources. Not needed here because no third-party resources.
