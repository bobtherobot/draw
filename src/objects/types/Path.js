import { DisplayObject } from '../DisplayObject.js';
import { Container }     from '../Container.js';
import { nextId } from '../../core/state.js';
import { parsePathD, buildPathD } from '../../utils/geometry/path-utils.js';
import { translatePathD, scalePathD, rotatePathD, rotatePoint } from '../../utils/geometry/transform.js';
import { rotation, scaling, multiply, applyToPathD, syncTransform } from '../../utils/geometry/mat2d.js';
import { getCK } from '../../render/renderer.js';

const HIT_TOLERANCE = 4;

// ── Renderer ──────────────────────────────────────────────────────────────────

class PathRenderer extends DisplayObject {
  get id() { return 'path'; }

  createShape(initAttrs, initStyle) {
    const shape = super.createShape(initAttrs, initStyle);
    const bb = this.getBBox(shape);
    if (bb && (bb.width > 0 || bb.height > 0)) {
      shape._rotDisplay = {
        bbox:   bb,
        center: { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
        angle:  0,
      };
    }
    shape._transform = null;
    return shape;
  }

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
    return _localBBox(shape);
  }

  hitPart(shape, docX, docY, zoom) {
    const tol = HIT_TOLERANCE / zoom;
    const bb  = this.getBBox(shape);
    if (!bb) return null;
    if (docX < bb.x - tol || docX > bb.x + bb.width  + tol) return null;
    if (docY < bb.y - tol || docY > bb.y + bb.height + tol) return null;

    const segs = parsePathD(shape.attrs.d ?? '');
    if (!segs.length) return null;

    const CK = getCK();
    if (CK) {
      const ckPath = CK.Path.MakeFromSVGString(shape.attrs.d ?? '');
      if (!ckPath) return { part: 'body' };
      const inFill = shape.style.fill !== 'none' && ckPath.contains(docX, docY);
      if (inFill) { ckPath.delete(); return { part: 'body' }; }
      if (shape.style.stroke !== 'none') {
        const sw = (shape.style.strokeWidth ?? 1) + tol * 2;
        const widened = ckPath.copy();
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
      syncTransform(shape);
    }
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.d = scalePathD(shape.attrs.d ?? '', sx, sy, ox, oy);
    delete shape._rotDisplay;
    delete shape._transform;
  }

  applyScaleRotated(shape, sx, sy, ox, oy, rotDisp) {
    const { center: { x: cx, y: cy }, angle } = rotDisp;
    const m = multiply(multiply(rotation(angle, cx, cy), scaling(sx, sy, ox, oy)), rotation(-angle, cx, cy));
    shape.attrs.d = applyToPathD(m, shape.attrs.d);

    const shapeBB   = shape._rotDisplay?.bbox;
    const snapCtr   = shape._rotDisplay?.center ?? { x: cx, y: cy };
    const prevAngle = shape._rotDisplay?.angle ?? 0;
    if (shapeBB) {
      const scaledW  = shapeBB.width  * Math.abs(sx);
      const scaledH  = shapeBB.height * Math.abs(sy);
      const localC   = rotatePoint(snapCtr.x, snapCtr.y, cx, cy, -angle);
      const newLCx   = ox + (localC.x - ox) * sx;
      const newLCy   = oy + (localC.y - oy) * sy;
      const { x: visCx, y: visCy } = rotatePoint(newLCx, newLCy, cx, cy, angle);
      shape._rotDisplay = {
        bbox:   { x: visCx - scaledW / 2, y: visCy - scaledH / 2, width: scaledW, height: scaledH },
        center: { x: visCx, y: visCy },
        angle:  prevAngle,
      };
    } else {
      delete shape._rotDisplay;
    }
    syncTransform(shape);
    return true;
  }

  bakeRotation(shape, angleDeg, cx, cy) {
    const prevAngle = shape._rotDisplay?.angle ?? 0;
    const prevBBox  = shape._rotDisplay?.bbox  ?? this.getBBox(shape);

    const prevCx = prevBBox.x + prevBBox.width  / 2;
    const prevCy = prevBBox.y + prevBBox.height / 2;
    const { x: newCx, y: newCy } = rotatePoint(prevCx, prevCy, cx, cy, angleDeg);

    shape._rotDisplay = {
      bbox: {
        x:      newCx - prevBBox.width  / 2,
        y:      newCy - prevBBox.height / 2,
        width:  prevBBox.width,
        height: prevBBox.height,
      },
      center: { x: newCx, y: newCy },
      angle:  prevAngle + angleDeg,
    };
    shape.attrs.d = rotatePathD(shape.attrs.d ?? '', angleDeg, cx, cy);
    syncTransform(shape);
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

// ── Thin controller ───────────────────────────────────────────────────────────

const _renderer = new PathRenderer();

export class Path extends Container {
  static id      = 'path';
  static label   = 'Path';
  static icon    = 'object-path';
  static renderer = _renderer;

  get typeId() { return 'path'; }
  get label()  { return 'Path'; }
  get icon()   { return 'object-path'; }

  constructor(shape) { super(shape); }
  _createDisplayObject() { return _renderer; }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _localBBox(shape) {
  const segs = parsePathD(shape.attrs.d ?? '');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  let cx = 0, cy = 0;
  for (const { cmd, args } of segs) {
    switch (cmd) {
      case 'M':
        cx = args[0]; cy = args[1];
        expand(cx, cy);
        break;
      case 'L':
        cx = args[0]; cy = args[1];
        expand(cx, cy);
        break;
      case 'C': {
        const [x1, y1, x2, y2, x3, y3] = args;
        expand(cx, cy);
        expand(x3, y3);
        for (const t of _cubicExtrema(cx, x1, x2, x3))
          expand(_cubicAt(t, cx, x1, x2, x3), _cubicAt(t, cy, y1, y2, y3));
        for (const t of _cubicExtrema(cy, y1, y2, y3))
          expand(_cubicAt(t, cx, x1, x2, x3), _cubicAt(t, cy, y1, y2, y3));
        cx = x3; cy = y3;
        break;
      }
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

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

function _cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3*p1 - 3*p2 + p3;
  const b = 2*(p0 - 2*p1 + p2);
  const c = p1 - p0;
  const ts = [];
  if (Math.abs(a) < 1e-10) {
    if (Math.abs(b) > 1e-10) { const t = -c / b; if (t > 0 && t < 1) ts.push(t); }
  } else {
    const disc = b*b - 4*a*c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b + sq) / (2*a), (-b - sq) / (2*a)])
        if (t > 0 && t < 1) ts.push(t);
    }
  }
  return ts;
}

function _cubicAt(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}
