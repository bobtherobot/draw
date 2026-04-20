# CLAUDE.md — Draw v2

This file provides persistent context for every Claude Code session in this repository.

## Project Overview

A browser-based SVG vector graphics editor — minimal, keyboard-driven, no bundler. SVG is both the render target and the file format. v2 is a clean OOP rewrite of the v1 proof-of-concept; v1 is preserved on the `v1` branch.

## Dev Setup

```bash
# Terminal 1: compile LESS (needed when editing .less files)
npm run css:watch

# Terminal 2: serve the app
npm run serve
# → http://localhost:8000
```

No bundler for JS — plain ES modules served directly from disk.

## Architecture

### Three extension points

Everything in the app flows through three registries:

| Type | Base class | Register via | Reference doc |
|---|---|---|---|
| Shape types | `src/objects/base.js` | `registerObjectType(instance)` | `OBJECT-TYPE.md` |
| Tools | `src/tools/base.js` | `registerTool(instance)` | `TOOL-CONTRACT.md` |
| Modes | `src/modes/base.js` | `registerMode(instance)` | _(see modes/base.js)_ |

Built-ins register themselves on import in `src/objects/index.js`, `src/tools/index.js`, `src/modes/index.js`.

### Render pipeline (`src/render/renderer.js`)

`render()` is the single entry point — call it after any state mutation:

1. `activeMode.beforeRender()`
2. `_renderArtboard()` — white page rects + per-artboard `<clipPath>` in `#artboard-layer` / `<defs>`
3. `_renderTree()` — builds item tree depth-first, reconciles `elMap`/`containerElMap`; calls `ObjectType.syncElement` per display item — **no `type` branches**
4. `renderTextGuides()` — anchor squares + baseline lines for text shapes
5. `renderSelection()` — dashed bounding box + scale/rotate handles in the `selection` overlay layer
6. `activeMode.afterRender()`
7. fires `emit('render')` — panels subscribe to refresh

### SVG structure (built by `src/app.js`)

```
<svg id="canvas">
  <defs>                     ← per-artboard clipPath elements (managed by renderer)
  <g id="artboard-layer">   ← white artboard background rects
  <g id="doc-root">
    <g id="doc-layer">       ← render root for all items (reconciled by _renderTree)
      <g id="item-{id}">     ← container <g> per group/artboard item
    <g id="text-guides">    ← anchor squares + baseline lines
  <g id="overlay-hit">      ← future: hit-test helpers
  <g id="overlay">          ← selection handles + tool previews (OverlayManager)
```

### OverlayManager (`src/render/overlay.js`)

Tools acquire named overlay layers instead of writing to `#overlay` directly. This prevents tools from clobbering each other's elements.

```js
// In tool.activate():
this._layer = this._ctx.overlay.acquireLayer('my-tool');

// In tool.deactivate():
this._ctx.overlay.releaseLayer('my-tool');

// In tool._redraw():
this._layer.clear();                        // recycles elements to pool
const line = this._layer.borrow('line');    // pool-backed SVG element, already appended
line.setAttribute('x1', ...);
```

### Item model (unified flat tree)

All items live in `state.items` (flat array). Tree structure is encoded via `parentId` — null = root.

```js
{
  id:       'item3',          // nextId('item') for groups/artboards; nextId(type) for display items
  type:     'artboard'        // pure container, owns dimensions
           | 'group'          // pure container, no geometry
           | 'path'           // display item, may have children
           | 'text-line'
           | 'text-block',
  name:     'Layer 1',        // optional; auto-derived for display items if absent
  parentId: null | 'item1',   // null = root level
  visible:  true,
  locked:   false,
  expanded: true,
  // --- artboard only ---
  attrs:  { x, y, width, height },
  // --- display items only ---
  attrs:  { d: '...' },       // SVG presentation attributes
  style:  { fill, stroke, strokeWidth },
  // text extras: _text, _fontSize, _fontFamily, _boxWidth, _boxHeight (text-block)
}
```

Key state helpers (`src/core/state.js`):
- `findItem(id)` — find any item by id
- `allDisplayItems()` — all non-group, non-artboard items
- `getActiveItem()` — active container (for new shapes to land in)
- `getActiveArtboard()` — first artboard item
- `childrenOf(parentId)` — direct children
- `sanitizeItems(items)` — promote orphans to root after any delete

**SVG `transform` is never persisted.** Scale/rotate bake into `attrs` coordinates via `ObjectType.scale()` / `ObjectType.bakeRotation()`. `syncElement` must always call `el.removeAttribute('transform')`.

### Intent / dispatch system

Canvas mouse events → `hitTest()` → `computeIntent()` → `dispatch()` → fallback to `tool.onMouseDown()`.

**Intent:**
```js
{
  tool: 'pen',             // state.activeTool
  effectiveTool: 'select', // after modifier override
  mode: 'normal',
  objectType: 'path',      // or null
  part: 'body',            // or null
  shape: {...},            // or null
  modifiers: { meta, ctrl, alt, shift, space }
}
```

**Dispatch key format:** `${effectiveTool}:${mode}:${objectType ?? 'null'}:${part ?? 'null'}`

Wildcards: `'*'` for objectType or part. Priority: exact > objectType-wildcard > part-wildcard > both-wildcard.

### Modifier key system

`src/core/modifiers.js` tracks live modifier state and resolves `effectiveTool`:

```js
// Built-in overrides (registered in src/controls/keyboard.js):
registerModifierOverride(['space'], 'hand',   10); // Space → pan
registerModifierOverride(['meta'],  'select',  9); // Meta  → select
```

