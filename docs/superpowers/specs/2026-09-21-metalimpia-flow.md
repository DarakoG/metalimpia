# MetaLimpia — Flow Document

**Status**: Draft for review
**Date**: 2026-09-21
**Related**: [Design Spec](./2026-09-21-metalimpia-design.md), [TRD](./2026-09-21-metalimpia-trd.md), [Data Model](./2026-09-21-metalimpia-data-model.md)

---

## 1. Overview

This document describes:

1. **User flows**: how a person moves through the page, screen by screen.
2. **Data flows**: how bytes and metadata move between modules.
3. **State machine**: the page's allowed states and transitions.
4. **Sequence diagrams**: text-based sequences for the main scenarios.
5. **Error flows**: how each error scenario is handled.
6. **Edge cases**: unusual but valid scenarios.

---

## 2. State Machine

### 2.1 The view states

```
                    +-----------+
                    |  landing  |
                    +-----+-----+
                          |
                          | user drops/selects file
                          v
                    +-----------+
                    | analyzing |
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
   read OK    |                       |  read failed
              v                       v
       +-----------+             +-----------+
       |  results  |             |   error   |
       +-----+-----+             +-----+-----+
             |                         |
             | user clicks remove      | user clicks "try again" / "back"
             v                         v
       +-----------+             +-----------+
       | processing|             |  landing  |
       +-----+-----+             +-----------+
             |
   write OK  |
             v
       +-----------+
       |   done    |
       +-----+-----+
             |
             | user clicks "another file"
             v
       +-----------+
       |  landing  |
       +-----------+
```

### 2.2 State transitions table

| From | Trigger | To | Side effects |
|------|---------|----|--------------|
| `landing` | User drops/picks valid file | `analyzing` | Create `UserFile`, read buffer, init Worker if first time |
| `analyzing` | ExifTool returns metadata | `results` | Build `FileMetadata` |
| `analyzing` | ExifTool fails (corrupted/unsupported) | `error` | Set error key |
| `results` | User toggles checkboxes | `results` | Update `MetadataSelection` |
| `results` | User clicks "remove all" or "remove selected" | `processing` | Send `write` to Worker |
| `results` | User clicks "back" | `landing` | Discard `UserFile` |
| `processing` | Worker returns cleaned buffer | `done` | Create `CleanedFile`, prepare Blob URL |
| `processing` | Worker fails | `error` | Set error key |
| `done` | User clicks "download" | `done` | Trigger download, revoke Blob URL |
| `done` | User clicks "another file" | `landing` | Discard all `UserFile`s |
| `error` | User clicks "back" / "try again" | `landing` | Clear error |

### 2.3 Invariants

- Only one view state is active at any time.
- A `UserFile` exists only between `analyzing` and the end of `done` / `error`.
- The Worker is created lazily on first `analyzing` transition and persists for the session.
- No data is retained after the user returns to `landing` (other than theme preference).

---

## 3. User Flows

### 3.1 Happy path — Desktop

```
1. User opens https://metalimpia.app
   → [landing] state
   → Sees: title, tagline, dropzone, privacy verifier (collapsed)

2. User drags "vacaciones.jpg" onto dropzone
   → Dropzone highlights (drag-over style)
   → On drop: validates file (size OK, extension OK)
   → Transitions to [analyzing]

3. [analyzing] state
   → Sees: progress indicator, "Analizando metadatos..."
   → Behind the scenes: file read to ArrayBuffer, sent to Worker
   → ExifTool reads metadata (~500ms for typical JPG)

4. ExifTool returns 23 tags
   → State transitions to [results]

5. [results] state
   → Sees: filename, total count, grouped metadata list, action buttons
   → All checkboxes default to checked (will be removed)
   → Sensitive groups (Location, Author) visually highlighted

6. User reviews the list
   → Optional: unticks "Software" (wants to keep "Adobe Lightroom")
   → Clicks "Borrar seleccionados" (or "Borrar todo")

7. State transitions to [processing]
   → Sees: "Limpiando archivo..."

8. Worker writes the cleaned file
   → State transitions to [done]

9. [done] state
   → Sees: confirmation ("Se eliminaron 22 metadatos"), download button
   → Clicks "Descargar"

10. File downloads as "vacaciones-limpio.jpg"
    → User can click "Procesar otro archivo" to return to [landing]
```

