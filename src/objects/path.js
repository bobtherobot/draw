import { ObjectType } from './base.js';
import { nextId } from '../core/state.js';
import { parsePathD, buildPathD } from '../geometry/path-utils.js';
import { translatePathD, scalePathD, rotatePathD } from '../geometry/transform.js';
import { getCK } from '../render/renderer.js';

const HIT_TOLERANCE = 4; // px in doc space (scaled by zoom below)

export class PathObjectType extends ObjectType {
  get id()    { return 'path'; }
  get label() { return 'Path'; }
  get icon()  { return 'object-path'; }

  draw(ckCanvas, shape, viewState) {
    const CK  = getCK();
    const { zoom } = viewState;
    const d   = shape.attrs.d ?? '';
    if (!d) return;

    const ckPath = CK.Path.MakeFromSVGString(d);
    if (!ckPath) return;

    const fill   = shape.style.fill   ?? 'none';
    const stroke = shape.style.stroke ?? 'none';

    if (fill !== 'none') {
      const paint = new CK.Paint();
      paint.setStyle(CK.PaintStyle.Fill);
      paint.setColor(CK.parseColorString(fill));
      paint.setAntiAlias(true);
      ckCanvas.drawPath(ckPath, paint);
      paint.delete();
    }
    if (stroke !== 'none') {
      const paint = new CK.Paint();
      paint.setStyle(CK.PaintStyle.Stroke);
      paint.setColor(CK.parseColorString(stroke));
      paint.setStrokeWidth((shape.style.strokeWidth ?? 1) / zoom);
      paint.setAntiAlias(true);
      ckCanvas.drawPath(ckPath, paint);
      paint.delete();
    }

    ckPath.delete();
  }

  getBBox(shape) {
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

  hitPart(shape, docX, docY, zoom) {
    const tol = HIT_TOLERANCE / zoom;
    const bb  = this.getBBox(shape);
    if (!bb) return null;
    // Cheap bbox pre-check
    if (docX < bb.x - tol || docX > bb.x + bb.width  + tol) return null;
    if (docY < bb.y - tol || docY > bb.y + bb.height + tol) return null;

    const segs = parsePathD(shape.attrs.d ?? '');
    if (!segs.length) return null;

    // Fill hit: use CanvasKit path.contains() (Skia winding-rule point-in-fill)
    const CK = getCK();
    if (CK) {
      const ckPath = CK.Path.MakeFromSVGString(shape.attrs.d ?? '');
      if (!ckPath) return { part: 'body' };
      const inFill = shape.style.fill !== 'none' && ckPath.contains(docX, docY);
      if (inFill) { ckPath.delete(); return { part: 'body' }; }
      // Stroke hit: widen path by tolerance and re-test
      if (shape.style.stroke !== 'none') {
        const sw = (shape.style.strokeWidth ?? 1) + tol * 2;
        const widened = ckPath.copy();
        // Stroke-to-fill conversion: check if docX,docY is in the stroke outline
        // Use OffscreenCanvas for stroke test as CanvasKit doesn't expose isPointInStroke
        try {
          const oc  = new OffscreenCanvas(1, 1);
          const oct = oc.getContext('2d');
          oct.beginPath();
          _replayPath2D(oct, segs);
          oct.lineWidth = sw;
          if (oct.isPointInStroke(docX, docY)) { widened.delete(); ckPath.delete(); return { part: 'body' }; }
        } catch (_) {
          widened.delete(); ckPath.delete(); return { part: 'body' };
        }
        widened.delete();
      }
      ckPath.delete();
      return null;
    }

    // Fallback (CK not ready): bbox hit
    return { part: 'body' };
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

// Replay path segments onto a Canvas 2D context (for stroke hit-testing only).
function _replayPath2D(ctx, segs) {
  for (const { cmd, args } of segs) {
    switch (cmd) {
      case 'M': ctx.moveTo(args[0], args[1]); break;
      case 'L': ctx.lineTo(args[0], args[1]); break;
      case 'C': ctx.bezierCurveTo(args[0], args[1], args[2], args[3], args[4], args[5]); break;
      case 'Z': ctx.closePath(); break;
    }
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
