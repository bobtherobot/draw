import { Tool } from './base.js';
import { startEditing, isEditing } from '../textedit.js';

export class TypeTool extends Tool {
  get id()       { return 'type'; }
  get label()    { return 'Text'; }
  get shortcut() { return 't'; }
  get icon()     { return 'type'; }

  deactivate() {
    // textedit commits on blur automatically
  }

  onMouseDown(e) {
    if (e.button !== 0) return;
    if (isEditing()) return;

    const ctx = this._ctx;
    const pos = ctx.screenToDoc(e.clientX, e.clientY);

    startEditing({
      docX:        pos.x,
      docY:        pos.y,
      fontSize:    14,
      fill:        ctx.state.currentStyle.fill ?? '#000000',
      zoom:        ctx.state.viewport.zoom,
      initialText: '',
      onCommit: (text) => {
        if (!text.trim()) return;
        const ot    = ctx.getObjectType('text-line');
        const shape = ot.createShape(
          { x: pos.x, y: pos.y, _text: text, _fontSize: 14, _fontFamily: 'sans-serif' },
          { fill: ctx.state.currentStyle.fill ?? '#000000', stroke: 'none', strokeWidth: 1 }
        );
        const layer = ctx.state.layers.find(l => l.id === ctx.state.activeLayerId) ?? ctx.state.layers[0];
        ctx.execute({
          do()   { layer.shapes.push(shape); ctx.state.selection = new Set([shape.id]); ctx.render(); },
          undo() { layer.shapes = layer.shapes.filter(s => s.id !== shape.id); ctx.state.selection.clear(); ctx.render(); },
        });
      },
    });
  }
}
