import { BaseObject } from '../BaseObject.js';
import { nextId } from '../../core/state.js';

export class Artboard extends BaseObject {
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
