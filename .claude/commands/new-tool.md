# /new-tool

Scaffold a new Tool module and its icon SVG. Registers the tool in the built-in index.

## What you provide
- `$ARGUMENTS`: tool name in kebab-case (e.g. `lasso`, `eyedropper`)

## What gets created
- `src/tools/{name}.js` — Tool subclass with all lifecycle methods stubbed
- `assets/themes/default/icons/tools/{name}.svg` — 16×16 currentColor icon
- Entry added to `src/tools/index.js` — import + registerTool call

## Steps
1. Read `src/tools/base.js` to understand the Tool contract.
2. Read `src/tools/rect.js` as a simple reference implementation.
3. Generate `src/tools/{name}.js` with the structure below.
4. Generate the icon SVG following the icon conventions.
5. Add the import and `registerTool(new {ClassName}())` to `src/tools/index.js`.
6. Verify against the contract checklist.

## Generated tool stub structure
```js
import { Tool } from './base.js';
// import helpers as needed

export class {ClassName}Tool extends Tool {
  get id()       { return '{name}'; }
  get label()    { return '{Label}'; }
  get shortcut() { return null; }  // single lowercase char, or null
  get icon()     { return '{name}'; }

  init(ctx) {
    super.init(ctx);
    // ctx provides: state, execute, render, screenToDoc, getElement,
    //   getObjectType, setActiveTool, emit, getModifiers, overlay
  }

  activate()   { /* reset state, call this._ctx.render() */ }
  deactivate() { /* clean up overlay layers */ }

  suspendTo(overrideTool) { /* park in-progress state */ }
  resume()                { this.activate(); }

  subFeatures() { return []; }

  onMouseDown(e) {}
  onMouseMove(e) {}
  onMouseUp(e)   {}
  onDblClick(e)  {}
  onKeyDown(e)   {}
}
```

## Contract checklist
- [ ] `get id()` returns the kebab-case name used in the URL and CSS
- [ ] `init(ctx)` calls `super.init(ctx)` and stores `this._ctx = ctx`
- [ ] `deactivate()` releases any overlay layers acquired via `this._ctx.overlay`
- [ ] Tool does NOT import from other tool modules (use geometry/ utilities instead)
- [ ] Icon SVG uses `fill="currentColor"`, has `viewBox`, no hardcoded width/height
- [ ] Import and `registerTool()` call added to `src/tools/index.js`

## Reference
- `.claude/docs/TOOL-CONTRACT.md` — full contract reference and worked example
- `.claude/docs/INTENT-DISPATCH.md` — how to register dispatch entries for complex tools
