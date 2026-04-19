let _idCtr = 1;
export const nextId = () => `s${_idCtr++}`;

export const state = {
  activeTool: 'select',
  layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false, expanded: true, shapes: [] }],
  activeLayerId: 'l1',
  selection: new Set(),   // Set<shapeId>
  viewport: { x: 0, y: 0, zoom: 1 },
  currentStyle: { fill: '#000000', stroke: 'none', strokeWidth: 1 },
  clipboard: null,
  nodeEditingActive: false,  // true while node tool is editing paths (suppresses selection box)
  viewMode: 'normal',        // 'normal' | 'wireframe'
  doc: { width: 800, height: 600, name: 'Untitled' },
  options: { theme: 'light', units: 'px', pasteboardColor: null },
};

export function getActiveLayer() {
  return state.layers.find(l => l.id === state.activeLayerId) ?? state.layers[0];
}

export function findShape(id) {
  for (const layer of state.layers)
    for (const shape of layer.shapes)
      if (shape.id === id) return { shape, layer };
  return null;
}

export function allShapes() {
  return state.layers.flatMap(l => l.shapes);
}
