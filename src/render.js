import { state, findShape } from './state.js';
import { makeElement, syncElement } from './shapes/index.js';
import { parsePathD } from './path-utils.js';

const NS  = 'http://www.w3.org/2000/svg';
const elMap     = new Map(); // shapeId → SVGElement
const guideElMap = new Map(); // shapeId → { sq, line } persistent guide elements

function docRoot()    { return document.getElementById('doc-root'); }
function overlay()    { return document.getElementById('overlay'); }
function overlayHit() { return document.getElementById('overlay-hit'); }

let _overlayHook = null;
export function setOverlayHook(fn) { _overlayHook = fn; }

export function render() {
  renderArtboard();
  renderLayers();
  renderTextGuides();
  renderLayersPanel();
  renderSelection();
  renderObjectInfo();
  renderWireframeNodes();
  if (_overlayHook) _overlayHook();
}

function renderArtboard() {
  const g = document.getElementById('artboard-layer');
  if (!g) return;

  const { width, height } = state.doc;

  let board = g.querySelector('.artboard-rect');
  if (!board) {
    board = document.createElementNS(NS, 'rect');
    board.classList.add('artboard-rect');
    board.setAttribute('fill', 'white');
    board.setAttribute('stroke', '#b0b0b0');
    board.setAttribute('stroke-width', '1');
    board.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(board);
  }

  board.setAttribute('x', 0);
  board.setAttribute('y', 0);
  board.setAttribute('width', width);
  board.setAttribute('height', height);
}

function renderLayers() {
  const root = docRoot();

  // Add/reorder layer groups
  for (const layer of state.layers) {
    let g = document.getElementById(`layer-${layer.id}`);
    if (!g) {
      g = document.createElementNS(NS, 'g');
      g.id = `layer-${layer.id}`;
      root.appendChild(g);
    }
    root.appendChild(g); // moves to end = correct z-order
    g.style.display      = layer.visible ? '' : 'none';
    g.style.pointerEvents = layer.locked ? 'none' : '';

    const stateSet = new Set(layer.shapes.map(s => s.id));

    // Remove deleted shapes
    for (const [id, el] of elMap) {
      if (el.parentElement === g && !stateSet.has(id)) {
        el.remove();
        elMap.delete(id);
      }
    }

    // Upsert shapes in order
    for (const shape of layer.shapes) {
      let el = elMap.get(shape.id);
      if (!el) {
        el = makeElement(shape);
        elMap.set(shape.id, el);
      } else {
        syncElement(el, shape);
      }
      g.appendChild(el); // maintains z-order
    }
  }

  // Purge elements for shapes that no longer exist in any layer
  const allIds = new Set(state.layers.flatMap(l => l.shapes.map(s => s.id)));
  for (const [id, el] of elMap) {
    if (!allIds.has(id)) { el.remove(); elMap.delete(id); }
  }
}

export function renderTextGuides() {
  const root = docRoot();
  let guideG = document.getElementById('text-guides');
  if (!guideG) {
    guideG = document.createElementNS(NS, 'g');
    guideG.id = 'text-guides';
  }
  root.appendChild(guideG); // keep on top of layer groups

  const z  = state.viewport.zoom;
  const sw = 1 / z;
  const hs = 3.5 / z;

  const activeIds = new Set();

  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const shape of layer.shapes) {
      if (shape.type !== 'text') continue;
      activeIds.add(shape.id);

      const x        = +(shape.attrs.x ?? 0);
      const y        = +(shape.attrs.y ?? 0);
      const fontSize = +(shape._fontSize ?? 16);
      const color    = layer.locked ? '#999' : '#5577aa';

      // Reuse existing guide elements or create them
      let g = guideElMap.get(shape.id);
      if (!g) {
        const sq   = document.createElementNS(NS, 'rect');
        const line = document.createElementNS(NS, 'line');
        sq.dataset.shapeId   = shape.id;
        line.dataset.shapeId = shape.id;
        guideG.appendChild(sq);
        guideG.appendChild(line);
        g = { sq, line };
        guideElMap.set(shape.id, g);
      }

      const { sq, line } = g;
      sq.setAttribute('x',            x - hs);
      sq.setAttribute('y',            y - hs);
      sq.setAttribute('width',        hs * 2);
      sq.setAttribute('height',       hs * 2);
      sq.setAttribute('fill',         'white');
      sq.setAttribute('stroke',       color);
      sq.setAttribute('stroke-width', sw);

      if (!shape._isArea) {
        const lineLen = 14 / z;
        line.setAttribute('x1',           x);
        line.setAttribute('y1',           y + fontSize);
        line.setAttribute('x2',           x + lineLen);
        line.setAttribute('y2',           y + fontSize);
        line.setAttribute('stroke',       color);
        line.setAttribute('stroke-width', sw);
        line.style.display = '';
      } else {
        line.style.display = 'none';
      }
    }
  }

  // Remove guide elements for text shapes that no longer exist
  for (const [id, g] of guideElMap) {
    if (!activeIds.has(id)) {
      g.sq.remove();
      g.line.remove();
      guideElMap.delete(id);
    }
  }
}

