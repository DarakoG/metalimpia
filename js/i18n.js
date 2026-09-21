/*
 * MetaLimpia — i18n module
 *
 * Loads the locale file matching the document's lang attribute and
 * exposes a t(key, params) lookup function. All UI strings flow
 * through here; HTML must never contain hardcoded user-facing copy
 * beyond the no-JS fallback content.
 *
 * Design Spec section 3 (file structure) and Data Model section 6
 * (locale schema).
 *
 * Phase 1 uses a static import for es.json (Vite bundles JSON into
 * the JS chunk). When a second language is added in a later phase,
 * switch the loader to dynamic import() so each locale lives in its
 * own chunk and is fetched on demand.
 */

import es from '../locales/es.json';

// Locale registry. Add a new entry per language; `init(lang)` looks
// up by the document's lang attribute (e.g. "es", "en").
const LOCALES = {
  es,
};

// Resolved locale object. Replaced by init().
let currentLocale = es;

/**
 * Initialise the i18n subsystem.
 *
 * @param {string} [lang] — language tag. Defaults to the value of
 *   `<html lang="...">`, falling back to "es".
 */
export async function init(lang) {
  const requested = lang || document.documentElement.lang || 'es';
  const resolved = LOCALES[requested] ? requested : 'es';
  currentLocale = LOCALES[resolved];
  document.documentElement.lang = resolved;
  applyTranslations();
}

/**
 * Look up a translation by dot-separated path with optional
 * {placeholder} interpolation. Returns the original key when the
 * path is missing so untranslated surfaces degrade gracefully
 * instead of throwing.
 *
 * @param {string} key — e.g. "verifier.summary.zero"
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
  const raw = lookup(currentLocale, key);
  if (typeof raw !== 'string') return key;
  return interpolate(raw, params);
}

/**
 * Walk the DOM and replace the text of any element marked with
 * data-i18n-key. Also handles data-i18n-attr="<attr>:<key>" for
 * ARIA labels, and data-i18n-title on the root <html> for
 * document.title.
 */
export function applyTranslations() {
  document.querySelectorAll('[data-i18n-key]').forEach((el) => {
    const key = el.getAttribute('data-i18n-key');
    const translated = t(key);
    if (translated !== key) {
      el.textContent = translated;
    }
  });

  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr');
    const sep = spec.indexOf(':');
    if (sep <= 0) return;
    const attr = spec.slice(0, sep);
    const key = spec.slice(sep + 1);
    const translated = t(key);
    if (translated !== key) {
      el.setAttribute(attr, translated);
    }
  });

  const titleKey = document.documentElement.getAttribute('data-i18n-title');
  if (titleKey) {
    const translated = t(titleKey);
    if (translated !== titleKey) {
      document.title = translated;
    }
  }
}

function lookup(obj, path) {
  if (obj == null) return undefined;
  return path.split('.').reduce((acc, segment) => {
    if (acc == null) return undefined;
    return acc[segment];
  }, obj);
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}