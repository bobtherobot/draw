import { DisplayObject } from '../DisplayObject.js';
import { Container }     from '../Container.js';
import { nextId } from '../../core/state.js';
import { localToWorld, worldToLocal, rotatePoint } from '../../utils/geometry/transform.js';
import { rotation, syncTransform, transformBBox } from '../../utils/geometry/mat2d.js';

// ── Renderer ──────────────────────────────────────────────────────────────────

class GroupRenderer extends DisplayObject {
  get id() { return 'group'; }

  createShape(initAttrs, initStyle) {
    return {
      id:         nextId(this.id),
      type:       'group',
      attrs:      { x: 0, y: 0, width: 0, height: 0, ...initAttrs },
      style:      { ...initStyle },
      _transform: null,
    };
  }

  draw() {}

  getBBox(shape) {
    const { x, y, width, height } = shape.attrs ?? {};
    if (x == null) return null;
    if (!shape._transform) return { x, y, width, height };
    return transformBBox(shape._transform, { x, y, width, height });
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
    if (shape._rotDisplay) {
      const { bbox, center } = shape._rotDisplay;
      shape._rotDisplay = {
        ...shape._rotDisplay,
        bbox:   { ...bbox, x: bbox.x + dx, y: bbox.y + dy },
        center: { x: center.x + dx, y: center.y + dy },
      };
      syncTransform(shape);
    }
  }

  scale(shape, sx, sy, ox, oy) {
    if (!shape._rotDisplay) {
      // No rotation — world space and local space are aligned, simple scale.
      shape.attrs.x      = ox + (shape.attrs.x - ox) * sx;
      shape.attrs.y      = oy + (shape.attrs.y - oy) * sy;
      shape.attrs.width  *= Math.abs(sx);
      shape.attrs.height *= Math.abs(sy);
      return;
    }

    // Rotated group: world-space scale shears the rect into a parallelogram.
    // Project each corner through the world-space scale, then back into the
    // group's local frame at the ORIGINAL angle. This keeps newW/newH as
    // smooth continuous functions of sx/sy — no angle update, no branching,
    // no crossover discontinuities during a drag.
    const { center: { x: cx, y: cy }, angle: angleDeg } = shape._rotDisplay;
    const hw = shape.attrs.width  / 2;
    const hh = shape.attrs.height / 2;
    const worldCorners = [
      localToWorld(-hw, -hh, cx, cy, angleDeg),
      localToWorld( hw, -hh, cx, cy, angleDeg),
      localToWorld( hw,  hh, cx, cy, angleDeg),
      localToWorld(-hw,  hh, cx, cy, angleDeg),
    ];

    const newCx = ox + (cx - ox) * sx;
    const newCy = oy + (cy - oy) * sy;

    const local = worldCorners.map(({ x, y }) => worldToLocal(
      ox + (x - ox) * sx,
      oy + (y - oy) * sy,
      newCx, newCy, angleDeg,
    ));

    // Due to input symmetry the bounding rect is always centred at (0,0).
    const lMaxX = Math.max(...local.map(p => Math.abs(p.x)));
    const lMaxY = Math.max(...local.map(p => Math.abs(p.y)));

    shape.attrs.x      = newCx - lMaxX;
    shape.attrs.y      = newCy - lMaxY;
    shape.attrs.width  = lMaxX * 2;
    shape.attrs.height = lMaxY * 2;
    // angle is intentionally not updated — syncRotDisplay preserves it.
  }

  bakeRotation(shape, angle, cx, cy) {
    // Read prevBBox from _rotDisplay (or current attrs) BEFORE updating attrs —
    // same ordering as PathRenderer.bakeRotation, which reads getBBox before mutating attrs.d.
    const prevAngle = shape._rotDisplay?.angle ?? 0;
    const prevBBox  = shape._rotDisplay?.bbox  ?? { x: shape.attrs.x, y: shape.attrs.y, width: shape.attrs.width, height: shape.attrs.height };
    const prevCx    = prevBBox.x + prevBBox.width  / 2;
    const prevCy    = prevBBox.y + prevBBox.height / 2;
    const { x: newCx, y: newCy } = rotatePoint(prevCx, prevCy, cx, cy, angle);

    shape.attrs.x = newCx - shape.attrs.width  / 2;
    shape.attrs.y = newCy - shape.attrs.height / 2;
    shape._rotDisplay = {
      bbox:   { x: newCx - prevBBox.width / 2, y: newCy - prevBBox.height / 2, width: prevBBox.width, height: prevBBox.height },
      center: { x: newCx, y: newCy },
      angle:  prevAngle + angle,
    };
    syncTransform(shape);
  }

