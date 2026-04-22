import { ObjectType } from './base.js';
import { nextId } from '../core/state.js';
import { rotatePoint } from '../geometry/path-utils.js';

// ── Canvas measurement ────────────────────────────────────────────────────────

let _measureCtx = null;
function _getMeasureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  return _measureCtx;
}

export function measureTextWidth(text, fontSize, fontFamily) {
  if (!text) return 0;
  const ctx = _getMeasureCtx();
  ctx.font = `${fontSize}px ${fontFamily}`;
  let maxW = 0;
  for (const line of text.split('\n'))
    maxW = Math.max(maxW, ctx.measureText(line).width);
  return maxW;
}

// ── ObjectType ────────────────────────────────────────────────────────────────

export class FreeTextObjectType extends ObjectType {
  get id()    { return 'free-text'; }
  get label() { return 'Text'; }
  get icon()  { return 'object-free-text'; }

  createShape(initAttrs, initStyle) {
    return {
      id:          nextId(this.id),
      type:        'free-text',
      attrs:       { x: 0, y: 0, ...initAttrs },
      style:       { fill: '#000000', stroke: 'none', strokeWidth: 1, ...initStyle },
      _text:       initAttrs._text       ?? '',
      _fontSize:   initAttrs._fontSize   ?? 14,
      _fontFamily: initAttrs._fontFamily ?? 'sans-serif',
      _textAlign:  initAttrs._textAlign  ?? 'left',
    };
  }

  // CanvasKit draw is a no-op — text is rendered by the Canvas 2D layer in renderer.js
  draw(_ckCanvas, _shape, _viewState) {}

