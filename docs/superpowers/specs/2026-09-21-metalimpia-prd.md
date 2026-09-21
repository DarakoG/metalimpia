# MetaLimpia — Product Requirements Document (PRD)

**Status**: Draft for review
**Date**: 2026-09-21
**Related**: [Design Spec](./2026-09-21-metalimpia-design.md)

---

## 1. Product Overview

### 1.1 Problem Statement
People share digital files (photos, PDFs, documents) without realizing they contain hidden metadata — GPS coordinates, device serial numbers, edit history, author names. This metadata can leak:
- The location where a photo was taken
- The author's identity in a leaked document
- The organization's software and hardware inventory
- The timeline of edits and reviews

Existing solutions are inadequate:
- **Command-line tools** (ExifTool) are powerful but require technical skill.
- **Online tools** require uploading files to remote servers, which itself is a privacy risk.
- **Platform-specific tools** (e.g. macOS Preview) cover only one format or only surface-level metadata.

### 1.2 Vision
MetaLimpia is a free web page that lets any Spanish-speaking user **review and remove** metadata from their files **without ever uploading them**, in any browser, on any device.

### 1.3 Key Value Proposition
> "Tu archivo nunca sale del navegador. No podemos verlo aunque quisiéramos."

This is not a marketing claim — it is a **technically enforced property** of the architecture (no backend server exists to receive files).

### 1.4 Audience
**Primary**: Spanish-speaking internet users who want to clean metadata before sharing files. Use cases include:
- Photographers avoiding GPS leaks in landscape or street photography.
- Journalists protecting source identity in leaked documents.
- Privacy-conscious employees sharing documents externally.
- Activists, lawyers, doctors, and others with confidentiality needs.

**Secondary**: Technical users who would otherwise reach for command-line ExifTool but want a faster UX.

The audience is **intentionally non-regional**: copy is in neutral Spanish, not specific to any country.

---

## 2. Personas

### Persona 1: Carla — The Privacy-Conscious Photographer
- **Context**: Hobbyist photographer who shares photos on social media and with friends.
- **Pain**: Recently learned that her photos contained GPS coordinates pointing to her home. Wants to clean them before sharing.
- **Goal**: A simple way to see what metadata is in her photos and remove it without uploading them anywhere.
- **Success criterion**: She can drag a photo, see what data is there, click "clean", and download — in under 60 seconds, on her phone.

### Persona 2: Miguel — The Investigative Journalist
- **Context**: Receives leaked documents from sources. Needs to verify and share them while protecting the source.
- **Pain**: Documents often contain author names, edit history, and organization metadata that could identify the source.
- **Goal**: Quickly strip identifying metadata from documents before sharing with editors.
- **Success criterion**: He trusts the tool enough to process sensitive documents because the privacy promise is verifiable (open-source code, no upload).

### Persona 3: Laura — The HR Manager
- **Context**: Shares CVs and contracts with external recruiters and clients.
- **Pain**: Worried about leaking employee personal info or company metadata embedded in old templates.
- **Goal**: Sanitize documents before sending them out.
- **Success criterion**: She can clean a batch of files with confidence that nothing leaks.

### Persona 4: Andrés — The Activist
- **Context**: Operates in a context where anonymity matters.
- **Pain**: Cannot risk uploading files to any server. Will not use tools without verifiable privacy guarantees.
- **Goal**: A tool whose privacy claim is provable, not just stated.
- **Success criterion**: He checks the source code, verifies no external connections, and trusts the tool.

---

## 3. User Stories

### Upload & Inspect
- **US-1**: As a user, I can drag a file onto the page so I don't have to navigate file pickers.
- **US-2**: As a user, I can click the dropzone to select a file from my device.
- **US-3**: As a user, I see what metadata is in my file before deciding what to remove.
- **US-4**: As a user, I see metadata grouped by category (Author, Location, Dates, etc.) so I can understand it.

### Remove & Download
- **US-5**: As a user, I can click "remove all" to clean everything at once.
- **US-6**: As a user, I can deselect specific tags I want to keep (e.g. keep color profile, remove GPS).
- **US-7**: As a user, I download the cleaned file with the same name (or with a `-clean` suffix) and same format.
- **US-8**: As a user, I get a confirmation that tells me how many tags were removed.

### Trust & Privacy
- **US-9**: As a user, I can verify that the page makes zero external requests via a built-in widget.
- **US-10**: As a user, I can read a plain-language privacy policy that explains what the page does and does not do.
- **US-11**: As a user, I can review the open-source code on GitHub to verify the privacy claims.

### Errors & Edge Cases
- **US-12**: As a user, I get a clear, friendly message if my file is too big, in an unsupported format, or corrupted.
- **US-13**: As a user, I see a positive message if my file already has no metadata.
- **US-14**: As a user, I see a clear message if my browser is too old to run the tool.

### Mobile
- **US-15**: As a mobile user, the page works on my phone with the same functionality.
- **US-16**: As a mobile user, the metadata view collapses to a vertical accordion (no horizontal scroll).

