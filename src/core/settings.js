/**
 * Single-key localStorage gateway for all persisted app state.
 *
 * Storage shape  (key: 'draw'):
 * {
 *   options: { theme, units, pasteboardColor },
 *   panels:  { ...panel-manager shell state... },
 *   layouts: [ ...named panel layouts... ]
 * }
 *
 * Everything goes through loadSection / saveSection so there is exactly one
 * localStorage key for the entire application.
 */
import { state }      from './state.js';
import { applyTheme } from '../app.js';

export const STORAGE_KEY = 'draw';

// ── Core read / write ─────────────────────────────────────────────────────────

function _read() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  } catch { return {}; }
}

function _write(all) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch {}
}

// ── Section API (used by panel-manager and settings) ─────────────────────────

/** Return the stored value for `section`, or `null` if absent. */
export function loadSection(section) {
  const v = _read()[section];
  return v !== undefined ? v : null;
}

/** Merge `value` into the stored object under `section` and persist. */
export function saveSection(section, value) {
  const all = _read();
  all[section] = value;
  _write(all);
}

// ── Options ───────────────────────────────────────────────────────────────────

export function loadSettings() {
  const s = loadSection('options');
  if (!s || typeof s !== 'object') return;
  if (typeof s.theme           === 'string') state.options.theme           = s.theme;
  if (typeof s.units           === 'string') state.options.units           = s.units;
  if (s.pasteboardColor !== undefined)       state.options.pasteboardColor = s.pasteboardColor;
  if (typeof s.selectByIntersect === 'boolean') state.options.selectByIntersect = s.selectByIntersect;
}

export function saveSettings() {
  saveSection('options', {
    theme:             state.options.theme,
    units:             state.options.units,
    pasteboardColor:   state.options.pasteboardColor,
    selectByIntersect: state.options.selectByIntersect,
  });
}

// ── Export / Import (full settings blob) ─────────────────────────────────────

export function exportSettings() {
  const payload = JSON.stringify(_read(), null, 2);
  const blob    = new Blob([payload], { type: 'application/json' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = 'draw-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importSettings(onDone) {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const blob = JSON.parse(/** @type {string} */ (reader.result));
        if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
          throw new Error('bad format');
        }
        // Write the entire blob back to localStorage
        _write(blob);
        // Apply the options section immediately
        loadSettings();
        applyTheme(state.options.theme);
        onDone?.();
      } catch {
        alert('Invalid settings file — could not import.');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}
