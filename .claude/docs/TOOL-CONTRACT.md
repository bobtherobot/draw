# Tool Contract

## Purpose
Tools are stateful singletons that handle user interaction for a specific editing mode (select, pen, rect, etc.). Each tool is responsible for its own overlay elements, cursor feedback, and undo entries. Tools interact with the app only through the AppContext passed to `init()`.

## Contract — method signatures

```js
class Tool {
  // ── Identity ──────────────────────────────────────────────────────────────
  get id()       // string — unique kebab-case id (matches CSS class: tool-{id})
  get label()    // string — display name
  get shortcut() // string|null — single lowercase char, or null
  get icon()     // string — icon name in assets/themes/default/icons/tools/

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  init(ctx)        // called once at startup; store: this._ctx = ctx (via super.init)
  activate()       // called when tool becomes active; reset state, re-draw overlay
  deactivate()     // called when another tool becomes active; MUST release overlay layers
  suspendTo(id)    // modifier override took over; park in-progress state
  resume()         // modifier released; default calls this.activate()

  // ── Sub-features (optional) ───────────────────────────────────────────────
  subFeatures()    // () → SubFeature[]  (see base.js typedef)
  setSubFeature(id)// activates a sub-feature by id

  // ── Mouse / keyboard handlers ─────────────────────────────────────────────
  onMouseDown(e)   // MouseEvent (screen coords)
  onMouseMove(e)
  onMouseUp(e)
  onDblClick(e)
  onKeyDown(e)     // KeyboardEvent
}
```

## AppContext
Available as `this._ctx` after `init()`:

| Property | Type | Description |
|---|---|---|
| `state` | object | Global state (shapes, selection, viewport, etc.) |
| `execute(cmd)` | function | Run a command + push to undo stack |
| `render()` | function | Trigger a full render pass |
| `screenToDoc(sx, sy)` | function | Convert screen px → doc coords |
| `getElement(shapeId)` | function | Get the live SVG element for a shape |
| `getObjectType(typeId)` | function | Get an ObjectType from the registry |
| `setActiveTool(toolId)` | function | Switch to another tool |
| `emit(event, data)` | function | Fire an internal event |
| `getModifiers()` | function | Get a snapshot of current modifier state |
| `overlay` | OverlayManager | Acquire named overlay layers |

## Overlay pattern
```js
activate() {
  this._layer = this._ctx.overlay.acquireLayer('my-tool');
  this._layer.clear();
}

deactivate() {
  this._ctx.overlay.releaseLayer('my-tool');
  this._layer = null;
}

_redraw() {
  this._layer.clear();
  const line = this._layer.borrow('line');
  line.setAttribute('x1', ...);
  // add more elements via layer.borrow(tag)
}
```

`layer.clear()` recycles all borrowed elements back to the pool. `layer.borrow(tag)` returns a pooled SVGElement appended to the layer's `<g>`.

## Undo pattern
```js
const snapshot = { ...shape.attrs };
ctx.execute({
  do()   { shape.attrs.d = newD; ctx.render(); },
  undo() { shape.attrs.d = snapshot.d; ctx.render(); },
});
```

## Invariants
1. **Never import from sibling tool files.** Use `../geometry/` utilities instead.
2. **Always release overlay layers in `deactivate()`.**
3. **Never call `document.getElementById('overlay').innerHTML = ''`.** Use `layer.clear()`.
4. All geometry in doc coords — convert screen events with `ctx.screenToDoc(e.clientX, e.clientY)`.
5. `init()` must call `super.init(ctx)`.

## Common mistakes
- Forgetting to call `layer.clear()` before `_redraw()` → stale overlay elements pile up
- Importing `render` directly instead of using `ctx.render` → breaks when renderer is replaced
- Not releasing overlay in `deactivate()` → layer leaks when tool switches

## Example — minimal drawing tool
See `src/tools/rect.js` for a clean minimal implementation.
See `src/tools/pen.js` for overlay element pooling via OverlayLayer.
