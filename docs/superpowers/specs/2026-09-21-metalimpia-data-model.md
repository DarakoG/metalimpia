# MetaLimpia — Data Model

**Status**: Draft for review
**Date**: 2026-09-21
**Related**: [Design Spec](./2026-09-21-metalimpia-design.md), [TRD](./2026-09-21-metalimpia-trd.md)

---

## 1. Overview

MetaLimpia has **no persistent data store**. There is no database, no backend, no cookies, no `localStorage` usage beyond a single optional theme preference.

This document describes:

1. **Transient data** that lives in memory only during a session.
2. **Locale files** (the only "configuration data").
3. **ExifTool output schema** (what we parse).
4. **Internal data structures** used between modules.
5. **Data lifecycle** (how data is created, used, and destroyed).
6. **Privacy implications** for each data element.

The privacy-first principle means: every byte of user-derived data is destroyed when the tab closes or the user navigates away.

---

## 2. Persistent Data

**There is no persistent data in MVP.** Specifically:

- ❌ No backend database
- ❌ No cookies
- ❌ No `localStorage` (except optional theme preference)
- ❌ No `sessionStorage`
- ❌ No `IndexedDB`
- ❌ No `Cache Storage`
- ❌ No service worker cache (no service worker in MVP)

### Optional non-identifying preference

```typescript
// Stored in localStorage only if user toggles theme in the future
type StoredPreference = {
  key: 'theme';
  value: 'light' | 'dark'; // dark mode is post-MVP
};
```

This is the only data that could ever persist. It contains zero identifying information.

---

## 3. Transient Data (In-Memory Only)

The following data structures exist only while the page is open. They are cleared when the tab is closed or the user navigates away.

### 3.1 Application state

```typescript
type AppState =
  | { view: 'landing' }
  | { view: 'analyzing'; file: File }
  | { view: 'results'; file: File; metadata: FileMetadata }
  | { view: 'processing'; file: File; selection: MetadataSelection }
  | { view: 'done'; file: File; cleanedBuffer: ArrayBuffer; removedCount: number }
  | { view: 'error'; errorKey: string; context?: Record<string, unknown> };
```

Only one state at a time. Transitions are explicit (no implicit state).

### 3.2 File representation

```typescript
type UserFile = {
  // The native File object from the user's drag-and-drop or file picker
  raw: File;

  // Derived, computed once on receipt
  id: string;               // UUID, generated locally for tracking within session
  name: string;             // Original filename (e.g. "vacaciones.jpg")
  size: number;             // Bytes
  type: string;             // MIME type as provided by the browser
  extension: string;        // Lowercase, without dot (e.g. "jpg")
  buffer: ArrayBuffer;      // The file's bytes, loaded once
};
```

**Lifecycle**: created when user drops file, destroyed when state transitions away from `done`/`error`.

### 3.3 FileMetadata (parsed from ExifTool)

```typescript
type FileMetadata = {
  fileId: string;            // Reference to UserFile.id
  totalCount: number;        // Total tags found
  groups: MetadataGroup[];
  warnings: string[];        // Non-fatal issues (e.g. "EXIF data truncated")
};

type MetadataGroup = {
  id: GroupId;
  labelKey: string;          // i18n key for the group label
  sensitive: boolean;        // True for groups containing privacy-relevant data
  tags: MetadataTag[];
};

type GroupId =
  | 'author'         // Author, creator, last-modified-by, etc.
  | 'location'       // GPS, location, etc.
  | 'dates'          // Creation, modification, access dates
  | 'device'         // Camera, scanner, device info
  | 'software'       // Editing software, OS
  | 'document'       // Document-specific (page count, language, etc.)
  | 'comments'       // User-entered comments
  | 'other';         // Anything not categorized

type MetadataTag = {
  id: string;                // Canonical ExifTool tag name (e.g. "GPSLatitude")
  labelKey: string;          // i18n key for human-readable label
  value: string;             // Formatted display value (already converted from raw)
  rawValue: unknown;         // Original value (for debugging, not displayed)
  selected: boolean;         // Checkbox state, default true (selected = will be removed)
  groupId: GroupId;          // Reference to parent group
};
```

### 3.4 MetadataSelection

