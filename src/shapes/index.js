import { nextId } from '../state.js';

const NS = 'http://www.w3.org/2000/svg';

export function createShape(type, attrs, style) {
  return { id: nextId(), type, attrs: { ...attrs }, style: { ...style } };
}

export function makeElement(shape) {
  const tag = shape.type === 'group' ? 'g' : shape.type;
  const el = document.createElementNS(NS, tag);
  el.dataset.shapeId = shape.id;
  syncElement(el, shape);
  return el;
}

export function syncElement(el, shape) {
  if (shape.type === 'text') { syncTextElement(el, shape); return; }

  // Remove stale attrs not in shape.attrs
  for (const { name } of [...el.attributes]) {
    if (name === 'data-shape-id') continue;
    if (name !== 'fill' && name !== 'stroke' && name !== 'stroke-width' && !(name in shape.attrs))
      el.removeAttribute(name);
  }
  for (const [k, v] of Object.entries(shape.attrs))
    el.setAttribute(k, String(v));

  el.setAttribute('fill', shape.style.fill);
  el.setAttribute('stroke', shape.style.stroke);
  el.setAttribute('stroke-width', shape.style.strokeWidth);
}

// ── Text rendering ─────────────────────────────────────────────

function syncTextElement(el, shape) {
  const x          = +(shape.attrs.x  ?? 0);
  const y          = +(shape.attrs.y  ?? 0);
  const fontSize   = +(shape._fontSize  ?? 16);
  const fontFamily =   shape._fontFamily ?? 'Arial, sans-serif';
  const text       =   shape._text       ?? '';
  const lineH      = fontSize * 1.3;

  // Clear child tspans
  while (el.firstChild) el.removeChild(el.firstChild);

  el.setAttribute('font-size',   fontSize);
  el.setAttribute('font-family', fontFamily);
  el.setAttribute('fill', shape.style.fill === 'none' ? '#000000' : (shape.style.fill || '#000000'));
  el.removeAttribute('stroke');
  el.removeAttribute('stroke-width');
  el.removeAttribute('x');
  el.removeAttribute('y');

  const lines = (shape._isArea && shape._boxWidth)
    ? wrapText(text, shape._boxWidth, fontSize, fontFamily)
    : text.split('\n');

  const boxBottom = (shape._isArea && shape._boxHeight != null)
    ? y + shape._boxHeight
    : Infinity;

  let firstLine = true;
  for (let i = 0; i < lines.length; i++) {
    const baselineY = y + fontSize + i * lineH;
    if (baselineY > boxBottom) break; // clip at box bottom
    const tspan = document.createElementNS(NS, 'tspan');
    tspan.setAttribute('x', x);
    if (firstLine) { tspan.setAttribute('y', baselineY); firstLine = false; }
    else           { tspan.setAttribute('dy', lineH); }
    tspan.textContent = lines[i] || '\u00A0';
    el.appendChild(tspan);
  }
}

let _ctx2d = null;
function getCtx() {
  if (!_ctx2d) _ctx2d = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  return _ctx2d;
}

const _wrapCache = new Map();

function wrapText(text, maxWidth, fontSize, fontFamily) {
  const key = `${text}|${maxWidth}|${fontSize}|${fontFamily}`;
  if (_wrapCache.has(key)) return _wrapCache.get(key);
  const ctx = getCtx();
  ctx.font = `${fontSize}px ${fontFamily}`;
  const result = [];
  for (const para of text.split('\n')) {
    if (!para) { result.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) result.push(line);
  }
  const out = result.length ? result : [''];
  _wrapCache.set(key, out);
  if (_wrapCache.size > 500) _wrapCache.clear();
  return out;
}

export function getBBox(shape) {
  const el = document.querySelector(`[data-shape-id="${shape.id}"]`);
  if (!el) return null;
  try { return el.getBBox(); } catch { return null; }
}

// Translate a shape by (dx, dy) in document units
export function translateShape(shape, dx, dy) {
  const a = shape.attrs;
  if (shape.type === 'rect')    { a.x = (a.x || 0) + dx; a.y = (a.y || 0) + dy; }
  if (shape.type === 'ellipse') { a.cx = (a.cx || 0) + dx; a.cy = (a.cy || 0) + dy; }
  if (shape.type === 'text')    { a.x = (a.x || 0) + dx; a.y = (a.y || 0) + dy; }
  if (shape.type === 'path') {
    // Shift all coordinate values in the path `d` attribute
    a.d = shiftPathD(a.d, dx, dy);
  }
}

function shiftPathD(d, dx, dy) {
  // Parse SVG path commands and shift absolute coordinates
  // We store paths using only absolute M, L, C, Z
  return d.replace(/([MLHVCSQTAZ])\s*([-\d.,\s]*)/gi, (match, cmd, args) => {
    if (cmd === 'Z' || cmd === 'z') return cmd;
    const nums = args.trim().split(/[\s,]+/).map(Number);
    const shifted = [];
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i < nums.length; i += 2)
        shifted.push(nums[i] + dx, nums[i+1] + dy);
    } else if (cmd === 'C') {
      for (let i = 0; i < nums.length; i += 6)
        shifted.push(
          nums[i]+dx, nums[i+1]+dy,
          nums[i+2]+dx, nums[i+3]+dy,
          nums[i+4]+dx, nums[i+5]+dy,
        );
    } else {
      shifted.push(...nums);
    }
    return cmd + shifted.join(' ');
  });
}
