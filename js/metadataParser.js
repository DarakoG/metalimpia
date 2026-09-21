/*
 * MetaLimpia — metadata parser
 *
 * Converts raw ExifTool JSON output into the FileMetadata shape
 * defined in Data Model §3.3:
 *
 *   FileMetadata {
 *     fileId: string;
 *     totalCount: number;
 *     groups: MetadataGroup[];
 *     warnings: string[];
 *   }
 *
 *   MetadataGroup {
 *     id: GroupId;       // 'author' | 'location' | 'dates' | ...
 *     labelKey: string;  // 'results.groups.<id>'
 *     sensitive: boolean;
 *     tags: MetadataTag[];
 *   }
 *
 *   MetadataTag {
 *     id: string;        // canonical ExifTool tag name
 *     labelKey: string;  // 'tags.<canonical>' — for future i18n
 *     value: string;     // formatted display string
 *     rawValue: unknown; // original value, preserved for debugging
 *     selected: boolean; // default true (= will be removed)
 *     groupId: GroupId;
 *   }
 *
 * ExifTool, when invoked with the flags `exiftoolLoader.js`
 * uses (`-j -G1 -a -s`), returns an object whose keys are
 * prefixed with the ExifTool-internal group followed by a
 * colon. Examples from the vendored ExifTool 13.42:
 *
 *   "ExifIFD:Make"            -> "Make"            -> device
 *   "GPS:GPSLatitude"         -> "GPSLatitude"     -> location
 *   "XMP-dc:Creator"          -> "Creator"         -> author
 *   "System:FileSize"         -> "FileSize"        -> FILTERED
 *   "ExifTool:ExifToolVersion"-> "ExifToolVersion" -> FILTERED
 *
 * NORMALIZATION RULE (justified, documented):
 *
 *   We STRIP the "Group:" prefix before classification. The
 *   canonical ExifTool tag name is what Data Model §4.2 uses
 *   to classify tags into the user-facing groups. The
 *   ExifTool-internal groups (ExifIFD, GPS, XMP, IPTC, File,
 *   System, JFIF, Composite, …) are technical noise: users
 *   care about "who", "where", "what device" — not "which
 *   internal section the tag lived in". Stripping the prefix
 *   gives us one consistent UX across file formats (JPG, PDF,
 *   DOCX all use different ExifTool groups but the same
 *   canonical names) and lets us keep the small curated
 *   GroupId set in the data model.
 *
 *   Trade-off: if two different ExifTool groups produced two
 *   different values for the same canonical name (rare — the
 *   `-a` flag tells ExifTool to emit duplicates), we keep the
 *   first one encountered. The classification rules treat both
 *   the same way, which is the desired behaviour.
 *
 * OPERATIONAL FILTER (Data Model §4.3):
 *
 *   Tags listed in §4.3 are excluded from display. We match
 *   the canonical name after stripping the prefix, so the
 *   filter catches both "FileSize" (no prefix) and
 *   "System:FileSize" (prefixed).
 *
 *   We additionally exclude "Warning" (ExifTool sometimes
 *   emits non-fatal warnings like "Skipped unknown bytes
 *   after JPEG DQT segment") and "FilePermissions". These
 *   are operational noise, not user-visible metadata.
 *
 * VALUE FORMATTING (Data Model §4.4):
 *
 *   - Strings / numbers / booleans: as-is.
 *   - Arrays: joined with ", " (Spanish list separator).
 *   - Date strings matching "YYYY:MM:DD HH:MM:SS" →
 *     "DD/MM/YYYY HH:MM". Unparseable dates are returned
 *     verbatim so the user sees what ExifTool produced.
 *   - Binary blobs (Uint8Array / ArrayBuffer): rendered via
 *     the caller-supplied `formatBinary(size)` callback. The
 *     parser is i18n-agnostic — the orchestrator passes
 *     `formatBinary: (size) => t('results.binaryValue', { size })`
 *     so the string lives in `locales/es.json` and the parser
 *     stays unit-testable in plain Node. The rawValue preserves
 *     the original for debugging.
 *   - Anything else (objects, etc.): best-effort JSON
 *     stringify; if that fails, fall back to "—".
 *
 * TRUNCATION (Task 4.12):
 *
 *   The parser does NOT truncate. Truncation is a
 *   presentation concern and lives in metadataView where
 *   the full value is kept in the `title` attribute for
 *   tooltip. This keeps the parser pure: callers get the
 *   exact formatted value; the view applies length caps.
 *
 * GROUP DEFINITIONS (Data Model §4.2):
 *
 *   Sensitive groups (carry privacy-relevant data):
 *     author, location, device
 *
 *   Non-sensitive groups (informational / structural):
 *     dates, software, document, comments, other
 *
 *   "Description" appears in both `document` and `comments`
 *   in §4.2. We resolve the conflict by giving `document`
 *   first match — `Description` ends up in `document`,
 *   matching the data model's table order.
 *
 * I18N DEPENDENCY:
 *
 *   This module deliberately does NOT import `./i18n.js`.
 *   Doing so would couple the parser to the JSON locale
 *   loader, which Node refuses to import without an
 *   import-assertion attribute (the browser-only Vite
 *   bundler handles it transparently). The caller threads
 *   the `formatBinary` function through instead.
 */

