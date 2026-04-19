import { registerMode } from '../core/registry.js';
import { NormalMode }    from './normal.js';
import { WireframeMode } from './wireframe.js';

registerMode(new NormalMode());
registerMode(new WireframeMode());
