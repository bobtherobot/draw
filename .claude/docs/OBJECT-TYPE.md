# ObjectType Contract

## Purpose
ObjectType is a **stateless singleton** that owns all knowledge about one shape type: how to create, render, hit-test, transform, and serialize it. Shape data stays as plain POJOs — ObjectType never holds per-shape state.

## Contract — method signatures

```js
class ObjectType {
  // ── Identity ──────────────────────────────────────────────────────────────
  get id()    // string — matches shape.type (e.g. 'path', 'text-line')
  get label() // string — layers panel label
  get icon()  // string — icon name in assets/themes/default/icons/objects/

  // ── Shape creation ────────────────────────────────────────────────────────
  createShape(initAttrs, initStyle, nextId) → shape POJO
  // Default: { id: nextId(), type: this.id, attrs: {...initAttrs}, style: {...initStyle} }

  // ── Rendering ─────────────────────────────────────────────────────────────
  makeElement(shape) → SVGElement
  syncElement(el, shape, viewState)  // viewState = { mode, zoom }
  // INVARIANT: syncElement must call el.removeAttribute('transform')

  // ── Geometry queries ──────────────────────────────────────────────────────
  getBBox(shape, el?) → { x, y, width, height } | null
  // Must work without el (called before first render for selection import)

  hitPart(shape, docX, docY, zoom, el?) → { part: string, detail?: * } | null
  parts(shape) → [{ id, cursor?, isVisible? }]
  // Default: [{ id: 'body', cursor: 'move' }]

  // ── Geometry mutations (mutate shape in-place) ────────────────────────────
  translate(shape, dx, dy)
  scale(shape, sx, sy, ox, oy)
  bakeRotation(shape, angleDeg, cx, cy)

  // ── Serialization ─────────────────────────────────────────────────────────
  toSVGString(shape, includeMetadata) → string
  fromSVGElement(el, nextId) → shape | null
  // fromSVGElement returns null if this type doesn't handle the element

  // ── Wireframe ─────────────────────────────────────────────────────────────
  getWireframePoints(shape) → [{x, y}]
}
```

## Standard part ids

| Part id | Meaning |
|---|---|
| `body` | Fill/stroke area — main click target |
| `baseline` | Text baseline guide |
| `handle-nw` … `handle-se` | Scale handles (set by selection renderer) |
| `rotate` | Rotation handle |
| `anchor` | Bezier anchor point |
| `handle-in` / `handle-out` | Bezier control handles |

## Invariants
1. **`syncElement` never writes `transform`** — all geometry mutations must be baked into `attrs`.
2. **`getBBox` must not require a live element** — fallback to coordinate math if `el` is null.
3. **`toSVGString` + `fromSVGElement` form a round-trip** — saving and reloading must produce identical shape data.
4. **ObjectType is stateless** — no per-shape state, no mutable instance variables that depend on which shape is active.
5. **All coordinate values stored as numbers** — never store `"100px"`, only `100`.

## Common mistakes
- Storing shape-specific state on the ObjectType instance → breaks multi-shape rendering
- Calling `el.getBBox()` without a null check or fallback in `getBBox()` → crash before first render
- Writing a `transform` attribute in `syncElement` → confuses undo, hit-test, and export

## Example — minimal path implementation
See `src/objects/path.js`.
See `src/objects/text-line.js` for a shape with extra fields beyond `attrs` and `style`.
