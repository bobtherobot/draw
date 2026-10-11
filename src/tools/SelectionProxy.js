/**
 * SelectionProxy — thin in-memory wrapper over the current selection's Controllers.
 *
 * Rebuilds from a Set<id> on demand and delegates beginOp / applyX / commitOp
 * to each selected Container.  Not persisted; invisible to ShapeRegistry.
 */
import { getController } from '../core/shape-registry.js';

export class SelectionProxy {
  constructor() {
    this._children = [];
  }

  /** Rebuild the child list from a selection Set<id>. Call before beginOp(). */
  rebuild(selectionSet) {
    this._children = [...selectionSet].map(id => getController(id)).filter(Boolean);
  }

  beginOp() {
    for (const c of this._children) c.beginOp();
  }

  applyMove(dx, dy) {
    for (const c of this._children) c.applyMove(dx, dy);
  }

  applyScale(sx, sy, ox, oy, rotDisp) {
    for (const c of this._children) c.applyScale(sx, sy, ox, oy, rotDisp);
  }

  applyRotate(delta, rotCenter) {
    for (const c of this._children) c.applyRotate(delta, rotCenter);
  }

  applyMoveOrigin(pos) {
    for (const c of this._children) c.applyMoveOrigin(pos);
  }

  /** Collect {id, pre, post} entries from all children. */
  commitOp() {
    const entries = [];
    for (const c of this._children) entries.push(...c.commitOp());
    return entries;
  }
}