### 3.2 Happy path — Mobile

```
1. User opens metalimpia.app in mobile Safari
   → Same as desktop, but dropzone fills the screen width
   → Touch-friendly hit targets

2. User taps dropzone
   → Native file picker opens
   → User selects "vacaciones.jpg" from Photos

3-9. Same as desktop, but:
   → Metadata list collapses to a vertical accordion (no horizontal scroll)
   → Buttons stack vertically instead of horizontally
   → Progress indicator is centered
```

### 3.3 Privacy-conscious user flow

```
1. User visits the page
   → Notes the tagline: "Tu archivo nunca sale del navegador."

2. Scrolls to the Privacy Verifier widget at the bottom

3. Clicks "Ver detalle técnico"

4. Verifier expands, showing:
   → "Conexiones externas: 0"
   → List of resources (all from origin)

5. User then opens DevTools → Network tab

6. Drags a file → confirms no new external requests

7. Convinced; proceeds with cleanup
```

### 3.4 "File already clean" flow

```
1-4. Same as happy path

5. [results] state — but ExifTool returns 0 tags

6. UI shows special state:
   → "Buenas noticias: este archivo no tiene metadatos."
   → "Ya está limpio. Podés descargarlo igual."
   → Single button: "Descargar original"

7. User downloads the unmodified file
```

### 3.5 "Cancel during processing" flow

```
1-6. Same as happy path

7. User clicks "remove all" → [processing] state

8. User clicks "Cancelar" (only available during processing, low priority for MVP)

9. Worker is terminated
   → State returns to [results] (selection preserved)

10. User can adjust and retry
```

**Note**: cancel during processing is not a critical feature for MVP but is easy to add if needed.

---

## 4. Data Flows

### 4.1 Initial page load

```
Browser GET /index.html
    → HTML returned
Browser GET /styles.css
    → CSS returned
Browser GET /main.js (orchestrator)
    → JS returned
Browser GET /locales/es.json
    → Locale JSON returned

[main.js executes]
    → Reads <html lang="...">
    → Loads appropriate locale
    → Renders initial UI (landing state)
    → Initializes privacy verifier

[No further network activity expected]
```

### 4.2 First file drop (lazy WASM load)

```
User drops file
    |
    v
[main.js: uploader.js receives File]
    |
    v
[fileHandler validates]
    |
    v
[main.js initiates Worker if not already]
    |  (Worker script fetched)
    |  (Worker starts; no WASM yet)
    v
[main.js posts 'init' to Worker]
    |
    v
[Worker imports exiftool.wasm]
    |  ← WASM downloaded (~10 MB) and compiled
    v
[Worker 'init' complete]
    |
    v
[main.js posts 'read' with ArrayBuffer]
    |
    v
[Worker uses ExifTool WASM to parse]
    |
    v
[Worker posts ExifTool JSON back]
    |
    v
[main.js parses JSON into FileMetadata]
    |
    v
[State transitions to results]
```

### 4.3 Cleanup request

```
User clicks "Borrar todo"
    |
    v
[main.js captures selection (all tags)]
    |
    v
[main.js posts 'write' to Worker with buffer + tagsToRemove]
    |
    v
[Worker calls ExifTool write mode with -all= -unsafe]
    |
    v
[Worker posts cleaned ArrayBuffer back]
    |
    v
[main.js stores CleanedFile]
    |
    v
[State transitions to done]
    |
    v
[User clicks download]
    |
    v
[downloader.js creates Blob, triggers download, revokes URL]
```

### 4.4 Privacy verifier flow

```
[page load]
    |
    v
[privacyVerifier.js records page origin as baseline]
    |
    v
[on each performance entry, classify by origin]
    |
    v
[internal resources: add to list]
    [external resources: increment counter, log to console]
    |
    v
[widget renders count + (expandable) list]
    |
    v
[on user interaction, optionally re-snapshot]
```

---

## 5. Sequence Diagrams (Text)

### 5.1 Successful file processing

