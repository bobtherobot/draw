# Scale Tool

Scale handles appear on the selection bounding box whenever the select tool (V) is active and one or more objects are selected. Eight handles sit at the four corners and four edge midpoints.

## Handles

```
nw ── n ── ne
│           │
w           e
│           │
sw ── s ── se
```

Corner handles (`nw`, `ne`, `se`, `sw`) scale both axes simultaneously. Edge handles (`n`, `s`, `e`, `w`) scale one axis only — the axis perpendicular to that edge.

**Shift + corner drag** constrains the scale to be proportional (locks aspect ratio). The dominant axis — whichever has moved further in screen pixels — determines the scale factor applied to both dimensions.

## Flip / zero-crossing

Dragging a handle past the opposite edge flips the shape. The scale factor crosses zero and goes negative; shapes are mirrored around the fixed origin.

- **rect** — negative width/height are normalised: the x/y origin is swapped to the other side and the dimension is made positive.
- **ellipse** — rx/ry are always stored positive (an ellipse is symmetric); only the centre position is mirrored.
- **path** — all M, L, and C coordinates are mirrored around the scale origin.
- **area text** — `_boxWidth`/`_boxHeight` are normalised the same way as rect; the anchor point moves to the opposite corner.

A dead-zone of ±0.001 doc units prevents exact collapse to zero while still allowing the sign to cross.

## Live preview

During drag, a single SVG `matrix(sx, 0, 0, sy, ox*(1−sx), oy*(1−sy))` transform is applied directly to each selected element's SVG node — no attribute mutation, no re-layout. The transform is removed on mouseup before the final attrs are committed.

The dashed selection rect in `#overlay` tracks the scaled bounding box in real time. Scale handles (in `#overlay-hit`) are removed for the duration of the drag and restored by the post-commit `render()`.

## SVG structure

Scale handles are appended to `#overlay-hit`, not `#overlay`.  
`#overlay` carries `pointer-events:none` globally, so interactive elements must go in `#overlay-hit`.

## Coordinate math

Each handle fixes one corner/edge as the **scale origin** `(ox, oy)` and moves the opposite one:

| Handle | Fixed origin | Moving edge/corner |
|---|---|---|
| `se` | top-left `(minX, minY)` | bottom-right |
| `nw` | bottom-right `(maxX, maxY)` | top-left |
| `ne` | bottom-left `(minX, maxY)` | top-right |
| `sw` | top-right `(maxX, minY)` | bottom-left |
| `e`  | left edge `(minX, —)` | right edge only |
| `w`  | right edge `(maxX, —)` | left edge only |
| `s`  | top edge `(—, minY)` | bottom edge only |
| `n`  | bottom edge `(—, maxY)` | top edge only |

Scale factors derived from total drag displacement `(dx, dy)` relative to `dragStart`:

```
se:  sx = (origW + dx) / origW    sy = (origH + dy) / origH
nw:  sx = (origW - dx) / origW    sy = (origH - dy) / origH
e:   sx = (origW + dx) / origW    sy = 1
n:   sx = 1                       sy = (origH - dy) / origH
```
(and so on by symmetry for the remaining handles)

## Undo

A single undo entry is pushed on mouseup via `execute()` in `src/history.js`. Each shape's full pre-scale state (`attrs` + `_boxWidth`/`_boxHeight` for area text) is snapshotted in `scaleSnapshots` at drag start. The undo closure restores directly from those snapshots.

## Key files

| File | Responsibility |
|---|---|
| `src/tools/select.js` | `enterScaleMode`, `computeScaleParams`, `updateScaleSelEl`, scale commit in `onMouseUp` |
| `src/shapes/index.js` | `scaleShape` (per-type attr mutation), `scalePathD` |
| `src/render.js` | `renderSelection` — draws dashed rect in `#overlay` and handles in `#overlay-hit` |
