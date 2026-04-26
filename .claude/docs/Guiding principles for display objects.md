
# Guiding principles for display objects

This document describes the architectural intent behind how items are modelled, rendered, and transformed in the draw editor. It reflects decisions made through v4 development and should be updated as the architecture evolves.

---

## Everything is a Container

Every item on stage — a path, a text block, a group, an artboard — is an instance of `Container` (or a subclass of it). There is no separate class hierarchy for "containers" vs "display items." The difference is only in what a `Container` holds:

- A **leaf item** (Path, FreeText, TextBlock) has a `DisplayObject` renderer and an empty `_children` array.
- A **group** has a no-op renderer and a populated `_children` array.
- An **artboard** has a rect renderer and a populated `_children` array.

This means every item inherits the same transform pipeline, the same selection machinery, the same overlay handles, and the same snapshot/undo lifecycle — with no parallel code paths.

---

## The four roles

When an item is created on stage, four objects come into existence:

### 1. The shape POJO (data)
A plain JSON-serialisable object that lives in `state.shapes[]` and is the only thing persisted to disk. It holds geometry (`attrs`), style, tree position (`parentId`), and display state (`visible`, `locked`, `name`). It is mutated in-place; it is never replaced or cloned during a live session.

```js
{ id, type, parentId, attrs, style, visible, locked, name, ... }
```

### 2. Container (controller)
A `Container` instance in the `ShapeRegistry` (`src/core/shape-registry.js`). It holds:
- `_shape` — live reference to the POJO
- `_parent`, `_children` — direct object pointers forming the runtime tree
- `_displayObject` — the type-specific renderer singleton
- `_overlay` — the selection handle renderer
- `_aux` — optional type-specific extra rendering (e.g. text baseline)
- `_prev` — snapshot for the current transform operation

The `Container` is the single entry point for everything: rendering, hit-testing, transforms, undo. Nothing outside should reach into `_shape` directly during a transform — it goes through `Container`.

### 3. DisplayObject (renderer)
A stateless singleton per type. It knows how to draw, measure, hit-test, and mutate one specific shape type. It is never instantiated per item — one instance serves all items of that type. It has no own state; all state lives in the POJO it receives as an argument.

Methods: `draw`, `getBBox`, `hitPart`, `translate`, `scale`, `bakeRotation`, `toSVGString`, `fromSVGElement`, `createShape`.

### 4. Overlay (handles)
A per-item object that renders visual selection/transform handles in screen space — bounding box, scale handles, rotate handle, origin crosshair. Recomputed every frame from the item's current geometry; never caches screen coordinates across frames.

### 4b. Aux (optional extras)
Some types need extra visuals beyond the core overlay: text baselines, anchor squares, hover outlines. These live in a per-item `Aux` instance rather than in the `Container` or `Overlay`, keeping those classes focused.

---

## The tree

Items form a tree via `parentId` in the POJO (the serialisable source of truth). At runtime, `ShapeRegistry.syncControllers()` rebuilds two direct-pointer shortcuts on every `Container`:

```
_parent:   Container | null   — pointer up to parent
_children: Container[]        — pointers down to all direct children
```

There is no separate "children array" in the POJO — `parentId` is the single source of truth and there are no two-direction sync problems.

---

## Transforms recurse automatically

The `Container` base class implements `applyMove`, `applyScale`, and `applyRotate` with child propagation built in:

```
container.applyMove(dx, dy)
  → moves own geometry (if any)
  → for each child: child.applyMove(dx, dy)
```

This means moving a group automatically moves all its descendants. No tool or call site needs to know about the tree shape — it calls the transform on the top-level selected container and the tree handles the rest.

**Exceptions** (subclass overrides):
- `Artboard.applyScale` / `applyRotate` — suppresses child propagation. Resizing the artboard canvas does not resize its contents.
- `Group.DisplayObject.translate/scale` — no-ops, since groups have no own geometry.

The snapshot lifecycle also recurses:
- `beginOp()` snapshots self and all descendants
- `commitOp()` returns `{id, pre, post}[]` for self and all descendants

---

## Key design rules

1. **Shape POJOs are always mutated in-place.** Never replace a POJO object reference. The `Container` holds a live `_shape` pointer — replacing the object silently breaks it.

2. **`_parent` / `_children` are runtime-only.** They are never serialised. They are rebuilt from `parentId` on every `syncControllers()` call.

3. **`DisplayObject` is stateless.** One instance handles all items of that type. Never store per-item state on a `DisplayObject`.

4. **All geometry lives in `attrs`.** There is no `transform` attribute on persisted shapes. Scale and rotation are baked into coordinates (`bakeRotation`, `scale`). SVG `transform` is used only as a drag preview and is stripped on commit.

5. **Transforms never call `render()` directly.** `applyX()` mutates the shape; the calling tool calls `render()` after.

6. **`commitOp()` returns an array.** Even for leaf items with no children, it returns `[{id, pre, post}]`. Call sites always spread: `entries.push(...ctrl.commitOp())`.

7. **The `Container` is the source of truth during an operation.** `beginOp()` snapshots the state before any drag. Every `applyX()` call restores from that snapshot first, then applies the new delta. This makes it safe to call `applyX()` on every mousemove without accumulating error.

---

## Adding a new item type

1. Create `src/objects/types/MyType.js`
2. Write `class MyTypeRenderer extends DisplayObject { get id() { ... } draw() { ... } ... }`
3. Write `export class MyType extends Container { static id = '...'; static renderer = new MyTypeRenderer(); _createDisplayObject() { return MyType.renderer; } }`
4. Register in `src/objects/index.js`: `registerObjectType(MyType)`
5. Optionally override `_createAux(shape)` on the controller for type-specific extras.
6. Optionally override `applyScale` / `applyRotate` if child propagation should be suppressed.