```
User      Browser       main.js      uploader     fileHandler     Worker     ExifTool
 |          |              |             |             |             |          |
 |--drop-->|              |             |             |             |          |
 |          |---validate-->|             |             |             |          |
 |          |              |---read file------------->|             |          |
 |          |              |<--buffer-----------------|             |          |
 |          |              |---init worker (if first)--------------->|          |
 |          |              |<--ready--------------------------------|          |
 |          |              |---read buffer------------------------->|          |
 |          |              |             |             |             |--parse-->|
 |          |              |             |             |             |<--json---|
 |          |              |<--raw metadata--------------------------|          |
 |          |              |---parse to FileMetadata  |             |          |
 |          |              |<--FileMetadata          |             |          |
 |          |              |---render results view    |             |          |
 |          |              |             |             |             |          |
 |--click "Borrar todo"-->|              |             |             |          |
 |          |              |---write (all=)-------------------------->|          |
 |          |              |             |             |             |--write-->|
 |          |              |             |             |             |<--bytes--|
 |          |              |<--cleaned buffer-------------------------|          |
 |          |              |---render done view       |             |          |
 |          |              |             |             |             |          |
 |--click "Descargar"---->|              |             |             |          |
 |          |              |---trigger download (Blob URL)            |          |
 |<--file saved-----------|              |             |             |          |
```

### 5.2 Corrupted file

```
User      Browser       main.js      Worker     ExifTool
 |          |              |             |          |
 |--drop-->|              |             |          |
 |          |---read-------------------->|          |
 |          |              |             |--parse-->|
 |          |              |             |<--error--|
 |          |              |<--error: corrupted----|
 |          |              |---render error view   |
 |          |              |             |          |
 |--click "Volver"------->|              |          |
 |          |              |---state = landing     |
```

### 5.3 Browser without WebAssembly

```
User      Browser       main.js      inline feature check
 |          |              |             |
 |--open-->|              |             |
 |          |---execute--->|             |
 |          |              |---detect WebAssembly---|
 |          |              |             |--false-->|
 |          |              |<--not supported          |
 |          |              |---render "browser too old" view  |
 |          |              |             |
```

---

## 6. Error Flows

