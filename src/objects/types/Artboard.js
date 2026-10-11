import { DisplayObject } from '../DisplayObject.js';
import { Container }     from '../Container.js';
import { cloneShape, restoreShape } from '../../utils/snapshots.js';
import { nextId } from '../../core/state.js';

// ── Renderer ──────────────────────────────────────────────────────────────────

class ArtboardRenderer extends DisplayObject {
  get id() { return 'artboard'; }

  createShape(initAttrs) {
    return {
      id:    nextId('item'),
      type:  'artboard',
      name:  'Artboard',
      attrs: { x: 0, y: 0, width: 800, height: 600, ...initAttrs },
    };
  }

  draw() {}

  getBBox(shape) {
    const { x, y, width, height } = shape.attrs;
    return { x, y, width, height };
  }

  hitPart() { return null; }

  translate(shape, dx, dy) {
    shape.attrs.x = (shape.attrs.x ?? 0) + dx;
    shape.attrs.y = (shape.attrs.y ?? 0) + dy;
  }

  // Resizing the artboard canvas does not scale contents — no-op here.
  scale() {}
  bakeRotation() {}
  toSVGString() { return ''; }
  fromSVGElement() { return null; }
}

// ── Thin controller ───────────────────────────────────────────────────────────

const _renderer = new ArtboardRenderer();

export class Artboard extends Container {
  static id      = 'artboard';
  static label   = 'Artboard';
  static icon    = 'object-artboard';
  static renderer = _renderer;

  get typeId() { return 'artboard'; }
  get label()  { return 'Artboard'; }
  get icon()   { return 'object-artboard'; }

  constructor(shape) { super(shape); }
  _createDisplayObject() { return _renderer; }

  // Moving the artboard moves all contents with it.
  applyMove(dx, dy) {
    super.applyMove(dx, dy);  // translates rect + propagates to children
  }

  // Resizing the artboard does not move or resize its contents.
  applyScale(sx, sy, ox, oy, rotDisp) {
    if (!this._prev) return;
    restoreShape(this._shape, this._prev);
    this._displayObject.scale(this._shape, sx, sy, ox, oy);
  }

  // Artboards do not rotate.
  applyRotate(_delta, _rotCenter) {}
}