/**
 * Operational tag names, matched AFTER the "Group:" prefix
 * has been stripped. Case-sensitive — ExifTool emits these
 * in their canonical case.
 */
const OPERATIONAL_TAGS = new Set([
  'SourceFile',
  'ExifToolVersion',
  'Directory',
  'FileName',
  'FileSize',
  'FileModifyDate',
  'FileAccessDate',
  'FileInodeChangeDate',
  'Error',
  'Warning',
  'FilePermissions',
]);

/**
 * Groups that carry privacy-relevant data. Surfaces a
 * sensitive badge in the UI per Data Model §3.3.
 */
const SENSITIVE_GROUPS = new Set(['author', 'location', 'device']);

/**
 * Classification rules, evaluated top-to-bottom. First
 * match wins. Order matters when one canonical name
 * appears in multiple rows of §4.2 (e.g. "Description").
 *
 * Each rule is either:
 *   - a Set of exact canonical names, OR
 *   - a RegExp tested against the canonical name.
 *
 * `i` flag is used because some ExifTool tags vary in
 * case across formats (rare but observed in PDF).
 */
const GROUP_RULES = [
  // author — exact names from §4.2, plus 'Rights' (XMP
  //            dc:rights) which is semantically a copyright
  //            statement and would otherwise be orphaned in
  //            'other'. Documented as a Phase 4 deviation.
  [
    'author',
    new Set([
      'Artist',
      'Copyright',
      'By-line',
      'Byline',
      'Author',
      'Creator',
      'CreatorAddress',
      'LastModifiedBy',
      'Owner',
      'Manager',
      'Rights',
    ]),
  ],
  // location — "GPS*", "Location*", plus exact City/Country/State
  ['location', /^GPS|^Location/i],
  ['location', new Set(['City', 'Country', 'State'])],
  // dates — "DateTime*", CreateDate, ModifyDate, AccessDate
  ['dates', /^DateTime|^CreateDate$|^ModifyDate$|^AccessDate$/i],
  // device — exact names from §4.2
  [
    'device',
    new Set([
      'Make',
      'Model',
      'SerialNumber',
      'BodySerialNumber',
      'LensModel',
      'CameraOwnerName',
    ]),
  ],
  // software — exact names from §4.2
  [
    'software',
    new Set([
      'Software',
      'CreatorTool',
      'Producer',
      'Application',
    ]),
  ],
  // document — listed BEFORE comments in §4.2, so "Description"
  //            lands in `document` (first match wins).
  [
    'document',
    new Set([
      'Title',
      'Subject',
      'Keywords',
      'Description',
      'PageCount',
      'Language',
    ]),
  ],
  // comments
  ['comments', /^Comment/i],
  ['comments', new Set(['UserComment', 'XPComment'])],
];

