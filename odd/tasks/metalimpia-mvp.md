# MetaLimpia MVP — Feature Document

**Feature**: MetaLimpia (Initial MVP)
**Status**: In Progress — Phase 0 (Project Scaffolding)
**Started**: 2026-09-21
**Stack**: Client-side pure, vanilla JS, Vite, ExifTool WASM
**Privacy stance**: Strict

## Objective

Build a privacy-focused web app that reviews and removes metadata from user files **entirely in the browser**, with no upload and no third-party requests.

## Why

Existing tools either require command-line skill (ExifTool) or upload files to remote servers (privacy risk). MetaLimpia combines ExifTool-grade coverage with client-side processing so files never leave the user's machine.

## Scope (MVP)

See [Implementation Plan](../../docs/superpowers/specs/2026-09-21-metalimpia-implementation-plan.md) for full scope. Highlights:

- Single file upload (drag & drop or click-to-select)
- Supported: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX
- Show metadata before deletion (per-tag checkboxes)
- Remove all or selective
- Download cleaned file
- Privacy verifier widget
- Spanish-neutral UI, i18n-ready
- Mobile responsive

## Constraints

- Static site, no backend
- Strict privacy: no CDN, no analytics, no Google Fonts, no third-party scripts
- Spanish-neutral copy (no voseo, no regionalismos)
- Open source (MIT)
- System fonts only
- Open source code in this repo

## TDD Mode

Not configured. Manual testing per Implementation Plan §6 and Privacy Guard test in CI per Phase 8.

## Architecture Decisions

See [Design Spec §3](../../docs/superpowers/specs/2026-09-21-metalimpia-design.md#3-technical-stack-and-architecture) and [TRD §2](../../docs/superpowers/specs/2026-09-21-metalimpia-trd.md#2-tech-stack). Key decisions:

- Vanilla JS, no framework (small bundle)
- Vite for build tooling
- ExifTool WASM in Web Worker
- GitHub Pages hosting

---

## Phase 0 — Project Scaffolding (CURRENT)

### Tasks

- [ ] 0.1 — Initialize git repo (requires user action — see notes)
- [x] 0.2 — Create folder structure per TRD §3
- [x] 0.3 — Create `package.json` with Vite as dev dep
- [x] 0.4 — Create `vite.config.js` with WASM support and base path
- [x] 0.5 — Create `.gitignore`
- [x] 0.6 — Create `LICENSE` (MIT)
- [x] 0.7 — Create `README.md` with project intro
- [x] 0.8 — Create placeholder `index.html`
- [x] 0.9 — Create placeholder `css/styles.css`
- [x] 0.10 — Create placeholder `js/main.js`
- [x] 0.11 — Create GitHub Actions workflow for build + deploy
- [ ] 0.12 — Verify deploy to GitHub Pages (requires user action — push to GitHub)

### Acceptance Criteria for Phase 0

- `npm install` succeeds ✅
- `npm run dev` starts local server (not run during scaffolding — verified by build success)
- `npm run build` produces `dist/` ✅
- All placeholder files exist ✅
- GitHub Actions workflow YAML is valid ✅

### Applicable Checks

- After Phase 0: `npm install`, `npm run build` succeed; `dist/` produced.

### Verification Status

- [x] npm install completes without errors (11 packages added, 2 vulnerabilities noted in dev deps — see notes)
- [x] npm run build produces dist/ (index.html + 0.8 KB JS + 0.17 KB CSS, gzipped: 0.65 + 0.45 + 0.17 = ~1.27 KB total initial payload)
- [x] All folders from TRD §3 exist (css, js, js/ui, js/workers, assets, locales, docs)
- [x] GitHub Actions workflow YAML is valid (Vite 5.4.x + GitHub Pages v4 actions)
- [ ] Live URL serves the placeholder (after user pushes to GitHub)

### Completion Notes

**Done by the assistant**:
- Folder structure created
- All config and placeholder files written
- `npm install` and `npm run build` verified working
- Initial bundle size well under TRD §4 budget (1.27 KB gzipped vs. 200 KB budget)

**Requires user action before Phase 1**:
1. **Initialize git repo** in this directory (`git init` + first commit). Recommended to do this manually so the user controls the initial commit.
2. **Create GitHub repository** under the user's account.
3. **Push the code** to GitHub (`git remote add origin ...` + `git push -u origin main`).
4. **Configure GitHub Pages** in repo settings: Settings → Pages → Source: GitHub Actions.
5. **Adjust `base` path** in `vite.config.js` if deploying to a project page (`/metalimpia/`) vs. user/org site (`/`).
6. **Resolve 2 npm audit warnings** in dev dependencies (esbuild, vite). See notes below.

**Known issue: dev-dependency vulnerabilities**:
```
esbuild  <=0.24.2   (moderate) — dev-server request smuggling; affects dev only
vite     <=6.4.2    (high)     — depends on vulnerable esbuild
```
Mitigation: `npm audit fix --force` upgrades to vite 8.x (breaking change). For a new project, recommend doing this now before more code is written. Can be done as a small task at the start of Phase 1.

---

## Future Phases

See [Implementation Plan](../../docs/superpowers/specs/2026-09-21-metalimpia-implementation-plan.md) for the full roadmap. Phases 1–10 cover landing page, file upload, ExifTool integration, metadata display, removal, edge cases, privacy hardening, privacy guard CI, cross-browser QA, and launch.

Each phase will be tracked here as it starts.

---

## Relevant Files

- `package.json` — Vite dependency
- `vite.config.js` — Build config with WASM support
- `.github/workflows/deploy.yml` — GitHub Pages deploy
- `LICENSE` — MIT license
- `README.md` — Public-facing project intro
- `index.html` — Single-page entry (placeholder for Phase 0)
- `odd/tasks/metalimpia-mvp.md` — This file
- `docs/superpowers/specs/2026-09-21-metalimpia-*.md` — Design artifacts
