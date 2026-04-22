/**
 * SVG path string parsing and building utilities.
 */

/**
 * Parse an SVG path `d` string into an array of command objects.
 * @param {string} d
 * @returns {Array<{cmd:string, args:number[]}>}
 */
export function parsePathD(d) {
  const re  = /([MmCcLlZzHhVvSsQqTtAa])([^MmCcLlZzHhVvSsQqTtAa]*)/g;
  const out = [];
  let m;
  while ((m = re.exec(d)) !== null) {
    const cmd  = m[1];
    const args = m[2].trim() === '' ? [] : m[2].trim().split(/[\s,]+/).map(Number);
    out.push({ cmd, args });
  }
  return out;
}

/**
 * Build an SVG path `d` string from an array of {cmd, args} segments.
 * @param {Array<{cmd:string, args:number[]}>} segments
 * @returns {string}
 */
export function buildPathD(segments) {
  return segments.map(({ cmd, args }) =>
    args.length ? `${cmd}${args.map(n => +n.toFixed(4)).join(' ')}` : cmd
  ).join(' ');
}

/**
 * Apply a 2D matrix transform to all absolute coordinates in a path.
 * Handles M, L, C, Z commands. Other commands passed through unchanged.
 *
 * @param {string}   d
 * @param {number}   a  - matrix [a,b,c,d,e,f] (standard SVG matrix)
 * @param {number}   b
 * @param {number}   c
 * @param {number}   dd
 * @param {number}   e
 * @param {number}   f
 * @returns {string}
 */
export function transformPathD(d, a, b, c, dd, e, f) {
  const tx = (x, y) => [a * x + c * y + e, b * x + dd * y + f];
  const segs = parsePathD(d);
  const out  = [];

  for (const { cmd, args } of segs) {
    switch (cmd) {
      case 'M': case 'L': {
        const [nx, ny] = tx(args[0], args[1]);
        out.push({ cmd, args: [nx, ny] });
        break;
      }
      case 'C': {
        const [x1, y1] = tx(args[0], args[1]);
        const [x2, y2] = tx(args[2], args[3]);
        const [x,  y ] = tx(args[4], args[5]);
        out.push({ cmd, args: [x1, y1, x2, y2, x, y] });
        break;
      }
      case 'Z': case 'z':
        out.push({ cmd: 'Z', args: [] });
        break;
      default:
        out.push({ cmd, args });
    }
  }
  return buildPathD(out);
}

/**
 * Rotate a point around a center.
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @param {number} angleDeg
 * @returns {{x:number, y:number}}
 */
export function rotatePoint(x, y, cx, cy, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx  = x - cx;
  const dy  = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Rotate every absolute coordinate in a path d string.
 * @param {string} d
 * @param {number} angleDeg
 * @param {number} cx
 * @param {number} cy
 * @returns {string}
 */
export function rotatePathD(d, angleDeg, cx, cy) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return transformPathD(d, cos, sin, -sin, cos, cx * (1 - cos) + cy * sin, cy * (1 - cos) - cx * sin);
}

/**
 * Convert a rect {x, y, width, height} to an absolute closed path d string.
 */
export function rectToPathD({ x, y, width, height }) {
  return `M${x} ${y}L${x + width} ${y}L${x + width} ${y + height}L${x} ${y + height}Z`;
}

/**
 * Convert an ellipse {cx, cy, rx, ry} to a path d string using 4 cubic beziers.
 * κ ≈ 0.5523 is the standard constant for ellipse-to-bezier approximation.
 */
export function ellipseToPathD({ cx, cy, rx, ry }) {
  const k = 0.5522847498;
  const kx = rx * k;
  const ky = ry * k;
  return [
    `M${cx - rx} ${cy}`,
    `C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    `C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}Z`,
  ].join('');
}
