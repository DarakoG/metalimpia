# MetaLimpia — Adversarial Testing Plan

**Status**: Draft for review
**Date**: 2026-09-21
**Related**: [Design Spec](./2026-09-21-metalimpia-design.md), [TRD](./2026-09-21-metalimpia-trd.md), [Flow](./2026-09-21-metalimpia-flow.md)

---

## 1. Overview

### 1.1 Purpose

This document defines the **adversarial test scenarios** for MetaLimpia. The goal is to find vulnerabilities, edge cases, and privacy regressions **before** they affect users.

### 1.2 What "adversarial" means here

Adversarial testing means approaching the page **as if trying to break it**:

- An attacker trying to extract data
- A malicious user trying to crash the page
- A curious user testing edge cases
- A browser quirk that breaks assumptions
- A file format that exposes a parser bug

### 1.3 What we are NOT testing

- Server-side attacks (no server exists)
- Network sniffing of TLS traffic (out of scope)
- Compromise of the user's device (out of scope)
- Compromised browser extensions (out of scope)

---

## 2. Threat Model

### 2.1 Adversaries

| Adversary | Motivation | Capability |
|-----------|------------|------------|
| Privacy-curious user | Wants to verify privacy claims | Can use DevTools |
| Malicious user | Wants to crash the page or extract data | Can craft files, run scripts, modify network |
| Compromised file source | Wants to deliver malware via file | Provides malicious file format |
| Passive network observer | Wants to see what's uploaded | Can sniff traffic (mitigated by HTTPS) |
| Malicious browser extension | Wants to alter page behavior | Can inject scripts (mitigated by CSP) |
| Competitor | Wants to find embarrassments | Can use the page like a normal user |

### 2.2 Assets to protect

| Asset | Sensitivity | Defense |
|-------|-------------|---------|
| User's file content | HIGH (may be confidential) | No upload (architectural) |
| User's metadata (before deletion) | MEDIUM (reveals info about file) | In-memory only |
| User's identity | HIGH | No tracking, no accounts |
| User's IP address | MEDIUM | HTTPS hides content but not visit |
| Page integrity | HIGH | CSP, no third-party scripts |

### 2.3 Trust boundaries

```
+----------------------------------+
|    User's device (trusted)       |
|                                  |
|  +---------------------------+   |
|  |  Browser (trusted)        |   |
|  |                           |   |
|  |  +---------------------+  |   |
|  |  |  MetaLimpia page    |  |   |
|  |  |  (trusted code)      |  |   |
|  |  +---------------------+  |   |
|  |                           |   |
|  |  +---------------------+  |   |
|  |  |  User file content   |  |   |
|  |  |  (untrusted data)    |  |   |
|  |  +---------------------+  |   |
|  |                           |   |
|  +---------------------------+   |
+----------------------------------+
        |
        |  HTTPS (zero file upload)
        v
+----------------------------------+
|  Network / Internet              |
+----------------------------------+
```

The main trust boundary is between MetaLimpia's code (trusted) and user-supplied file content (untrusted). All untrusted content must be treated as potentially malicious.

---

## 3. Adversarial Test Categories

### 3.1 Malicious File Inputs

#### Category 3.1.1: File with misleading extension

**Test**: Drop a file named `vacaciones.jpg` that is actually a PDF (or any other format).

**Expected behavior**:
- Extension validation passes (`.jpg` is allowed).
- ExifTool detects actual file type via magic bytes.
- Worker returns `unsupported` error.
- User sees: "El archivo parece estar dañado. No pudimos leerlo."

**How to test**: Create a renamed file. Or use a hex editor to change magic bytes.

---

#### Category 3.1.2: ZIP bomb (Office formats)

**Test**: Create a DOCX/XLSX/PPTX that is a ZIP bomb (small file that decompresses to huge size).

**Expected behavior**:
- File size check passes (small).
- ExifTool attempts to process, may consume excessive memory.
- Page should either handle gracefully or reject before processing.

