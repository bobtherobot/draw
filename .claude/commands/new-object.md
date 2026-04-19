# /new-object

Scaffold a new ObjectType module and its layers-panel icon SVG.

## What you provide
- `$ARGUMENTS`: object type name in kebab-case (e.g. `image`, `star`)

## What gets created
- `src/objects/{name}.js` — ObjectType subclass with all methods stubbed
- `assets/themes/default/icons/objects/object-{name}.svg` — layers panel icon
- Entry added to `src/objects/index.js` — import + registerObjectType call

## Steps
1. Read `src/objects/base.js` for the full ObjectType contract.
2. Read `src/objects/path.js` as a reference implementation.
3. Generate `src/objects/{name}.js` with all required methods.
4. Generate the icon SVG (16×16, currentColor).
5. Add import + `registerObjectType(new {ClassName}ObjectType())` to `src/objects/index.js`.
6. Verify against the contract checklist.

## Generated ObjectType stub structure
```js
import { ObjectType } from './base.js';

const NS = 'http://www.w3.org/2000/svg';

export class {ClassName}ObjectType extends ObjectType {
  get id()    { return '{name}'; }
  get label() { return '{Label}'; }
  get icon()  { return 'object-{name}'; }

  makeElement(shape) {
    const el = document.createElementNS(NS, /* SVG tag */);
    this.syncElement(el, shape, { mode: 'normal', zoom: 1 });
    return el;
  }

  syncElement(el, shape, _viewState) {
    // Update SVG attributes from shape data
    // NEVER write a transform attribute — bake all transforms into attrs
    el.removeAttribute('transform');
  }

  getBBox(shape, el) { /* return {x, y, width, height} */ }

  hitPart(shape, docX, docY, zoom, el) {
    // return { part: 'body' } or null
  }

  translate(shape, dx, dy) { /* mutate shape.attrs in-place */ }
  scale(shape, sx, sy, ox, oy) { /* mutate shape.attrs */ }
  bakeRotation(shape, angleDeg, cx, cy) { /* mutate shape.attrs */ }

  toSVGString(shape, includeMetadata) { return ''; }
  fromSVGElement(el, nextId) { return null; }
  getWireframePoints(shape) { return []; }
}
```

## Contract checklist
- [ ] `syncElement` NEVER writes a `transform` attribute — geometry is baked into attrs
- [ ] `getBBox` must work without a live DOM element (called before first render)
- [ ] `hitPart` returns `{ part: 'body' }` at minimum for the fill/stroke area
- [ ] `toSVGString` / `fromSVGElement` form a complete round-trip
- [ ] Icon SVG: `fill="currentColor"`, `viewBox`, no hardcoded `width`/`height`
- [ ] Registered in `src/objects/index.js`

## Reference
`.claude/docs/OBJECT-TYPE.md` — full contract with all method signatures and invariants