/**
 * Group display order — controls the rendering order of
 * sections in the UI. Mirrors the order in Data Model §4.2
 * so the visual layout matches the spec.
 */
const GROUP_ORDER = [
  'author',
  'location',
  'dates',
  'device',
  'software',
  'document',
  'comments',
  'other',
];

/**
 * Strip the "Group:" prefix from an ExifTool key, returning
 * the canonical tag name. Keys without a prefix are returned
 * verbatim (ExifTool emits some unprefixed tags like
 * "SourceFile" and "Make" when -G1 doesn't know the group).
 *
 * @param {string} key
 * @returns {string}
 */
function stripGroupPrefix(key) {
  const idx = key.indexOf(':');
  if (idx <= 0) return key;
  // Only treat as a group prefix if the segment BEFORE the
  // colon looks like a group name (letters/digits only, no
  // spaces). Defensive against future ExifTool versions
  // that might emit "namespace:tag" with spaces.
  const prefix = key.slice(0, idx);
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(prefix)) return key;
  return key.slice(idx + 1);
}

/**
 * Classify a canonical ExifTool tag name into one of our
 * user-facing groups per Data Model §4.2. Returns 'other'
 * when no rule matches.
 *
 * @param {string} canonical
 * @returns {'author'|'location'|'dates'|'device'|'software'|'document'|'comments'|'other'}
 */
function classifyGroup(canonical) {
  for (const [groupId, matcher] of GROUP_RULES) {
    if (matcher instanceof RegExp) {
      if (matcher.test(canonical)) return groupId;
    } else if (matcher.has(canonical)) {
      return groupId;
    }
  }
  return 'other';
}

/**
 * Heuristic: is this a binary / non-textual value the UI
 * should NOT try to stringify itself? ExifTool only emits
 * these in a few formats (notably TIFF embedded previews
 * and PDF object streams), but the Worker can return
 * Uint8Array / ArrayBuffer when it does.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isBinary(value) {
  if (value instanceof Uint8Array) return true;
  if (value instanceof ArrayBuffer) return true;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    // Other TypedArrays (Int32Array, Float32Array, …) are
    // treated as binary too. DataView is intentionally NOT
    // matched — it's a generic view over an ArrayBuffer and
    // usually wraps text.
    return true;
  }
  return false;
}

/**
 * Format a date string in ExifTool's "YYYY:MM:DD HH:MM:SS"
 * form to a shorter "DD/MM/YYYY HH:MM" Spanish-friendly
 * representation. Unparseable strings pass through verbatim
 * so we never lose information.
 *
 * @param {string} value
 * @returns {string}
 */
