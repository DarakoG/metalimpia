# MetaLimpia — Auditoría de privacidad

**Status**: Phase 7 (Privacy Hardening) audit — 2026-09-21
**Scope**: Static audit of the source code and the production build artifacts.

This document captures the privacy audit required by Implementation Plan §10
tasks 7.6, 7.7, 7.8, 7.10, 7.11, and 7.12. Every section records what was
checked, the command used, and the result. A future contributor can rerun
each command to re-verify the audit.

The audit is also captured in `odd/tasks/metalimpia-mvp.md` (Phase 7 section)
for tracking purposes. This document is the public-facing version.

---

## 7.6 — `innerHTML`, `eval`, `Function()`, `document.write`

These APIs are the canonical XSS surface in a vanilla JS app. The audit
confirms that the codebase never assigns user-derived data to `innerHTML`,
never evaluates strings as code, and never uses `document.write`.

### Command

```bash
grep -rE 'innerHTML|\beval\b|new Function|Function\(\s*['\''"]|document\.write' \
    js/ index.html docs/privacidad.html
```

### Findings

#### `innerHTML`

Five code occurrences across `js/`:

| File | Line | Code | Purpose | Safe? |
|------|------|------|---------|-------|
| `js/main.js` | 237 | `viewContainer.innerHTML = '';` | Clear view container on `landing` render | ✓ Empty string assignment |
| `js/main.js` | 252 | `viewContainer.innerHTML = '';` | Clear view container before each non-landing render | ✓ Empty string assignment |
| `js/ui/metadataView.js` | 160 | `container.innerHTML = '';` | Clear view container before results render | ✓ Empty string assignment |
| `js/ui/analyzingView.js` | 45 | `container.innerHTML = '';` | Clear view container before analyzing render | ✓ Empty string assignment |
| `js/ui/doneView.js` | 80 | `container.innerHTML = '';` | Clear view container before done render | ✓ Empty string assignment |
| `js/ui/errorView.js` | 67 | `container.innerHTML = '';` | Clear view container before error render | ✓ Empty string assignment |
| `js/ui/privacyVerifier.js` | (renderList helper) | `listEl.innerHTML = '';` | Clear resource list before re-rendering | ✓ Empty string assignment |

All seven assignments set `innerHTML` to the empty string `''` so the browser
performs a subtree wipe with no HTML parser involvement. Every subsequent
child element is created with `document.createElement` and populated with
`textContent` — user-derived strings (filenames, metadata values, file
sizes, etc.) are never assigned to `innerHTML`.

The `innerHTML` pattern with empty string is the explicit "clear container"
pattern documented across `js/ui/*View.js` and is consistent with the
short task brief: "either `element.innerHTML = ''` (clearing, not setting
user data — safe) or comments documenting that innerHTML is never used
with user data".

#### `eval`

```bash
grep -rE '\beval\b' js/ index.html docs/privacidad.html
```

**Zero matches.** No string is ever passed to `eval`.

#### `new Function()` / `Function('...')`

```bash
grep -rE 'new Function\(|Function\(\s*['\''"]' js/ index.html docs/privacidad.html
```

**Zero matches.** The Function constructor is not used anywhere in the
codebase, vendored dependencies included.

#### `document.write`

```bash
grep -rE 'document\.write' js/ index.html docs/privacidad.html
```

**Zero matches.** The legacy `document.write` API is not used.

### Conclusion

The codebase is clean of XSS surface via the four canonical vectors. The
five `innerHTML` uses are all the empty-string clear pattern documented
across the codebase.

---

## 7.7 — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`

These APIs are the canonical "phone home" surface. The audit confirms
that there is exactly one `fetch()` call in the codebase, that it is
same-origin, and that no other network-request APIs are used at runtime.

### Command

```bash
grep -rE 'fetch\(|XMLHttpRequest|WebSocket|EventSource' js/ index.html docs/privacidad.html
```

### Findings

#### `fetch()`

One code occurrence:

| File | Line | Code | URL | Safe? |
|------|------|------|-----|-------|
| `js/workers/exiftool.worker.js` | 98 | `const response = await fetch(WASM_URL);` | Same-origin (`new URL('../../assets/exiftool.wasm', import.meta.url)`) | ✓ Same-origin |

