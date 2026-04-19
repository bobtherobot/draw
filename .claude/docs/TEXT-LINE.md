# Text-Line Tool

Text-line is point text — free-flowing, single or multi-line, not constrained to a box. Shape field `_isArea = false` distinguishes it from text-block (`_isArea = true`).

## Shape fields

| Field | Type | Notes |
|---|---|---|
| `type` | `'text'` | Shared with text-block |
| `attrs.x` | number | Anchor point (left edge, scale/rotation origin) |
| `attrs.y` | number | Top of logical text box (not the baseline — first baseline = `y + _fontSize`) |
| `_text` | string | Content, may contain `\n` for multiple lines |
| `_fontSize` | number | Base font size in doc units (default 16). **Not changed by scale operations** — scale is handled via `_scaleX`/`_scaleY`. |
| `_fontFamily` | string | CSS font family (default `'Arial, sans-serif'`) |
| `_isArea` | `false` | Always false for text-line |
| `_scaleX` | number | Horizontal geometric scale (default `undefined` = 1) |
| `_scaleY` | number | Vertical geometric scale (default `undefined` = 1) |
| `_rotation` | number | Rotation in degrees (persistent model field, not a transient drag state) |
| `_rotCx` | number | Rotation centre x in doc coords |
| `_rotCy` | number | Rotation centre y in doc coords |

## Coordinate model

`attrs.y` is the **logical top** of the text box. This is the origin for both the scale transform and the bounding box. It is NOT the SVG text baseline.

- First tspan baseline (unscaled): `attrs.y + _fontSize`
- i-th baseline (unscaled): `attrs.y + _fontSize + i * lineH`  where `lineH = _fontSize * 1.3`
- **Visual** i-th baseline after scale: `attrs.y + (_fontSize + i * lineH) * _scaleY`
- **Visual** line width after scale: `measureTextWidth(line) * |_scaleX|`

This choice of `attrs.y` as origin means that for the s/se/sw scale handles (`oy = attrs.y`), `attrs.y - oy = 0` and `attrs.y` never changes — only `_scaleY` accumulates. This eliminates any Canvas/SVG font-metric drift.

## Rendering (`src/shapes/index.js` → `syncTextElement`)

Text-line renders as a `<text>` element with one `<tspan>` per line:

- `<text>` has no `x`/`y` attribute — positions live on tspans
- First tspan: `y = attrs.y + fontSize` (unscaled baseline)
- Subsequent tspans: `dy = fontSize * 1.3`
- **Combined transform** (applied every sync, NOT transient):

```
transform="rotate(R,rotCx,rotCy) translate(x*(1-scaleX), y*(1-scaleY)) scale(scaleX, scaleY)"
```

The `translate + scale` pair scales character widths **and** heights around the anchor `(attrs.x, attrs.y)`. A point `(px, py)` on the unscaled text maps to `(attrs.x + (px - attrs.x)*scaleX, attrs.y + (py - attrs.y)*scaleY)` in visual space. Rotation wraps the whole scaled element so all tspans rotate together.

If both scales are 1 and rotation is 0, the `transform` attribute is removed entirely.

## Bounding box (`src/shapes/index.js` → `getTextBBox`)

Point-text uses **logical line-height bounds** — no font-metric measurement:

```
bbX    = attrs.x
bbY    = attrs.y                           // logical top
width  = maxLineWidth * |_scaleX|
height = lineH * lineCount * |_scaleY|    // lineH = fontSize * 1.3
```

If `_rotation != 0`, `rotatedAABB` expands the rect into its axis-aligned envelope. This bbox is used by `renderSelection` for handle placement and by `enterScaleMode`/`enterRotateMode` for the initial scale origin.

## Scale behaviour (`src/shapes/index.js` → `scaleShape`)

**`_fontSize` is never changed by scale operations.** All geometric scaling goes into `_scaleX` and `_scaleY`:

```js
shape._scaleX = (shape._scaleX || 1) * sx;
shape._scaleY = (shape._scaleY || 1) * sy;
attrs.x = ox + (attrs.x - ox) * sx;
attrs.y = oy + (attrs.y - oy) * sy;
```

Handle semantics:
- **n / s** — `sx = 1`, so `_scaleX` unchanged (width constant); only `_scaleY` grows/shrinks
- **e / w** — `sy = 1`, so `_scaleY` unchanged (height constant); only `_scaleX` grows/shrinks
- **corner handles** — both `_scaleX` and `_scaleY` change (uniform with shift)

For the **s/se/sw** handles `oy = attrs.y`, so `attrs.y - oy = 0` → `attrs.y` stays fixed; text grows downward from a fixed top anchor. For **n/ne/nw** handles `oy = maxY`, so `attrs.y` shifts to keep the bottom edge pinned.

### Scale drag (select.js `onMouseMove`)

Text shapes use the **model-update approach** during scale drag (not a raw SVG matrix on the element):

1. Restore shape fields from `scaleSnapshots`
2. Call `scaleShape(s, sx, sy, ox, oy)` to update model in place
3. Call `syncElement(el, s)` to re-render the element with the new `_scaleX`/`_scaleY` transform

