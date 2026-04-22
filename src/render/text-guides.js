/**
 * Text anchor indicator and baseline guides rendered into #text-guides.
 *
 * Per shape:
 *   - One small square on the first baseline at attrs.x — indicates alignment:
 *       left   → box is at the left end of the baseline
 *       center → box is at the midpoint of the baseline
 *       right  → box is at the right end of the baseline
 *   - One baseline line per text line, extending from the anchor per alignment.
 *     Minimum width is 1em so empty/new text still shows a baseline.
 */
import { effectiveVisible, allDisplayItems } from '../core/state.js';
import { measureTextWidth } from '../objects/free-text.js';
import { getPendingGuide, getEditingShapeId } from '../textedit.js';

const NS = 'http://www.w3.org/2000/svg';
const SQ = 2; // square half-size in screen px (scaled to doc coords)

export function renderTextGuides(textGuidesGroup, state) {
  const { viewport: { zoom } } = state;
  const szDoc = SQ / zoom;

  const editingId = getEditingShapeId();
  const textShapes = allDisplayItems().filter(
    s => (s.type === 'free-text' || s.type === 'text-block') &&
         effectiveVisible(s) &&
         (state.selection.has(s.id) || s.id === editingId),
  );

  // Reconcile existing guide elements by composite key
  const existing = new Map();
  for (const el of textGuidesGroup.children) {
    const id   = el.dataset.shapeId;
    const kind = el.dataset.kind;
    if (id && kind) existing.set(`${id}:${kind}`, el);
  }

  const keep = new Set();

  for (const shape of textShapes) {
    const x     = shape.attrs.x ?? 0;
    const y     = shape.attrs.y ?? 0;
    const fs    = shape._fontSize   ?? 14;
    const ff    = shape._fontFamily ?? 'sans-serif';
    const align = shape._textAlign  ?? 'left';
    const sx    = Math.abs(shape._scaleX ?? 1);
    const sy    = Math.abs(shape._scaleY ?? 1);
    const lh    = fs * 1.3;

    // ── Baseline line(s) — one per text line ─────────────────────────────────
    const lines = shape.type === 'text-block'
      ? ['']
      : (shape._text ?? '').split('\n');

    lines.forEach((line, i) => {
      const lineKey = `${shape.id}:line:${i}`;
      let lineEl = existing.get(lineKey);
      if (!lineEl) {
        lineEl = document.createElementNS(NS, 'line');
        lineEl.dataset.shapeId = shape.id;
        lineEl.dataset.kind    = `line:${i}`;
        lineEl.classList.add('text-guide-line');
        textGuidesGroup.appendChild(lineEl);
      }

      // The SVG transform keeps attrs.x fixed; baseline y scales around attrs.y
      const baseY = y + (fs + i * lh) * sy;

      // Width: measured text or 1em minimum so new/empty text shows something
      const lineW = shape.type === 'text-block'
        ? (shape._boxWidth ?? 200)
        : Math.max(measureTextWidth(line, fs, ff), fs) * sx;

      // Extend left/right from anchor based on alignment
      const x1 = align === 'right'  ? x - lineW
               : align === 'center' ? x - lineW / 2
               :                      x;
      const x2 = align === 'left'   ? x + lineW
               : align === 'center' ? x + lineW / 2
               :                      x;

      lineEl.setAttribute('x1', x1);
      lineEl.setAttribute('y1', baseY);
      lineEl.setAttribute('x2', x2);
      lineEl.setAttribute('y2', baseY);
      keep.add(lineKey);
    });

    // ── Anchor square — on the first baseline, at attrs.x ────────────────────
    const sqKey = `${shape.id}:sq`;
    let sq = existing.get(sqKey);
    if (!sq) {
      sq = document.createElementNS(NS, 'rect');
      sq.dataset.shapeId = shape.id;
      sq.dataset.kind    = 'sq';
      sq.classList.add('text-guide-sq');
      textGuidesGroup.appendChild(sq);
    }
    const baselineY = y + fs * sy;
    sq.setAttribute('x',      x - szDoc);
    sq.setAttribute('y',      baselineY - szDoc);
    sq.setAttribute('width',  szDoc * 2);
    sq.setAttribute('height', szDoc * 2);
    keep.add(sqKey);
  }

  // ── Pending guide for in-progress new-text creation ─────────────────────────
  const pg = getPendingGuide();
  if (pg) {
    const { x, y, fontSize: fs, fontFamily: ff, textAlign: align, text } = pg;
    const lineW = Math.max(measureTextWidth(text ?? '', fs, ff), fs);
    const baseY = y + fs;

    const x1 = align === 'right'  ? x - lineW
               : align === 'center' ? x - lineW / 2
               :                      x;
    const x2 = align === 'left'   ? x + lineW
               : align === 'center' ? x + lineW / 2
               :                      x;

    const pgLineKey = '__pending__:line:0';
    let pgLine = existing.get(pgLineKey);
    if (!pgLine) {
      pgLine = document.createElementNS(NS, 'line');
      pgLine.dataset.shapeId = '__pending__';
      pgLine.dataset.kind    = 'line:0';
      pgLine.classList.add('text-guide-line');
      textGuidesGroup.appendChild(pgLine);
    }
    pgLine.setAttribute('x1', x1);
    pgLine.setAttribute('y1', baseY);
    pgLine.setAttribute('x2', x2);
    pgLine.setAttribute('y2', baseY);
    keep.add(pgLineKey);

    const pgSqKey = '__pending__:sq';
    let pgSq = existing.get(pgSqKey);
    if (!pgSq) {
      pgSq = document.createElementNS(NS, 'rect');
      pgSq.dataset.shapeId = '__pending__';
      pgSq.dataset.kind    = 'sq';
      pgSq.classList.add('text-guide-sq');
      textGuidesGroup.appendChild(pgSq);
    }
    pgSq.setAttribute('x',      x - szDoc);
    pgSq.setAttribute('y',      baseY - szDoc);
    pgSq.setAttribute('width',  szDoc * 2);
    pgSq.setAttribute('height', szDoc * 2);
    keep.add(pgSqKey);
  }

  // Remove stale guide elements
  for (const [key, el] of existing) {
    if (!keep.has(key)) el.remove();
  }
}