**Mitigation for MVP**:
- 200 MB hard cap on file size is BEFORE the buffer is loaded.
- Office formats are ZIP; ExifTool may decompress internally.
- If memory becomes an issue, lower the cap or add per-format caps.

**How to test**: Generate a known ZIP bomb (e.g., 42.zip variants).

---

#### Category 3.1.3: Files with embedded scripts

**Test**: Create a PDF or Office file with embedded JavaScript or macro code.

**Expected behavior**:
- MetaLimpia NEVER executes file content. It only parses metadata.
- ExifTool reads metadata, not content.
- The cleaned file should still contain the embedded scripts if they were in metadata-adjacent areas (acceptable; not a security boundary for MetaLimpia).
- The downloaded file is the user's responsibility to handle.

**How to test**: Create a PDF with `/JavaScript` action; verify MetaLimpia can read its metadata without triggering the JS.

---

#### Category 3.1.4: Pathologically nested structures

**Test**: Create a file with extremely deep nested structures (e.g., deeply nested XMP or deeply nested ZIP entries).

**Expected behavior**:
- ExifTool handles it (likely with reasonable performance).
- If ExifTool hangs or OOMs, the page should show an error after a timeout.

**How to test**: Use fuzzing tools or hand-craft a deeply nested structure.

---

#### Category 3.1.5: Files with extremely long strings

**Test**: Create a file with a 1 MB metadata string value.

**Expected behavior**:
- File size check may catch this if the value is huge.
- If file passes size check but has a huge value, the UI should truncate display.
- Worker should handle without OOM.

**How to test**: Use ExifTool CLI to inject a long string: `exiftool -Comment=$(python -c "print('A'*1000000)") test.jpg`.

---

#### Category 3.1.6: Binary garbage as a file

**Test**: Drop a file of random bytes (not a valid format).

**Expected behavior**:
- Extension may be valid or invalid.
- If extension is valid: ExifTool returns "unsupported" or "corrupted" error.
- User sees friendly error.

**How to test**: Use `dd if=/dev/urandom of=test.jpg bs=1024 count=100`.

---

#### Category 3.1.7: Files with non-UTF8 metadata

**Test**: Create a JPG with metadata in Latin-1, Shift-JIS, or other legacy encoding.

**Expected behavior**:
- ExifTool returns the value in some representation (often the raw bytes or with a `charset` prefix).
- Display should not break; values may show as garbled text, but no JS errors.

**How to test**: Use ExifTool to write metadata in a non-UTF8 charset.

---

#### Category 3.1.8: Zero-byte file

**Test**: Drop a zero-byte file.

**Expected behavior**:
- fileHandler returns `error: 'empty'`.
- User sees friendly error.

---

### 3.2 Privacy Verification Tests

#### Category 3.2.1: Manual network traffic analysis

**Test**: Open DevTools → Network tab. Perform a full user flow. Verify zero requests to non-origin domains.

**Steps**:
1. Open DevTools before page load.
2. Clear network log.
3. Reload page.
4. Drop a file, review metadata, clean, download.
5. Inspect every request's domain.

**Pass criteria**: Every request's domain is `metalimpia.app` (or whatever origin is set).

**Tool**: Browser DevTools.

---

#### Category 3.2.2: Automated privacy guard (CI)

**Test**: A scripted test that loads the page in a headless browser, performs a full flow, and asserts no external requests.

**Implementation** (sketch):

```javascript
// Pseudo-code for the CI test
const browser = await playwright.chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const externalRequests = [];
page.on('request', request => {
  const url = new URL(request.url());
  if (url.host !== 'metalimpia.app') {
    externalRequests.push(request.url());
  }
});

await page.goto('https://metalimpia.app');
// Simulate file drop
const fileInput = await page.$('input[type="file"]');
await fileInput.setInputFiles('test.jpg');
// Wait for results
await page.waitForSelector('[data-test="results"]');
// Click remove all
await page.click('[data-test="remove-all"]');
// Wait for done
await page.waitForSelector('[data-test="done"]');

await browser.close();

if (externalRequests.length > 0) {
  throw new Error(`Privacy violation: ${externalRequests.length} external requests: ${externalRequests.join(', ')}`);
}
```

