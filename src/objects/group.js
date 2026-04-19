import { ObjectType } from './base.js';
import { unionBBoxes } from '../geometry/bbox.js';

const NS = 'http://www.w3.org/2000/svg';

export class GroupObjectType extends ObjectType {
  get id()    { return 'group'; }
  get label() { return 'Group'; }
  get icon()  { return 'object-group'; }

  createShape(initAttrs, initStyle, nextId) {
    return {
      id:       nextId(),
      type:     'group',
      attrs:    { ...initAttrs },
      style:    { ...initStyle },
      children: initAttrs.children ?? [],
    };
  }

  makeElement(shape) {
    const el = document.createElementNS(NS, 'g');
    this.syncElement(el, shape, { mode: 'normal', zoom: 1 });
    return el;
  }

  syncElement(el, shape, _viewState) {
    el.removeAttribute('transform');
    // Child elements are managed by the renderer — group itself has no presentation attrs
  }

  getBBox(shape, el) {
    if (el) {
      try {
        const b = el.getBBox();
        if (b.width > 0 || b.height > 0) return b;
      } catch (_) {}
    }
    return null;
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
    // Groups store children as shape POJOs; renderer handles recursion
    // For flat translation we update a transform offset stored on the group
    shape.attrs.tx = (shape.attrs.tx ?? 0) + dx;
    shape.attrs.ty = (shape.attrs.ty ?? 0) + dy;
  }

  scale(shape, sx, sy, ox, oy) {
    shape.attrs.tx = ox + ((shape.attrs.tx ?? 0) - ox) * sx;
    shape.attrs.ty = oy + ((shape.attrs.ty ?? 0) - oy) * sy;
    // TODO: propagate to children via their ObjectTypes
  }

  bakeRotation(shape, _angleDeg, _cx, _cy) {
    // TODO: propagate to children
  }

  toSVGString(shape, includeMetadata) {
    const meta = includeMetadata ? ` data-id="${shape.id}"` : '';
    return `<g${meta}></g>`;
  }

  fromSVGElement(el, nextId) {
    if (el.tagName !== 'g') return null;
    return {
      id:       nextId(),
      type:     'group',
      attrs:    {},
      style:    {},
      children: [],
    };
  }
}
