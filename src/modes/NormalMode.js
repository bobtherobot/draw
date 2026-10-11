import { Mode } from './Mode.js';

export class NormalMode extends Mode {
  get id()    { return 'normal'; }
  get label() { return 'Normal'; }
  // resolveStyle returns null → shapes render with their own style as-is
}
