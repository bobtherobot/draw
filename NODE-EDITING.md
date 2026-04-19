# Node Editing — Behaviour & Logic

This document describes how node (bezier anchor) editing works in the draw editor, covering both the **Direct Selection tool (A)** and the **post-draw node edit mode** that activates automatically after finishing a pen path.

---

## Two entry points

### 1. Direct Selection tool (A)
Press `A` or click the Direct Selection tool button. The cursor becomes a **hollow white arrow**.

- If one or more path shapes are already selected (via the Selection tool), **all selected paths enter node edit mode simultaneously**.
- If nothing is selected, click any path shape to begin editing its anchors.

### 2. Post-draw mode (automatic, pen tool stays active)
After finishing a path with the Pen tool (via Enter, double-click, or closing the shape), the newly drawn path **automatically enters node edit mode** without switching tools. The Pen tool remains active in the toolbar.

---

## Cursor behaviour

| Context | Cursor |
|---|---|
| Direct Selection tool (A) | Hollow white arrow |
| Post-draw mode, hovering over shape or a node | Hollow white arrow |
| Post-draw mode, hovering outside the shape | Crosshair (pen ready) |
| Selection tool (V) | Default black arrow |

---

## Visual display while editing

- The **dashed selection bounding box is suppressed** — it is replaced by:
  - A **blue wireframe** trace of each editing path's outline (`stroke: #0066ff`, `fill: none`)
  - **Hollow white squares** at each anchor point across all editing shapes
  - **Filled blue squares** for selected anchors
  - **Blue handle lines + circles** extending from selected anchors that have bezier handles

---

## Multi-shape node editing

Multiple path shapes can be edited simultaneously:

- **Select several paths with the Selection tool (V), then press A** — all selected paths enter node edit mode at once, each showing its own wireframe and anchor squares
- **Shift-click a path body** while in node edit mode — adds that path to the editing set without clearing the current editing shapes
- **Click a path body** (no Shift) while editing other shapes — switches to editing only the clicked path
- **Click a non-path object** — exits node editing entirely and selects that object
- Anchors from different shapes can be selected together and moved as a group

---

## Anchor selection

- **Click an unselected anchor** — selects it (deselects all other anchors across all editing shapes unless Shift is held)
- **Click an already-selected anchor** — keeps it selected; does not reset the selection
- **Shift-click an anchor** — adds to or removes from the selection (works across shapes)
- **Click empty canvas or shape body (already editing)** — deselects all anchors; stays in node editing mode
- **Escape** — exits node editing, returns to Selection tool

Multiple anchors from multiple shapes can be selected at once. All selected anchors move together when any one of them is dragged.

---

## Marquee (rubber-band) selection

Dragging from an empty area (or from a shape body that is already being edited, not on an anchor or handle) draws a rubber-band rectangle:

- Any anchor whose position falls **fully inside** the marquee rect is added to the selection on mouseup — across **all currently editing shapes**
- **Shift + drag** — adds anchors inside the rect to the existing selection; does not deselect anchors already selected but outside the rect
- If the drag distance never exceeds the threshold (i.e., the gesture was just a click), the marquee is abandoned and the selection was already cleared on mousedown (unless Shift was held)

The marquee rect is drawn in doc-space (a dashed blue outline with a faint blue fill) directly in the node-edit overlay.

---

## Auto-selection after drawing

When a path finishes drawing, the **relevant final anchor is automatically selected**:

- **Open path** (finished with Enter or double-click) — the last placed anchor is selected
- **Closed path** (finished by clicking the first anchor) — anchor `0` (the joining anchor) is selected

This allows the user to immediately drag that anchor to adjust its position without any additional click.

---

## Determining intent after post-draw auto-selection

The first click after finishing a shape determines what the user wants to do next:

### Click on a node or handle → switch to Direct Selection tool
- The node tool (A) is automatically activated
- The **original mousedown is forwarded** to the node tool so a drag can begin immediately without a second click
- The auto-selected anchor remains selected through the tool switch

### Click anywhere else → stay in Pen tool, start drawing a new shape
- Node edit mode is exited
- The previous shape is deselected
- The pen begins a new path from the clicked point

---

## Moving anchors

- **Drag a selected anchor** — moves that anchor and both of its handles together (maintains handle offsets)
- **Multiple selected anchors** — all move by the same delta; drag any one of them; this works across shapes (anchors from different paths move together)
- **Drag a handle circle** — reshapes the curve on that side
  - If the anchor was placed smoothly (handles were collinear), the opposite handle mirrors the drag (smooth constraint maintained)
  - If the anchor is a corner (handles already broken), only the dragged handle moves

---

## Deleting anchors

- `Delete` / `Backspace` — removes all selected anchors across all editing shapes in a single undo entry
- If **all anchors** of a shape are selected, that entire shape is deleted
- Partial deletion rebuilds the path from the remaining anchors; if fewer than 2 remain in a shape, that path is forced open
- Shapes with no selected anchors are unaffected

---

## Undo

- One undo entry per drag gesture (not per frame), covering all shapes whose anchors moved
- The pre-drag `d` attribute of every editing shape is snapshot at mousedown; a single `execute({do, undo})` is pushed on mouseup only if any path actually changed
- Undo restores each shape's previous `d` and re-parses anchors so the overlay stays in sync if the node tool is still active

---

## Keyboard shortcuts (node tool)

| Key | Action |
|---|---|
| `Escape` | Switch back to Selection tool (V) |
| `Delete` / `Backspace` | Delete selected anchors (across all editing shapes) |

---

## Implementation notes

- Anchor data model: `{ x, y, hIn: {x,y}|null, hOut: {x,y}|null }` — same structure as the Pen tool
- `state.nodeEditingActive` (boolean) — set `true` while any shapes are in node edit mode; read by `renderSelection()` to suppress the dashed selection box
- Per-shape state is held in Maps keyed by shapeId: `anchorsMap`, `closePathMap`, `selectedMap`, `wirePathMap`
- A `wireGroup` sub-group inside the overlay `<g>` holds one `<path>` element per editing shape (the blue wireframe); pool elements for anchors and handles are appended directly to the outer overlay group and render on top
- A post-render hook (`setOverlayHook`) ensures the node overlay survives any `render()` call from other code paths (colour changes, undo, layer toggles, etc.)
- Hit testing uses screen-space geometry (not SVG DOM events) for reliability with small elements; `hitTestAnchors` and `hitTestHandles` search across all editing shapes and return `{shapeId, anchorIdx}` tuples
- The overlay group (`overlayGroup`) is preserved across deactivate/activate cycles so pool elements survive without DOM churn; only `wireGroup` children are cleared on deactivate (they are shape-specific)
