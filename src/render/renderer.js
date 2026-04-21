/**
 * Render pipeline orchestrator.
 *
 * Pipeline:
 *   1. activeMode.beforeRender()
 *   2. renderArtboard()
 *   3. _renderTree()  — builds item tree, recurses depth-first, no type branches
 *   4. renderTextGuides()
 *   5. renderSelection()
 *   6. activeMode.afterRender()
 *   7. panel refreshes (via 'render' event)
 */
import { state, effectiveVisible } from '../core/state.js';
import { getObjectType, getMode } from '../core/registry.js';
import { emit }              from '../core/events.js';
import { updateViewBox }     from '../viewport.js';
import { OverlayManager }    from './overlay.js';
import { renderTextGuides }  from './text-guides.js';
import { renderSelection }   from './selection.js';

const NS = 'http://www.w3.org/2000/svg';

// ── Module-level refs set once by init() ────────────────────────────────────
let _artboardLayer  = null;
let _docLayer       = null;
let _svgDefs        = null;
let _textGuides     = null;
let _overlayManager = null;
let _selectionLayer = null;

/** itemId → SVGElement  (display items and container <g>s) */
const elMap = new Map();

/** itemId → SVGGElement  (container <g> elements in the SVG tree) */
const containerElMap = new Map();

/**
 * Initialize the renderer with the SVG canvas element.
 * @param {SVGElement} svg  — the #canvas SVG element
 */
export function initRenderer(svg) {
  _artboardLayer  = svg.querySelector('#artboard-layer');
  _docLayer       = svg.querySelector('#doc-layer');
  _svgDefs        = svg.querySelector('defs');
  _textGuides     = svg.querySelector('#text-guides');
  _overlayManager = new OverlayManager(svg.querySelector('#overlay'));
  _selectionLayer = _overlayManager.acquireLayer('selection');
}

/** Lookup the live SVG element for a given item id. */
export function getElement(itemId) {
  return elMap.get(itemId) ?? null;
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
  if (!_docLayer) return; // not yet initialized

  const activeMode = getMode(state.activeMode);

  if (activeMode) activeMode.beforeRender({ state, getObjectType, getElement });

  updateViewBox();
  _renderArtboard();
  _renderTree(activeMode);
  renderTextGuides(_textGuides, state);
  renderSelection(_selectionLayer, state, getObjectType, getElement);

  if (activeMode) activeMode.afterRender({ state, getObjectType, getElement });

  emit('render', null);
}

// ── Private ──────────────────────────────────────────────────────────────────

function _renderArtboard() {
  const artboards = state.items.filter(i => i.type === 'artboard');
  const liveArtboardIds = new Set(artboards.map(a => a.id));

  // Remove background rects for deleted artboards
  for (const el of _artboardLayer.querySelectorAll('rect.artboard-rect')) {
    if (!liveArtboardIds.has(el.dataset.artboardId)) el.remove();
  }
  // Remove clip paths for deleted artboards
  if (_svgDefs) {
    for (const cp of _svgDefs.querySelectorAll('clipPath[data-artboard-id]')) {
      if (!liveArtboardIds.has(cp.dataset.artboardId)) cp.remove();
    }
  }

  for (const ab of artboards) {
    const { x, y, width, height } = ab.attrs;

    // Background rect in artboard layer
    let rect = _artboardLayer.querySelector(`rect.artboard-rect[data-artboard-id="${ab.id}"]`);
    if (!rect) {
      rect = document.createElementNS(NS, 'rect');
      rect.classList.add('artboard-rect');
      rect.dataset.artboardId = ab.id;
      _artboardLayer.appendChild(rect);
    }
    rect.setAttribute('x',      x);
    rect.setAttribute('y',      y);
    rect.setAttribute('width',  width);
    rect.setAttribute('height', height);

    // Per-artboard clip path in <defs>
    if (_svgDefs) {
      const clipId = `clip-ab-${ab.id}`;
      let clip = _svgDefs.querySelector(`#${clipId}`);
      if (!clip) {
        clip = document.createElementNS(NS, 'clipPath');
        clip.id = clipId;
        clip.dataset.artboardId = ab.id;
        const cr = document.createElementNS(NS, 'rect');
        clip.appendChild(cr);
        _svgDefs.appendChild(clip);
      }
      const cr = clip.querySelector('rect');
      cr.setAttribute('x',      x);
      cr.setAttribute('y',      y);
      cr.setAttribute('width',  width);
      cr.setAttribute('height', height);
    }
  }
}

