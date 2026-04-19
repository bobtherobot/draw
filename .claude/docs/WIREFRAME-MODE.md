# Wireframe Mode

Wireframe mode is a global view toggle that strips all fill/stroke styling from shapes and overlays their structural anchor points as small orange squares.

## Toggling

The command bar (top of window, or floating) contains two view-mode buttons with `data-view` attributes:

| Button | `data-view` | Effect |
|---|---|---|
| Normal | `normal` | Full colour rendering |
| Wireframe | `wireframe` | Outline-only + node overlay |

Clicking a button sets `state.viewMode` and calls `render()`. The active button is highlighted in orange (`#e8973a`). State is not persisted — mode resets to `'normal'` on page load.

## What changes in wireframe mode

### Shape fill/stroke (`src/shapes/index.js`)

`syncElement` and `syncTextElement` both read `state.viewMode` on every sync:

- **Non-text shapes** — `fill` forced to `'none'`, `stroke` forced to `'#777'`, `stroke-width` forced to `1/zoom` (so the outline stays 1 screen pixel regardless of zoom).
- **Text shapes** — `fill` forced to `'#777'`; stroke is removed. Text remains readable but desaturated.

Shape `style` data (`shape.style.fill` etc.) is untouched — it is simply not applied when wireframe is active. Switching back to normal mode restores full colour immediately.

### Node overlay (`src/render.js` → `renderWireframeNodes`)

A fixed SVG group `<g id="wireframe-nodes">` sits above all layer content. On every `render()` call, `renderWireframeNodes()` runs:

- If `viewMode !== 'wireframe'`: all pooled node rects are hidden (`display: none`). Returns immediately.
- If `viewMode === 'wireframe'`: iterates every visible shape on every visible layer, computes its structural points via `getShapePoints()`, and draws a small filled square at each one.

Node squares are **orange** (`#e8973a`), sized `2.2/zoom` half-size so they stay visually constant at ~4–5 screen pixels.

#### `getShapePoints(shape)` — anchor point derivation

| Shape type | Points returned |
|---|---|
| `path` | All anchor positions from parsed `d` attribute (via `parsePathD`) |
| `rect` | 4 corners: top-left, top-right, bottom-left, bottom-right |
| `ellipse` | 4 cardinal points: top, right, bottom, left (`cx/cy ± rx/ry`) |
| `text` | 1 point: the text origin `(attrs.x, attrs.y)` |

#### Pool pattern

Node rects are allocated once and reused across frames — no DOM creation per frame:

```
_nodePool[]   — array of SVG rect elements, appended once to #wireframe-nodes
_nu           — reuse counter, reset to 0 each render call
poolNodeRect  — takes from pool if available, creates and appends if not
```

After the loop, any unused pool entries (`i >= _nu`) are hidden. This avoids `innerHTML = ''` + recreate on every render.

## SVG structure

```
<g id="doc-root">
  <g id="layer-{id}">     ← shapes rendered here (colour or wireframe style)
  <g id="text-guides">
  <g id="wireframe-nodes" style="pointer-events:none">
                          ← orange anchor squares, always on top of layers
```

`#wireframe-nodes` carries `pointer-events:none` — nodes are decorative only.

## Command bar behaviour (`src/commandbar.js`)

The bar docks to the top of the window by default. Dragging the handle detaches it as a floating panel. When dragged back within 44px of the top, it re-docks automatically. Position is persisted to `localStorage` under the key `draw-commandbar-state`.

## Key files

| File | Responsibility |
|---|---|
| `src/state.js` | `state.viewMode` — `'normal' \| 'wireframe'` |
| `src/commandbar.js` | Button wiring, dock/float drag, localStorage persistence |
| `src/render.js` | `renderWireframeNodes`, `getShapePoints`, `_nodePool` pattern |
| `src/shapes/index.js` | `syncElement` / `syncTextElement` — override style when in wireframe mode |
| `index.html` | `#command-bar`, `.cb-btn[data-view]`, `#wireframe-nodes` group |
