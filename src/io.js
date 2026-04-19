import { state } from './state.js';
import { render } from './render.js';
import { fitToArtboard } from './viewport.js';

export function newDocument() {
  state.layers = [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, shapes: [] }];
  state.activeLayerId = 'l1';
  state.selection.clear();
  state.doc = { width: 800, height: 600, name: 'Untitled' };
  render();
  fitToArtboard();
}

export function openSVG() {
  document.getElementById('file-open').click();
}

export function saveSVG() {
  const svgEl = buildSVGString(true);
  downloadFile(svgEl, 'drawing.svg', 'image/svg+xml');
}

export function exportSVG() {
  const svgEl = buildSVGString(false);
  downloadFile(svgEl, 'export.svg', 'image/svg+xml');
}

function buildSVGString(includeMetadata) {
  const canvas = document.getElementById('canvas');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;

  for (const layer of state.layers) {
    const attrs = includeMetadata
      ? ` id="layer-${layer.id}" data-name="${esc(layer.name)}" data-visible="${layer.visible}" data-locked="${layer.locked}"`
      : ` id="layer-${layer.id}"`;
    out += `  <g${attrs}>\n`;

    for (const shape of layer.shapes) {
      out += '    ' + shapeToSVG(shape, includeMetadata) + '\n';
    }
    out += '  </g>\n';
  }

  out += '</svg>';
  return out;
}

function shapeToSVG(shape, meta) {
  const tag = shape.type;
  let a = '';
  for (const [k, v] of Object.entries(shape.attrs)) a += ` ${k}="${esc(String(v))}"`;
  a += ` fill="${esc(shape.style.fill)}" stroke="${esc(shape.style.stroke)}" stroke-width="${shape.style.strokeWidth}"`;
  if (meta) a += ` data-id="${shape.id}"`;
  return `<${tag}${a}/>`;
}

export function initIO() {
  document.getElementById('file-open').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => parseSVG(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  });
}

function parseSVG(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return;

  const newLayers = [];
  let lid = 1;

  for (const g of svgEl.querySelectorAll(':scope > g')) {
    const layer = {
      id: g.id || `l${lid++}`,
      name: g.dataset.name || g.id || `Layer ${lid}`,
      visible: g.dataset.visible !== 'false',
      locked: g.dataset.locked === 'true',
      shapes: [],
    };

    for (const child of g.children) {
      const shape = elementToShape(child);
      if (shape) layer.shapes.push(shape);
    }
    newLayers.push(layer);
  }

  if (newLayers.length === 0) return;
  state.layers = newLayers;
  state.activeLayerId = newLayers[0].id;
  state.selection.clear();
  render();
}

function elementToShape(el) {
  const type = el.tagName.toLowerCase();
  if (!['rect', 'ellipse', 'path', 'text'].includes(type)) return null;

  const attrs = {};
  const skipAttrs = new Set(['fill', 'stroke', 'stroke-width', 'data-id', 'style']);
  for (const { name, value } of el.attributes) {
    if (!skipAttrs.has(name) && !name.startsWith('data-')) attrs[name] = isNaN(value) ? value : Number(value);
  }

  const style = {
    fill: el.getAttribute('fill') || '#000000',
    stroke: el.getAttribute('stroke') || 'none',
    strokeWidth: parseFloat(el.getAttribute('stroke-width') || '1'),
  };

  const id = el.dataset.id || `s${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return { id, type, attrs, style };
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const esc = (s) => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
