# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based vector graphics editor inspired by Adobe Illustrator 88 — minimal, keyboard-driven, no build step. SVG is both the render target and the file format.

## Dev Setup

No build step — plain ES modules served directly:

```
python3 -m http.server
# or: npx serve .
```

Open `http://localhost:8000` in a browser.

## Architecture

### Rendering pipeline (`src/render.js`)

`render()` is the single entry point — call it after any state mutation. It calls in order:

1. `renderArtboard()` — white page rect with drop shadow in `#artboard-layer`
2. `renderLayers()` — reconciles `elMap` (shapeId → SVGElement) against `state.layers`; upserts/removes elements
3. `renderTextGuides()` — draws anchor squares + baseline indicators for text shapes in `#text-guides` group (exported so select tool can call it during drag)
4. `renderLayersPanel()` — rebuilds the layers sidebar, including expand/collapse triangles and shape item lists
5. `renderSelection()` — clears `#overlay` innerHTML and draws the dashed selection bounding box

**Critical**: `renderSelection()` does `overlay.innerHTML = ''`, which removes any SVG elements appended to the overlay by tools (e.g., pen tool preview path). Tools that draw into `#overlay` must re-append their elements on every update — see pen tool's `ensureOverlayEls()`.

### SVG structure (`index.html`)

```
<svg id="canvas">
  <g id="artboard-layer">   ← white page background
  <g id="doc-root">         ← layer groups + #text-guides live here
    <g id="layer-{id}">     ← one per layer
  <g id="overlay">          ← selection handles, tool previews (cleared each render)
  <g id="overlay-hit">      ← hit-test helpers
```

### Shape model

Shapes are plain JS objects: `{ id, type, attrs, style }`.

- `attrs` — SVG presentation attributes (e.g., `x`, `y`, `width`, `height`, `d`, `cx`, `cy`)
- `style` — `{ fill, stroke, strokeWidth }`
- Text-specific extra fields: `_text`, `_fontSize`, `_fontFamily`, `_isArea`, `_boxWidth`, `_boxHeight`

`makeElement(shape)` creates the SVG element; `syncElement(el, shape)` updates it. Text shapes get special treatment in `syncTextElement` — positions are on `<tspan>` children, not the `<text>` element, so the raw attribute loop used for other shapes won't move text correctly. Always use `syncElement` when syncing text.

### Text shapes (`src/shapes/index.js`)

- Point text (`_isArea = false`): free-flowing, no box constraint
- Area text (`_isArea = true`): wrapped to `_boxWidth`, clipped at `_boxHeight` (lines beyond box bottom are not rendered)
- SVG `y` on `<text>` is the BASELINE, not top. First tspan baseline = `attrs.y + _fontSize`; subsequent tspans use `dy = fontSize * 1.3`
- `wrapText()` uses an offscreen Canvas 2D `measureText` to break lines

### Text editing overlay (`src/tools/_textedit.js`)

A singleton `<textarea>` (id `text-edit-ta`) appended to `#canvas-wrap`, repositioned for each edit session. Key behaviors:

- `startEditing({ docX, docY, fontSize, fill, boxWidth?, boxHeight?, onCommit })` — converts doc coords to screen px, shows the textarea
- Point text: auto-expands horizontally using a hidden mirror `<span>` for width measurement (textarea `scrollWidth` is unreliable with `overflow: hidden`)
- Area text: fixed size, `oninput` pins `scrollTop = 0` so overflow exits at the bottom
- `ta.focus()` is deferred with `setTimeout(0)` to survive the mousedown event cycle
- `commit()` hides the textarea and calls the `onCommit` callback

### Coordinate system

`screenToDoc(sx, sy)` → doc coords: `{ x: (sx - rect.left)/zoom + viewport.x, y: ... }`

All shape positions are in document space. The SVG viewBox is updated by `updateViewBox()` in `src/viewport.js`. `fitToArtboard()` centers the artboard with 64px screen padding.

### Undo/Redo (`src/history.js`)

Command pattern: `execute(cmd)` calls `cmd.do()` immediately and pushes to undoStack. `undo()`/`redo()` pop and call the respective method.

### Color picker undo (`src/main.js`)

Color pickers produce many intermediate values. The flow:
- Swatch click → snapshot current shape styles into `_pickerSnapshot`
- `input` event → `applyStyleLive()` — updates shapes + re-renders, NO undo entry
- `change` event → debounced 400ms → `commitStyleChange()` — one undo entry using the pre-drag snapshot

`change` in Chrome fires continuously during drag (same as `input`), hence the debounce.

### Pen tool (`src/tools/pen.js`)

State machine: `active`, `anchors[]`, `mouseDown`, `closing`.