Each error scenario has a specific user-facing message and a recovery path. See [Design Spec §5](./2026-09-21-metalimpia-design.md#5-error-handling) for the messages.

### 6.1 File too large

```
[landing] state
    |
    v
user drops file > 200 MB
    |
    v
fileHandler validates → error: too_large
    |
    v
error view shows: "Este archivo es muy grande (X MB)..."
    |
    v
user clicks "Volver"
    |
    v
[landing] state
```

**Important**: the file is NEVER loaded into memory. The size check is the FIRST check, before any read.

### 6.2 Unsupported format

```
user drops file with .xyz extension
    |
    v
fileHandler validates extension → not in allowed list
    |
    v
error view shows: "No reconocemos este formato..."
    |
    v
user clicks "Volver"
```

Note: even if the extension is allowed, ExifTool detects actual file type via magic bytes. A `.jpg` that's actually a PDF will fail at the Worker stage with "unsupported".

### 6.3 Corrupted file

```
user drops valid-extension file that's truncated/corrupted
    |
    v
fileHandler validates → OK (size and extension fine)
    |
    v
state → analyzing
    |
    v
Worker calls ExifTool reads → returns error
    |
    v
error view: "El archivo parece estar dañado..."
```

### 6.4 WASM load failure

```
user drops file
    |
    v
first-time Worker init → WASM download fails (network issue)
    |
    v
Worker fails to instantiate
    |
    v
error view: "No pudimos cargar el motor..."
```

### 6.5 Worker crashes mid-processing

```
[processing] state
    |
    v
Worker.onerror fires (rare; ExifTool bug or OOM)
    |
    v
main.js catches, transitions to error
    |
    v
error view: "Ocurrió un error inesperado..."
```

### 6.6 Browser too old

```
page load
    |
    v
inline check: WebAssembly undefined
    |
    v
main.js renders "browser too old" view immediately
    |
    v
no further interaction possible; user must upgrade browser
```

---

## 7. Edge Cases

### 7.1 Empty metadata file

```
ExifTool returns 0 tags
    |
    v
parser produces FileMetadata with empty groups
    |
    v
results view detects empty state
    |
    v
shows special "ya está limpio" UI
    |
    v
user can still download the original file
```

### 7.2 Extremely large metadata (many tags)

```
ExifTool returns 1000+ tags (rare; some RAW files)
    |
    v
parser produces FileMetadata with many groups
    |
    v
UI renders with virtualization (optional for MVP)
    |
    v
if not virtualized: page may scroll; performance acceptable
```

**Note**: virtualization of the metadata list is a "nice to have" for MVP. If performance is poor with 1000+ tags, add it.

### 7.3 Very long tag values

```
ExifTool returns a tag with a 10,000-character value
    |
    v
display truncates with CSS (text-overflow: ellipsis)
    |
    v
full value available in title attribute (hover for desktop)
```

### 7.4 Non-UTF8 metadata values

```
ExifTool returns a tag with binary or non-UTF8 data
    |
    v
ExifTool encodes as hex or base64
    |
    v
display as the encoded form with a "(binary)" label
```

### 7.5 Multiple files dropped at once

```
user drags 5 files at once
    |
    v
uploader processes only the first
    |
    v
others are ignored (MVP limitation)
    |
    v
user can process them one at a time
```

**Note**: batch processing is explicitly out of scope for MVP.

### 7.6 Same file dropped twice

```
user drops file, processes, downloads
    |
    v
user drops the SAME file again
    |
    v
normal flow; works as expected
```

### 7.7 User navigates away during processing

```
[processing] state
    |
    v
user clicks browser back / closes tab
    |
    v
Worker is terminated by browser
    |
    v
all in-memory data GC'd
    |
    v
no persistence, no issue
```

### 7.8 User clicks download twice quickly

```
user clicks download
    |
    v
downloader triggers download via synthetic click
    |
    v
Blob URL revoked immediately
    |
    v
user clicks again (very fast)
    |
    v
second click triggers again (creates new Blob URL)
    |
    v
no issue
```

---

## 8. Timing and Performance Flows

### 8.1 Initial load timing

```
T=0ms     : Browser receives HTML
T=50ms    : HTML parsed, CSS requested
T=100ms   : CSS loaded, JS requested
T=150ms   : JS loaded and parsed
T=200ms   : main.js executes, locale loaded (cached with HTML)
T=300ms   : Initial render (dropzone visible)
T=400ms   : Privacy verifier initialized
T=500ms   : Page fully interactive

Target: < 1000ms for time-to-interactive
```

### 8.2 First-use timing (with WASM)

```
T=0       : User drops first file
T=10ms    : Validation complete
T=20ms    : Buffer read into memory
T=30ms    : Worker spawn requested
T=200ms   : Worker script loaded, started
T=300ms   : WASM download begins (~10 MB)
T=8s      : WASM downloaded (on broadband)
T=9s      : WASM compiled
T=9.5s    : Worker ready, 'read' sent
T=10s     : ExifTool parse complete
T=10.5s   : Results view rendered
```

**After first use**: WASM is cached; subsequent uses skip the 8-second download.

### 8.3 Subsequent file timing

```
T=0       : User drops file
T=20ms    : Buffer read
T=30ms    : 'read' sent to Worker (already alive)
T=500ms   : 'read' response received
T=600ms   : Results view rendered

Total: ~600ms for typical file
```

---

## 9. Cross-Browser Flow Differences

### 9.1 Chrome / Edge (Chromium)

- File API: `File.arrayBuffer()` (Promise-based)
- Drag and drop: standard
- WASM: full support, well-optimized

### 9.2 Firefox

- Same APIs as Chrome
- WASM: full support
- Drag and drop: standard

### 9.3 Safari (macOS and iOS)

- File API: `FileReader.readAsArrayBuffer()` (callback-based, older)
  - For MVP, use `FileReader` everywhere for compatibility; `arrayBuffer()` Promise API is also widely supported now.
- Drag and drop: supported on macOS; on iOS Safari only via file picker (no drag).
- WASM: full support
- iOS-specific: file picker shows "Photo Library", "Take Photo", "Choose File" options

### 9.4 Mobile browsers

- No drag and drop on mobile; only tap-to-select
- File picker is OS-native
- WASM: supported on modern Android Chrome and iOS Safari
- Memory limits are tighter; the 200 MB cap helps avoid OOM

---

## Appendix A — Glossary

See [Design Spec Appendix B](./2026-09-21-metalimpia-design.md#appendix-b--glossary).
