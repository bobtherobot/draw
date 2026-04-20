# Draw — TODO

Tracks remaining work across sessions. Check off items as they are completed.
Add new items under the appropriate section as work progresses.

---

## v2 Rewrite — Build Phases

- [x] Phase 0: Git setup (v1 branch preserved, v2 branch, clean scaffold)
- [x] Phase 1: All default icon SVGs (tools, ui, objects, handles, cursors)
- [x] Phase 2: Core JS modules (state, history, events, registry, intent, hit-test, modifiers, icons, viewport, textedit)
- [x] Phase 3: Full LESS stack (variables, mixins, reset, all 9 component files, light theme)
- [x] Phase 4: ObjectType modules (path, text-line, text-block, group)
- [x] Phase 5: Render pipeline (renderer, overlay manager, selection, text-guides)
- [x] Phase 6: Modes (normal, wireframe)
- [x] Phase 7: IO (serializer, newDocument, openSVG, saveSVG, exportSVG)
- [x] Phase 8: All 9 tools (select, node, pen, rect, ellipse, type, typearea, zoom, hand)
- [x] Phase 9+10: Canvas event routing, intent/dispatch, all 5 control panels
- [x] Phase 11: Developer tooling (slash command skills, reference docs, CLAUDE.md rewrite)

---

## Bug Fixes Applied

- [x] `textedit.js`: Textarea positioned in viewport space — fixed to canvas-wrap-relative coords
- [x] `viewport.js`: `zoomAt`/`panBy`/`fitToArtboard` used `emit('render')` instead of triggering render pipeline — fixed via `'viewport-change'` event + `on('viewport-change', render)` in `main.js`
- [x] `layers-panel.js`: Add-layer do/undo called `emit('render')` instead of `render()` — layer shapes weren't redrawn
- [x] `select.js`: Dead `post` variable in `_openTextEditor` removed
- [x] `select.js`: Edge-only scale handles (n/s/e/w) incorrectly scaled both axes — now correctly constrain to one axis
- [x] `select.js`: `shape._isArea` → `shape.type === 'text-block'` for text editor open
- [x] `toolbar.js`: Dynamic imports for `zoomAt` and `on` replaced with static imports
- [x] `keyboard.js`: Broken `require`-based lazy import replaced with static `getAllTools` import
- [x] `renderer.js`: `initRenderer` signature unified to accept single `svg` element

---

## Needs Browser Verification

All tools need hands-on testing at http://localhost:8000. Known risk areas:

- [ ] App boots without console errors
- [ ] All 9 tool buttons appear in toolbar with correct icons
- [ ] Select tool: click-select, shift-click multi-select, rubber-band, move, scale handles (all 8), rotate handle, delete key
- [ ] Select tool: double-click text → opens textarea overlay at correct position
- [ ] Node tool: drag anchor, drag control handles, smooth mirroring, marquee anchor selection
- [ ] Pen tool: click to place anchors, drag to curve, close path, Escape to finish open
- [ ] Rect tool: drag to draw, Shift to constrain square
- [ ] Ellipse tool: drag to draw, Shift to constrain circle
- [ ] Type tool: click to place, type, Enter/Escape to commit, result appears on canvas
- [ ] TypeArea tool: drag box, type, text wraps within box
- [ ] Zoom tool: click to zoom in, Alt+click to zoom out; Cmd+scroll wheel zoom
- [ ] Hand tool: drag to pan; Space held → hand override while any other tool is active
- [ ] Meta held → select override from any tool
- [ ] Undo/redo: Cmd+Z / Cmd+Shift+Z cycle correctly
- [ ] Open SVG: file picker opens, shapes load
- [ ] Save SVG: file downloads with all shapes
- [ ] Wireframe mode: shapes render as stroke-only outlines
- [ ] Light theme: `body[data-theme="light"]` switches all colors; icons inherit correctly
- [ ] Layer panel: add layer, rename (dblclick), visibility toggle, lock toggle

---

## Features To Add

### Style panel
- [ ] Font size control (number input) — reflects selected text shape's `_fontSize`; applies to selection via execute()
- [ ] Font family control (select/dropdown) — applies `_fontFamily` to selected text shapes
- [ ] Stroke dash pattern selector (none / dashed / dotted)

### Editing
- [ ] Copy / paste (Cmd+C / Cmd+V) — shapes clone with offset; clipboard stored in `state.clipboard`
- [ ] Group / ungroup (Cmd+G / Cmd+Shift+G) — wraps selected shapes in a `group` ObjectType
- [ ] Duplicate (Cmd+D) — clone selected shapes with offset

### Canvas / view
- [ ] Snapping to grid / to other shapes (optional, low priority)
- [ ] Ruler display along top and left edges (optional)

### Document
- [ ] Document setup dialog (width, height, name) — triggered by Cmd+Shift+D or menu
- [ ] Export as PNG (via `canvas` element rasterization of the SVG)
- [ ] MIKE: We must remember that we need to consider how we save files. Currently, I believe the the "save" feature is geared to just exporting the SVG. We'll want to change this so that save generates a JSON file, where we include everything that is needed to restore the file, including the layer structure, show/hide/lock states and any other important information needed to restore the user's project to the state it was in while they were working. So some thought needs to go into how we structure the JSON. We'll probably want to include timestamps, when the file was created, and an array of all the times it was edited.

### Status bar
- [ ] Display active tool name + cursor position in doc coordinates
- [ ] Display selection count when shapes are selected

### Plugin / extension
- [ ] Load and verify a test plugin from `plugins/` folder end-to-end
- [ ] Publish stable import paths for `ObjectType`, `Tool`, `Mode` base classes

### Context Menu
- [ ] certain controls and panels will need right-click behaviour to pop-up a context menu for special features.

---

## Known Limitations / Future Work

- Text rotation not supported (text-line `bakeRotation` is a no-op)
- Group ObjectType is registered but group creation (Cmd+G) is not wired up
- No snap-to-grid or smart guides
- No artboard resize in-session (requires document setup dialog)
- `openSVG` round-trip only preserves shapes with `data-type` metadata attributes; generic SVG import is partial
- Provide a way for users to export/import all options and settings, so they can restore their setup or share their setup.