  syncRotDisplay(shape) {
    if (!shape._rotDisplay) return;
    const { x, y, width, height } = shape.attrs;
    const cx = x + width  / 2;
    const cy = y + height / 2;
    shape._rotDisplay = {
      bbox:   { x, y, width, height },
      center: { x: cx, y: cy },
      angle:  shape._rotDisplay.angle,
    };
    syncTransform(shape);
  }

  applyScaleRotated(shape, sx, sy, ox, oy, rotDisp) {
    const { center: { x: cx, y: cy }, angle } = rotDisp;
    const midX = shape.attrs.x + shape.attrs.width  / 2;
    const midY = shape.attrs.y + shape.attrs.height / 2;
    const local  = rotatePoint(midX, midY, cx, cy, -angle);
    const scaled = { x: ox + (local.x - ox) * sx, y: oy + (local.y - oy) * sy };
    const newMid = rotatePoint(scaled.x, scaled.y, cx, cy, angle);
    shape.attrs.width  *= Math.abs(sx);
    shape.attrs.height *= Math.abs(sy);
    shape.attrs.x = newMid.x - shape.attrs.width  / 2;
    shape.attrs.y = newMid.y - shape.attrs.height / 2;

    const shapeBB   = shape._rotDisplay?.bbox;
    const snapCtr   = shape._rotDisplay?.center ?? { x: cx, y: cy };
    const prevAngle = shape._rotDisplay?.angle  ?? 0;
    if (shapeBB) {
      const scaledW = shapeBB.width  * Math.abs(sx);
      const scaledH = shapeBB.height * Math.abs(sy);
      const localC  = rotatePoint(snapCtr.x, snapCtr.y, cx, cy, -angle);
      const newLCx  = ox + (localC.x - ox) * sx;
      const newLCy  = oy + (localC.y - oy) * sy;
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

  toSVGString(shape, includeMetadata) {
    const meta = includeMetadata ? ` data-id="${shape.id}"` : '';
    return `<g${meta}></g>`;
  }

  fromSVGElement(el) {
    if (el.tagName !== 'g') return null;
    return {
      id:    nextId(this.id),
      type:  'group',
      attrs: {},
      style: {},
    };
  }
}

// ── Normalize ─────────────────────────────────────────────────────────────────

/**
 * Recompute a group's attrs as the AABB of all its children, then clear
 * _rotDisplay and _transform. Call this when the group leaves the selection
 * so the overlay is a clean axis-aligned rect on the next selection.
 *
 * Depth-first: nested groups are normalized before the parent so the parent's
 * AABB is computed from already-corrected child bounds.
 */
export function normalizeGroup(container) {
  for (const child of container.children) {
    if (child.shape.type === 'group') normalizeGroup(child);
  }
  const bboxes = container.children
    .map(c => c.displayObject.getBBox(c.shape))
    .filter(Boolean);
  if (bboxes.length === 0) return;
  const minX = Math.min(...bboxes.map(b => b.x));
  const minY = Math.min(...bboxes.map(b => b.y));
  const maxX = Math.max(...bboxes.map(b => b.x + b.width));
  const maxY = Math.max(...bboxes.map(b => b.y + b.height));
  const shape = container.shape;
  shape.attrs.x      = minX;
  shape.attrs.y      = minY;
  shape.attrs.width  = maxX - minX;
  shape.attrs.height = maxY - minY;
  delete shape._rotDisplay;
  shape._transform = null;
}

// ── Thin controller ───────────────────────────────────────────────────────────

const _renderer = new GroupRenderer();

export class Group extends Container {
  static id      = 'group';
  static label   = 'Group';
  static icon    = 'object-group';
  static renderer = _renderer;

  get typeId() { return 'group'; }
  get label()  { return 'Group'; }
  get icon()   { return 'object-group'; }

  constructor(shape) { super(shape); }
  _createDisplayObject() { return _renderer; }
}