function formatExifDate(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return value;
  const [, y, m, d, hh, mm] = match;
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

/**
 * Best-effort string conversion. Preserves the original
 * in `rawValue` so callers can debug; this function only
 * shapes the user-visible string.
 *
 * The `formatBinary` callback is the i18n seam — the parser
 * does not import the locale module itself.
 *
 * @param {unknown} raw
 * @param {(size: number) => string} formatBinary
 * @returns {string}
 */
function formatValue(raw, formatBinary) {
  if (raw === null || raw === undefined) return '—';

  if (isBinary(raw)) {
    const size =
      raw instanceof ArrayBuffer
        ? raw.byteLength
        : raw.byteLength !== undefined
          ? raw.byteLength
          : raw.length || 0;
    return formatBinary(size);
  }

  if (typeof raw === 'string') {
    return formatExifDate(raw);
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }

  if (Array.isArray(raw)) {
    // Recurse so dates inside arrays get formatted too.
    return raw.map((entry) => formatValue(entry, formatBinary)).join(', ');
  }

  if (typeof raw === 'object') {
    try {
      const json = JSON.stringify(raw);
      return json === undefined ? '—' : json;
    } catch {
      return '—';
    }
  }

  return String(raw);
}

/**
 * Build a stable i18n label key for a canonical ExifTool
 * tag name. Format: `tags.<lowercased canonical>`. Future
 * translations live under `tags.*` in the locale file;
 * until they're added, `t(labelKey)` returns the key
 * itself, so the UI shows the canonical name in English
 * (which is informative on its own for technical users).
 *
 * @param {string} canonical
 * @returns {string}
 */
function makeLabelKey(canonical) {
  return `tags.${canonical.toLowerCase()}`;
}

/**
 * Parse the raw ExifTool JSON object into a FileMetadata
 * per Data Model §3.3.
 *
 * @param {Record<string, unknown>} rawJson
 * @param {string} fileId
 * @param {object} [options]
 * @param {(size: number) => string} [options.formatBinary]
 *   i18n seam for binary blob formatting. Receives the blob
 *   size in bytes and returns the localised placeholder
 *   string. Defaults to a plain-English stub so the parser
 *   is usable in any context.
 * @returns {{
 *   fileId: string,
 *   totalCount: number,
 *   groups: Array<{
 *     id: string,
 *     labelKey: string,
 *     sensitive: boolean,
 *     tags: Array<{
 *       id: string,
 *       labelKey: string,
 *       value: string,
 *       rawValue: unknown,
 *       selected: boolean,
 *       groupId: string,
 *     }>,
 *   }>,
 *   warnings: string[],
 * }}
 */
export function parseExiftoolOutput(rawJson, fileId, options = {}) {
  const formatBinary =
    typeof options.formatBinary === 'function'
      ? options.formatBinary
      : (size) => `[binary data — ${size} bytes]`;

  const tagsByGroup = new Map();
  const warnings = [];
  let totalCount = 0;

  // Defensive: handle null / non-object input. ExifTool
  // returns an object, but the caller may pass a partial
  // shape during edge cases (Worker error path).
  if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) {
    for (const rawKey of Object.keys(rawJson)) {
      const canonical = stripGroupPrefix(rawKey);
      if (OPERATIONAL_TAGS.has(canonical)) {
        // Skip — operational metadata per Data Model §4.3.
        continue;
      }
      const groupId = classifyGroup(canonical);
      const value = formatValue(rawJson[rawKey], formatBinary);

      // Skip tags whose formatted value is empty (defensive
      // against ExifTool emitting "" for unset tags). The
      // user gains nothing from seeing "X: " lines.
      if (!value) continue;

      const tag = {
        id: canonical,
        labelKey: makeLabelKey(canonical),
        value,
        rawValue: rawJson[rawKey],
        selected: true, // default per Data Model §3.3
        groupId,
      };

      let bucket = tagsByGroup.get(groupId);
      if (!bucket) {
        bucket = [];
        tagsByGroup.set(groupId, bucket);
      }
      bucket.push(tag);
      totalCount += 1;
    }
  }

  // Materialise groups in the canonical order. Empty groups
  // are omitted per Data Model §8.2.
  const groups = [];
  for (const groupId of GROUP_ORDER) {
    const tags = tagsByGroup.get(groupId);
    if (!tags || tags.length === 0) continue;
    groups.push({
      id: groupId,
      labelKey: `results.groups.${groupId}`,
      sensitive: SENSITIVE_GROUPS.has(groupId),
      tags,
    });
  }

  return {
    fileId: fileId || '',
    totalCount,
    groups,
    warnings,
  };
}

/**
 * Public exports kept here so tests / callers can verify
 * the classification logic without re-deriving it.
 */
export const __internals = {
  stripGroupPrefix,
  classifyGroup,
  formatValue,
  isBinary,
  OPERATIONAL_TAGS,
  GROUP_ORDER,
  SENSITIVE_GROUPS,
};
