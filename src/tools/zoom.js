import { Tool } from './base.js';
import { zoomAt } from '../viewport.js';

export class ZoomTool extends Tool {
  get id()       { return 'zoom'; }
  get label()    { return 'Zoom'; }
  get shortcut() { return 'z'; }
  get icon()     { return 'zoom'; }

  onMouseDown(e) {
    if (e.button !== 0) return;
    const factor = e.altKey ? 1 / 1.5 : 1.5;
    zoomAt(factor, e.clientX, e.clientY);
  }

  onMouseMove(_e) {}
}
