/**
 * Shared helper for building SVG path d strings from pen anchor arrays.
 * Used by both pen.js (drawing) and node.js (editing).
 *
 * Anchor format: { x, y, hIn: {x,y}|null, hOut: {x,y}|null }
 *   hIn  = control point for the segment arriving at this anchor
 *   hOut = control point for the segment leaving this anchor
 */

const r = (n) => Math.round(n * 100) / 100;

/**
 * Build an SVG path d string from an array of pen anchors.
 * @param {Array<{x,y,hIn,hOut}>} anchors
 * @param {boolean} closePath
 * @returns {string}
 */
export function buildPenPathD(anchors, closePath) {
  if (anchors.length === 0) return '';
  const a0 = anchors[0];
  let d = `M ${r(a0.x)} ${r(a0.y)}`;

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    const h1 = prev.hOut;
    const h2 = curr.hIn;
    if (!h1 && !h2) {
      d += ` L ${r(curr.x)} ${r(curr.y)}`;
    } else {
      d += ` C ${r((h1 || prev).x)} ${r((h1 || prev).y)} ${r((h2 || curr).x)} ${r((h2 || curr).y)} ${r(curr.x)} ${r(curr.y)}`;
    }
  }

  if (closePath && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    const h1 = last.hOut;
    const h2 = a0.hIn;
    if (!h1 && !h2) {
      d += ' Z';
    } else {
      d += ` C ${r((h1 || last).x)} ${r((h1 || last).y)} ${r((h2 || a0).x)} ${r((h2 || a0).y)} ${r(a0.x)} ${r(a0.y)} Z`;
    }
  }

  return d;
}

/**
 * Parse an SVG path d string back into an array of pen anchors.
 * Handles M, L, C, Z commands.
 * @param {string} d
 * @returns {{ anchors: Array<{x,y,hIn,hOut}>, closed: boolean }}
 */
export function parsePenAnchors(d) {
  const segs    = d.trim().split(/(?=[MmLlCcZz])/);
  const anchors = [];
  let   closed  = false;

  for (const seg of segs) {
    const cmd = seg[0];
    const ns  = seg.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));

    if (cmd === 'M' || cmd === 'm') {
      anchors.push({ x: ns[0], y: ns[1], hIn: null, hOut: null });
    } else if (cmd === 'L' || cmd === 'l') {
      anchors.push({ x: ns[0], y: ns[1], hIn: null, hOut: null });
    } else if (cmd === 'C' || cmd === 'c') {
      // C x1 y1 x2 y2 x y
      const prev = anchors[anchors.length - 1];
      if (prev) prev.hOut = { x: ns[0], y: ns[1] };
      anchors.push({ x: ns[4], y: ns[5], hIn: { x: ns[2], y: ns[3] }, hOut: null });
    } else if (cmd === 'Z' || cmd === 'z') {
      closed = true;
    }
  }

  return { anchors, closed };
}
