import { ObjectType } from './base.js';
import { nextId } from '../core/state.js';
import { parsePathD, buildPathD } from '../geometry/path-utils.js';
import { translatePathD, scalePathD, rotatePathD } from '../geometry/transform.js';

const NS = 'http://www.w3.org/2000/svg';
const HIT_TOLERANCE = 4; // px in doc space (scaled by zoom below)

export class PathObjectType extends ObjectType {
  get id()    { return 'path'; }
  get label() { return 'Path'; }
  get icon()  { return 'object-path'; }

  makeElement(shape) {
    const el = document.createElementNS(NS, 'path');
    this.syncElement(el, shape, { mode: 'normal', zoom: 1 });
    return el;
  }

  syncElement(el, shape, _viewState) {
    el.setAttribute('d', shape.attrs.d ?? '');
    el.setAttribute('fill',   shape.style.fill   ?? 'none');
    el.setAttribute('stroke', shape.style.stroke ?? 'none');
    el.setAttribute('stroke-width', shape.style.strokeWidth ?? 1);
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.removeAttribute('transform');
  }

  getBBox(shape, el) {
    if (el) {
      try {
        const b = el.getBBox();
        if (b.width > 0 || b.height > 0) return b;
      } catch (_) {}
    }
    // Fallback: scan path coordinates
    const segs = parsePathD(shape.attrs.d ?? '');
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { cmd, args } of segs) {
      const pairs = _coordPairs(cmd, args);
      for (const [x, y] of pairs) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  hitPart(shape, docX, docY, zoom, el) {
    if (!el) return null;
    const tol = HIT_TOLERANCE / zoom;
    const bb  = this.getBBox(shape, el);
    if (!bb) return null;
    // Expand bbox by tolerance for a cheap early-out
    if (docX < bb.x - tol || docX > bb.x + bb.width  + tol) return null;
    if (docY < bb.y - tol || docY > bb.y + bb.height + tol) return null;
    // Use SVG's own geometry: isPointInStroke / isPointInFill
    try {
      const svg  = el.ownerSVGElement;
      const pt   = svg.createSVGPoint();
      pt.x = docX; pt.y = docY;
      const fill   = shape.style.fill   !== 'none' && el.isPointInFill(pt);
      const stroke = shape.style.stroke !== 'none' && el.isPointInStroke(pt);
      if (fill || stroke) return { part: 'body' };
    } catch (_) {
      // Fallback: just use bbox
      if (docX >= bb.x - tol && docX <= bb.x + bb.width  + tol &&
          docY >= bb.y - tol && docY <= bb.y + bb.height + tol) {
        return { part: 'body' };
      }
    }
    return null;
  }

  translate(shape, dx, dy) {
    shape.attrs.d = translatePathD(shape.attrs.d ?? '', dx, dy);
    if (shape._rotDisplay) {
      const { bbox, center } = shape._rotDisplay;
      shape._rotDisplay = {
        ...shape._rotDisplay,
        bbox:   { ...bbox,   x: bbox.x + dx,      y: bbox.y + dy },
        center: { x: center.x + dx, y: center.y + dy },
      };
    }
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.d = scalePathD(shape.attrs.d ?? '', sx, sy, ox, oy);
    delete shape._rotDisplay;
  }

  bakeRotation(shape, angleDeg, cx, cy) {
    shape.attrs.d = rotatePathD(shape.attrs.d ?? '', angleDeg, cx, cy);
  }

  toSVGString(shape, includeMetadata) {
    const s = shape.style;
    const meta = includeMetadata ? ` data-id="${shape.id}"` : '';
    return `<path d="${shape.attrs.d ?? ''}" fill="${s.fill ?? 'none'}" stroke="${s.stroke ?? 'none'}" stroke-width="${s.strokeWidth ?? 1}"${meta}/>`;
  }

  fromSVGElement(el) {
    if (el.tagName !== 'path') return null;
    const d = el.getAttribute('d') ?? '';
    return {
      id:    nextId(this.id),
      type:  'path',
      attrs: { d },
      style: {
        fill:        el.getAttribute('fill')         ?? 'none',
        stroke:      el.getAttribute('stroke')       ?? 'none',
        strokeWidth: Number(el.getAttribute('stroke-width') ?? 1),
      },
    };
  }

  getWireframePoints(shape) {
    const segs = parsePathD(shape.attrs.d ?? '');
    const pts  = [];
    for (const { cmd, args } of segs) {
      if (cmd === 'M' || cmd === 'L') pts.push({ x: args[0], y: args[1] });
      else if (cmd === 'C')           pts.push({ x: args[4], y: args[5] });
    }
    return pts;
  }
}

// Helper: extract endpoint pairs from a path command
function _coordPairs(cmd, args) {
  switch (cmd) {
    case 'M': case 'L': return [[args[0], args[1]]];
    case 'C': return [[args[0],args[1]], [args[2],args[3]], [args[4],args[5]]];
    default:  return [];
  }
}
