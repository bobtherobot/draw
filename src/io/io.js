/**
 * Document-level operations: new, open, save, export.
 */
import { state, nextId, sanitizeShapes } from '../core/state.js';
import { emit }                  from '../core/events.js';
import { fitToArtboard }         from '../core/Viewport.js';
import { serializeJSON, deserializeJSON, exportSVG as buildSVG, importSVG } from './serializer.js';
import { rebuildAll }            from '../core/shape-registry.js';

/** Reset to a blank document. */
export function newDocument() {
  const artboardId = nextId('item');
  const layerId    = nextId('item');
  state.shapes = [
    { id: artboardId, type: 'artboard', name: 'Artboard 1', parentId: null, visible: true, locked: false, expanded: true, attrs: { x: 0, y: 0, width: 800, height: 600 } },
    { id: layerId,    type: 'group',    name: 'Layer 1',    parentId: artboardId, visible: true, locked: false, expanded: true },
  ];
  state.activeContainerId = layerId;
  state.selection.clear();
  state.doc = { name: 'Untitled' };
  emit('render', null);
  fitToArtboard();
}

/** Trigger the hidden file-open input. */
export function openSVG() {
  _getFileInput().click();
}

/** Serialize and download as a native .draw (JSON) file. */
export function saveSVG() {
  const json = serializeJSON(state.shapes, state.doc);
  _download(json, `${state.doc.name || 'drawing'}.draw`, 'application/json');
}

/** Serialize and download as a clean export SVG (no metadata). */
export function exportSVG() {
  const svg = buildSVG(state.shapes, state.doc);
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
    reader.onload = (ev) => _loadFile(ev.target.result, file.name);
    reader.readAsText(file);
    e.target.value = '';
  });
}

// ── Private ──────────────────────────────────────────────────────────────────

function _loadFile(text, filename) {
  const isJson = filename.endsWith('.draw') || filename.endsWith('.json');
  const result = isJson
    ? deserializeJSON(text)
    : (importSVG(text) ?? deserializeJSON(text));
  if (!result) return;

  state.shapes        = result.shapes;
  // Prefer first layer (group child of artboard), fall back to first group or first shape
  state.activeContainerId = result.shapes.find(s => s.type === 'group')?.id
                     ?? result.shapes[0]?.id;
  state.selection.clear();
  state.doc = { name: filename.replace(/\.(draw|svg|json)$/i, '') };
  sanitizeShapes(state.shapes);
  rebuildAll(state.shapes);

  emit('render', null);
  fitToArtboard();
}

function _getFileInput() {
  let input = document.getElementById('file-open');
  if (!input) {
    input = document.createElement('input');
    input.type    = 'file';
    input.id      = 'file-open';
    input.accept  = '.draw,.svg,application/json,image/svg+xml';
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