**Pass criteria**: `externalRequests.length === 0`.

**Tool**: Playwright in CI.

---

#### Category 3.2.3: Privacy verifier widget correctness

**Test**: The on-page verifier widget must report zero external connections.

**Steps**:
1. Open the page.
2. Click "Ver detalle técnico" on the privacy verifier.
3. Observe the list of loaded resources.
4. Verify all entries have origin == page origin.

**Pass criteria**: Verifier shows "0 conexiones externas" and the resource list is all origin.

---

#### Category 3.2.4: CSP enforcement

**Test**: Verify the Content-Security-Policy header is present and strict.

**Steps**:
1. `curl -I https://metalimpia.app`
2. Check for `Content-Security-Policy:` header.
3. Verify it contains:
   - `default-src 'self'`
   - `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval`)
   - `connect-src 'self'`
   - `worker-src 'self'`

**Pass criteria**: CSP header present and strict.

---

#### Category 3.2.5: Service worker absence

**Test**: Verify no service worker is registered.

**Steps**:
1. Open DevTools → Application tab → Service Workers.
2. Verify no worker is registered.

**Pass criteria**: No service worker registered (intentional for MVP).

---

#### Category 3.2.6: Cookie / storage audit

**Test**: Verify no cookies or localStorage entries are created.

**Steps**:
1. Open DevTools → Application tab → Storage.
2. Verify no cookies, no localStorage entries (except optional theme preference).
3. Verify no IndexedDB, no Cache Storage.

**Pass criteria**: No tracking-related storage.

---

### 3.3 XSS / Injection Attacks

#### Category 3.3.1: Filename with HTML/JS

**Test**: Drop a file named `<img src=x onerror=alert(1)>.jpg`.

**Expected behavior**:
- Filename is rendered as text only (`textContent`), never as HTML.
- No alert appears.
- Filename displays literally in the UI.

**How to test**: Create a file with the malicious name. Inspect the rendered DOM to ensure no element creation occurred.

---

#### Category 3.3.2: Metadata value with HTML/JS

**Test**: Create a JPG with metadata value `<script>alert('xss')</script>`.

**Expected behavior**:
- Metadata value rendered as text only.
- No script execution.

**How to test**:
```bash
exiftool -Comment="<script>alert('xss')</script>" test.jpg
```

---

#### Category 3.3.3: Metadata value with HTML entities / encoding tricks

**Test**: Metadata value with various encodings: `&lt;script&gt;`, `%3Cscript%3E`, etc.

**Expected behavior**:
- Rendered as literal text.
- No HTML interpretation.

---

#### Category 3.3.4: Inline event handlers via innerHTML

**Test**: Inspect the codebase for any use of `innerHTML`, `outerHTML`, `document.write`, `eval`, `Function()`.

**Expected behavior**:
- None of these are used for dynamic content.
- Static HTML in index.html does not contain user data.

**Pass criteria**: Code audit shows no risky DOM manipulation.

---

#### Category 3.3.5: JSON injection via metadata

**Test**: Metadata value that is valid JSON containing keys that could pollute `Object.prototype`.

**Expected behavior**:
- The value is treated as a string, not parsed as JSON.
- No prototype pollution.

