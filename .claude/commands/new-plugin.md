# /new-plugin

Scaffold a plugin package that can add new tools, object types, modes, or panels.

## What you provide
- `$ARGUMENTS`: plugin name in kebab-case (e.g. `lasso-tool`, `star-shapes`)

## What gets created
- `plugins/{name}/index.js` — plugin entry point with `{ id, version, install(registry) }`
- Optionally calls `/new-tool` or `/new-object` within the plugin's scope

## Steps
1. Generate `plugins/{name}/index.js` with the plugin shell.
2. Ask: does this plugin add a tool, an object type, a mode, or a panel? Generate the appropriate submodule.
3. Register the submodule inside `plugin.install()`.
4. Note: plugins are loaded by adding a `<script type="module">` to index.html — the thin shell stays unchanged.

## Generated plugin structure
```js
// plugins/{name}/index.js
export default {
  id:      '{name}',
  version: '1.0.0',

  install(registry) {
    // registry exposes the same API as src/core/registry.js:
    //   registerObjectType, registerTool, registerMode, registerPanel,
    //   registerKeybindings, registerDispatch, registerModifierOverride,
    //   on, emit, ObjectType, Tool, Mode

    // Example: register a new tool
    // import { MyTool } from './my-tool.js';
    // registry.registerTool(new MyTool());
  },
};
```

## Loading the plugin in index.html
```html
<script type="module">
  import { installPlugin } from './src/core/registry.js';
  import MyPlugin from './plugins/{name}/index.js';
  installPlugin(MyPlugin);
</script>
```

Add this block after the main `<script type="module" src="src/main.js">` tag.

## Contract checklist
- [ ] `id` is unique across all plugins
- [ ] `install(registry)` does not import from `src/controls/` — only from `src/core/`, `src/objects/base.js`, `src/tools/base.js`, `src/modes/base.js`
- [ ] Plugin tools/objects use `registry.registerTool` / `registry.registerObjectType`, not direct Map manipulation
- [ ] Icon SVGs placed in `assets/themes/default/icons/` following icon conventions

## Reference
`.claude/docs/PLUGIN-GUIDE.md` — full plugin API surface and worked example