- Anchor: `{ x, y, hIn: {x,y}|null, hOut: {x,y}|null }`
- `closing = true` when mousedown lands on the first anchor (≥2 anchors placed)
- Path is closed on **mouseup** (not mousedown) so the closing drag can set bezier handles
- `ensureOverlayEls()` always re-appends `previewPath` and `handleGroup` to `#overlay` — this is the fix for drawing a second shape after the first (renderSelection clears the overlay)

### Text guides (`src/render.js` → `renderTextGuides`)

Renders per text shape: a small hollow square at the origin (`attrs.x`, `attrs.y`) and a short horizontal baseline line. Both carry `data-shape-id` so they are clickable for selection. Exported and called by the select tool during drag so guides track the text in real time.

### Select tool drag (`src/tools/select.js`)

During move, calls `syncElement(el, shape)` for every selected shape (not a raw attribute loop) — necessary because text tspan positions are not in `shape.attrs` directly. Also calls `renderTextGuides()` after each move step.

Area text selection bounding box is derived from `shape._boxWidth`/`_boxHeight` (not `el.getBBox()`) so the selection handles stay fixed at the drawn box size regardless of text content.

## Key Files

| File | Role |
|---|---|
| `index.html` | Layout, toolbar, panels, Document Settings dialog |
| `src/state.js` | Global mutable state + `findShape()`, `allShapes()`, `getActiveLayer()` |
| `src/render.js` | `render()` pipeline; exports `renderSelection`, `renderTextGuides`, `getElement` |
| `src/viewport.js` | Pan/zoom, `screenToDoc`, `fitToArtboard` |
| `src/history.js` | `execute`, `undo`, `redo` |
| `src/shapes/index.js` | `createShape`, `makeElement`, `syncElement`, `translateShape`, `getBBox` |
| `src/tools/select.js` | Click-select, rubber-band, drag-move |
| `src/tools/pen.js` | Bezier pen; exports `buildPathD` |
| `src/tools/type.js` | Point text tool |
| `src/tools/typearea.js` | Area text tool |
| `src/tools/_textedit.js` | Shared textarea editing overlay |
| `src/main.js` | Tool switching, keyboard shortcuts, style panel, menus, doc settings dialog |
| `src/io.js` | `newDocument`, `openSVG`, `saveSVG`, `exportSVG` |

## Toolbar Tools

| Button | Key | Tool module |
|---|---|---|
| ↖ | V | select.js |
| ↗ | A | node.js |
| ✒ | P | pen.js |
| ▭ | M | rect.js |
| ◯ | E | ellipse.js |
| T | T | type.js (point text) |
| ⊞T | — | typearea.js (area text) |
| ⊕ | Z | zoom.js |
| ✋ | H | hand.js |

## Performance Guidelines

`render()` is called on every state mutation, including every `mousemove`. Any code that runs inside `render()` or tool `onMouseMove` handlers is hot — treat it accordingly.

**DOM reads that force layout (synchronous, expensive):**
- `el.getBoundingClientRect()` — cache it; `viewport.js` exports `invalidateRect()` for this
- `el.getBBox()` — avoid in hot paths; use stored shape dimensions (`attrs`, `_boxWidth`/`_boxHeight`) where possible
- `el.clientWidth/Height`, `el.scrollWidth` — read once, store locally

**DOM writes (avoid repeated churn):**
- Never `innerHTML = ''` + recreate elements in a per-frame path — reuse elements via attribute updates or element pools (see pen.js `_linePool` pattern)
- Never rebuild a panel/list on every render — add a version-string guard and skip if nothing changed (see `renderLayersPanel`)

**Computation:**
- Cache pure function results that depend on inputs that rarely change — key by the inputs (see `_wrapCache` in `shapes/index.js`)
- Pre-build indexes at drag/interaction start rather than scanning all shapes per frame (see `guideElMap` iteration in `offsetTextGuidesForDrag`)

**Throttling:**
- Status bar and other non-critical UI updates: gate behind `requestAnimationFrame`
- Color picker live preview already debounced — follow the same pattern for any high-frequency input → render path

**Not worth optimizing:**
- `Math.*` method localization — JIT inlines these to native instructions
- Caching `a.x` style property accesses — V8 hidden classes make these essentially free
- JS computation in general — bottleneck is always DOM/SVG attribute setting, not JS math

## Known Patterns / Gotchas

- **Never** use `for (const [k,v] of Object.entries(shape.attrs)) el.setAttribute(k,v)` to move text — use `syncElement(el, shape)` instead
- `renderSelection()` nukes the overlay — any tool with overlay elements must call `ensureOverlayEls()` before each update
- `textarea.scrollWidth` with `overflow: hidden` returns clientWidth, not content width — use the mirror `<span>` for point text width measurement
- Area text: `ta.scrollTop = 0` on input keeps text anchored at the top; SVG rendering clips at `y + _boxHeight`
- `<input type="color">` fires `change` continuously in Chrome — always debounce commits to the undo stack
