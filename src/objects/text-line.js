import { ObjectType } from './base.js';

const NS = 'http://www.w3.org/2000/svg';

export class TextLineObjectType extends ObjectType {
  get id()    { return 'text-line'; }
  get label() { return 'Text'; }
  get icon()  { return 'object-text-line'; }

  createShape(initAttrs, initStyle, nextId) {
    return {
      id:           nextId(),
      type:         'text-line',
      attrs:        { x: 0, y: 0, ...initAttrs },
      style:        { fill: '#000000', stroke: 'none', strokeWidth: 1, ...initStyle },
      _text:        initAttrs._text        ?? '',
      _fontSize:    initAttrs._fontSize    ?? 14,
      _fontFamily:  initAttrs._fontFamily  ?? 'sans-serif',
    };
  }

  makeElement(shape) {
    const el = document.createElementNS(NS, 'text');
    this.syncElement(el, shape, { mode: 'normal', zoom: 1 });
    return el;
  }

  syncElement(el, shape, _viewState) {
    // SVG y is baseline; tspan carries the actual position
    el.setAttribute('x', shape.attrs.x);
    el.setAttribute('y', shape.attrs.y);
    el.setAttribute('fill',        shape.style.fill        ?? '#000000');
    el.setAttribute('font-size',   shape._fontSize         ?? 14);
    el.setAttribute('font-family', shape._fontFamily       ?? 'sans-serif');
    el.removeAttribute('transform');

    // Rebuild single tspan
    let tspan = el.querySelector('tspan');
    if (!tspan) {
      tspan = document.createElementNS(NS, 'tspan');
      el.appendChild(tspan);
    }
    tspan.setAttribute('x', shape.attrs.x);
    tspan.setAttribute('y', shape.attrs.y + (shape._fontSize ?? 14));
    tspan.textContent = shape._text ?? '';
  }

  getBBox(shape, el) {
    if (el) {
      try {
        const b = el.getBBox();
        if (b.width > 0 || b.height > 0) return b;
      } catch (_) {}
    }
    const fs = shape._fontSize ?? 14;
    const approxWidth = (shape._text ?? '').length * fs * 0.6;
    return {
      x:      shape.attrs.x,
      y:      shape.attrs.y,
      width:  approxWidth,
      height: fs * 1.3,
    };
  }

  hitPart(shape, docX, docY, zoom, el) {
    const bb = this.getBBox(shape, el);
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
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.x  = ox + (shape.attrs.x - ox) * sx;
    shape.attrs.y  = oy + (shape.attrs.y - oy) * sy;
    shape._fontSize = (shape._fontSize ?? 14) * Math.abs(sy);
  }

  bakeRotation(shape, _angleDeg, _cx, _cy) {
    // Text-line rotation is not currently supported — no-op
  }

  toSVGString(shape, includeMetadata) {
    const s   = shape.style;
    const fs  = shape._fontSize   ?? 14;
    const ff  = shape._fontFamily ?? 'sans-serif';
    const txt = _escapeXML(shape._text ?? '');
    const meta = includeMetadata ? ` data-id="${shape.id}" data-type="text-line"` : '';
    return `<text x="${shape.attrs.x}" y="${shape.attrs.y}" fill="${s.fill ?? '#000'}" font-size="${fs}" font-family="${ff}"${meta}><tspan x="${shape.attrs.x}" y="${shape.attrs.y + fs}">${txt}</tspan></text>`;
  }

  fromSVGElement(el, nextId) {
    if (el.tagName !== 'text') return null;
    if (el.getAttribute('data-type') === 'text-block') return null; // handled by TextBlockObjectType
    const tspan = el.querySelector('tspan');
    return {
      id:          nextId(),
      type:        'text-line',
      attrs:       { x: Number(el.getAttribute('x') ?? 0), y: Number(el.getAttribute('y') ?? 0) },
      style:       { fill: el.getAttribute('fill') ?? '#000000', stroke: 'none', strokeWidth: 1 },
      _text:       tspan ? tspan.textContent : el.textContent,
      _fontSize:   Number(el.getAttribute('font-size')   ?? 14),
      _fontFamily: el.getAttribute('font-family')        ?? 'sans-serif',
    };
  }

  getWireframePoints(shape) {
    return [{ x: shape.attrs.x, y: shape.attrs.y }];
  }
}

function _escapeXML(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