**Mitigation**: Use `JSON.parse` only on trusted sources (locale files, ExifTool output that's already an object).

---

### 3.4 Browser Compatibility Edge Cases

#### Category 3.4.1: Browser without WebAssembly

**Test**: Disable JavaScript-WASM in browser settings, or use an old browser.

**Expected behavior**:
- Feature detection fails.
- Page shows "browser too old" message.
- No JS errors in console (early return).

**How to test**: Chrome → Settings → Privacy and Security → Site Settings → Content → JavaScript (disable WASM via flag if possible, or use an older browser).

---

#### Category 3.4.2: Browser without File API

**Test**: Use a browser that predates File API.

**Expected behavior**:
- Feature detection fails.
- Page shows "browser too old" message.

---

#### Category 3.4.3: Browser with JS disabled

**Test**: Disable JavaScript, load the page.

**Expected behavior**:
- Page shows `<noscript>` message (if added) or a blank page.
- This is acceptable — without JS, the tool cannot work.

---

#### Category 3.4.4: Private / Incognito browsing

**Test**: Open page in incognito mode. Process a file.

**Expected behavior**:
- Same functionality as normal mode.
- WASM may be re-downloaded each session (no cache).
- No persistent storage leaks across sessions.

---

#### Category 3.4.5: Multiple tabs

**Test**: Open the page in 2 tabs simultaneously.

**Expected behavior**:
- Each tab is independent.
- One tab's processing does not affect the other.
- No cross-tab data leakage.

---

### 3.5 Resource Exhaustion

#### Category 3.5.1: Memory exhaustion (very large file)

**Test**: Upload a 500 MB file (above the 200 MB cap).

**Expected behavior**:
- Validation rejects before reading.
- No memory exhaustion.
- User sees: "Este archivo es muy grande..."

**Test variant**: Upload exactly 200 MB file.

**Expected behavior**:
- Passes validation.
- If file is a large image, processing may use significant memory.
- Tab may slow down but should not crash.

---

#### Category 3.5.2: CPU exhaustion (many small files in sequence)

**Test**: Drop 20 small files in sequence.

**Expected behavior**:
- Each is processed independently.
- Memory is released between files.
- No accumulation of resources.

---

#### Category 3.5.3: Worker termination

**Test**: Open browser task manager; manually kill the Worker thread.

**Expected behavior**:
- `worker.onerror` fires.
- Page shows error message.
- User can retry.

---

#### Category 3.5.4: Slow network (WASM download timeout)

**Test**: Throttle network to 1 KB/s. Try to use the tool.

**Expected behavior**:
- WASM download takes a long time.
- UI shows progress (or "still loading" state).
- Eventually completes or shows timeout error.

**Test variant**: Disconnect network mid-download.

**Expected behavior**:
- Worker fails to load WASM.
- Error message: "No pudimos cargar el motor..."

---

### 3.6 Concurrency Tests

#### Category 3.6.1: Multiple files dropped rapidly

**Test**: Drop a file. Before processing completes, drop another.

**Expected behavior**:
- Second drop is ignored (current processing is not interrupted).
- Or: second drop cancels first and starts fresh.

**Decision for MVP**: second drop is ignored. User must wait or click "back".

---

#### Category 3.6.2: Click "remove" twice rapidly

**Test**: Click the remove button twice in quick succession.

**Expected behavior**:
- Only one cleanup operation runs.
- Button is disabled during processing.

---

#### Category 3.6.3: Click download before processing completes

**Test**: Hypothetically — should not be possible because download button only appears in `[done]` state.

**Expected behavior**: Not applicable; UI prevents this.

---

### 3.7 Visual / Layout Edge Cases

#### Category 3.7.1: Very long filename

**Test**: Drop a file with a 200-character filename.

**Expected behavior**:
- Filename truncates in UI with ellipsis.
- Full filename in `title` attribute (hover for desktop).
- No layout breakage.

---

#### Category 3.7.2: Unicode in filename

**Test**: Drop a file with emoji or non-Latin characters in filename.

**Expected behavior**:
- Renders correctly.
- No encoding issues.

---

#### Category 3.7.3: Very small viewport

**Test**: Resize browser to 320px wide (mobile small).

**Expected behavior**:
- Layout adapts.
- No horizontal scroll on the main page.
- All controls remain accessible.

---

#### Category 3.7.4: Very large viewport

**Test**: Resize browser to 4K width.

**Expected behavior**:
- Content stays centered with max-width.
- Generous whitespace on sides.

---

#### Category 3.7.5: Zoom levels

**Test**: Set browser zoom to 200% and 50%.

**Expected behavior**:
- Layout reflows appropriately.
- Text remains readable.
- No overlap or clipping.

---

### 3.8 ExifTool-Specific Edge Cases

#### Category 3.8.1: MakerNotes from various camera brands

**Test**: Process JPGs from Canon, Nikon, Sony, Apple, etc.

**Expected behavior**:
- All metadata is read.
- Vendor-specific tags appear in results.
- Cleanup works correctly (vendor notes are removed).

**How to test**: Obtain sample images from various cameras (or use ExifTool sample images).

---

#### Category 3.8.2: Multiple metadata standards in one file

**Test**: A JPG that has both EXIF and XMP and IPTC for the same logical field (e.g., creator).

**Expected behavior**:
- ExifTool returns the "preferred" value as a single tag.
- Other copies are also returned but grouped under their respective standards.
- Cleanup removes all instances.

---

#### Category 3.8.3: PDF with encrypted metadata

**Test**: A password-protected PDF.

**Expected behavior**:
- ExifTool attempts to read; may return partial data or error.
- Error message is friendly.

---

#### Category 3.8.4: Office file with macros

**Test**: A DOCM (macro-enabled Word file).

**Expected behavior**:
- Metadata read works (macros are content, not metadata).
- Cleanup removes document properties.
- The macros remain in the file (out of scope for metadata cleaning).

---

## 4. Test Execution Plan

### 4.1 Manual test checklist (pre-release)

Run through every test in each category. Record pass/fail.

| Category | # tests | Owner | Status |
|----------|---------|-------|--------|
| 3.1 Malicious file inputs | 8 | Manual | ☐ |
| 3.2 Privacy verification | 6 | Manual + automated | ☐ |
| 3.3 XSS / injection | 5 | Manual + code audit | ☐ |
| 3.4 Browser compatibility | 5 | Manual | ☐ |
| 3.5 Resource exhaustion | 4 | Manual | ☐ |
| 3.6 Concurrency | 3 | Manual | ☐ |
| 3.7 Visual / layout | 5 | Manual | ☐ |
| 3.8 ExifTool edge cases | 4 | Manual | ☐ |

### 4.2 Automated test checklist

| Test | Tool | Trigger | Pass criteria |
|------|------|---------|---------------|
| Privacy guard (3.2.2) | Playwright | Every CI build | 0 external requests |
| CSP header check (3.2.4) | `curl` + grep | Every CI build | CSP header present and strict |
| Build output audit | grep | Every CI build | No `innerHTML`, no `eval`, no `Function()` in bundle |
| Privacy claim regression | grep + manual review | Every PR | No new third-party dependencies |

### 4.3 Bug reporting

When a test fails:
1. Document the exact test case, environment, and observed behavior.
2. Assign severity (CRITICAL / HIGH / MEDIUM / LOW).
3. CRITICAL / HIGH bugs block release.
4. Track in GitHub Issues.

---

## 5. Tools and Environment

### 5.1 Tools required

| Tool | Purpose |
|------|---------|
| Chrome DevTools | Network monitoring, storage inspection |
| Firefox DevTools | Cross-browser verification |
| Safari Web Inspector | iOS / macOS Safari verification |
| Playwright | Automated privacy guard test |
| `curl` | Header inspection |
| ExifTool (CLI) | Reference implementation; verify cleanup results |
| BrowserStack or similar | Optional: cross-browser/device matrix |

### 5.2 Test data needed

| Data | Source |
|------|--------|
| Sample JPG with GPS | Photos from a phone with GPS enabled |
| Sample DOCX with author | Created in Word with author property |
| Sample PDF | Created in any PDF editor |
| ZIP bomb | Generated or downloaded (42.zip variants) |
| File with XSS payload in name | Manually created |
| File with non-UTF8 metadata | `exiftool -Comment -charset Latin1 ...` |
| Zero-byte file | `touch empty.jpg` |

### 5.3 Environment matrix

| Browser | OS | Versions to test |
|---------|----|-------------------|
| Chrome | Windows, macOS, Android | Latest stable, latest -1 |
| Firefox | Windows, macOS | Latest stable, latest -1 |
| Safari | macOS, iOS | Latest stable, latest -1 |
| Edge | Windows | Latest stable |

---

## 6. Acceptance Criteria for Adversarial Test Pass

The MVP passes adversarial testing when:

1. **All CRITICAL / HIGH severity tests pass.**
2. **No privacy violations are found** (zero external requests in any tested scenario).
3. **No XSS vulnerabilities** are exploitable.
4. **All supported formats** pass adversarial tests for that format.
5. **Memory / CPU exhaustion tests** result in graceful errors, not crashes.
6. **The CI privacy guard test** passes on every commit.

---

## 7. Known Limitations (Documented for Transparency)

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Encrypted PDFs are partially readable | User may not see all metadata | Friendly error message |
| Files with embedded macros retain them | Macros are content, not metadata | Documented in privacy policy |
| ZIP-bomb-like Office files may consume memory before being rejected | Possible slowdown or crash on hostile files | 200 MB cap mitigates most cases |
| Cancel-during-processing not in MVP | User must wait for completion to finish | Acceptable for MVP |
| Batch upload not supported | Multiple files dropped → only first processed | Documented in UI |
| `prefers-reduced-motion` honored only at CSS level | Some animations may still play | Acceptable; verify in manual tests |

---

## 8. Open Questions

- **Should we add Subresource Integrity for any future first-party resources?** Currently N/A because all resources are same-origin.
- **Should we add a "report vulnerability" link** in the privacy policy? Recommended.
- **Should we run periodic external security audits?** Deferred; can be revisited post-launch.

---

## Appendix A — Test Case Templates

Use these templates when adding new test cases.

### Template: File input test

```markdown
**Test ID**: FILE-INPUT-XXX
**Category**: 3.1 Malicious File Inputs
**Severity**: CRITICAL | HIGH | MEDIUM | LOW
**Pre-conditions**: [What state is the page in?]
**Test steps**:
1. [Step 1]
2. [Step 2]
**Expected result**: [What should happen]
**How to reproduce**: [Concrete commands or file creation steps]
**Actual result**: [Observed, filled in during test]
**Pass/Fail**: ☐
```

### Template: Privacy verification test

```markdown
**Test ID**: PRIVACY-XXX
**Category**: 3.2 Privacy Verification
**Severity**: CRITICAL
**Pre-conditions**: DevTools open with Network tab cleared
**Test steps**:
1. [Step 1]
**Expected result**: Zero requests to non-origin domains
**Tool**: [DevTools / Playwright / curl]
**Pass/Fail**: ☐
```

### Template: XSS test

```markdown
**Test ID**: XSS-XXX
**Category**: 3.3 XSS / Injection
**Severity**: CRITICAL
**Pre-conditions**: Page loaded
**Test steps**:
1. Drop file with [specific payload]
**Expected result**: Payload rendered as literal text; no script execution
**Pass/Fail**: ☐
```

---

## Appendix B — Severity Definitions

| Severity | Definition | Release blocker? |
|----------|------------|------------------|
| CRITICAL | Privacy violation, RCE, data loss | Yes |
| HIGH | XSS, significant functional break, security weakness | Yes |
| MEDIUM | Functional edge case, minor security weakness | No, but tracked |
| LOW | Cosmetic, nice-to-have improvement | No |

---

## Appendix C — Glossary

See [Design Spec Appendix B](./2026-09-21-metalimpia-design.md#appendix-b--glossary).