// During drag: update guide positions by offsetting selected shapes, no element recreation.
export function offsetTextGuidesForDrag(selectedIds, dx, dy) {
  const z  = state.viewport.zoom;
  const sw = 1 / z;
  const hs = 3.5 / z;
  for (const [id, g] of guideElMap) {
    const found = findShape(id);
    if (!found) continue;
    const shape = found.shape;
    const ox = selectedIds.has(id) ? dx : 0;
    const oy = selectedIds.has(id) ? dy : 0;
    const x  = +(shape.attrs.x ?? 0) + ox;
    const y  = +(shape.attrs.y ?? 0) + oy;
    const fontSize = +(shape._fontSize ?? 16);
    g.sq.setAttribute('x',            x - hs);
    g.sq.setAttribute('y',            y - hs);
    g.sq.setAttribute('width',        hs * 2);
    g.sq.setAttribute('height',       hs * 2);
    g.sq.setAttribute('stroke-width', sw);
    if (!shape._isArea) {
      const lineLen = 14 / z;
      g.line.setAttribute('x1',           x);
      g.line.setAttribute('y1',           y + fontSize);
      g.line.setAttribute('x2',           x + lineLen);
      g.line.setAttribute('y2',           y + fontSize);
      g.line.setAttribute('stroke-width', sw);
      g.line.style.display = '';
    } else {
      g.line.style.display = 'none';
    }
  }
}

