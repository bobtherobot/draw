# Draw — Application Overview

A browser-based SVG vector graphics editor in the spirit of Illustrator 88. No bundler; plain ES modules served from disk. SVG is both the render target and the save format.

## What it does

- Draw and edit vector shapes: paths (pen tool), rectangles, ellipses, point text, area text
- Select, move, scale (8-handle), and rotate shapes
- Edit bezier paths with the node tool (drag anchors and control handles, add/remove anchors)
- Undo/redo all operations
- Open and save SVG files
- Pan (hand tool / space) and zoom (zoom tool / Cmd+scroll)
- Toggle wireframe view mode
- Manage layers (add, rename, show/hide, lock)
- Apply fill, stroke, and stroke-weight via the style panel
- Double-click text shapes to re-edit inline (textarea overlay)

## Architecture at a glance

The app is split into three registries — **ObjectTypes**, **Tools**, **Modes** — with a plugin API to add more of each without touching core files.

### Shape model

Shapes are plain JS POJOs: `{ id, type, attrs, style }`. No classes on shapes — only on the ObjectType singletons that operate on them. This keeps undo snapshots trivial (shallow clone).

### Render pipeline

`render()` in `src/render/renderer.js` is the single entry point called after every state mutation:

1. `activeMode.beforeRender()` — modes can override shape styles (wireframe collapses fill/stroke)
2. `renderArtboard()` — white artboard rect
3. `renderLayers()` — reconciles `elMap` (shapeId → SVGElement), calls `ObjectType.syncElement` per shape; no `if (type === …)` branches
4. `renderTextGuides()` — anchor squares and baseline lines for text shapes
5. `renderSelection()` — dashed bbox + 8 scale handles + rotate handle
6. `activeMode.afterRender()`
7. `emit('render')` — panels subscribe to refresh their UI

### Canvas event routing

`mousedown/move/up/dblclick` → `hitTest()` → `computeIntent()` → `dispatch()` → fallback `tool.onEvent()`.

The dispatch table keys on `effectiveTool` (which may differ from `activeTool` when a modifier is held — e.g. Space → hand, Meta → select).

### OverlayManager

Tools write to named overlay layers (`acquireLayer(id)`) so they don't clobber each other. `OverlayLayer.borrow(tag)` pools SVG elements to avoid per-frame allocation.

### CSS / theming

Single compiled `dist/main.css`. Runtime theming via CSS custom properties (`--theme-*`). Setting `body[data-theme="light"]` switches all colors without a page reload. Icons use `fill="currentColor"` so they inherit CSS `color`.

### Design principles — customizability and portability

This application is intentionally designed to be accessible to **designers and developers** without requiring deep knowledge of the source code. Two rules enforce this:

**1. No embedded SVG — ever.**
All icons and graphics must be external `.svg` files under `assets/themes/<theme>/icons/`. Icons are loaded at runtime via `getIconSync(category, name)` in `src/core/icons.js`. This means an entire icon set can be replaced by dropping in a new theme folder — zero JS or CSS changes required. Never use `innerHTML`, template literals, or hardcoded SVG strings in JS or HTML. The serializer (`src/io/serializer.js`) is the only legitimate source of programmatically-constructed SVG, and that is document output, not UI.

**2. Design decisions surface as variables — not buried in component code.**
Every color, size, or visual choice that a designer might want to adjust must be expressed as a CSS custom property (`--theme-*`) defined in `styles/core/variables.less` (dark default) and overridden in `styles/themes/light.less`. Component LESS files must reference `var(--theme-*)` for every color — never raw hex. Each component LESS file should open with a comment block listing the `--theme-*` tokens it consumes, so a designer can find the relevant knobs without reading the full file.

## File layout (key files)

```
src/
  main.js             — boot: register built-ins, init controls, render
  app.js              — build #app DOM; applyTheme()
  viewport.js         — pan/zoom; screenToDoc/docToScreen; zoomAt/fitToArtboard
  textedit.js         — singleton textarea overlay for in-place text editing
  core/
    state.js          — global state POJO + nextId()
    history.js        — execute()/undo()/redo() command pattern
    registry.js       — register/get tools, objects, modes, panels, keybindings
    events.js         — on()/emit() pub/sub
    intent.js         — dispatch table: registerDispatch()/dispatch()
    hit-test.js       — hitTest() → HitResult; computeIntent() → Intent
    modifiers.js      — modifier key tracking; resolveEffectiveTool()
    icons.js          — async SVG icon loader with theme fallback + LRU cache
  objects/            — ObjectType modules: path, text-line, text-block, group
  tools/              — Tool modules: select, node, pen, rect, ellipse, type, typearea, zoom, hand
  modes/              — Mode modules: normal, wireframe
  render/             — renderer, overlay manager, selection, text-guides
  controls/           — toolbar, keyboard, style-panel, layers-panel, commandbar
  geometry/           — path-utils, pen-path, bbox, transform
  io/                 — io.js (open/save/new), serializer
styles/               — LESS source → dist/main.css
assets/themes/        — icon SVGs per theme
```

## Dev setup

```bash
npm run css:watch   # compile LESS (keep running while editing .less files)
npm run serve       # python3 http.server → http://localhost:8000
```
