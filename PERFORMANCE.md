# Performance Notes

## What we profiled and why

`render()` is called on every state mutation, including every `mousemove`. Several functions inside it were doing expensive work unconditionally — full DOM rebuilds, synchronous layout reads, repeated text measurement — causing jank during drag, pan, and pen drawing.

---

## Improvements implemented

### 1. Cache `getBoundingClientRect()` — `src/viewport.js`

`screenToDoc()` was calling `svg().getBoundingClientRect()` on every coordinate conversion — 60+ times per second across all tools. Replaced with a cached rect invalidated by `ResizeObserver` and `window.resize`. Exported `invalidateRect()` for call sites that reposition the SVG (e.g. `fitToArtboard`).

**Impact:** Eliminates the most frequent synchronous layout read in the app.

### 2. rAF-gate status bar update — `src/main.js`

`updateStatusPos()` was firing on every raw `mousemove` event (potentially 300+/s on high-DPI). Tool `onMouseMove` handlers still fire synchronously — only the status bar DOM write is deferred to `requestAnimationFrame`.

**Impact:** Caps non-critical DOM writes at monitor refresh rate.

### 3. Cache `wrapText()` results — `src/shapes/index.js`

`wrapText()` called `ctx.measureText()` per word, per render, per text shape — even when text/font/width hadn't changed. Added a `Map` cache keyed by `text|maxWidth|fontSize|fontFamily` with a simple 500-entry overflow clear.

**Impact:** During pan/drag, text measurement drops to a single Map lookup per text shape.

### 4. Short-circuit `renderLayersPanel()` — `src/render.js`

`list.innerHTML = ''` was destroying and recreating the entire layers panel on every `render()` call, including during drag. Added a version string computed from layer and selection state; the rebuild is skipped if the string matches the previous render.

**Impact:** During drag/pan, the layers panel rebuild becomes a string comparison and early return.

### 5. Simplify `offsetTextGuidesForDrag()` — `src/render.js`

Was scanning all layers → all shapes looking for text shapes on every `mousemove` during drag. `guideElMap` is already a filtered index of exactly the text shapes with guide elements. Replaced the nested layer loop with direct `guideElMap` iteration.

**Impact:** O(text shapes) instead of O(all shapes) per frame during drag.

### 6. Element pool for pen handles — `src/tools/pen.js`

`handleGroup.innerHTML = ''` + full SVG element recreation was firing on every `mousemove` during pen drawing. Replaced with grow-only pools (`_linePool`, `_circPool`, `_rectPool`). Unused elements are hidden via `display: none` instead of being destroyed.

**Impact:** Zero DOM node allocation/deletion during pen drawing; eliminates GC pressure from element churn.

---

## Web Workers — decided against

Investigated whether `wrapText()` could be offloaded via `OffscreenCanvas` in a worker. Decision: not worth it.

- After the result cache (item 3), `wrapText()` only runs at full cost when text/font/width actually changes — during active text editing, not during the hot drag/pan path.
- Worker round-trip latency (~1ms) would cost more than the occasional cache miss.
- All other bottlenecks are DOM-bound and cannot be moved to a worker.

Future worker candidates if the app grows: SVG boolean path operations, large-file import parsing.

---

## Micro-optimizations — decided against

Localizing `Math.floor` / `Math.round` and caching `a.x` style property accesses:

- V8 JIT-compiles `Math.*` calls to single native instructions (e.g. `roundsd`). No real lookup at runtime.
- Plain object property access on monomorphic objects (hidden classes) is a single indexed memory read — essentially free after JIT warmup.
- Each `el.setAttribute(...)` crosses the JS→C++ DOM boundary and costs 100–1000x more than any JS property lookup. The bottleneck is always DOM/SVG attribute setting, not JS math.

These changes would not appear on a DevTools flame graph.

---

## Rules for new features

Before adding any code that runs inside `render()` or a tool `onMouseMove` handler, ask:

- **DOM reads** — Can this be cached or moved outside the loop? (`getBoundingClientRect`, `getBBox`, `clientWidth`)
- **DOM writes** — Am I recreating elements that could be reused? Could a version guard skip this entirely?
- **Computation** — Does this pure function depend on inputs that rarely change? Cache the result.
- **Iteration** — Am I scanning all shapes when a pre-built index would do?
- **UI updates** — Is this non-critical? Gate it behind `requestAnimationFrame`.

See also the Performance Guidelines section in `CLAUDE.md`.
