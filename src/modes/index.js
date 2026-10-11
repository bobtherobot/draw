import { registerMode } from '../core/registry.js';
import { NormalMode }    from './NormalMode.js';
import { WireframeMode } from './WireframeMode.js';

registerMode(new NormalMode());
registerMode(new WireframeMode());