```typescript
type MetadataSelection = {
  fileId: string;
  selectedTagIds: Set<string>;    // IDs of tags to remove
  removeAll: boolean;              // Shortcut: remove everything
};
```

Default: `removeAll = true`, all tags selected.

### 3.5 Worker communication

Messages between the main thread and the Web Worker:

```typescript
// Main → Worker
type WorkerRequest =
  | { op: 'init' }
  | { op: 'read'; buffer: ArrayBuffer }
  | { op: 'write'; buffer: ArrayBuffer; tagsToRemove: string[]; removeAll: boolean };

// Worker → Main
type WorkerResponse =
  | { ok: true; op: 'init' }
  | { ok: true; op: 'read'; raw: ExifToolRawOutput }
  | { ok: true; op: 'write'; cleaned: ArrayBuffer }
  | { ok: false; op: 'read'; error: 'corrupted' | 'unsupported' | 'crashed' }
  | { ok: false; op: 'write'; error: 'write_failed' | 'crashed' };
```

---

## 4. ExifTool Output Schema

ExifTool returns a JSON object where keys are canonical tag names and values are the tag values (already converted to human-readable form).

### 4.1 Raw output structure

```json
{
  "SourceFile": "foto.jpg",
  "ExifToolVersion": "12.70",
  "Make": "Canon",
  "Model": "EOS R5",
  "DateTimeOriginal": "2024:12:15 14:32:10",
  "GPSLatitude": "40 deg 45' 30.00\" N",
  "GPSLongitude": "73 deg 59' 12.00\" W",
  "GPSAltitude": "15 m Above Sea Level",
  "Software": "Adobe Lightroom 13.0",
  "Artist": "Carla Mendoza",
  "Copyright": "© 2024 Carla Mendoza",
  "ImageWidth": 6000,
  "ImageHeight": 4000,
  "...": "..."
}
```

### 4.2 Group classification rules

Tags are classified into groups based on prefix matching:

| Group | Tag prefix / pattern | Examples | Sensitive? |
|-------|---------------------|----------|------------|
| `author` | `Artist`, `Copyright`, `By-line`, `Author`, `Creator`, `LastModifiedBy`, `Owner`, `Manager` | `Artist`, `Copyright` | Yes |
| `location` | `GPS*`, `Location*`, `City`, `Country`, `State` | `GPSLatitude`, `GPSLongitude` | **Yes** |
| `dates` | `DateTime*`, `CreateDate`, `ModifyDate`, `AccessDate` | `DateTimeOriginal`, `CreateDate` | No |
| `device` | `Make`, `Model`, `SerialNumber`, `LensModel`, `CameraOwnerName` | `Make`, `Model` | Yes |
| `software` | `Software`, `CreatorTool`, `Producer`, `Application` | `Software`, `Producer` | No |
| `document` | `Title`, `Subject`, `Keywords`, `Description`, `PageCount`, `Language` | `Title`, `PageCount` | No |
| `comments` | `Comment*`, `UserComment`, `Description`, `XPComment` | `UserComment` | No |
| `other` | Anything else | `ImageWidth`, `ColorSpace` | No |

### 4.3 Tags excluded from display

Some ExifTool output fields are operational metadata that should not be shown to users:

- `SourceFile` — internal path
- `ExifToolVersion`, `ExifTool:ExifToolVersion` — version info
- `Directory`, `FileName` — internal
- `FileSize`, `FileModifyDate`, `FileAccessDate`, `FileInodeChangeDate` — filesystem metadata
- `Error` — internal error field

These are filtered out during parsing.

### 4.4 Value formatting

| Tag type | Raw format | Display format |
|----------|-----------|----------------|
| GPS coordinates | `"40 deg 45' 30.00\" N"` | Displayed as-is (already formatted) |
| Date | `"2024:12:15 14:32:10"` | Localized via i18n: `"15/12/2024 14:32"` |
| Number | `6000` | Displayed as-is |
| String | `"Adobe Lightroom 13.0"` | Displayed as-is |
| List | `["tag1", "tag2"]` | Joined with localized separator |

---

## 5. Internal Schemas

### 5.1 Cleaned file representation

