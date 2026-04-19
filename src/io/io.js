/**
 * Document-level operations: new, open, save, export.
 */
import { state }               from '../core/state.js';
import { emit }                from '../core/events.js';
import { fitToArtboard }       from '../viewport.js';
import { serializeSVG, deserializeSVG } from './serializer.js';

/** Reset to a blank document. */
export function newDocument() {
  state.layers = [{
    id:       'l1',
    name:     'Layer 1',
    visible:  true,
    locked:   false,
    expanded: true,
    shapes:   [],
  }];
  state.activeLayerId = 'l1';
  state.selection.clear();
  state.doc = { width: 800, height: 600, name: 'Untitled' };
  emit('render', null);
  fitToArtboard();
}

/** Trigger the hidden file-open input. */
export function openSVG() {
  const input = _getFileInput();
  input.click();
}

/** Serialize and download as an editable .svg (with data-id metadata). */
export function saveSVG() {
  const svg = serializeSVG(state.layers, state.doc, true);
  _download(svg, `${state.doc.name || 'drawing'}.svg`, 'image/svg+xml');
}

/** Serialize and download as a clean export (no metadata). */
export function exportSVG() {
  const svg = serializeSVG(state.layers, state.doc, false);
  _download(svg, `${state.doc.name || 'export'}.svg`, 'image/svg+xml');
}

/**
 * Wire up the hidden file input for open.
 * Call once during app init.
 */
export function initIO() {
  const input = _getFileInput();
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => _loadSVGText(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ── Private ──────────────────────────────────────────────────────────────────

function _loadSVGText(svgText, filename) {
  const result = deserializeSVG(svgText);
  if (!result) return;

  state.layers        = result.layers;
  state.activeLayerId = result.layers[0]?.id ?? 'l1';
  state.selection.clear();
  state.doc = {
    ...result.doc,
    name: filename.replace(/\.svg$/i, ''),
  };

  emit('render', null);
  fitToArtboard();
}

function _getFileInput() {
  let input = document.getElementById('file-open');
  if (!input) {
    input = document.createElement('input');
    input.type   = 'file';
    input.id     = 'file-open';
    input.accept = '.svg,image/svg+xml';
    input.style.display = 'none';
    document.body.appendChild(input);
  }
  return input;
}

function _download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