/**
 * Build a render tree from the flat items array.
 * Returns root nodes in array order, each with a `children` array.
 * Mirrors the _buildTree logic in layers-panel.js.
 */
function _buildRenderTree(items) {
  const byId = {};
  for (const item of items) byId[item.id] = { item, children: [] };

  const roots = [];
  for (const item of items) {
    const node = byId[item.id];
    if (item.parentId && byId[item.parentId]) {
      byId[item.parentId].children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function _renderTree(activeMode) {
  const viewState  = { mode: state.activeMode, zoom: state.viewport.zoom };
  const liveIds    = new Set(state.items.map(i => i.id));

  // Remove container <g>s for deleted items
  for (const [id, el] of containerElMap) {
    if (!liveIds.has(id)) { el.remove(); containerElMap.delete(id); }
  }
  // Remove display elements for deleted items
  for (const [id, el] of elMap) {
    if (!liveIds.has(id)) { el.remove(); elMap.delete(id); }
  }

  const roots = _buildRenderTree(state.items);
  _renderNodes(roots, _docLayer, activeMode, viewState);
}

/**
 * Recursively render a list of tree nodes into the given SVG parent element.
 * Maintains correct DOM order by comparing each element's nextSibling.
 */
function _renderNodes(nodes, parentSvgEl, activeMode, viewState) {
  const expectedEls = [];

  for (const { item, children } of nodes) {
    const isArtboard  = item.type === 'artboard';
    const isContainer = isArtboard || item.type === 'group' || children.length > 0;

    if (isContainer) {
      let gEl = containerElMap.get(item.id);
      if (!gEl) {
        gEl = document.createElementNS(NS, 'g');
        gEl.id = `item-${item.id}`;
        containerElMap.set(item.id, gEl);
      }
      if (gEl.parentNode !== parentSvgEl) parentSvgEl.appendChild(gEl);
      gEl.style.display = effectiveVisible(item) ? '' : 'none';

      if (isArtboard) {
        gEl.setAttribute('clip-path', `url(#clip-ab-${item.id})`);
      }

      expectedEls.push(gEl);

      if (item.type !== 'group' && !isArtboard) {
        _syncDisplayItem(item, gEl, activeMode, viewState);
      }

      _renderNodes(children, gEl, activeMode, viewState);

    } else {
      _syncDisplayItem(item, parentSvgEl, activeMode, viewState);
      const el = elMap.get(item.id);
      if (el) expectedEls.push(el);
    }
  }

  // Enforce DOM order — insertBefore(el, null) is a valid append
  for (let i = 0; i < expectedEls.length; i++) {
    const el      = expectedEls[i];
    const nextExp = i + 1 < expectedEls.length ? expectedEls[i + 1] : null;
    if (el.nextSibling !== nextExp) {
      parentSvgEl.insertBefore(el, nextExp);
    }
  }
}

function _syncDisplayItem(item, parentSvgEl, activeMode, viewState) {
  const ot = getObjectType(item.type);
  if (!ot) return;

  let el = elMap.get(item.id);
  if (!el) {
    el = ot.makeElement(item);
    el.dataset.shapeId = item.id;
    elMap.set(item.id, el);
  }
  if (el.parentNode !== parentSvgEl) parentSvgEl.appendChild(el);

  const modeStyle   = activeMode?.resolveStyle(item, state) ?? null;
  const renderItem  = modeStyle
    ? { ...item, style: { ...item.style, ...modeStyle } }
    : item;

  ot.syncElement(el, renderItem, viewState);
  el.style.display = item.visible === false ? 'none' : '';
}
