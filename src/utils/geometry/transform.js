/**
 * Shape geometry transformations.
 * Used by Container subclasses — not called directly by tools.
 */
import { parsePathD, buildPathD, rotatePathD, rotatePoint } from './path-utils.js';

/**
 * Scale path d coordinates around an origin point.
 * @param {string} d
 * @param {number} sx
 * @param {number} sy
 * @param {number} ox
 * @param {number} oy
 * @returns {string}
 */
export function scalePathD(d, sx, sy, ox, oy) {
  const segs = parsePathD(d);
  const tx   = (x, y) => [ox + (x - ox) * sx, oy + (y - oy) * sy];
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
 * Translate path d coordinates.
 * @param {string} d
 * @param {number} dx
 * @param {number} dy
 * @returns {string}
 */
export function translatePathD(d, dx, dy) {
  const segs = parsePathD(d);
  const out  = [];
  for (const { cmd, args } of segs) {
    switch (cmd) {
      case 'M': case 'L':
        out.push({ cmd, args: [args[0] + dx, args[1] + dy] }); break;
      case 'C':
        out.push({ cmd, args: [
          args[0]+dx, args[1]+dy, args[2]+dx, args[3]+dy, args[4]+dx, args[5]+dy,
        ]}); break;
      case 'Z': case 'z':
        out.push({ cmd: 'Z', args: [] }); break;
      default:
        out.push({ cmd, args });
    }
  }
  return buildPathD(out);
}

// Re-export shared point helpers
export { rotatePoint, rotatePathD } from './path-utils.js';

/**
 * Transform a point from a rotated local space into world (doc) space.
 * The local space has its origin at (originX, originY) and is rotated
 * by `angle` degrees relative to the world axes.
 *
 * @param {number} lx      local x
 * @param {number} ly      local y
 * @param {number} originX world-space x of the local origin
 * @param {number} originY world-space y of the local origin
 * @param {number} angle   rotation of the local space in degrees
 * @returns {{x:number, y:number}}
 */
export function localToWorld(lx, ly, originX, originY, angle) {
  return rotatePoint(originX + lx, originY + ly, originX, originY, angle);
}

/**
 * Transform a point from world (doc) space into a rotated local space.
 * Inverse of localToWorld.
 *
 * @param {number} wx      world x
 * @param {number} wy      world y
 * @param {number} originX world-space x of the local origin
 * @param {number} originY world-space y of the local origin
 * @param {number} angle   rotation of the local space in degrees
 * @returns {{x:number, y:number}}
 */
export function worldToLocal(wx, wy, originX, originY, angle) {
  const r = rotatePoint(wx, wy, originX, originY, -angle);
  return { x: r.x - originX, y: r.y - originY };
}