```typescript
type CleanedFile = {
  fileId: string;             // Reference to original UserFile.id
  originalBuffer: ArrayBuffer;
  cleanedBuffer: ArrayBuffer;
  removedCount: number;       // Number of tags removed
  downloadName: string;       // e.g. "vacaciones-limpio.jpg"
  mimeType: string;           // Inherited from original
};
```

### 5.2 Privacy verifier data

```typescript
type PrivacyReport = {
  externalCount: number;       // Should always be 0
  internalResources: ResourceInfo[];
  lastUpdated: number;         // Timestamp (ms since epoch)
};

type ResourceInfo = {
  name: string;                // Filename (e.g. "main.js")
  origin: string;              // Always equal to page origin in correct operation
  type: 'script' | 'style' | 'image' | 'wasm' | 'font' | 'fetch' | 'other';
  size: number;                // Bytes
  loadTime: number;            // ms
};
```

---

## 6. Locale File Schema

Each locale file is a flat JSON object where keys are dot-separated identifiers and values are the localized strings.

### 6.1 File: `locales/es.json`

```json
{
  "app.name": "MetaLimpia",
  "app.tagline": "Tu archivo nunca sale del navegador.",
  "landing.heading": "Revisá y eliminá los metadatos de tus archivos",
  "landing.subheading": "Arrastrá tu archivo o hacé click para seleccionarlo.",
  "landing.dropzone": "Arrastrá tu archivo acá o hacé click",
  "landing.supportedFormats": "Formatos soportados: JPG, PNG, TIFF, HEIC, PDF, DOCX, XLSX, PPTX",
  "landing.privacyVerifier.collapsed": "Esta página está haciendo {count} conexiones con servidores externos.",
  "landing.privacyVerifier.collapsed.zero": "Esta página está haciendo 0 conexiones con servidores externos.",
  "analyzing.message": "Analizando metadatos...",
  "results.title": "Tu archivo: {filename}",
  "results.summary": "Se encontraron {count} metadatos.",
  "results.actions.removeAll": "Borrar todo",
  "results.actions.removeSelected": "Borrar seleccionados",
  "results.actions.back": "Cambiar archivo",
  "results.empty.title": "Este archivo no tiene metadatos",
  "results.empty.subtitle": "Ya está limpio. Podés descargarlo igual.",
  "results.groups.author": "Autor",
  "results.groups.location": "Ubicación",
  "results.groups.dates": "Fechas",
  "results.groups.device": "Dispositivo",
  "results.groups.software": "Software",
  "results.groups.document": "Documento",
  "results.groups.comments": "Comentarios",
  "results.groups.other": "Otros",
  "results.groups.sensitive.badge": "Datos sensibles",
  "done.title": "Archivo limpio",
  "done.summary": "Se eliminaron {count} metadatos.",
  "done.download": "Descargar archivo limpio",
  "done.another": "Procesar otro archivo",
  "errors.tooLarge": "Este archivo es muy grande ({size} MB). El máximo permitido es 200 MB.",
  "errors.unsupportedFormat": "No reconocemos este formato. Formatos soportados: {formats}.",
  "errors.corrupted": "El archivo parece estar dañado. Probá con otra copia.",
  "errors.wasmLoadFailed": "No pudimos cargar el motor. Verificá tu conexión y recargá la página.",
  "errors.workerCrashed": "Ocurrió un error inesperado. Recargá la página y probá de nuevo.",
  "errors.browserTooOld": "Tu navegador es muy antiguo. Actualizalo o usá Chrome, Firefox, Safari o Edge en sus últimas versiones.",
  "verifier.title": "Verificador de privacidad",
  "verifier.summary.zero": "Esta página está haciendo 0 conexiones con servidores externos.",
  "verifier.summary.nonzero": "Esta página está haciendo {count} conexiones con servidores externos.",
  "verifier.expand": "Ver detalle técnico",
  "verifier.collapse": "Ocultar detalle",
  "verifier.list.label": "Recursos cargados:",
  "verifier.list.empty": "Ninguno todavía"
}
```

### 6.2 Localization parameters

Strings use `{name}` placeholders for runtime substitution. Example: `"Este archivo es muy grande ({size} MB)."` → `"Este archivo es muy grande (180 MB)."`

### 6.3 Pluralization