export function renderSelection() {
  const ov  = overlay();
  const ovh = overlayHit();
  ov.innerHTML  = '';
  ovh.innerHTML = '';

  // Node editing replaces the selection box with a wireframe + anchor overlay.
  if (state.nodeEditingActive) return;

  if (state.selection.size === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of state.selection) {
    let bb;
    // Area text: use stored box dimensions so selection never grows with overflow text
    const found = findShape(id);
    if (found?.shape.type === 'text' && found.shape._isArea) {
      const s = found.shape;
      bb = { x: +(s.attrs.x ?? 0), y: +(s.attrs.y ?? 0), width: s._boxWidth ?? 0, height: s._boxHeight ?? 0 };
    } else {
      const el = elMap.get(id);
      if (!el) continue;
      try { bb = el.getBBox(); } catch { continue; }
      if (!bb || (bb.width === 0 && bb.height === 0)) continue;
    }
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  if (!isFinite(minX)) return;

  const z = state.viewport.zoom;
  const sw = 1 / z;
  const da = `${4 / z},${3 / z}`;

  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', minX - sw);
  rect.setAttribute('y', minY - sw);
  rect.setAttribute('width',  maxX - minX + sw * 2);
  rect.setAttribute('height', maxY - minY + sw * 2);
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#0066ff');
  rect.setAttribute('stroke-width', sw);
  rect.setAttribute('stroke-dasharray', da);
  rect.style.pointerEvents = 'none';
  ov.appendChild(rect);

  if (state.activeTool !== 'select') return;

  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const hs   = 3.5 / z;
  const HANDLES = [
    { id: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
    { id: 'n',  x: midX, y: minY, cursor: 'ns-resize'   },
    { id: 'ne', x: maxX, y: minY, cursor: 'nesw-resize'  },
    { id: 'e',  x: maxX, y: midY, cursor: 'ew-resize'    },
    { id: 'se', x: maxX, y: maxY, cursor: 'nwse-resize'  },
    { id: 's',  x: midX, y: maxY, cursor: 'ns-resize'    },
    { id: 'sw', x: minX, y: maxY, cursor: 'nesw-resize'  },
    { id: 'w',  x: minX, y: midY, cursor: 'ew-resize'    },
  ];
  for (const h of HANDLES) {
    const hr = document.createElementNS(NS, 'rect');
    hr.setAttribute('x',      h.x - hs);
    hr.setAttribute('y',      h.y - hs);
    hr.setAttribute('width',  hs * 2);
    hr.setAttribute('height', hs * 2);
    hr.setAttribute('fill',   'white');
    hr.setAttribute('stroke', '#0066ff');
    hr.setAttribute('stroke-width', sw);
    hr.dataset.handle = h.id;
    hr.style.cursor   = h.cursor;
    ovh.appendChild(hr);
  }

  // Rotate handle — circle above the top-centre, connected by a stem line
  const stemLen = 18 / z;
  const rotR    =  4.5 / z;
  const rotX    = midX;
  const rotY    = minY - stemLen;

  const stem = document.createElementNS(NS, 'line');
  stem.setAttribute('x1', rotX); stem.setAttribute('y1', minY - sw);
  stem.setAttribute('x2', rotX); stem.setAttribute('y2', rotY + rotR);
  stem.setAttribute('stroke', '#0066ff');
  stem.setAttribute('stroke-width', sw);
  stem.style.pointerEvents = 'none';
  ov.appendChild(stem);

  const rotHandle = document.createElementNS(NS, 'circle');
  rotHandle.setAttribute('cx', rotX);
  rotHandle.setAttribute('cy', rotY);
  rotHandle.setAttribute('r',  rotR);
  rotHandle.setAttribute('fill',   'white');
  rotHandle.setAttribute('stroke', '#0066ff');
  rotHandle.setAttribute('stroke-width', sw);
  rotHandle.dataset.handle = 'rotate';
  rotHandle.style.cursor   = 'crosshair';
  ovh.appendChild(rotHandle);
}

let _lastPanelVersion = null;

function getPanelVersion() {
  return state.layers.map(l =>
    `${l.id}:${l.name}:${l.visible}:${l.locked}:${l.expanded ?? false}:${l.id === state.activeLayerId}:` +
    l.shapes.map(s => `${s.id}:${state.selection.has(s.id)}`).join(',')
  ).join('|');
}

function renderLayersPanel() {
  const version = getPanelVersion();
  if (version === _lastPanelVersion) return;
  _lastPanelVersion = version;

  const list = document.getElementById('layers-list');
  list.innerHTML = '';

  for (const layer of [...state.layers].reverse()) {
    const expanded = layer.expanded ?? false;
    const hasShapes = layer.shapes.length > 0;

    // ── Layer row ──────────────────────────────────────────────
    const row = document.createElement('div');
    row.className = 'layer-row' + (layer.id === state.activeLayerId ? ' active' : '');

    // Collapse/expand triangle
    const tri = document.createElement('span');
    tri.className = 'layer-tri' + (hasShapes ? '' : ' layer-tri-empty');
    tri.textContent = expanded ? '▾' : '▸';
    if (hasShapes) {
      tri.addEventListener('click', (e) => {
        e.stopPropagation();
        layer.expanded = !layer.expanded;
        _lastPanelVersion = null;
        renderLayersPanel();
      });
    }

    const eye  = makeIcon(layer.visible ? '◉' : '○', 'Toggle visibility', () => {
      layer.visible = !layer.visible; render();
    });
    const lock = makeIcon(layer.locked ? '🔒' : '·', 'Toggle lock', () => {
      layer.locked = !layer.locked; render();
    });
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;

    row.append(tri, eye, lock, name);
    row.addEventListener('click', () => { state.activeLayerId = layer.id; render(); });
    list.appendChild(row);

    // ── Shape items ────────────────────────────────────────────
    if (expanded && hasShapes) {
      const shapeList = document.createElement('div');
      shapeList.className = 'shape-list';

      // Reverse so topmost shape appears first (matches z-order intuition)
      for (const shape of [...layer.shapes].reverse()) {
        const item = document.createElement('div');
        item.className = 'shape-item' + (state.selection.has(shape.id) ? ' shape-item-sel' : '');

        const icon = document.createElement('span');
        icon.className = 'shape-item-icon';
        icon.textContent = SHAPE_ICONS[shape.type] ?? '◆';

        const label = document.createElement('span');
        label.className = 'shape-item-label';
        label.textContent = shapeLabel(shape, layer);

        item.append(icon, label);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (e.shiftKey) {
            if (state.selection.has(shape.id)) state.selection.delete(shape.id);
            else state.selection.add(shape.id);
          } else {
            state.selection.clear();
            state.selection.add(shape.id);
            state.activeLayerId = layer.id;
          }
          render();
        });

        shapeList.appendChild(item);
      }

      list.appendChild(shapeList);
    }
  }
}

