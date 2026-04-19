# Rotate Tool

The rotate handle appears above the selection bounding box whenever the select tool (V) is active and one or more objects are selected.

## Handle layout

```
        ○   ← rotate handle (circle, data-handle="rotate")
        │   ← stem line
nw ── n ── ne
│           │
w           e
│           │
sw ── s ── se
```

The circle sits `18/zoom` doc units above the top-centre midpoint of the selection bounding box, connected by a thin stem line. Both the circle and stem are redrawn at current zoom by `renderSelection()` in `src/render.js`. The circle is in `#overlay-hit` (interactive); the stem is in `#overlay` (non-interactive).

## Drag behaviour

On mousedown on the rotate handle, `enterRotateMode()` records:

- `rotateCenter` — centre of the selection bounding box in doc coords
- `rotateStartAngle` — `atan2(mouseY − cy, mouseX − cx)` in degrees at drag start
- `scaleSnapshots` — per shape: `{ attrs, _rotation: 0, _rotCx, _rotCy }` (attrs are the pre-rotation coordinates)

On mousemove, `delta = currentAngle − rotateStartAngle`. **Shift** snaps delta to the nearest 15°.

All selected shapes receive a live `transform="rotate(delta, cx, cy)"` directly on their SVG element. No state mutation happens during drag.

## Multi-shape rotation

All shapes rotate around a single shared centre — the centre of the combined selection bounding box computed at drag start. Each shape's `_rotCx`/`_rotCy` in the snapshot is set to that shared centre, so they all orbit the same point.

## SVG transform philosophy

The `transform` attribute is **temporary** — it exists only during the drag as a visual preview. It is never persisted to `shape.attrs` and is never written by `syncElement`.

On mouseup, the transform is removed from the SVG element and the rotation is **baked** into the shape's actual coordinates.

## Baking on commit (`bakeRotation`)

`bakeRotation(shape, angleDeg, cx, cy)` in `src/shapes/index.js`:

- **path** — calls `rotatePathD(d, angleDeg, cx, cy)`: rewrites every M, L, and C coordinate pair by applying `rotatePoint` around `(cx, cy)`.
- **text** — rotates only the anchor point `(attrs.x, attrs.y)`. Glyph orientation is not changed (text is repositioned, not visually rotated).
- Clears `_rotation`, `_rotCx`, `_rotCy` on the shape (they are always `undefined` on committed shapes).

After baking, `el.getBBox()` returns the correct envelope and all subsequent operations (scale, move, node edit, further rotation) work directly on the real coordinates — no transform composition required.

## Coordinate math

```js
rotatePoint(x, y, angleDeg, cx, cy):
  r   = angleDeg * π / 180
  x'  = cx + (x − cx) * cos(r) − (y − cy) * sin(r)
  y'  = cy + (x − cx) * sin(r) + (y − cy) * cos(r)
```

`rotatePathD` applies `rotatePoint` to every coordinate pair in an SVG path `d` string, handling M, L, and C commands. H, V, and other relative commands are not used in this codebase (all paths use absolute M/L/C/Z).

## Undo

A single undo entry is pushed on mouseup via `execute()`. Each shape's pre-rotation `attrs` are snapshotted in `scaleSnapshots` at drag start. The undo closure restores those attrs directly; redo re-applies the baked attrs stored in `newAttrs`.

```
undo: Object.assign(shape.attrs, snapshot.attrs)   ← pre-rotation coords
redo: Object.assign(shape.attrs, newAttrs)          ← baked post-rotation coords
```

## Key files

| File | Responsibility |
|---|---|
| `src/tools/select.js` | `enterRotateMode`, rotate `onMouseMove` (live transform), rotate commit in `onMouseUp` |
| `src/shapes/index.js` | `rotatePoint`, `rotatePathD` (internal), `bakeRotation` (exported) |
| `src/render.js` | `renderSelection` — draws rotate circle + stem in `#overlay`/`#overlay-hit` |
