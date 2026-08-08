# Draw

A browser-based vector graphics editor — minimal, keyboard-driven, no bundler.

Plain ES modules served straight from disk, rendered with CanvasKit (Skia
compiled to WebAssembly). The only build step in the whole project is
compiling LESS to CSS.

---

## Requirements

| Need | Why |
|---|---|
| Node.js + npm | Only to run `lessc` and the file watcher |
| Python 3 | Only to serve static files (`python3 -m http.server`) |
| A modern browser | Needs ES modules, `DOMMatrix`, and WebAssembly |

There is no JavaScript build, bundle, or transpile step. `src/**/*.js` is
loaded by the browser exactly as it sits on disk.

---

## Setup

```bash
git clone <repo-url> draw
cd draw
npm install
npm run css      # required — dist/ is gitignored, so main.css does not exist yet
```

`npm run css` is not optional on a fresh clone. `index.html` links
`dist/main.css`, and `dist/` is in `.gitignore`, so without this step the app
loads with no styling at all.

---

## Running the dev server

Use two terminals:

```bash
# Terminal 1 — recompile LESS on every change
npm run css:watch

# Terminal 2 — serve the project root
npm run serve
```

Then open <http://localhost:8000>.

Serving over HTTP is required — opening `index.html` via `file://` fails,
because ES module imports and the CanvasKit `.wasm` fetch are both blocked by
the browser's file-origin rules.

Only restart the server if you change `index.html` or add files. Editing
`src/**/*.js` needs nothing but a browser reload; editing `styles/**/*.less`
needs nothing at all if `css:watch` is running.

### About `npm run dev`

There is a one-terminal `npm run dev` script, but be aware of how it behaves:

```json
"dev": "npm run css && npm run serve & npm run css:watch"
```

The shell parses this as `(css && serve) & css:watch`, so the HTTP server is
backgrounded and only the LESS watcher runs in the foreground. Pressing Ctrl+C
stops the watcher and leaves the server running as an orphan on port 8000 — a
later `npm run serve` will then fail with "address already in use". Clean up
with:

```bash
pkill -f "http.server 8000"
```

The two-terminal workflow above avoids this entirely and is the recommended
way to work.

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run css` | Compile `styles/main.less` → `dist/main.css`, once |
| `npm run css:watch` | Recompile on any change under `styles/**/*.less` |
| `npm run serve` | Static file server on port 8000 |
| `npm run dev` | Both at once — see the caveat above |

### "Build" / deploy

There is no production build. To deploy, compile the CSS and copy the tree:

```bash
npm run css
```

Then serve these paths from any static host:

```
index.html
dist/main.css
src/**            (ES modules, loaded as-is)
assets/**         (icons, themes, vendored CanvasKit)
```

`node_modules/` is build-time only and is not needed at runtime. The whole app
is static — no server-side component.

---

## Project layout

```
index.html            entry point; links dist/main.css and src/main.js
src/
  main.js             boots the app — imports registrations, inits controls, renders
  app.js              builds the #app DOM; applyTheme()
  core/               state, registry, intent dispatch, hit-test, history, modifiers
  objects/            Container base + shape types (Path, FreeText, TextBlock, Group, Artboard)
  tools/              BaseTool + Select, DirectSelect, Node, Pen, Rect, Ellipse, Type, …
  render/             CanvasKit renderer, selection overlay, OverlayManager
  modes/              normal / wireframe
  io/                 open, save, SVG import/export, .draw JSON serializer
  operations/         grouping and other multi-shape operations
  utils/              geometry (path-utils, transform, mat2d, bbox), snapshots
styles/
  main.less           the single LESS entry point
  core/               variables + mixins
  components/         one file per UI component
  themes/             light theme overrides
assets/
  themes/             per-theme icon sets (default, light, high-contrast)
  vendor/canvaskit/   vendored canvaskit.js + canvaskit.wasm
dist/main.css         compiled output — gitignored
```

Architecture, extension points, and the render pipeline are documented in
[CLAUDE.md](CLAUDE.md); deeper reference docs live in `.claude/docs/`
(`TOOL-CONTRACT.md`, `OBJECT-TYPE.md`, `INTENT-DISPATCH.md`, `PLUGIN-GUIDE.md`,
`THEME-GUIDE.md`, and others).

---

## Keyboard shortcuts

### Tools

| Key | Tool |
|---|---|
| `V` | Direct Select |
| `A` | Select |
| `P` | Pen |
| `M` | Rect |
| `E` | Ellipse |
| `T` | Type |
| `Z` | Zoom |
| `H` | Hand |

Node and Area Text have no shortcut; pick them from the toolbar.

### Modifiers (held)

| Hold | Effect |
|---|---|
| `Space` | Temporarily switch to Hand (pan) |
| `Cmd` / `Ctrl` | Temporarily switch to whichever select tool was last used |

### Commands

| Shortcut | Action |
|---|---|
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / redo |
| `Cmd+G` / `Cmd+Shift+G` | Group / ungroup |
| `Cmd+N` / `Cmd+O` / `Cmd+S` | New / open / save |
| `Cmd+=` / `Cmd+-` / `Cmd+0` | Zoom in / out / fit to artboard |

`Ctrl` substitutes for `Cmd` throughout.

---

## File formats

- **`.draw`** — the native format: JSON carrying the full document, including
  layer structure and per-shape visibility and lock state.
- **SVG** — export produces clean SVG. Import is partial: round-tripping only
  fully preserves shapes that carry the editor's `data-type` metadata.

---

## Troubleshooting

**Page loads unstyled.** `dist/main.css` is missing — run `npm run css`.

**Blank canvas, console shows a CanvasKit or `.wasm` error.** You are almost
certainly on `file://`. Serve over HTTP with `npm run serve`.

**Port 8000 already in use.** An orphaned server from `npm run dev` — see the
caveat above; `pkill -f "http.server 8000"`.

**LESS changes not appearing.** Confirm `css:watch` is still running; it exits
silently if `lessc` hits a syntax error, so check that terminal.

---

## License

MIT — see [LICENSE](LICENSE).