const SHAPE_ICONS = { path: '⌇', text: 'T', group: '▣' };
const SHAPE_NAMES = { path: 'Path', text: 'Text', group: 'Group' };

function shapeLabel(shape, layer) {
  const base = SHAPE_NAMES[shape.type] ?? shape.type;
  const peers = layer.shapes.filter(s => s.type === shape.type);
  if (peers.length <= 1) return base;
  return `${base} ${peers.indexOf(shape) + 1}`;
}

function makeIcon(text, title, onClick) {
  const span = document.createElement('span');
  span.className = 'layer-icon';
  span.textContent = text;
  span.title = title;
  span.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return span;
}

function renderObjectInfo() {
  const info = document.getElementById('obj-info');
  const sel = state.selection;
  if (sel.size === 0) { info.textContent = 'No selection'; return; }
  if (sel.size > 1)   { info.textContent = `${sel.size} objects`; return; }

  const id = [...sel][0];
  const found = (() => {
    for (const l of state.layers)
      for (const s of l.shapes)
        if (s.id === id) return s;
  })();
  if (!found) return;

  info.style.whiteSpace = 'pre';
  info.textContent = found.type;
}

export function getElement(id) { return elMap.get(id); }

// ── Wireframe node overlay ─────────────────────────────────────

const NS_SVG = 'http://www.w3.org/2000/svg';
let _nodePool = [];
let _nu = 0;

function poolNodeRect(nodeGroup, x, y, hs) {
  let el;
  if (_nu < _nodePool.length) {
    el = _nodePool[_nu];
    el.style.display = '';
  } else {
    el = document.createElementNS(NS_SVG, 'rect');
    el.style.pointerEvents = 'none';
    nodeGroup.appendChild(el);
    _nodePool.push(el);
  }
  _nu++;
  el.setAttribute('x', x - hs);
  el.setAttribute('y', y - hs);
  el.setAttribute('width',  hs * 2);
  el.setAttribute('height', hs * 2);
  el.setAttribute('fill', '#e8973a');
  el.setAttribute('stroke', 'none');
}

function getShapePoints(shape) {
  if (shape.type === 'path') {
    const { anchors } = parsePathD(shape.attrs.d || '');
    return anchors.map(a => ({ x: a.x, y: a.y }));
  }
  if (shape.type === 'text') {
    return [{ x: +(shape.attrs.x || 0), y: +(shape.attrs.y || 0) }];
  }
  return [];
}

function renderWireframeNodes() {
  const nodeGroup = document.getElementById('wireframe-nodes');
  if (!nodeGroup) return;

  _nu = 0;

  if (state.viewMode !== 'wireframe') {
    for (const el of _nodePool) el.style.display = 'none';
    return;
  }

  const z  = state.viewport.zoom;
  const hs = 2.2 / z;

  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const shape of layer.shapes) {
      for (const pt of getShapePoints(shape)) {
        poolNodeRect(nodeGroup, pt.x, pt.y, hs);
      }
    }
  }

  for (let i = _nu; i < _nodePool.length; i++) _nodePool[i].style.display = 'none';
}
