import { Mode } from './base.js';

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
}
