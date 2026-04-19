import { state } from './state.js';
import { render } from './render.js';
import { fitToArtboard } from './viewport.js';
import { rectToPathD, ellipseToPathD } from './shapes/index.js';

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

  if (shape.type === 'text') {
    a += ` font-size="${shape._fontSize || 16}"`;
    a += ` font-family="${esc(shape._fontFamily || 'Arial, sans-serif')}"`;
    a += ` data-text="${esc(shape._text || '')}"`;
    if (shape._isArea) {
      a += ` data-is-area="true"`;
      a += ` data-box-width="${shape._boxWidth || 0}"`;
      a += ` data-box-height="${shape._boxHeight || 0}"`;
    }
    if (shape._scaleX != null && shape._scaleX !== 1) a += ` data-scale-x="${shape._scaleX}"`;
    if (shape._scaleY != null && shape._scaleY !== 1) a += ` data-scale-y="${shape._scaleY}"`;
    if (shape._rotation) {
      a += ` data-rotation="${shape._rotation}"`;
      a += ` data-rot-cx="${shape._rotCx || 0}"`;
      a += ` data-rot-cy="${shape._rotCy || 0}"`;
    }
  }

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
  const tag = el.tagName.toLowerCase();
  if (!['rect', 'ellipse', 'path', 'text'].includes(tag)) return null;

  const style = {
    fill:        el.getAttribute('fill')         || '#000000',
    stroke:      el.getAttribute('stroke')       || 'none',
    strokeWidth: parseFloat(el.getAttribute('stroke-width') || '1'),
  };
  const id = el.dataset.id || `s${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Convert legacy rect/ellipse elements to paths
  if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x')      || '0');
    const y = parseFloat(el.getAttribute('y')      || '0');
    const w = parseFloat(el.getAttribute('width')  || '0');
    const h = parseFloat(el.getAttribute('height') || '0');
    return { id, type: 'path', attrs: { d: rectToPathD(x, y, w, h) }, style };
  }
  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx') || '0');
    const cy = parseFloat(el.getAttribute('cy') || '0');
    const rx = parseFloat(el.getAttribute('rx') || '0');
    const ry = parseFloat(el.getAttribute('ry') || '0');
    return { id, type: 'path', attrs: { d: ellipseToPathD(cx, cy, rx, ry) }, style };
  }

  const skipAttrs = new Set(['fill', 'stroke', 'stroke-width', 'data-id', 'style', 'font-size', 'font-family']);
  const attrs = {};
  for (const { name, value } of el.attributes) {
    if (!skipAttrs.has(name) && !name.startsWith('data-')) attrs[name] = isNaN(value) ? value : Number(value);
  }

  if (tag === 'text') {
    const shape = { id, type: 'text', attrs, style };
    shape._text       = el.dataset.text       || '';
    shape._fontSize   = parseFloat(el.getAttribute('font-size') || '16');
    shape._fontFamily = el.getAttribute('font-family') || 'Arial, sans-serif';
    shape._isArea     = el.dataset.isArea === 'true';
    if (shape._isArea) {
      shape._boxWidth  = parseFloat(el.dataset.boxWidth  || '0');
      shape._boxHeight = parseFloat(el.dataset.boxHeight || '0');
    }
    if (el.dataset.scaleX)    shape._scaleX    = parseFloat(el.dataset.scaleX);
    if (el.dataset.scaleY)    shape._scaleY    = parseFloat(el.dataset.scaleY);
    if (el.dataset.rotation) {
      shape._rotation = parseFloat(el.dataset.rotation);
      shape._rotCx    = parseFloat(el.dataset.rotCx || '0');
      shape._rotCy    = parseFloat(el.dataset.rotCy || '0');
    }
    return shape;
  }

  return { id, type: tag, attrs, style };
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const esc = (s) => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
