/**
 * Render pipeline orchestrator.
 *
 * Pipeline:
 *   1. activeMode.beforeRender()
 *   2. renderArtboard()
 *   3. renderLayers()  — ObjectType.syncElement per shape, no type branches
 *   4. renderTextGuides()
 *   5. renderSelection()
 *   6. activeMode.afterRender()
 *   7. panel refreshes (via 'render' event)
 */
import { state }             from '../core/state.js';
import { getObjectType, getMode } from '../core/registry.js';
import { emit }              from '../core/events.js';
import { updateViewBox }     from '../viewport.js';
import { OverlayManager }    from './overlay.js';
import { renderTextGuides }  from './text-guides.js';
import { renderSelection }   from './selection.js';

const NS = 'http://www.w3.org/2000/svg';

// ── Module-level refs set once by init() ────────────────────────────────────
let _artboardLayer  = null;
let _docRoot        = null;
let _textGuides     = null;
let _overlayManager = null;
let _selectionLayer = null;

/** shapeId → SVGElement  (live element in #doc-root) */
const elMap = new Map();

/** layerId → SVGGElement  (layer group in #doc-root) */
const layerElMap = new Map();

/**
 * Initialize the renderer with DOM references from app.js.
 * Call once after buildApp().
 *
 * @param {SVGGElement} artboardLayer
 * @param {SVGGElement} docRoot
 * @param {SVGGElement} textGuidesGroup
 * @param {SVGGElement} overlayGroup
 */
export function initRenderer(artboardLayer, docRoot, textGuidesGroup, overlayGroup) {
  _artboardLayer  = artboardLayer;
  _docRoot        = docRoot;
  _textGuides     = textGuidesGroup;
  _overlayManager = new OverlayManager(overlayGroup);
  _selectionLayer = _overlayManager.acquireLayer('selection');
}

/** Lookup the live SVG element for a given shape id. */
export function getElement(shapeId) {
  return elMap.get(shapeId) ?? null;
}

/** Return the OverlayManager (for tools to call acquireLayer). */
export function getOverlay() {
  return _overlayManager;
}

/**
 * Main render entry point.
 * Call after any state mutation.
 */
export function render() {
  if (!_artboardLayer) return; // not yet initialized

  const activeMode = getMode(state.activeMode);

  if (activeMode) activeMode.beforeRender({ state, getObjectType, getElement });

  updateViewBox();
  _renderArtboard();
  _renderLayers(activeMode);
  renderTextGuides(_textGuides, state);
  renderSelection(_selectionLayer, state, getObjectType, getElement);

  if (activeMode) activeMode.afterRender({ state, getObjectType, getElement });

  emit('render', null);
}

// ── Private ──────────────────────────────────────────────────────────────────

function _renderArtboard() {
  let rect = _artboardLayer.querySelector('rect.artboard-rect');
  if (!rect) {
    rect = document.createElementNS(NS, 'rect');
    rect.classList.add('artboard-rect');
    _artboardLayer.appendChild(rect);
  }
  rect.setAttribute('x',      0);
  rect.setAttribute('y',      0);
  rect.setAttribute('width',  state.doc.width);
  rect.setAttribute('height', state.doc.height);
}

function _renderLayers(activeMode) {
  const viewState = { mode: state.activeMode, zoom: state.viewport.zoom };

  // Ensure a <g> exists for each layer, in the right order
  for (let i = 0; i < state.layers.length; i++) {
    const layer = state.layers[i];
    let layerEl = layerElMap.get(layer.id);
    if (!layerEl) {
      layerEl = document.createElementNS(NS, 'g');
      layerEl.id = `layer-${layer.id}`;
      // Insert before #text-guides (always the last child of doc-root we manage)
      _docRoot.insertBefore(layerEl, _docRoot.querySelector('#text-guides'));
      layerElMap.set(layer.id, layerEl);
    }
    layerEl.style.display = layer.visible ? '' : 'none';

    // Track shape ids in this layer to detect removals
    const currentIds = new Set(layer.shapes.map(s => s.id));

    // Remove stale elements from this layer
    for (const [id, el] of elMap) {
      if (el.parentNode === layerEl && !currentIds.has(id)) {
        el.remove();
        elMap.delete(id);
      }
    }

    // Upsert each shape element
    for (let j = 0; j < layer.shapes.length; j++) {
      const shape = layer.shapes[j];
      const ot    = getObjectType(shape.type);
      if (!ot) continue;

      let el = elMap.get(shape.id);
      if (!el) {
        el = ot.makeElement(shape);
        el.dataset.shapeId = shape.id;
        layerEl.appendChild(el);
        elMap.set(shape.id, el);
      }

      // Apply mode style overrides before syncing
      const modeStyle = activeMode?.resolveStyle(shape, state) ?? null;
      const renderShape = modeStyle
        ? { ...shape, style: { ...shape.style, ...modeStyle } }
        : shape;

      ot.syncElement(el, renderShape, viewState);

      // Ensure correct DOM order (shapes can be reordered)
      const expectedNext = j + 1 < layer.shapes.length
        ? elMap.get(layer.shapes[j + 1].id) ?? null
        : null;
      if (el.nextSibling !== expectedNext) {
        layerEl.insertBefore(el, expectedNext);
      }
    }
  }

  // Remove layer groups for deleted layers
  for (const [id, el] of layerElMap) {
    if (!state.layers.find(l => l.id === id)) {
      el.remove();
      layerElMap.delete(id);
    }
  }
}
