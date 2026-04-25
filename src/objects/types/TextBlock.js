import { BaseObject } from '../BaseObject.js';
import { nextId } from '../../core/state.js';

// Cache for wrapText results — keyed by "text|fontSize|fontFamily|boxWidth"
const _wrapCache = new Map();
let   _measureCtx = null;

function getMeasureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

function wrapText(text, fontSize, fontFamily, boxWidth) {
  const key = `${text}|${fontSize}|${fontFamily}|${boxWidth}`;
  if (_wrapCache.has(key)) return _wrapCache.get(key);

  const ctx  = getMeasureCtx();
  ctx.font   = `${fontSize}px ${fontFamily}`;
  const words = text.split(' ');
  const lines = [];
  let   cur   = '';

  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > boxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  _wrapCache.set(key, lines);
  if (_wrapCache.size > 200) {
    // Evict oldest entry
    _wrapCache.delete(_wrapCache.keys().next().value);
  }
  return lines;
}

export class TextBlock extends BaseObject {
  get id()    { return 'text-block'; }
  get label() { return 'Text Block'; }
  get icon()  { return 'object-text-block'; }

  createShape(initAttrs, initStyle) {
    const shape = {
      id:           nextId(this.id),
      type:         'text-block',
      attrs:        { x: 0, y: 0, ...initAttrs },
      style:        { fill: '#000000', stroke: 'none', strokeWidth: 1, ...initStyle },
      _text:        initAttrs._text        ?? '',
      _fontSize:    initAttrs._fontSize    ?? 14,
      _fontFamily:  initAttrs._fontFamily  ?? 'sans-serif',
      _boxWidth:    initAttrs._boxWidth    ?? 200,
      _boxHeight:   initAttrs._boxHeight   ?? 100,
    };
    const bb = this.getBBox(shape);
    if (bb && (bb.width > 0 || bb.height > 0)) {
      shape._rotDisplay = {
        bbox:   bb,
        center: { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
        angle:  0,
      };
    }
    return shape;
  }

  // CanvasKit draw is a no-op — text is rendered by the Canvas 2D layer in renderer.js
  draw(_ckCanvas, _shape, _viewState) {}

  drawCanvas2D(ctx, shape) {
    const x    = shape.attrs.x   ?? 0;
    const y    = shape.attrs.y   ?? 0;
    const fs   = shape._fontSize   ?? 14;
    const ff   = shape._fontFamily ?? 'sans-serif';
    const bw   = shape._boxWidth   ?? 200;
    const bh   = shape._boxHeight  ?? 100;
    const lh   = fs * 1.3;
    const fill = shape.style.fill  ?? '#000000';

    const lines    = wrapText(shape._text ?? '', fs, ff, bw);
    const maxLines = Math.floor(bh / lh);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, bw, bh);
    ctx.clip();
    ctx.font         = `${fs}px ${ff}`;
    ctx.fillStyle    = fill;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      ctx.fillText(lines[i], x, y + fs + i * lh);
    }
    ctx.restore();
  }

  getBBox(shape) {
    return {
      x:      shape.attrs.x,
      y:      shape.attrs.y,
      width:  shape._boxWidth  ?? 200,
      height: shape._boxHeight ?? 100,
    };
  }

  hitPart(shape, docX, docY, zoom) {
    const bb  = this.getBBox(shape);
    const tol = 4 / zoom;
    if (docX >= bb.x - tol && docX <= bb.x + bb.width  + tol &&
        docY >= bb.y - tol && docY <= bb.y + bb.height + tol) {
      return { part: 'body' };
    }
    return null;
  }

  translate(shape, dx, dy) {
    shape.attrs.x += dx;
    shape.attrs.y += dy;
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.x    = ox + (shape.attrs.x - ox) * sx;
    shape.attrs.y    = oy + (shape.attrs.y - oy) * sy;
    shape._boxWidth  = (shape._boxWidth  ?? 200) * Math.abs(sx);
    shape._boxHeight = (shape._boxHeight ?? 100) * Math.abs(sy);
  }

  bakeRotation(shape, _angleDeg, _cx, _cy) {
    // Area text rotation not currently supported — no-op
  }

  toSVGString(shape, includeMetadata) {
    const s   = shape.style;
    const fs  = shape._fontSize   ?? 14;
    const ff  = shape._fontFamily ?? 'sans-serif';
    const bw  = shape._boxWidth   ?? 200;
    const bh  = shape._boxHeight  ?? 100;
    const lh  = fs * 1.3;
    const meta = includeMetadata ? ` data-id="${shape.id}" data-type="text-block" data-box-w="${bw}" data-box-h="${bh}"` : '';
    const lines  = wrapText(shape._text ?? '', fs, ff, bw);
    const maxLines = Math.floor(bh / lh);
    const tspans = lines.slice(0, maxLines).map((line, i) =>
      `<tspan x="${shape.attrs.x}" dy="${i === 0 ? fs : lh}">${_escapeXML(line)}</tspan>`
    ).join('');
    return `<text x="${shape.attrs.x}" y="${shape.attrs.y}" fill="${s.fill ?? '#000'}" font-size="${fs}" font-family="${ff}"${meta}>${tspans}</text>`;
  }

  fromSVGElement(el) {
    if (el.tagName !== 'text') return null;
    if (el.getAttribute('data-type') !== 'text-block') return null;
    const tspans = Array.from(el.querySelectorAll('tspan'));
    const text   = tspans.map(t => t.textContent).join(' ');
    return {
      id:          nextId(this.id),
      type:        'text-block',
      attrs:       { x: Number(el.getAttribute('x') ?? 0), y: Number(el.getAttribute('y') ?? 0) },
      style:       { fill: el.getAttribute('fill') ?? '#000000', stroke: 'none', strokeWidth: 1 },
      _text:       text,
      _fontSize:   Number(el.getAttribute('font-size')         ?? 14),
      _fontFamily: el.getAttribute('font-family')              ?? 'sans-serif',
      _boxWidth:   Number(el.getAttribute('data-box-w')        ?? 200),
      _boxHeight:  Number(el.getAttribute('data-box-h')        ?? 100),
    };
  }

  getWireframePoints(shape) {
    return [{ x: shape.attrs.x, y: shape.attrs.y }];
  }
}

function _escapeXML(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