For MVP, pluralization is handled by separate keys (e.g. `verifier.summary.zero` vs `verifier.summary.nonzero`). A proper i18n library can be introduced later if needed.

### 6.4 Adding a new locale

To add a new language (e.g. English):

1. Create `locales/en.json` with all keys from `es.json` translated.
2. Set the `<html lang="en">` attribute when serving in English.
3. The i18n module automatically loads the file matching the `lang` attribute.

No code changes required.

---

## 7. Data Lifecycle

### 7.1 Per-session lifecycle

```
Page load
    |
    v
[landing] state, no data
    |
    v  (user drops file)
[analyzing] state: UserFile created, buffer in memory
    |
    v  (ExifTool returns)
[results] state: FileMetadata created
    |
    v  (user adjusts selection, clicks remove)
[processing] state: MetadataSelection created
    |
    v  (Worker returns cleaned bytes)
[done] state: CleanedFile created
    |
    +----> (user clicks "another file") --> back to [landing], old UserFile GC'd
    |
    +----> (user closes tab)            --> all in-memory data GC'd
```

### 7.2 Garbage collection

JavaScript's garbage collector handles in-memory data automatically. When:
- The user navigates to a different view, the old `UserFile` reference is dropped.
- The user closes the tab, all references are dropped.
- The `Blob` URL created for download is revoked via `URL.revokeObjectURL()` after download.

### 7.3 Blob URL lifecycle

```javascript
// On download trigger
const blob = new Blob([cleanedBuffer], { type: mimeType });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = downloadName;
a.click();
URL.revokeObjectURL(url); // Immediately revoke; download already triggered
```

The URL is revoked immediately after the click event. The browser handles the actual download using the cached data.

---

## 8. Data Validation Rules

### 8.1 On file receipt

```typescript
function validateFile(file: File): ValidationResult {
  if (file.size === 0) return { ok: false, error: 'empty' };
  if (file.size > 200 * 1024 * 1024) return { ok: false, error: 'too_large' };
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return { ok: false, error: 'unsupported_format' };
  return { ok: true };
}
```

### 8.2 On metadata parse

- All tag values are coerced to strings for display.
- Unknown tags (not in our group mapping) go to the `other` group.
- Empty groups are omitted from the rendered view.

### 8.3 On worker response

- Worker responses are validated against the expected shape.
- Any deviation (e.g. missing `ok` field, unexpected types) triggers a `crashed` error path.

---

## 9. Privacy Implications

This section lists each data element and its privacy posture.

| Data | Where it lives | Lifetime | Identifiable? | Risk |
|------|---------------|----------|---------------|------|
| UserFile.raw | Browser memory | Until state transitions | Filename may contain personal info | Discarded automatically |
| UserFile.buffer | Browser memory | Until state transitions | Yes (file content) | Discarded automatically |
| FileMetadata | Browser memory | Until state transitions | Aggregated metadata, no PII on its own | Discarded automatically |
| MetadataSelection | Browser memory | Until processing completes | No | Discarded automatically |
| CleanedFile.cleanedBuffer | Browser memory | Until downloaded | Yes (file content) | Discarded after Blob URL revoked |
| Performance API entries | Browser-internal | Per session | No (just URLs and sizes) | Reviewable via verifier |
| AppState | Browser memory | Until next state change | No | Discarded automatically |

**No data ever leaves the browser.** This is verified by the CI privacy guard test.

---

## Appendix A — JSON Schemas (informal)

The TypeScript types above are the source of truth. For documentation purposes, here are the equivalent JSON shapes.

### `CleanedFile` as JSON (in-memory only, not serialized)

```json
{
  "fileId": "uuid-v4-string",
  "originalBuffer": "<ArrayBuffer>",
  "cleanedBuffer": "<ArrayBuffer>",
  "removedCount": 23,
  "downloadName": "vacaciones-limpio.jpg",
  "mimeType": "image/jpeg"
}
```

### `WorkerResponse` as JSON (over `postMessage`)

```json
{
  "ok": true,
  "op": "read",
  "raw": {
    "Make": "Canon",
    "Model": "EOS R5",
    "..."
  }
}
```

```json
{
  "ok": false,
  "op": "read",
  "error": "corrupted"
}
```
