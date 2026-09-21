# MetaLimpia — Implementation Plan

**Status**: Draft for review
**Date**: 2026-09-21
**Related**:
- [Design Spec](./2026-09-21-metalimpia-design.md)
- [PRD](./2026-09-21-metalimpia-prd.md)
- [TRD](./2026-09-21-metalimpia-trd.md)
- [Data Model](./2026-09-21-metalimpia-data-model.md)
- [Flow](./2026-09-21-metalimpia-flow.md)
- [Adversarial Testing](./2026-09-21-metalimpia-adversarial-testing.md)

---

## 1. Overview

This plan breaks the MetaLimpia MVP into **11 sequential phases**, each with clear deliverables and verification. The phases are ordered so that each one produces a working, demonstrable artifact before moving on.

### How to read this document

- Each phase has a **Goal**, **Tasks**, **Deliverables**, **Verification**, and **Effort**.
- Effort uses t-shirt sizes (XS / S / M / L). Treat these as relative, not absolute.
- Each task is sized to fit one **work-unit commit** (see [Work Unit Commits](../../../../.config/opencode/skills/work-unit-commits/SKILL.md)).
- A phase is "done" only when all its tasks pass their verification criteria.

### Branch and commit strategy

- One feature branch for the entire MVP: `feat/initial-implementation`
- Trunk-based for personal commits; one PR per phase for review if collaborating
- Each task = one work-unit commit with conventional commit message
- No long-lived sub-branches; merge to `main` at phase boundaries

---

## 2. Phases at a Glance

| Phase | Name | Effort | Depends on | Working artifact |
|-------|------|--------|------------|------------------|
| 0 | Project scaffolding | XS | — | Empty project with tooling |
| 1 | Landing page + design system | S | 0 | Static landing renders |
| 2 | File upload + validation | S | 1 | Dropzone accepts/rejects files |
| 3 | ExifTool WASM integration | M | 2 | Worker returns metadata |
| 4 | Metadata display + selection | M | 3 | User sees metadata with checkboxes |
| 5 | Metadata removal + download | S | 4 | User gets a cleaned file |
| 6 | State machine + edge cases | S | 5 | All view states work end-to-end |
| 7 | Privacy hardening | S | 6 | CSP, verifier, no external requests |
| 8 | Privacy guard test (CI) | M | 7 | Build fails on privacy regression |
| 9 | Cross-browser + responsive QA | M | 8 | Works on all supported targets |
| 10 | Polish + launch | S | 9 | Live in production |

**Total estimated effort**: ~25–35 hours of focused work, depending on familiarity with the toolchain.

---

## 3. Phase 0 — Project Scaffolding

### Goal
Stand up an empty project with build tooling, deploy pipeline, and the foundational files. After this phase, `npm run dev` starts a local server and `npm run build` produces a deployable static bundle.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 0.1 | Initialize git repo (if not already) | `git status` works |
| 0.2 | Create folder structure per [TRD §3](./2026-09-21-metalimpia-trd.md) | Folders exist: `css/`, `js/`, `js/ui/`, `js/workers/`, `assets/`, `locales/`, `docs/` |
| 0.3 | Create `package.json` with Vite as dev dep | `npm install` succeeds |
| 0.4 | Create `vite.config.js` with WASM support and base path for GitHub Pages | `npm run build` produces `dist/` |
| 0.5 | Create `.gitignore` (node_modules, dist, .env) | Git ignores correctly |
| 0.6 | Create `LICENSE` (MIT) | File present with standard MIT text |
| 0.7 | Create `README.md` with project intro, link to docs/, link to privacy policy | Renders correctly on GitHub |
| 0.8 | Create placeholder `index.html` (empty body) | Loads without errors |
| 0.9 | Create placeholder `css/styles.css` (empty) | Loads without errors |
| 0.10 | Create placeholder `js/main.js` (logs "init") | Runs without errors |
| 0.11 | Create GitHub Actions workflow for build + deploy to Pages | Push triggers deploy |
| 0.12 | Verify deploy to GitHub Pages works | Live URL accessible |