When a modifier override fires, `prevTool.suspendTo(newTool)` is called. On release, `prevTool.resume()` is called (defaults to `activate()`).

### Undo / redo (`src/core/history.js`)

Command pattern. Call via `ctx.execute({ do(), undo() })` from tools. Never call `render()` inside commands — call it after `execute()` returns.

### CSS / LESS architecture

- `styles/core/variables.less` — LESS vars (compile-time) + `:root { --theme-*: ... }` (runtime)
- `styles/core/mixins.less` — `.flex-center()`, `.panel-chrome()`, `.icon-btn()` etc.
- `styles/components/*.less` — one file per UI component, BEM naming
- `styles/themes/light.less` — overrides for `body[data-theme="light"]`

**Rule:** Component files use `var(--theme-*)` for every color — never raw hex. LESS vars are for compile-time math only.

### SVG icon conventions

- `fill="currentColor"` — icons inherit CSS `color` via currentColor
- `viewBox` always present — typically `0 0 16 16`
- No hardcoded `width` / `height` on root `<svg>`
- `aria-hidden="true"` on all icons
- No inline `<style>` blocks

Cursors (in `icons/cursors/`) are an exception — they use hardcoded black since the OS renders them.

## Key files

| File | Role |
|---|---|
| `src/main.js` | Entry point — imports registrations, inits controls, calls render |
| `src/app.js` | Builds #app DOM; `applyTheme()` |
| `src/core/state.js` | Global state + `nextId()`, `findItem()`, `allDisplayItems()`, `getActiveArtboard()`, `sanitizeItems()` |
| `src/core/registry.js` | Extension API — register tools/objects/modes/panels/keybindings |
| `src/core/intent.js` | Dispatch table — `registerDispatch()`, `dispatch()` |
| `src/core/modifiers.js` | Modifier key tracking + tool-switch overrides |
| `src/core/hit-test.js` | `hitTest()` → HitResult, `computeIntent()` → Intent |
| `src/core/history.js` | `execute()`, `undo()`, `redo()` |
| `src/core/icons.js` | `getIcon()` / `getIconSync()` with theme fallback |
| `src/render/renderer.js` | `initRenderer()`, `render()`, `getElement()`, `getOverlay()` |
| `src/render/overlay.js` | OverlayManager + OverlayLayer |
| `src/viewport.js` | `screenToDoc()`, `docToScreen()`, `zoomAt()`, `fitToArtboard()` |
| `src/textedit.js` | Singleton textarea for text editing sessions |
| `src/io/io.js` | `newDocument()`, `openSVG()`, `saveSVG()`, `exportSVG()` — native format is `.draw` (JSON) |
| `src/io/serializer.js` | `serializeJSON/deserializeJSON` (native), `exportSVG` (clean SVG), `importSVG` (foreign SVG) |
| `src/objects/artboard.js` | ArtboardObjectType — `type:'artboard'`, attrs `{x,y,width,height}` |
| `src/geometry/path-utils.js` | Path string parse/build/transform |
| `src/geometry/pen-path.js` | `buildPenPathD()` / `parsePenAnchors()` — shared by pen + node |

## Toolbar tools

| Button | Key | Tool module |
|---|---|---|
| ↖ Select | V | `src/tools/select.js` |
| ↗ Node | A | `src/tools/node.js` |
| ✒ Pen | P | `src/tools/pen.js` |
| ▭ Rect | M | `src/tools/rect.js` |
| ◯ Ellipse | E | `src/tools/ellipse.js` |
| T Text | T | `src/tools/type.js` |
| ⊞T Area Text | — | `src/tools/typearea.js` |
| ⊕ Zoom | Z | `src/tools/zoom.js` |
| ✋ Hand | H | `src/tools/hand.js` |

## Slash commands (Claude Code skills)

| Command | What it does |
|---|---|
| `/new-tool name` | Scaffold a Tool module + icon SVG + registry entry |
| `/new-object name` | Scaffold an ObjectType module + icon + registry entry |
| `/new-theme name` | Scaffold LESS theme file + icon folder |
| `/new-plugin name` | Scaffold a plugin package |
| `/validate-api` | Check all tools/objects/modes for contract compliance |

## Performance rules

`render()` runs on every state mutation and every `mousemove`. Hot paths are `renderLayers()` and `OverlayLayer` redraws.

**Expensive DOM reads (avoid in hot paths):**
- `el.getBoundingClientRect()` — cache it; use `viewport.js` → `getCanvasRect()` + `invalidateRect()`
- `el.getBBox()` — prefer stored shape dimensions; only call as a fallback with a try/catch

**DOM writes:**
- Never `innerHTML = ''` in overlay code — use `OverlayLayer.clear()` + `borrow()`
- Reconcile SVG element attributes, don't recreate elements per frame
- Guard panel rebuilds with a version string (`_versionKey()` pattern): skip if nothing changed

**Hot path mentions `renderLayers()` in old docs — that function is now `_renderTree()` internally.**

**Not worth optimizing:** `Math.*` calls, property access on plain objects, JS arithmetic.

## Known patterns / gotchas

- `syncElement` must call `el.removeAttribute('transform')` — SVG transform is a drag-only preview
- Tools must call `this._ctx.overlay.releaseLayer('id')` in `deactivate()` — layers leak otherwise
- `parsePenAnchors` from `geometry/pen-path.js` reverses anchor order on closed paths — check before relying on index 0 as "first placed"
- Area text wrapping is cached in `text-block.js` — cache invalidates when text/fontSize/fontFamily/boxWidth changes
- `OverlayLayer.clear()` must be called at the top of every redraw, not just when changing content
