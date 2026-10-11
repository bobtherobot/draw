import { BaseTool } from './BaseTool.js';

const _canvas = () => document.getElementById('canvas');

export class Hand extends BaseTool {
  get id()       { return 'hand'; }
  get label()    { return 'Hand'; }
  get shortcut() { return 'h'; }
  get icon()     { return 'hand'; }

  activate() {
    this._dragging = false;
    this._anchor   = null;
    this._vpSnap   = null;
    _canvas()?.style.setProperty('cursor', 'grab');
  }

  deactivate() {
    this._dragging = false;
    _canvas()?.style.removeProperty('cursor');
  }

  onMouseDown(e) {
    this._dragging = true;
    this._anchor   = { x: e.clientX, y: e.clientY };
    this._vpSnap   = { ...this._ctx.state.viewport };
    _canvas()?.style.setProperty('cursor', 'grabbing');
  }

  onMouseMove(e) {
    if (!this._dragging) return;
    const z = this._vpSnap.zoom;
    this._ctx.state.viewport.x = this._vpSnap.x - (e.clientX - this._anchor.x) / z;
    this._ctx.state.viewport.y = this._vpSnap.y - (e.clientY - this._anchor.y) / z;
    this._ctx.render();
  }

  onMouseUp() {
    this._dragging = false;
    _canvas()?.style.setProperty('cursor', 'grab');
  }
}
