import { BaseTool } from './BaseTool.js';
import { zoomAt } from '../core/Viewport.js';

export class Zoom extends BaseTool {
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