  drawCanvas2D(ctx, shape) {
    const x        = shape.attrs.x   ?? 0;
    const y        = shape.attrs.y   ?? 0;
    const fs       = shape._fontSize   ?? 14;
    const ff       = shape._fontFamily ?? 'sans-serif';
    const lh       = fs * 1.3;
    const align    = shape._textAlign  ?? 'left';
    const fill     = shape.style.fill  ?? '#000000';
    const scaleX   = shape._scaleX    ?? 1;
    const scaleY   = shape._scaleY    ?? 1;
    const rotation = shape._rotation  ?? 0;
    const rotCx    = shape._rotCx     ?? x;
    const rotCy    = shape._rotCy     ?? (y + fs);

    ctx.save();
    if (rotation !== 0) {
      ctx.translate(rotCx, rotCy);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-rotCx, -rotCy);
    }
    if (scaleX !== 1 || scaleY !== 1) {
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-x, -y);
    }
    ctx.font         = `${fs}px ${ff}`;
    ctx.fillStyle    = fill;
    ctx.textAlign    = align;
    ctx.textBaseline = 'alphabetic';
    const lines = (shape._text ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i] || '', x, y + fs + i * lh);
    }
    ctx.restore();
  }

  getBBox(shape) {
    const rotation = shape._rotation ?? 0;
    const fs    = shape._fontSize   ?? 14;
    const ff    = shape._fontFamily ?? 'sans-serif';
    const lines = (shape._text ?? '').split('\n');
    const lh    = fs * 1.3;
    const sx    = Math.abs(shape._scaleX ?? 1);
    const sy    = Math.abs(shape._scaleY ?? 1);
    const maxW  = measureTextWidth(shape._text ?? '', fs, ff) * sx;
    const align = shape._textAlign ?? 'left';
    const bx    = align === 'center' ? shape.attrs.x - maxW / 2
                : align === 'right'  ? shape.attrs.x - maxW
                :                      shape.attrs.x;
    const by    = shape.attrs.y;
    const bw    = maxW;
    const bh    = lh * lines.length * sy;

    if (rotation === 0) return { x: bx, y: by, width: bw, height: bh };

    // Rotate all 4 corners and return the axis-aligned bounding box.
    const rcx = shape._rotCx ?? shape.attrs.x;
    const rcy = shape._rotCy ?? (shape.attrs.y + fs);
    const corners = [
      { x: bx,      y: by },
      { x: bx + bw, y: by },
      { x: bx + bw, y: by + bh },
      { x: bx,      y: by + bh },
    ];
    const rotated = corners.map(p => rotatePoint(p.x, p.y, rcx, rcy, rotation));
    const xs = rotated.map(p => p.x);
    const ys = rotated.map(p => p.y);
    return {
      x:      Math.min(...xs),
      y:      Math.min(...ys),
      width:  Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  hitPart(shape, docX, docY, zoom) {
    const bb = this.getBBox(shape);
    if (!bb) return null;
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
    if (shape._rotCx != null) { shape._rotCx += dx; shape._rotCy += dy; }
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.x = ox + (shape.attrs.x - ox) * sx;
    shape.attrs.y = oy + (shape.attrs.y - oy) * sy;
    shape._scaleX = (shape._scaleX ?? 1) * sx;
    shape._scaleY = (shape._scaleY ?? 1) * sy;
    if (shape._rotCx != null) {
      shape._rotCx = ox + (shape._rotCx - ox) * sx;
      shape._rotCy = oy + (shape._rotCy - oy) * sy;
    }
  }

  bakeRotation(shape, angleDeg, cx, cy) {
    shape._rotation = (shape._rotation ?? 0) + angleDeg;
    shape._rotCx    = cx;
    shape._rotCy    = cy;
  }

  toSVGString(shape, includeMetadata) {
    const s   = shape.style;
    const fs  = shape._fontSize   ?? 14;
    const ff  = shape._fontFamily ?? 'sans-serif';
    const lh  = fs * 1.3;
    const x   = shape.attrs.x;
    const y   = shape.attrs.y;
    const meta = includeMetadata ? ` data-id="${shape.id}" data-type="free-text"` : '';

    const scaleX   = shape._scaleX   ?? 1;
    const scaleY   = shape._scaleY   ?? 1;
    const rotation = shape._rotation ?? 0;
    const rotCx    = shape._rotCx    ?? x;
    const rotCy    = shape._rotCy    ?? (y + fs);
    let transformAttr = '';
    if (rotation !== 0 || scaleX !== 1 || scaleY !== 1) {
      let t = '';
      if (rotation !== 0)
        t += `rotate(${rotation},${rotCx},${rotCy}) `;
      if (scaleX !== 1 || scaleY !== 1)
        t += `translate(${x * (1 - scaleX)},${y * (1 - scaleY)}) scale(${scaleX},${scaleY})`;
      transformAttr = ` transform="${t.trim()}"`;
    }

    const lines  = (shape._text ?? '').split('\n');
    const tspans = lines.map((line, i) => {
      const pos = i === 0 ? ` y="${y + fs}"` : ` dy="${lh}"`;
      return `<tspan x="${x}"${pos}>${_escapeXML(line)}</tspan>`;
    }).join('');

    const anchor = _anchorFor(shape._textAlign);
    return `<text fill="${s.fill ?? '#000'}" font-size="${fs}" font-family="${ff}" text-anchor="${anchor}"${transformAttr}${meta}>${tspans}</text>`;
  }

  fromSVGElement(el) {
    if (el.tagName !== 'text') return null;
    if (el.getAttribute('data-type') === 'text-block') return null;
    const tspans   = Array.from(el.querySelectorAll('tspan'));
    const fs       = Number(el.getAttribute('font-size') ?? 14);
    const firstY   = Number(tspans[0]?.getAttribute('y') ?? fs);
    // tspan[0].y = attrs.y + fontSize  →  attrs.y = firstY - fontSize
    const x        = Number(tspans[0]?.getAttribute('x') ?? el.getAttribute('x') ?? 0);
    const y        = firstY - fs;
    const text     = tspans.length > 0
      ? tspans.map(t => t.textContent.replace(' ', '')).join('\n')
      : (el.textContent ?? '');
    return {
      id:          nextId(this.id),
      type:        'free-text',
      attrs:       { x, y },
      style:       { fill: el.getAttribute('fill') ?? '#000000', stroke: 'none', strokeWidth: 1 },
      _text:       text,
      _fontSize:   fs,
      _fontFamily: el.getAttribute('font-family') ?? 'sans-serif',
      _textAlign:  _alignFor(el.getAttribute('text-anchor')),
    };
  }

  getWireframePoints(shape) {
    return [{ x: shape.attrs.x, y: shape.attrs.y }];
  }
}

function _anchorFor(align) {
  if (align === 'center') return 'middle';
  if (align === 'right')  return 'end';
  return 'start';
}

function _alignFor(anchor) {
  if (anchor === 'middle') return 'center';
  if (anchor === 'end')    return 'right';
  return 'left';
}

function _escapeXML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
