# Draw — TODO

Tracks remaining work across sessions. Check off items as they are completed.
Add new items under the appropriate section as work progresses.

Current branch: **v4**. The v2 build-phase checklist that used to live here is
finished and has been removed; see git history for it.

---

## Done — v4 architecture

- [x] Companion-object architecture — universal `Container` base, every item on
      stage (path, text, group, artboard) gets a controller
- [x] `_parent` / `_children` runtime tree wired on every Container
- [x] `SelectionProxy` — replaces `for (const id of selection)` loops in
      Select.js and TransformController
- [x] CanvasKit (Skia WASM) render backend; text on a Canvas 2D overlay
- [x] Groups — create/ungroup (Cmd+G / Cmd+Shift+G), hit-test promotion, full
      `GroupRenderer` geometry, `normalizeGroup()` on deselect
- [x] Rotate/scale/move incl. rotated multi-selection persisting through
      rotate → scale → rotate → move sequences
- [x] Rotated free-text editing (textarea CSS-rotated to match the shape)
- [x] Type tool: first-click caret placement, drag-to-select, rotation-aware
      hover outline
- [x] Matrix transform layer (`mat2d.js`) — `_transform` DOMMatrix on every shape
- [x] Direct Select tool (V); Select moved to A; Node tool unbound
- [x] Rubber-band "Select by Intersect" option (Edit > Options)
- [x] Undo/redo, layers panel, style panel, pan/zoom, hand/zoom tools
- [x] Save/load `.draw` JSON; SVG import/export

---

## Next up

### Editing
- [ ] Copy / paste (Cmd+C / Cmd+V) — shapes clone with offset; clipboard in `state.clipboard`
- [ ] Duplicate (Cmd+D) — clone selection with offset
- [ ] Align / distribute for multi-selection (no panel or shortcut yet)
- [ ] Tab to cycle selection

### Style panel
- [ ] Font family picker
- [ ] Font weight picker
- [ ] Stroke dash pattern selector (none / dashed / dotted)

### Document
- [ ] Document setup dialog (artboard width / height / name)
- [ ] Export as PNG (rasterize the CanvasKit surface)
- [ ] Export / import all options and settings so a setup can be restored or shared

### UI
- [ ] Context menus (right-click on canvas, panels, layer rows)
- [ ] Status bar — active tool, cursor position in doc coords, selection count
- [ ] Angle readout while rotating
- [ ] Display units — pt/mm/cm/in selector exists in Options but coordinates
      still always render in px

---

## Deferred / known gaps

- [ ] Artboard resize UI — `Artboard.applyScale` is implemented but untested via
      the UI; needs select + scale artboard without resizing its contents
- [ ] Proper CanvasKit font loading (fetch TTF; 0.41.1 ships no bundled fonts)
- [ ] Snapping to grid / smart guides
- [ ] Rulers along top and left edges
- [ ] Double-click a group to enter isolated group-editing mode
- [ ] Plugin API — load and verify a test plugin from `plugins/` end-to-end;
      publish stable import paths for the `Container` / `BaseTool` / `Mode` bases
- [ ] `importSVG` round-trip only fully preserves shapes carrying `data-type`
      metadata; generic SVG import is partial
- [ ] Free-text anchor squares and baseline guides are currently missing —
      decide whether to restore them or drop them deliberately

### Wireframe mode

Consolidate the design into `WIREFRAME-MODE.md`. Intended behaviour: in
wireframe mode the app treats the artboard as if everything were in direct
select mode — all nodes editable at once. The Select tool still picks
individual objects, but clicking any control point or shape line activates
that shape.

### Collections

A collection spans layers, groups and shapes — unlike a layer or a group.
Anything added to a collection can be shown/hidden, locked, or restyled
together when the collection is selected. Open question: allowing individual
shape *nodes* into a collection may only make sense in wireframe mode.

---

## Matrix layer — deferred follow-ups

`_transform` is in place but not yet the render-time source of truth. Remaining:

- [ ] `hitPart()` inverse transform — FreeText still un-rotates hit points
      manually via `rotatePoint`; could become `transformPoint(inverse(m), x, y)`
- [ ] TransformController accumulated matrix — replace `_rotCenter` /
      `_rotStart` / `_initialAngle` / `_rotInitialCenter` with one accumulator
- [ ] FreeText `_scaleX/_scaleY/_rotation/_rotCx/_rotCy` → single matrix;
      `drawCanvas2D` does `ctx.setTransform(...)` and draws at (0,0) local
- [ ] Non-uniform scale / shear — encode directly in the matrix once
      `_transform` is authoritative
- [ ] Node-point transforms via `transformPoint` on individual Bézier controls
- [ ] Remove `_rotDisplay` reads from `Overlay.draw` and `selection.js`