Other matches in `js/exiftoolLoader.js`, `js/workers/exiftool.worker.js`,
and `js/ui/uploader.js` are comments or vendored-code references (the
vendored Apache-2.0 `parseMetadata`/`writeMetadata` wrappers in
`js/vendor/exiftool/index.js` and `js/vendor/zeroperl/index.js` expose a
`fetch` callback that we satisfy with a same-origin `customFetchForZeroperl`
that returns the cached WASM bytes — see `js/workers/exiftool.worker.js`
lines 83–90).

`docs/privacidad.html` and `index.html` contain zero `fetch(` calls
(the privacy policy page has no JavaScript at all).

#### `XMLHttpRequest`

**Zero matches.** The legacy XHR API is not used anywhere in the codebase.

#### `WebSocket`

**Zero matches.** The page does not open any WebSocket connections.

#### `EventSource`

**Zero matches.** The page does not subscribe to any Server-Sent Events.

### Conclusion

The only outbound network call in the entire codebase is the Worker's
fetch of the ExifTool WASM, which resolves to the same origin as the
page (`/assets/exiftool.wasm`). Every other resource the browser loads
is the same-origin HTML, CSS, JS, or WASM that ships in `dist/`.

---

## 7.8 — Third-party URLs in build output

A grep over `dist/` after a production build confirms that no third-party
domain is ever **fetched** at runtime. Some URL strings do appear in the
bundle as static literals (XML namespace identifiers, error-message
strings, plain-text anchors); none of them triggers an HTTP request
during the user flow.

### Command

```bash
npm run build

# PowerShell equivalent of grep — find every http(s) URL in
# the build artefacts (HTML/JS/CSS only; .wasm is binary).
$files = @()
$files += Get-ChildItem dist -Recurse -File -Filter "*.html"
$files += Get-ChildItem dist -Recurse -File -Filter "*.js"
$files += Get-ChildItem dist -Recurse -File -Filter "*.css"
foreach ($f in $files) {
  $content = Get-Content -LiteralPath $f.FullName -Raw
  $matches = [regex]::Matches($content, 'https?://[a-zA-Z0-9.\-/]+')
  foreach ($m in $matches) { $matches_list += $m.Value }
}
$matches_list | Sort-Object -Unique
```

### Findings

The grep surfaces 5 unique URL strings across `dist/`. Each is examined
and classified below.

| URL | File | Class | Network call? |
|-----|------|-------|---------------|
| `https://github.com/darakog/metalimpia` | `dist/privacidad.html` | Plain-text anchor `<a href>` (link to source code) | No — browser only navigates if the user clicks |
| `https://github.com/darakog/metalimpia/issues` | `dist/privacidad.html` | Plain-text anchor `<a href>` (link to issues) | No — browser only navigates if the user clicks |
| `https://rolldown.rs/in-depth/bundling-cjs#require-external-modules` | `dist/assets/exiftool.worker-*.js` | Vite CJS-shim error message string | No — only displayed if the Worker fails to load a CJS module |
| `http://www.w3.org/1999/02/22-rdf-syntax-ns#` | `dist/assets/exiftool.worker-*.js` | W3C RDF syntax namespace URI (literal string in the bundled ExifTool Perl code) | No — XML namespace identifier, never fetched |
| `http://www.w3.org/2001/XMLSchema` | `dist/assets/exiftool.worker-*.js` | W3C XML Schema namespace URI (literal string in the bundled ExifTool Perl code) | No — XML namespace identifier, never fetched |
| `http://ns.exiftool.org/1.0/` | `dist/assets/exiftool.worker-*.js` | ExifTool's custom RDF namespace URI (literal string in the bundled ExifTool Perl code) | No — XML namespace identifier, never fetched |

The W3C / ExifTool namespace strings come from the XMP / RDF metadata
output produced by ExifTool when it writes XMP sidecars or RDF serialisations.
They are static XML namespace identifiers (the same way `http://www.w3.org/2000/svg`
identifies the SVG namespace in an inline SVG document) — the strings are
emitted into the user's file as XML attributes, not as URLs the browser
fetches. The Perl source that contains them is bundled into the WASM
runtime; the strings are never the target of a network call.