---

## 4. Functional Requirements

### FR-1: File Upload
- **FR-1.1**: The page provides a dropzone occupying the central viewport on landing.
- **FR-1.2**: The dropzone accepts drag-and-drop and click-to-select.
- **FR-1.3**: The dropzone highlights on drag-over with a visible state change.
- **FR-1.4**: The page rejects files larger than 200 MB before processing.
- **FR-1.5**: The page accepts: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX.

### FR-2: Metadata Reading
- **FR-2.1**: The page reads all metadata from the uploaded file using ExifTool WASM.
- **FR-2.2**: Metadata is parsed into human-readable format (not raw binary).
- **FR-2.3**: Metadata is grouped into categories: Author, Location, Dates, Device, Software, Comments, Other.
- **FR-2.4**: Sensitive categories (Location, Author) are visually highlighted to warn the user.
- **FR-2.5**: Each tag shows its canonical name (e.g. `GPSLatitude`) and its human-friendly value (e.g. `40° 45' 30" N`).

### FR-3: Metadata Selection
- **FR-3.1**: Each metadata tag has a checkbox, defaulting to "remove".
- **FR-3.2**: A "select all" / "deselect all" toggle is available per category.
- **FR-3.3**: Two action buttons are available: "Borrar todo" (remove all) and "Borrar seleccionados" (remove only checked).

### FR-4: Metadata Removal
- **FR-4.1**: On "Borrar todo", all metadata is removed (ExifTool `-all= -unsafe`).
- **FR-4.2**: On "Borrar seleccionados", only the checked tags are removed.
- **FR-4.3**: The cleaned file is generated in the same format as the original.
- **FR-4.4**: The cleaned file is verified to have no metadata before download (internal check).

### FR-5: Clean File Download
- **FR-5.1**: A download button appears after cleanup completes.
- **FR-5.2**: The downloaded filename follows the pattern `{original}-limpio.{ext}` (e.g. `foto-limpia.jpg`).
- **FR-5.3**: An option to "process another file" is offered after download.

### FR-6: Privacy Verification Widget
- **FR-6.1**: A persistent widget on the page shows the count of external connections.
- **FR-6.2**: The widget always shows "0 conexiones externas" when used correctly.
- **FR-6.3**: Expanding the widget shows the list of loaded resources, all from origin.
- **FR-6.4**: The widget updates in real time if any non-origin resource is loaded (which should never happen in correct operation).

### FR-7: Error Handling
- **FR-7.1**: All errors display in neutral Spanish with a clear next step.
- **FR-7.2**: No error messages contain technical jargon (no stack traces, no error codes).
- **FR-7.3**: Errors never trigger external requests (no error reporting service).

### FR-8: Responsive UI
- **FR-8.1**: The layout is mobile-first; the dropzone is full-width on mobile.
- **FR-8.2**: On desktop, content is centered with a max-width of 720px.
- **FR-8.3**: The metadata list becomes a vertical accordion on mobile (no horizontal scroll).

### FR-9: Internationalization
- **FR-9.1**: All user-facing strings live in `locales/es.json`.
- **FR-9.2**: The codebase never contains hardcoded Spanish (or any other language) strings.
- **FR-9.3**: Adding a new language requires only adding a new JSON file.

### FR-10: Accessibility
- **FR-10.1**: All interactive elements are keyboard-navigable.
- **FR-10.2**: Color contrast meets WCAG AA (4.5:1 for body text).
- **FR-10.3**: Animated transitions respect `prefers-reduced-motion`.

---

## 5. Non-Functional Requirements

### NFR-1: Privacy
- **NFR-1.1**: Zero files uploaded to any server (architectural property).
- **NFR-1.2**: Zero analytics or tracking of any kind.
- **NFR-1.3**: Zero third-party network requests after page load.
- **NFR-1.4**: Source code is public under MIT license.

### NFR-2: Performance
- **NFR-2.1**: Initial page load (HTML+CSS+JS, no WASM) is under 200 KB transferred.
- **NFR-2.2**: Time to first interaction (dropzone usable) is under 1 second on broadband.
- **NFR-2.3**: WASM download (lazy, on first file drop) completes in under 10 seconds on broadband.
- **NFR-2.4**: Metadata read for a typical 5 MB JPG completes in under 1 second.
- **NFR-2.5**: Metadata write for a typical 5 MB JPG completes in under 1 second.
- **NFR-2.6**: UI never freezes during processing (Web Worker mandatory).

### NFR-3: Browser Support
- **NFR-3.1**: Latest 2 versions of Chrome, Firefox, Safari, Edge.
- **NFR-3.2**: Latest 2 versions of iOS Safari, Android Chrome.
- **NFR-3.3**: Browsers without WebAssembly show a friendly upgrade message.

### NFR-4: Accessibility
- **NFR-4.1**: WCAG 2.1 AA compliance.
- **NFR-4.2**: Full keyboard navigation.
- **NFR-4.3**: Screen reader support (semantic HTML, ARIA where needed).
- **NFR-4.4**: Honors `prefers-reduced-motion`.

