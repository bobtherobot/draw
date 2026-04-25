/**
 * FreeTextAuxObject — Canvas 2D guides for free-text shapes.
 *
 * Renders when the shape is selected or hovered:
 *   • A baseline line at the first-line baseline, spanning the text width.
 *   • A small anchor square at (attrs.x, baseline) — the alignment axis point.
 *
 * Uses the exact same transform (rotation + scale) as FreeTextObjectType.drawCanvas2D()
 * so the guides always align with the rendered text.
 */
import { AuxObject }         from './aux-object.js';
import { measureTextWidth }  from './free-text.js';

const ANCHOR_HALF = 3;  // half-side of anchor square in CSS px (scaled by 1/zoom)

function _css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class FreeTextAuxObject extends AuxObject {
  drawCanvas2D(ctx, item, abstract, viewState, appState) {
    const isSelected = appState.selection.has(item.id);
    const isHovered  = appState.hover?.shape?.id === item.id;
    if (!isSelected && !isHovered) return;

    const x        = item.attrs.x   ?? 0;
    const y        = item.attrs.y   ?? 0;
    const fs       = item._fontSize   ?? 14;
    const ff       = item._fontFamily ?? 'sans-serif';
    const align    = item._textAlign  ?? 'left';
    const scaleX   = item._scaleX    ?? 1;
    const scaleY   = item._scaleY    ?? 1;
    const rotation = item._rotation  ?? 0;
    const rotCx    = item._rotCx ?? x;
    const rotCy    = item._rotCy ?? (y + fs);
    const zoom     = viewState.zoom;

    const text  = item._text ?? '';
    const rawW  = measureTextWidth(text, fs, ff);
    // Use a minimum width so there's always something visible even for empty/short text.
    const textW = Math.max(rawW, fs * 0.4) * Math.abs(scaleX);

    // Baseline y in local (pre-rotation, pre-scale) doc space
    const lineY = y + fs;

    // Baseline x extent depends on text alignment
    let x1, x2;
    if (align === 'center') { x1 = x - textW / 2; x2 = x + textW / 2; }
    else if (align === 'right') { x1 = x - textW;  x2 = x; }
    else                        { x1 = x;           x2 = x + textW; }

    const accent = _css('--theme-accent') || '#4a9eff';
    const sw = 1 / zoom;                // 1 CSS-px stroke in doc space
    const as = ANCHOR_HALF / zoom;      // anchor half-side in doc space

    ctx.save();

    // Mirror FreeTextObjectType.drawCanvas2D() transforms exactly.
    if (rotation !== 0) {
      ctx.translate(rotCx, rotCy);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-rotCx, -rotCy);
    }
    if (scaleX !== 1 || scaleY !== 1) {
      ctx.translate(x, y);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-x, -y);
    }

    ctx.globalAlpha = isSelected ? 0.55 : 0.3;
    ctx.strokeStyle = accent;
    ctx.fillStyle   = accent;
    ctx.lineWidth   = sw;

    // Baseline line
    ctx.beginPath();
    ctx.moveTo(x1, lineY);
    ctx.lineTo(x2, lineY);
    ctx.stroke();

    // Anchor square at the alignment-axis point on the baseline
    ctx.fillRect(x - as, lineY - as, as * 2, as * 2);

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
