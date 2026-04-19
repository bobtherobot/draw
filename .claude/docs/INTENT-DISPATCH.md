# Intent / Dispatch Architecture

## Problem with the current approach

Tool behavior, object-type behavior, and mode behavior are all tangled together inside individual tool files. Some examples of the friction this creates:

- `select.js` has special-case branches for text shapes (`if (shape.type === 'text')`) — it reaches into text internals directly
- Adding wireframe mode required touching `syncElement`, `syncTextElement`, `renderSelection`, `renderWireframeNodes`, and every tool that draws overlays
- Hover/cursor logic is duplicated: type.js walks the DOM to detect text shapes, node.js does its own hit-test, select.js has its own shape-under-cursor check
- There is no single place in the code that answers: "given the active tool, the current mode, and what's under the cursor — what will happen when the user clicks?"
- Adding a new object type (e.g., image, symbol, component) means hunting through every tool file and adding new branches

## Proposed architecture

### Intent context

On every `mousemove`, a shared intent context is computed and stored in `state.intent`:

```js
state.intent = {
  tool:       'select',      // active tool name
  mode:       'normal',      // 'normal' | 'wireframe'
  objectType: 'text-line',   // 'path' | 'text-line' | 'text-block' | 'group' | null
  part:       'body',        // 'body' | 'baseline' | 'node-box' | 'handle-nw' | ... | null
  shape:      Shape | null,  // the actual shape object
}
```

This is computed by a **centralized hit-test** function — not duplicated across tools. The result is frozen: when `mousedown` fires, the handler reads from the intent context that was already established by the preceding hover.

### Hit testing

A single `hitTest(docX, docY): IntentObject` function centralizes all object detection:

- Checks overlay-hit elements first (scale/rotate handles)
- Checks text guide elements (baseline lines, node boxes) — these have `data-shape-id`
- Checks SVG shape elements (walks up from `e.target`)
- Returns `{ shape, objectType, part }` or `{ shape: null, objectType: null, part: null }` for empty canvas

Each object type registers its own part-detection logic (e.g., text-line knows how to distinguish a baseline hit from a body hit based on proximity to the baseline `y` coordinate).

### Dispatch table

Behavior is defined as entries in a dispatch table keyed by `(tool, mode, objectType, part)`:

```js
const dispatch = {
  'select:normal:text-line:body': {
    cursor:      'move',
    onHover:     highlightShape,
    onMouseDown: beginMoveOrSelect,
  },
  'select:normal:text-line:body:dblclick': {
    cursor:      'text',
    onMouseDown: openTextEditor,
  },
  'type:normal:text-line:body': {
    cursor:      'text',
    onMouseDown: openExistingText,
  },
  'type:normal:null:null': {
    cursor:      'crosshair',
    onMouseDown: createNewText,
  },
  'select:normal:path:body': {
    cursor:      'move',
    onMouseDown: beginMoveOrSelect,
  },
  // ... etc
}
```

Key points:
- Each entry is a small, focused handler — no internal `if (shape.type === ...)` branching
- Adding a new mode (e.g., `'presentation'`) only requires new entries in the table
- Adding a new object type (e.g., `'image'`) only requires defining its hit detection and its table entries
- The dispatch table is the single source of truth for "what happens when"

Considerations:
- When in different display modes (normal vs wireframe), objects can behave differently.
- Under some modes (wireframe) we may be able to perform operations (like operations on nodes) across all objects at the same time.

### Cursor and visual feedback

The cursor and any hover highlights are driven entirely by `state.intent`:

```js
// In onMouseMove, after hitTest:
state.intent = computedIntent;
canvas.style.cursor = dispatch[intentKey]?.cursor ?? 'default';
// Optional: trigger hover highlight render
```

No tool needs to manage cursor independently.

### MouseDown dispatch

```js
function onMouseDown(e) {
  const key = intentKey(state.intent);   // e.g. 'select:normal:text-line:body'
  const handler = dispatch[key];
  if (handler?.onMouseDown) handler.onMouseDown(e, state.intent);
}
```

The handler receives the frozen intent — it already knows the shape, type, part, and mode. No re-detection needed.

## Object types

Object types are first-class, not inferred from `shape.type`. The mapping:

| Object type | Condition |
|---|---|
| `'path'` | `shape.type === 'path'` |
| `'text-line'` | `shape.type === 'text'` and `!shape._isArea` |
| `'text-block'` | `shape.type === 'text'` and `shape._isArea` |
| `'group'` | `shape.type === 'group'` |

This separation matters because text-line and text-block have fundamentally different behaviors under every tool.

## Parts

Parts subdivide what region of an object the cursor is over:

| Part | Meaning |
|---|---|
| `'body'` | The shape's fill/stroke area |
| `'baseline'` | A text guide baseline line (text-line only) |
| `'node-box'` | The alignment anchor square (text-line only) |
| `'anchor'` | A bezier anchor point (node tool context) |
| `'handle'` | A bezier control handle |
| `'scale-nw'` … `'scale-se'` | Selection bounding box scale handles |
| `'rotate'` | The rotate handle circle |
| `null` | Empty canvas (no object under cursor) |

## Migration strategy

The current tool files don't need to be rewritten all at once. A phased approach:

1. **Add `state.intent`** and `hitTest()` — computed on mousemove but not yet used for dispatch. Tools continue working as-is.
2. **Drive cursor from intent** — remove per-tool cursor management, replace with the table lookup.
3. **Migrate one tool at a time** — start with the select tool (highest complexity, most object-type branches). Extract its per-objectType handlers into dispatch entries.
4. **Extract object type modules** — each object type (`path`, `text-line`, etc.) gets a module that defines its hit-test logic and its dispatch entries, rather than living inside tool files.

## Files expected to change

| File | Change |
|---|---|
| `src/state.js` | Add `intent: {}` field |
| `src/main.js` | Add global `mousemove` → `hitTest` + intent update; mousemove/mousedown dispatch |
| `src/intent.js` | New: `hitTest()`, `intentKey()`, dispatch table registry |
| `src/tools/select.js` | Extract object-type branches into dispatch entries |
| `src/tools/type.js` | Hover/cursor logic moves to intent system |
| `src/tools/node.js` | Hit-test logic moves to intent system |
| `src/objects/path.js` | New: path-specific hit-test + dispatch entries |
| `src/objects/text-line.js` | New: text-line-specific hit-test + dispatch entries |
| `src/objects/text-block.js` | New: text-block-specific hit-test + dispatch entries |