The GitHub anchors on the privacy policy page are explicit links the user
must click to navigate to. The CSP `default-src 'self'` and
`connect-src 'self'` do not restrict `<a href>` navigation (CSP does not
cover hyperlink clicks — only programmatic fetch / XHR / WebSocket /
EventSource). The Privacy Verifier's `performance.getEntriesByType('resource')`
count is therefore unchanged by the existence of the anchors.

### Conclusion

The production build is clean of **fetched** third-party URLs. The
strict CSP meta tag's `connect-src 'self'` is the structural defence;
the grep above is the empirical verification. Phase 8's Playwright
privacy guard test will automate this check at runtime and fail the
build on any regression.

---

## 7.9 — Manual DevTools network audit (DEFERRED)

The Implementation Plan §10 task 7.9 calls for a manual DevTools Network
tab walkthrough of the full user flow (drop file → review → clean →
download). This is documented as **Phase 9 work** (Cross-Browser + Responsive
QA) in `odd/tasks/metalimpia-mvp.md`.

The Phase 8 Playwright privacy guard test will automate the same check
and gate the CI pipeline — that is the structural gate that prevents
future regressions from shipping.

---

## 7.10 — Service worker

The codebase contains zero service worker registration code. Service
workers would be required for PWA installability and offline support,
but the Design Spec §3 explicitly defers both to "Future Roadmap" — and
service workers are incompatible with the strict CSP because they would
allow a future contributor to inject CSP response headers, contradicting
the "no service worker in MVP" stance.

### Command

```bash
grep -rE 'serviceWorker|navigator\.serviceWorker' js/ index.html docs/privacidad.html
```

### Findings

**Zero matches.** No code path registers, installs, or interacts with a
service worker.

### Conclusion

The app is SW-free by design. Adding one in a future phase would require
a deliberate Phase 7 amendment (this audit doc + the task file would
need to be updated, and the CSP would need to add `worker-src 'self'`
allowance for the SW registration).

---

## 7.11 — Cookies, `localStorage`, `sessionStorage`

The Data Model §2 explicitly forbids persistent client-side state in the
MVP. The audit confirms no production code touches `document.cookie`,
`localStorage`, or `sessionStorage`.

### Command

```bash
grep -rE 'localStorage|sessionStorage|document\.cookie' js/ index.html docs/privacidad.html
```

### Findings

**Zero matches.** No code path reads or writes cookies, `localStorage`,
or `sessionStorage`.

The Data Model §2 explicitly allows `localStorage` for a single optional
theme preference (deferred to a future dark-mode feature). That key would
be a non-identifying string (`'light' | 'dark'`) and would only land in
`localStorage` if the user toggled the theme — neither of which the
current MVP does.

### Conclusion

The app is stateless across sessions. Closing the tab drops every byte
the user dropped into it.

---

## 7.12 — HTTPS-only

GitHub Pages enforces HTTPS by default for `<user>.github.io` project
sites. The deployment URL is `https://darakog.github.io/metalimpia/`.

### Verification

To be verified by the parent agent (or by a CI check in a future phase)
after the Phase 7 commits are pushed:

1. `curl -I http://darakog.github.io/metalimpia/` returns a 301/302 redirect
   to `https://darakog.github.io/metalimpia/`.
2. `curl -I https://darakog.github.io/metalimpia/` returns `200 OK` with
   `Strict-Transport-Security` set by GitHub Pages.
3. The browser DevTools Network tab shows the served URL as `https://...`.

### Limitation

GitHub Pages does not let us set custom HTTP response headers, so we
cannot add HSTS preload directives, custom CSP headers, or
`X-Frame-Options`. See `README.md` → "Limitaciones honestas de la
plataforma" for the full list.

### Conclusion

HTTPS is enforced by the platform. The strict CSP via `<meta>` tag is
the in-document privacy defence; it is identical in scope to the
header form for every directive except `frame-ancestors` and
`report-uri` / `report-to` (see `index.html` for the full rationale).

---

## How to re-run this audit

Every section above records the exact grep / curl command used. A future
contributor can re-run each command to confirm the audit still passes.
The Phase 8 privacy guard test will automate the live-runtime
verification (network requests during a full user flow) and fail the
build on any regression.

If a finding changes (a new `fetch` call, a new CDN reference, a new
service worker registration, etc.), update both this file and the
Phase 7 section of `odd/tasks/metalimpia-mvp.md` in the same commit.
