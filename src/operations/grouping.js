/**
 * Group / Ungroup operations.
 *
 * groupSelected()   — wraps current selection in a new group; fully undoable
 * ungroupSelected() — dissolves selected groups; fully undoable
 */
import { state, findShape, nextId } from '../core/state.js';
import { execute }                  from '../core/history.js';
import { getDisplayObject }         from '../core/registry.js';
import { render }                   from '../render/renderer.js';
import { unionBBoxes }              from '../utils/geometry/bbox.js';

// ── Group ─────────────────────────────────────────────────────────────────────

export function groupSelected() {
  const selIds = [...state.selection];
  if (selIds.length < 2) return;

  const selShapes = selIds.map(id => findShape(id)).filter(Boolean);
  if (!selShapes.length) return;

  // Compute union bbox of all selected items.
  const bboxes = selShapes
    .map(s => getDisplayObject(s.type)?.getBBox(s))
    .filter(Boolean);
  if (!bboxes.length) return;
  const bb = unionBBoxes(bboxes);

  // Group shares the parent of the selected items (all should share activeContainerId).
  const groupParentId = selShapes[0].parentId;

  const group = {
    id:       nextId('group'),
    type:     'group',
    name:     'Group',
    parentId: groupParentId,
    visible:  true,
    locked:   false,
    expanded: true,
    attrs:    { x: bb.x, y: bb.y, width: bb.width, height: bb.height },
    style:    {},
  };

  const selIdSet        = new Set(selIds);
  const oldShapes       = [...state.shapes];
  const oldSel          = new Set(state.selection);
  // Capture parentIds before any mutation — oldShapes is a shallow copy so
  // the shape objects are shared; mutating parentId in do() would corrupt the snapshot.
  const origParentIds   = new Map(selShapes.map(s => [s.id, s.parentId]));

  execute({
    do() {
      // Walk the flat array; drop selected items, track where to insert the group
      // (at the topmost selected item's z-position).
      const remaining = [];
      let insertIdx   = 0;
      for (const s of state.shapes) {
        if (selIdSet.has(s.id)) {
          insertIdx = remaining.length;
        } else {
          remaining.push(s);
        }
      }

      for (const s of selShapes) s.parentId = group.id;
      remaining.splice(insertIdx, 0, group, ...selShapes);

      state.shapes             = remaining;
      state.selection          = new Set([group.id]);
      state.selectionRotation  = null;
      render();
    },
    undo() {
      for (const s of selShapes) s.parentId = origParentIds.get(s.id);
      state.shapes             = oldShapes;
      state.selection          = oldSel;
      state.selectionRotation  = null;
      render();
    },
  });
}

// ── Ungroup ───────────────────────────────────────────────────────────────────

export function ungroupSelected() {
  const selIds = [...state.selection];
  if (!selIds.length) return;

  const groups = selIds
    .map(id => findShape(id))
    .filter(s => s?.type === 'group');
  if (!groups.length) return;

  const oldShapes = [...state.shapes];
  const oldSel    = new Set(state.selection);

  const groupDataFixed = groups.map(g => ({
    group: g,
    children: state.shapes.filter(s => s.parentId === g.id),
  }));

  execute({
    do() {
      const ungroupedChildIds = new Set();

      for (const { group: g, children } of groupDataFixed) {
        for (const child of children) {
          child.parentId = g.parentId;
          ungroupedChildIds.add(child.id);
        }
      }

      const groupIdSet = new Set(groups.map(g => g.id));
      state.shapes    = state.shapes.filter(s => !groupIdSet.has(s.id));

      state.selection          = ungroupedChildIds;
      state.selectionRotation  = null;
      render();
    },
    undo() {
      for (const { group: g, children } of groupDataFixed) {
        for (const child of children) child.parentId = g.id;
      }
      state.shapes             = oldShapes;
      state.selection          = oldSel;
      state.selectionRotation  = null;
      render();
    },
  });
}
