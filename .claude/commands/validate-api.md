# /validate-api

Check that all Tool, ObjectType, and Mode modules conform to their contracts.

## What you provide
Nothing — runs on the whole codebase.

## What gets checked
For every file in `src/tools/` (except `base.js`, `index.js`):
- [ ] Class extends `Tool`
- [ ] `get id()` is implemented (not inherited from base)
- [ ] `init(ctx)` calls `super.init(ctx)`
- [ ] `deactivate()` releases all overlay layers acquired in `activate()` or `init()`
- [ ] No `import` from sibling tool files (only from `../geometry/`, `../core/`, `../textedit.js`, `./base.js`)
- [ ] Referenced icon file exists in `assets/themes/default/icons/tools/`
- [ ] Tool is registered in `src/tools/index.js`

For every file in `src/objects/` (except `base.js`, `index.js`):
- [ ] Class extends `ObjectType`
- [ ] `get id()` implemented
- [ ] `makeElement`, `syncElement`, `translate`, `scale`, `bakeRotation` implemented
- [ ] `syncElement` never calls `el.setAttribute('transform', ...)` with a transform value
- [ ] `getBBox` works without a live DOM element (no `el.getBBox()` without fallback)
- [ ] Referenced icon file exists in `assets/themes/default/icons/objects/`
- [ ] Type is registered in `src/objects/index.js`

For every file in `src/modes/` (except `base.js`, `index.js`):
- [ ] Class extends `Mode`
- [ ] `get id()` implemented
- [ ] Mode is registered in `src/modes/index.js`

Cross-cutting checks:
- [ ] No `if (shape.type === '...')` type branches in any tool file
- [ ] No raw `overlay.innerHTML = ''` in any file (use OverlayLayer.clear())

## Steps
1. Read each file in `src/tools/`, `src/objects/`, `src/modes/`.
2. For each, run through the checklist above.
3. Report: PASS / FAIL per module, with file:line for any failures.
4. Suggest fixes for any failures found.

## Reference
- `.claude/docs/TOOL-CONTRACT.md`
- `.claude/docs/OBJECT-TYPE.md`