### NFR-5: Availability
- **NFR-5.1**: Hosted on GitHub Pages; inherits GitHub's availability SLA.
- **NFR-5.2**: No backend to fail.
- **NFR-5.3**: The tool remains usable as long as the user has the page loaded and ExifTool WASM cached.

### NFR-6: Maintainability
- **NFR-6.1**: Code is organized in modules with clear single responsibilities.
- **NFR-6.2**: External dependencies are minimized (target: only ExifTool WASM).
- **NFR-6.3**: Updates to ExifTool can be integrated by replacing the WASM binary.

### NFR-7: Verifiability
- **NFR-7.1**: Any user can verify the privacy claim by inspecting the open-source code.
- **NFR-7.2**: A privacy guard test in CI fails the build if any non-origin network request is detected.

---

## 6. Success Metrics (post-launch)

These metrics are deliberately limited because we do not run analytics. They are measured indirectly (e.g. via GitHub traffic, voluntary feedback):

| Metric | How measured | Target |
|--------|--------------|--------|
| Page is functional | Manual smoke test on each release | 100% |
| Privacy guarantee holds | CI privacy guard test | 100% pass |
| Mobile usability | Manual QA on iOS + Android | Pass |
| WCAG AA | Manual a11y audit + automated scan | Pass |
| Spanish neutrality | Native speaker review of copy | Pass |
| GitHub stars | Voluntary signal of adoption | Indicator only |
| User feedback | GitHub issues / email | Qualitative only |

**Note**: We will not track individual users, sessions, files, or any personal data. If quantitative growth metrics are needed in the future, a self-hosted, cookieless counter is the only acceptable approach.

---

## 7. Constraints

### Hard constraints (cannot be relaxed)
- **Static-site architecture**: no backend, no database, no server-side processing.
- **Strict privacy stance**: no third-party requests of any kind.
- **Spanish-neutral copy**: no voseo, no regionalismos.
- **Open source**: code is public under MIT.
- **System fonts only**: no external font loading.

### Soft constraints (can be revisited with conscious trade-offs)
- **GitHub Pages hosting**: could move to Netlify, Vercel, or self-host with similar guarantees.
- **Vanilla JS**: could migrate to a framework if complexity grows past what vanilla supports cleanly.
- **ExifTool as the engine**: would only be replaced if a strictly better option emerged.

---

## 8. Out of Scope (MVP)

Explicitly NOT in MVP — see [Design Spec §2](./2026-09-21-metalimpia-design.md#2-product-scope-mvp) for the full list and rationale. Highlights:

- User accounts
- File history
- Batch processing
- PWA / offline
- Native apps
- Dark mode
- Custom themes
- Sharing / collaboration
- Server-side fallback

---

## 9. Acceptance Criteria for MVP Launch

The MVP is ready to ship when ALL of the following are true:

### Functional
- [ ] Upload via drag-and-drop works on desktop.
- [ ] Upload via click-to-select works on desktop and mobile.
- [ ] All 8 supported formats (JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX) can be processed end-to-end.
- [ ] Metadata is correctly displayed for at least one test file per format.
- [ ] "Borrar todo" produces a file with zero metadata (verified with `exiftool` CLI).
- [ ] Selective removal correctly preserves selected tags (verified).
- [ ] Downloaded file opens correctly in standard viewers (Adobe Reader, MS Office, image viewers).
- [ ] Mobile responsive on iPhone Safari and Android Chrome.

### Privacy
- [ ] DevTools Network tab shows zero requests to non-origin domains during a full flow.
- [ ] Privacy verifier widget correctly reports "0 conexiones externas".
- [ ] CSP header is present and strict (no `unsafe-inline` or `unsafe-eval`).
- [ ] Source code is published on GitHub.
- [ ] Privacy policy page is published in plain Spanish.

### Quality
- [ ] No console errors during a full flow.
- [ ] No unhandled promise rejections.
- [ ] WCAG AA contrast verified.
- [ ] Keyboard navigation works for all interactive elements.
- [ ] `prefers-reduced-motion` honored.

### Trust
- [ ] The owner can answer YES to: "If I were a privacy-paranoid user, would I trust this page to clean a sensitive file?"

---

## 10. Open Questions

These are tracked in the main Design Spec ([§10](./2026-09-21-metalimpia-design.md#10-open-questions--deferred-decisions)). Items specific to PRD:

- **Domain name**: `metalimpia.com` and `metalimpia.app` availability must be confirmed before launch.
- **Launch market**: no specific geography targeted; default is global Spanish-speaking audience.
- **Brand identity**: no logo or icon designed yet. SVG icon to be created (lock + document motif).
- **Pre-launch communication**: should there be a landing countdown? A waitlist? Decided to launch quietly and grow via organic discovery.

---

## Appendix A — Glossary

See [Design Spec Appendix B](./2026-09-21-metalimpia-design.md#appendix-b--glossary).