### Deliverables

- Repo with `main` branch
- GitHub Pages deployment working
- Local dev (`npm run dev`) and build (`npm run build`) functional

### Verification

- [ ] `npm install && npm run dev` opens browser to placeholder page
- [ ] `npm run build` produces deployable static bundle
- [ ] Pushing to `main` deploys to GitHub Pages
- [ ] Live URL serves the placeholder page over HTTPS

### Effort

**XS** (~1 hour)

---

## 4. Phase 1 — Landing Page + Design System

### Goal
The landing page renders with the visual design system applied, in Spanish-neutral copy, responsive across viewports. No functionality yet — just the visual foundation.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 1.1 | Implement CSS custom properties (tokens) from [Design Spec §7](./2026-09-21-metalimpia-design.md) | Tokens defined in `:root` |
| 1.2 | Implement system font stack from Design Spec §7 | Fonts resolve to OS native |
| 1.3 | Implement spacing and radii scales | Classes/utilities available |
| 1.4 | Implement base typography (display, h1, h2, h3, body, small, tiny, mono) | Styles render correctly |
| 1.5 | Create `locales/es.json` with all strings from [Data Model §6](./2026-09-21-metalimpia-data-model.md#6-locale-file-schema) | JSON valid; all keys present |
| 1.6 | Implement `js/i18n.js` with `t(key, params)` lookup function | Function returns expected strings |
| 1.7 | Build landing HTML structure: header, hero, dropzone placeholder, verifier placeholder, footer | Renders correctly |
| 1.8 | Style landing page per design (off-white bg, deep blue accent, generous whitespace) | Visual matches design spec |
| 1.9 | Make layout responsive (mobile-first, max-width 720px on desktop) | Resize browser; layout adapts |
| 1.10 | Add reduced-motion CSS rules | With OS reduced-motion on, transitions disabled |
| 1.11 | Verify WCAG AA contrast on all text/background pairs | Manual check with browser tools |
| 1.12 | Verify keyboard navigation through the visible elements (none clickable yet, but tab order correct) | Tab moves focus sensibly |

### Deliverables

- Landing page renders with proper design system applied
- Spanish copy loads from `locales/es.json`
- Responsive across mobile / tablet / desktop

### Verification

- [ ] Landing page on desktop matches design spec
- [ ] Landing page on mobile (375px width) is usable
- [ ] All text meets WCAG AA contrast
- [ ] Tab navigation moves focus sensibly
- [ ] `prefers-reduced-motion` honored

### Effort

**S** (~2–3 hours)

---

## 5. Phase 2 — File Upload + Validation

### Goal
The dropzone accepts files via drag-and-drop and click-to-select. Files are validated against the allowed size and extension lists. Invalid files show user-facing error messages.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 2.1 | Implement `js/fileHandler.js` with `validateFile(file)` per [Data Model §8](./2026-09-21-metalimpia-data-model.md#8-data-validation-rules) | Returns correct result for size/extension checks |
| 2.2 | Implement `js/ui/uploader.js` with drag-and-drop handlers (`dragenter`, `dragover`, `dragleave`, `drop`) | Dropping a file triggers validation |
| 2.3 | Add visual feedback during drag-over (border highlight, background tint) | Visual state changes on drag |
| 2.4 | Implement click-to-select via hidden `<input type="file">` | Click on dropzone opens file picker |
| 2.5 | Read file into `ArrayBuffer` via `FileReader` (callback) or `File.arrayBuffer()` (Promise) | Buffer available in handler |
| 2.6 | Implement error state view rendering for: too_large, unsupported_format, empty | Error messages display per [Design Spec §5](./2026-09-21-metalimpia-design.md#5-error-handling) |
| 2.7 | Implement basic state machine in `main.js` (landing / error) | State transitions work |
| 2.8 | Add test fixtures: small JPG, large file (>200 MB), wrong extension file | Manual tests pass |
| 2.9 | Manual QA on desktop browsers (Chrome, Firefox) | Works in both |
| 2.10 | Manual QA on mobile (tap-to-select works, drag-and-drop gracefully disabled) | Works on iOS Safari, Android Chrome |

### Deliverables

- Dropzone functional with both drag-and-drop and click-to-select
- Validation errors shown in Spanish-neutral copy
- Basic state machine in place

### Verification

- [ ] Drop a valid JPG → validation passes, no error shown (ready for Phase 3)
- [ ] Drop a 300 MB file → error: "Este archivo es muy grande..."
- [ ] Drop a `.txt` file → error: "No reconocemos este formato..."
- [ ] Drop an empty file → error shown
- [ ] Click dropzone → file picker opens
- [ ] All errors display in neutral Spanish

### Effort

**S** (~2 hours)

---

## 6. Phase 3 — ExifTool WASM Integration

### Goal
ExifTool WASM runs in a Web Worker and can read metadata from any supported file. This is the most technically complex phase.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 3.1 | Obtain ExifTool WASM build (research current option; pin version) | WASM file in `assets/exiftool.wasm` |
| 3.2 | Implement `js/exiftoolLoader.js` for lazy load on first use | First use downloads; subsequent uses cached |
| 3.3 | Implement `js/workers/exiftool.worker.js` with message handler for `init`, `read`, `write` | Worker responds correctly |
| 3.4 | Wire Worker creation from `main.js` (only when first file arrives) | Worker spawned on first drop |
| 3.5 | Implement Worker message protocol per [Data Model §3.5](./2026-09-21-metalimpia-data-model.md#35-worker-communication) | Messages validated by both sides |
| 3.6 | Implement ExifTool `read` operation in Worker (returns JSON) | Metadata read for test JPG returns expected tags |
| 3.7 | Add progress indication while WASM loads (initial use case) | "Cargando motor..." message shown |
| 3.8 | Handle Worker init failure (network error, corrupted WASM) | Error message shown |
| 3.9 | Test with JPG, PNG, PDF, DOCX, XLSX, PPTX | All formats readable |
| 3.10 | Add `state = analyzing` UI with progress indicator | User sees feedback during processing |
| 3.11 | Performance check: typical 5 MB JPG processes in < 1 second | Manual timing |
| 3.12 | Memory check: no leaks across multiple file drops | Browser DevTools shows stable memory |

### Deliverables

- ExifTool WASM runs in Worker, returns metadata JSON for any supported file
- Lazy loading confirmed
- Worker lifecycle managed (created once, reused)

### Verification

- [ ] First file drop triggers WASM download (~10 MB)
- [ ] After first use, WASM is cached (no re-download)
- [ ] Metadata read for JPG with GPS returns GPSLatitude, GPSLongitude, etc.
- [ ] Metadata read for PDF returns Title, Author, Producer, etc.
- [ ] Metadata read for DOCX returns Author, LastModifiedBy, etc.
- [ ] Worker handles errors gracefully (corrupted file returns error message, not crash)
- [ ] UI shows "analyzing" state during processing

### Effort

**M** (~4–6 hours — most complex phase)

---

## 7. Phase 4 — Metadata Display + Selection

### Goal
Parsed metadata is displayed in a user-friendly, grouped, categorized list. Each tag has a checkbox. Users can toggle selection per-tag or per-group.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 4.1 | Implement `js/metadataParser.js` to parse ExifTool JSON into `FileMetadata` per [Data Model §3.3](./2026-09-21-metalimpia-data-model.md#33-filemetadata-parsed-from-exiftool) | Parser returns correct structure |
| 4.2 | Implement group classification rules from [Data Model §4.2](./2026-09-21-metalimpia-data-model.md#42-group-classification-rules) | Tags correctly grouped |
| 4.3 | Filter out operational metadata (SourceFile, FileSize, etc.) from [Data Model §4.3](./2026-09-21-metalimpia-data-model.md#43-tags-excluded-from-display) | Operational tags not shown |
| 4.4 | Implement `js/ui/metadataView.js` to render the grouped list | UI renders correctly |
| 4.5 | Add visual indicator for sensitive groups (Location, Author) per design | Amber badge / background tint shown |
| 4.6 | Implement per-tag checkbox with default `selected: true` | All checkboxes start checked |
| 4.7 | Implement "select all / deselect all" toggle per group | Toggle works |
| 4.8 | Add expandable/collapsible group sections (click group header) | Groups collapse/expand |
| 4.9 | Handle empty state: "Este archivo no tiene metadatos" | Special UI shown when 0 tags |
| 4.10 | Add "back" button to return to landing | Navigation works |
| 4.11 | Make metadata list responsive (vertical accordion on mobile) | Layout works at 375px |
| 4.12 | Truncate long values with ellipsis, full value in `title` attribute | Long values handled |
| 4.13 | Handle non-UTF8 / binary values gracefully | Display does not break |

### Deliverables

- Metadata displayed in a clear, grouped, categorized list
- Sensitive data visually highlighted
- Per-tag and per-group selection working
- Empty state handled

### Verification

- [ ] JPG with 23 tags displays correctly grouped
- [ ] GPS data appears under "Ubicación" with sensitive indicator
- [ ] Author data appears under "Autor" with sensitive indicator
- [ ] Clicking group header collapses/expands
- [ ] "Select all" toggles all checkboxes in a group
- [ ] File with no metadata shows the "ya está limpio" message
- [ ] Mobile responsive (no horizontal scroll)

### Effort

**M** (~3–4 hours)

---

## 8. Phase 5 — Metadata Removal + Download

### Goal
User selections are sent to the Worker; a cleaned file is generated and downloaded. The "remove all" and "remove selected" paths both work.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 5.1 | Implement ExifTool `write` operation in Worker (with `-all= -unsafe` or selected tags) | Worker returns cleaned buffer |
| 5.2 | Implement `js/ui/downloader.js` per [TRD §3.2](./2026-09-21-metalimpia-trd.md#32-module-responsibilities) | Blob URL created, click triggered, URL revoked |
| 5.3 | Generate download filename per pattern `{original}-limpio.{ext}` | Filename format correct |
| 5.4 | Implement `state = processing` UI ("Limpiando archivo...") | Loading indicator shown |
| 5.5 | Handle Worker write errors (write_failed, worker_crashed) | Error message shown |
| 5.6 | Add "Borrar todo" and "Borrar seleccionados" buttons in results view | Buttons trigger write |
| 5.7 | Verify cleaned file with `exiftool` CLI: zero metadata | CLI confirms cleanup |
| 5.8 | Test with all supported formats | All formats cleanable |
| 5.9 | Implement "done" state UI (confirmation + download button) | State transitions correctly |
| 5.10 | Add "Procesar otro archivo" button to return to landing | Navigation works |
| 5.11 | Performance check: cleanup < 1 second for typical 5 MB JPG | Manual timing |

### Deliverables

- "Remove all" and "remove selected" both produce a cleaned file
- Cleaned file downloads with correct filename
- "Done" state shows confirmation and download button

### Verification

- [ ] "Borrar todo" produces a file with zero metadata (verified with `exiftool -all= cleaned.jpg`)
- [ ] "Borrar seleccionados" preserves unchecked tags (verified with `exiftool`)
- [ ] Downloaded file opens correctly in standard viewers (Adobe Reader, MS Office, image viewers)
- [ ] Filename format is `original-limpio.ext`
- [ ] "Procesar otro archivo" returns to landing state

### Effort

**S** (~2 hours)

---

## 9. Phase 6 — State Machine + Edge Cases

### Goal
The full view state machine is implemented cleanly, and all edge cases from the Flow document are handled.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 6.1 | Implement full state machine in `main.js` per [Flow §2](./2026-09-21-metalimpia-flow.md#2-state-machine) | All transitions work |
| 6.2 | Handle all error scenarios per [Flow §6](./2026-09-21-metalimpia-flow.md#6-error-flows) | Each error has correct UI |
| 6.3 | Implement "browser too old" detection on page load | Feature detection works |
| 6.4 | Handle zero-byte file (rejected before reading) | Error message shown |
| 6.5 | Handle multiple files dropped (only first processed) | Subsequent ignored with no error |
| 6.6 | Handle cancel during processing (low priority) | Either disabled button or graceful abort |
| 6.7 | Add accessible ARIA labels and roles | Screen reader navigation works |
| 6.8 | Verify focus management on state transitions | Focus moves sensibly |
| 6.9 | Add skip-link or focus-trap where needed | Keyboard-only navigation works |
| 6.10 | Test all edge cases from [Flow §7](./2026-09-21-metalimpia-flow.md#7-edge-cases) | Each edge case handled correctly |

### Deliverables

- Full state machine working
- All error flows implemented
- Edge cases handled

### Verification

- [ ] All view states reachable from the state machine
- [ ] All error scenarios produce correct user messages
- [ ] Keyboard navigation works through all states
- [ ] Screen reader announces state changes appropriately
- [ ] Focus moves to the relevant element on each transition

### Effort

**S** (~2 hours)

---

## 10. Phase 7 — Privacy Hardening

### Goal
The page enforces strict privacy via CSP, the privacy verifier widget works correctly, and the page makes zero external requests during normal operation.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 7.1 | Add strict CSP meta tag in HTML per [TRD §6.1](./2026-09-21-metalimpia-trd.md#61-content-security-policy) | Meta tag present |
| 7.2 | Add CSP HTTP header via GitHub Pages (custom file or `headers` plugin) | Header present on response |
| 7.3 | Implement `js/ui/privacyVerifier.js` per [Data Model §5.2](./2026-09-21-metalimpia-data-model.md#52-privacy-verifier-data) | Widget shows correct count |
| 7.4 | Wire verifier widget to UI (expandable detail view) | List of loaded resources shown |
| 7.5 | Add privacy policy page at `/privacidad.html` (or `/privacidad` route) | Plain Spanish policy text |
| 7.6 | Audit codebase for `innerHTML`, `eval`, `Function()`, `document.write` | None present |
| 7.7 | Audit codebase for any `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | None present (intentional) |
| 7.8 | Verify no third-party URLs in HTML, CSS, JS bundle | Build artifact audit clean |
| 7.9 | Manual network audit with DevTools (full flow) | Zero non-origin requests |
| 7.10 | Confirm no service worker registered | DevTools shows none |
| 7.11 | Confirm no cookies, no localStorage (except optional theme) | DevTools Application tab clean |
| 7.12 | Confirm HTTPS-only via GitHub Pages | HTTP redirects to HTTPS |

### Deliverables

- CSP enforced (header + meta)
- Privacy verifier widget functional
- Privacy policy page published
- Codebase audited for privacy leaks

### Verification

- [ ] CSP header present and strict (no `unsafe-inline`, no `unsafe-eval`)
- [ ] DevTools Network tab shows zero non-origin requests during full flow
- [ ] Privacy verifier shows "0 conexiones externas"
- [ ] Privacy policy page accessible at `/privacidad`
- [ ] No cookies set
- [ ] No service worker registered
- [ ] HTTPS enforced

### Effort

**S** (~2–3 hours)

---

## 11. Phase 8 — Privacy Guard Test (CI)

### Goal
An automated test fails the build if any non-origin network request is detected. This is the privacy regression gate.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 8.1 | Add Playwright as dev dependency | `npm install --save-dev @playwright/test` |
| 8.2 | Install Playwright browsers | `npx playwright install chromium` |
| 8.3 | Write test that loads the built page and asserts zero non-origin requests | Test passes on clean code |
| 8.4 | Write test that simulates a full user flow (drop file → clean → download) | Full flow tested |
| 8.5 | Write test that injects a fake external request and confirms it fails | Regression detected |
| 8.6 | Integrate test into GitHub Actions workflow | CI runs test on every push |
| 8.7 | Configure GitHub Pages deployment to require passing test | Build fails if test fails |
| 8.8 | Add a "Privacy Guard" badge to README | Visible signal of the test |
| 8.9 | Document the test in README / contributing guide | Future contributors understand |

### Deliverables

- Automated privacy guard test
- Test integrated into CI
- Build fails on privacy regression

### Verification

- [ ] Test passes on the current clean implementation
- [ ] Test fails when a fake external request is injected (regression test)
- [ ] Test runs in CI on every push
- [ ] Build is blocked if test fails
- [ ] README documents the privacy guarantee

### Effort

**M** (~3–4 hours)

---

## 12. Phase 9 — Cross-Browser + Responsive QA

### Goal
The page works correctly on all supported browser/device targets per [TRD §5](./2026-09-21-metalimpia-trd.md#5-browser-support).

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 9.1 | Manual test on latest Chrome (Windows, macOS, Android) | All flows work |
| 9.2 | Manual test on latest Firefox (Windows, macOS) | All flows work |
| 9.3 | Manual test on latest Safari (macOS) | All flows work |
| 9.4 | Manual test on latest Edge (Windows) | All flows work |
| 9.5 | Manual test on latest iOS Safari (iPhone) | Tap-to-select works; responsive layout correct |
| 9.6 | Manual test on latest Android Chrome | Tap-to-select works; responsive layout correct |
| 9.7 | Test at viewport widths: 320px, 375px, 414px, 768px, 1024px, 1440px, 1920px | Layout correct at each |
| 9.8 | Test at browser zoom levels: 50%, 100%, 150%, 200% | Layout reflows correctly |
| 9.9 | Test in private/incognito mode | All flows work; no persistent state issues |
| 9.10 | Test in multiple tabs simultaneously | Independent per tab |
| 9.11 | Verify performance on low-end mobile (browser-perf tested if available) | Acceptable performance |
| 9.12 | Fix any issues found (small CSS adjustments, polyfills if strictly necessary) | All issues resolved |

### Deliverables

- Verified cross-browser support
- Verified responsive behavior
- Documented known issues (if any)

### Verification

- [ ] All browser/device targets pass the manual flow
- [ ] All viewport widths render correctly
- [ ] Performance acceptable on mobile

### Effort

**M** (~3–4 hours)

---

## 13. Phase 10 — Polish + Launch

### Goal
Final polish, copy review, deployment, and pre-launch verification. Ready for production traffic.

### Tasks

| # | Task | Verification |
|---|------|--------------|
| 10.1 | Spanish copy review by a native speaker (neutrality, no regionalismos) | Copy approved |
| 10.2 | Error message review (tone, clarity) | Messages approved |
| 10.3 | Visual polish pass (spacing, alignment, hover states) | Design review passes |
| 10.4 | Add a favicon (SVG lock + document icon) | Icon visible in tab |
| 10.5 | Add Open Graph and Twitter card meta tags (for sharing) | Preview cards work |
| 10.6 | Add `sitemap.xml` and `robots.txt` (basic) | Files present |
| 10.7 | Lighthouse audit (Performance, Accessibility, Best Practices, SEO) | Score ≥ 90 in all categories |
| 10.8 | Final privacy guard test run | Passes |
| 10.9 | Final acceptance criteria check from [PRD §9](./2026-09-21-metalimpia-prd.md#9-acceptance-criteria-for-mvp-launch) | All criteria met |
| 10.10 | Confirm domain (`metalimpia.app` or chosen) points to GitHub Pages | DNS resolves |
| 10.11 | Confirm HTTPS works on custom domain | SSL cert valid |
| 10.12 | Publish / announce (optional, low-key) | Done |
| 10.13 | Update README with screenshots, links, status | README accurate |

### Deliverables

- Production-ready MVP deployed
- All acceptance criteria met
- README and docs reflect current state

### Verification

- [ ] All PRD acceptance criteria pass (see [PRD §9](./2026-09-21-metalimpia-prd.md#9-acceptance-criteria-for-mvp-launch))
- [ ] Lighthouse scores ≥ 90
- [ ] Domain resolves to live site
- [ ] HTTPS works on custom domain
- [ ] All privacy tests pass

### Effort

**S** (~2–3 hours)

---

## 14. Cross-Cutting Concerns

These run throughout all phases, not as standalone tasks.

### Performance monitoring

- After each phase, check that performance budgets from [TRD §4](./2026-09-21-metalimpia-trd.md#4-performance-requirements) are still on track.
- If a phase introduces a regression, address it before moving on.

### Accessibility

- After each phase, verify that new UI elements are keyboard-navigable.
- Use browser DevTools accessibility inspector.
- Honor `prefers-reduced-motion` at every new animation.

### Privacy

- After each phase, audit that no new external requests are introduced.
- The Phase 8 privacy guard test becomes the canonical check.
- Before Phase 8, this is a manual check.

### Commit hygiene

- One work-unit commit per task (not per phase).
- Conventional Commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- Commit message references the phase and task number (e.g., `feat(phase-2): implement file validation`).

---

## 15. Risk Register

| Risk | Phase impacted | Mitigation |
|------|---------------|------------|
| ExifTool WASM build unavailable or stale | 3 | Research during planning; have backup plan to vendor a specific version |
| ExifTool WASM too slow on mobile | 3, 9 | Show progress; consider format-specific fast paths later |
| Browser compatibility surprise | 9 | Phase 9 explicitly tests all targets |
| Privacy regression in dependency | 7, 8 | Phase 7 audit + Phase 8 automated gate |
| Custom domain not configured | 10 | Owner must confirm domain before Phase 10 |

---

## 16. Definition of Done

The MVP is **done** when:

1. All 11 phases complete.
2. All PRD acceptance criteria pass ([PRD §9](./2026-09-21-metalimpia-prd.md#9-acceptance-criteria-for-mvp-launch)).
3. The privacy guard test in CI passes.
4. Cross-browser QA passes for all supported targets.
5. The owner can answer YES to: "If I were a privacy-paranoid user, would I trust this page to clean a sensitive file?"

After MVP launch, future enhancements (PWA, batch processing, additional languages) are tracked as separate projects, each with its own brainstorming cycle.

---

## Appendix A — Task Index (Quick Lookup)

| Phase | # | Task | Effort |
|-------|---|------|--------|
| 0 | 0.1–0.12 | Project scaffolding | XS |
| 1 | 1.1–1.12 | Landing + design system | S |
| 2 | 2.1–2.10 | File upload + validation | S |
| 3 | 3.1–3.12 | ExifTool WASM integration | M |
| 4 | 4.1–4.13 | Metadata display + selection | M |
| 5 | 5.1–5.11 | Metadata removal + download | S |
| 6 | 6.1–6.10 | State machine + edge cases | S |
| 7 | 7.1–7.12 | Privacy hardening | S |
| 8 | 8.1–8.9 | Privacy guard test CI | M |
| 9 | 9.1–9.12 | Cross-browser + responsive QA | M |
| 10 | 10.1–10.13 | Polish + launch | S |

---

## Appendix B — Glossary

See [Design Spec Appendix B](./2026-09-21-metalimpia-design.md#appendix-b--glossary).