`scaleSnapshots` captures `attrs`, `_fontSize`, `_scaleX`, `_scaleY`, `_rotation`, `_rotCx`, `_rotCy` at drag start. The snap is restored on every mousemove frame before reapplying scale, so the scaling is always relative to the initial state.

On mouseup the same restore + `scaleShape` is applied once more using the final `sx/sy`, then committed to undo history via `execute`.

## Move drag (`src/tools/select.js`)

Text shapes also use model-update during **move** drag (unlike paths which use a raw `translate` transform):

- **mousemove**: `shape.attrs.x = snap.x + dx; shape.attrs.y = snap.y + dy; syncElement(el, shape)`
- **cleanupDrag**: restores attrs from snap + calls `syncElement` (so `_scaleX`/`_scaleY`/`_rotation` transform is correctly re-applied at the pre-drag position)
- **mouseup**: applies final `translateShape` and commits

Using a raw `translate` transform for text would overwrite the persistent `_scaleX`/`_scaleY`/`_rotation` transform, causing the text to appear unscaled during and after the drag.

## Rotation (`src/shapes/index.js` → `bakeRotation`)

Rotation for text is **persistent in the model** (not baked into coordinates):

```js
shape._rotation = (shape._rotation || 0) + angleDeg;
shape._rotCx    = cx;
shape._rotCy    = cy;
```

`syncTextElement` always re-applies `rotate(_rotation, _rotCx, _rotCy)` as the outermost transform, wrapping the scale transforms. This means all tspans rotate together correctly. On mouseup the already-updated `_rotation` is captured in `newRotations` and committed; `bakeRotation` is a no-op for text (the fields ARE the baked state).

## Text guides (`src/render.js` → `renderTextGuides`)

Every text-line shape has persistent guide elements in `#text-guides`, stored in `guideElMap`:

```js
guideElMap.get(shapeId) = { baseLines: SVGLine[], nodeBox: SVGRect }
```

- **baseLines**: one `<line>` per `\n`-split line. Positioned at the **visual** baseline after scale:
  ```
  bY = attrs.y + (fontSize + i * lineH) * scaleY
  x2 = attrs.x + textWidth * |scaleX|
  ```
- **nodeBox**: hollow square centred on the first visual baseline `(attrs.x, attrs.y + fontSize * scaleY)` — marks the text anchor and alignment point.
- Both elements carry `data-shape-id` so they are clickable for selection.
- Color: `#5577aa` normal, `#999` locked layer.

`scaleTextGuidesForDrag` and `offsetTextGuidesForDrag` apply the same scaled-baseline formula so guides track the text during drag operations.

## Text guides during editing (`src/tools/type.js`)

While creating or re-editing a text-line, a separate set of overlay elements lives in `#overlay` (not `#text-guides`). These are managed by the type tool and use the `setOverlayHook` mechanism to survive `renderSelection()`'s `overlay.innerHTML = ''`.

## Double-rendering prevention during edit

When editing starts, the underlying SVG `<text>` element is hidden:

```js
const svgEl = getElement(shapeId);
if (svgEl) svgEl.style.display = 'none';
```

Restored in `clearOverlayEls()` (type tool) or `onCommit` (select tool).

## Save / load (`src/io.js`)

All transform fields are persisted as data attributes on the SVG `<text>` element:

| Data attribute | Shape field |
|---|---|
| `data-text` | `_text` |
| `data-scale-x` | `_scaleX` (omitted if 1) |
| `data-scale-y` | `_scaleY` (omitted if 1) |
| `data-rotation` | `_rotation` (omitted if 0) |
| `data-rot-cx` | `_rotCx` |
| `data-rot-cy` | `_rotCy` |
| `data-is-area` | `_isArea` |
| `font-size` | `_fontSize` |
| `font-family` | `_fontFamily` |

## Key functions

| Function | File | Role |
|---|---|---|
| `syncTextElement` | `src/shapes/index.js` | Renders text shape to SVG; applies rotation + scaleX + scaleY transform |
| `getTextBBox` | `src/shapes/index.js` | Analytic bbox using logical line-height bounds + `_scaleY` |
| `scaleShape` | `src/shapes/index.js` | Accumulates `_scaleX`, `_scaleY`; repositions anchor; never touches `_fontSize` |
| `bakeRotation` | `src/shapes/index.js` | Stores rotation in `_rotation/_rotCx/_rotCy` (no-op bake — fields are the state) |
| `translateShape` | `src/shapes/index.js` | Shifts `attrs.x/y` and `_rotCx/_rotCy` |
| `renderTextGuides` | `src/render.js` | Maintains persistent baseline + node-box guides at scaled visual positions |
| `scaleTextGuidesForDrag` | `src/render.js` | Updates guide positions during scale drag using post-`scaleShape` model values |
| `offsetTextGuidesForDrag` | `src/render.js` | Updates guide positions during move drag; 0 offset for text (attrs already updated) |
| `startEditing` | `src/tools/_textedit.js` | Shows textarea, wires input/commit callbacks |
| `commit` | `src/tools/_textedit.js` | Hides textarea, fires onCommit |
| `openExistingText` | `src/tools/type.js` | Re-edits existing text-line (type tool) |
| `openTextEditor` | `src/tools/select.js` | Re-edits existing text-line (select tool double-click) |
