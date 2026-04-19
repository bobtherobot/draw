# Plugin Guide

## Plugin shape
A plugin is a plain JS object with `id`, `version`, and `install(registry)`.

```js
// plugins/my-plugin/index.js
export default {
  id:      'my-plugin',
  version: '1.0.0',

  install(registry) {
    // Everything the registry exposes:
    // registerObjectType, registerTool, registerMode, registerPanel,
    // registerKeybindings, registerDispatch, registerModifierOverride,
    // on, emit, ObjectType, Tool, Mode (base classes for subclassing)

    registry.registerTool(new MyTool());
    registry.registerObjectType(new MyObjectType());
  },
};
```

## Loading a plugin
Add a `<script type="module">` block to `index.html` **after** the main script:

```html
<script type="module" src="src/main.js"></script>
<script type="module">
  import { installPlugin } from './src/core/registry.js';
  import MyPlugin from './plugins/my-plugin/index.js';
  installPlugin(MyPlugin);
</script>
```

Plugins are installed at page load before `render()` runs, so their tools and object types are available from the first frame.

## Adding a tool
```js
import { Tool } from './src/tools/base.js';  // or from registry.Tool

class MyTool extends Tool {
  get id()       { return 'my-tool'; }
  get label()    { return 'My Tool'; }
  get shortcut() { return null; }
  get icon()     { return 'my-tool'; }  // assets/themes/default/icons/tools/my-tool.svg

  activate()   { /* reset state */ }
  deactivate() { /* release overlay layers */ }
  onMouseDown(e) { /* ... */ }
}
```

## Adding an object type
```js
import { ObjectType } from './src/objects/base.js';  // or from registry.ObjectType

class MyObjectType extends ObjectType {
  get id()    { return 'my-object'; }
  get label() { return 'My Object'; }
  get icon()  { return 'object-my-object'; }
  makeElement(shape)         { /* ... */ }
  syncElement(el, shape, vs) { el.removeAttribute('transform'); /* ... */ }
  getBBox(shape, el)         { /* ... */ }
  hitPart(shape, x, y, z)   { return null; }
  translate(shape, dx, dy)   { /* mutate shape.attrs */ }
  scale(shape, sx, sy, ox, oy) { /* ... */ }
  bakeRotation(shape, a, cx, cy) { /* ... */ }
  toSVGString(shape, meta)   { return ''; }
  fromSVGElement(el, nextId) { return null; }
}
```

## Registering dispatch entries
```js
import { registerDispatch } from './src/core/intent.js';

// When my-tool is active and the user clicks on a path body:
registerDispatch('my-tool', '*', 'path', 'body', 'mousedown', (intent, ctx, e) => {
  // intent.shape = the hit shape
  // ctx = AppContext
});
```

## Registering modifier overrides
```js
import { registerModifierOverride } from './src/core/modifiers.js';

// Alt+Ctrl held → switch to my-tool temporarily
registerModifierOverride(['alt', 'ctrl'], 'my-tool', 5);
```

## Rules
- Plugins must not import from `src/controls/` — only from `src/core/`, `src/geometry/`, and their own files
- Plugin icon SVGs go in `assets/themes/default/icons/` following SVG conventions (`fill="currentColor"`, no hardcoded size)
- `plugin.id` must be globally unique; prefix with your namespace (e.g. `acme-lasso`)
