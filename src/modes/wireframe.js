import { Mode } from './base.js';
import { effectiveVisible } from '../core/state.js';

const WIREFRAME_STROKE = '#4a9eff';
const WIREFRAME_WIDTH  = 1;

export class WireframeMode extends Mode {
  get id()    { return 'wireframe'; }
  get label() { return 'Wireframe'; }

  resolveStyle(shape, _state) {
    return {
      fill:        'none',
      stroke:      WIREFRAME_STROKE,
      strokeWidth: WIREFRAME_WIDTH,
    };
  }

  afterRender({ state, getObjectType, getElement }) {
    // Wireframe node dots are rendered into the overlay by the renderer
    // when mode === 'wireframe'. The renderer calls this after the main pass.
    const overlayEl = document.getElementById('overlay');
    if (!overlayEl) return;

    // Remove old wireframe node dots
    for (const el of overlayEl.querySelectorAll('.wireframe-node')) el.remove();

    const NS = 'http://www.w3.org/2000/svg';
    const r  = 3 / state.viewport.zoom;

    for (const layer of state.layers) {
      if (!effectiveVisible(layer)) continue;
      for (const shape of layer.shapes) {
        const ot = getObjectType(shape.type);
        if (!ot) continue;
        const pts = ot.getWireframePoints(shape);
        for (const { x, y } of pts) {
          const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('cx', x);
          dot.setAttribute('cy', y);
          dot.setAttribute('r',  r);
          dot.classList.add('wireframe-node');
          overlayEl.appendChild(dot);
        }
      }
    }
  }
}
