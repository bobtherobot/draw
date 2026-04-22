import { ObjectType } from './base.js';
import { nextId } from '../core/state.js';

export class ArtboardObjectType extends ObjectType {
  get id()    { return 'artboard'; }
  get label() { return 'Artboard'; }
  get icon()  { return 'object-artboard'; }

  createShape(initAttrs) {
    return {
      id:    nextId('item'),
      type:  'artboard',
      name:  'Artboard',
      attrs: { x: 0, y: 0, width: 800, height: 600, ...initAttrs },
    };
  }

  draw() { /* renderer handles artboard backgrounds and clipping directly */ }

  makeElement() {
    // Artboards render as container <g>s; the renderer handles them specially.
    const NS = 'http://www.w3.org/2000/svg';
    return document.createElementNS(NS, 'g');
  }

  syncElement(el) {
    el.removeAttribute('transform');
  }

  getBBox(shape) {
    const { x, y, width, height } = shape.attrs;
    return { x, y, width, height };
  }

  hitPart() { return null; }
  translate() {}
  scale() {}
  bakeRotation() {}

  toSVGString() { return ''; }
  fromSVGElement() { return null; }
}
