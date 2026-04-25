import { BaseObject } from '../BaseObject.js';
import { nextId } from '../../core/state.js';
import { unionBBoxes } from '../../utils/geometry/bbox.js';

export class Group extends BaseObject {
  get id()    { return 'group'; }
  get label() { return 'Group'; }
  get icon()  { return 'object-group'; }

  createShape(initAttrs, initStyle) {
    return {
      id:    nextId(this.id),
      type:  'group',
      attrs: { ...initAttrs },
      style: { ...initStyle },
    };
  }

  draw() { /* renderer handles group recursion directly */ }

  getBBox(_shape) { return null; }

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
    // Groups store children as shape POJOs; renderer handles recursion
    // For flat translation we update a transform offset stored on the group
    shape.attrs.tx = (shape.attrs.tx ?? 0) + dx;
    shape.attrs.ty = (shape.attrs.ty ?? 0) + dy;
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.tx = ox + ((shape.attrs.tx ?? 0) - ox) * sx;
    shape.attrs.ty = oy + ((shape.attrs.ty ?? 0) - oy) * sy;
    // TODO: propagate to children via their BaseObjects
  }

  bakeRotation(shape, _angleDeg, _cx, _cy) {
    // TODO: propagate to children
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
