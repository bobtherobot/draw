/**
 * 2D affine matrix utilities built on the native DOMMatrix API.
 *
 * Convention: SVG matrix [a,b,c,d,e,f] where
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * All functions return new DOMMatrix instances — never mutate in place.
 */
import { transformPathD } from './path-utils.js';

export function identity() {
  return new DOMMatrix();
}

export function fromComponents(a, b, c, d, e, f) {
  return DOMMatrix.fromMatrix({ a, b, c, d, e, f, is2D: true });
}

export function translation(dx, dy) {
  return fromComponents(1, 0, 0, 1, dx, dy);
}

/**
 * Rotation matrix around an optional center point.
 * @param {number} angleDeg
 * @param {number} [cx=0]
 * @param {number} [cy=0]
 */
export function rotation(angleDeg, cx = 0, cy = 0) {
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return fromComponents(
    cos, sin, -sin, cos,
    cx * (1 - cos) + cy * sin,
    cy * (1 - cos) - cx * sin,
  );
}

/**
 * Scale matrix around an optional origin point.
 * @param {number} sx
 * @param {number} sy
 * @param {number} [ox=0]
 * @param {number} [oy=0]
 */
export function scaling(sx, sy, ox = 0, oy = 0) {
  return fromComponents(sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy));
}

/** Returns m1 * m2 (m2 is applied first, then m1). */
export function multiply(m1, m2) {
  return m1.multiply(m2);
}

export function inverse(m) {
  return m.inverse();
}

/** Transform a single point. */
export function transformPoint(m, x, y) {
  const p = m.transformPoint({ x, y });
  return { x: p.x, y: p.y };
}

/** Apply the matrix to all coordinates in an SVG path d string. */
export function applyToPathD(m, d) {
  return transformPathD(d, m.a, m.b, m.c, m.d, m.e, m.f);
}

/** Extract the rotation angle in degrees from a matrix. */
export function getAngleDeg(m) {
  return Math.atan2(m.b, m.a) * 180 / Math.PI;
}

export function isIdentity(m) {
  return m.isIdentity;
}

/**
 * Sync a shape's `_transform` from its `_rotDisplay`.
 * Deletes `_transform` when angle is 0 (no rotation).
 * @param {{_rotDisplay?, _transform?}} shape
 */
export function syncTransform(shape) {
  const rd = shape._rotDisplay;
  if (rd && rd.angle !== 0) {
    shape._transform = rotation(rd.angle, rd.center.x, rd.center.y);
  } else {
    delete shape._transform;
  }
}

/**
 * Compute the axis-aligned bounding box of a rectangle after applying a matrix.
 * @param {DOMMatrix} m
 * @param {{x,y,width,height}} bbox  - local bounding box
 * @returns {{x,y,width,height}}
 */
export function transformBBox(m, bbox) {
  const { x, y, width, height } = bbox;
  const corners = [
    transformPoint(m, x,         y),
    transformPoint(m, x + width, y),
    transformPoint(m, x + width, y + height),
    transformPoint(m, x,         y + height),
  ];
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  return {
    x:      Math.min(...xs),
    y:      Math.min(...ys),
    width:  Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
