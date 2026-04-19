/**
 * Bounding box helpers.
 */

/**
 * Union multiple {x, y, width, height} bboxes into one.
 * @param {Array<{x:number,y:number,width:number,height:number}>} boxes
 * @returns {{x:number,y:number,width:number,height:number} | null}
 */
export function unionBBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of valid) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Expand a bbox by a margin on all sides.
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {number} margin
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function expandBBox(bbox, margin) {
  return {
    x:      bbox.x - margin,
    y:      bbox.y - margin,
    width:  bbox.width  + margin * 2,
    height: bbox.height + margin * 2,
  };
}

/**
 * Check if a point is within a bbox (with optional tolerance).
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {number} px
 * @param {number} py
 * @param {number} [tol=0]
 * @returns {boolean}
 */
export function pointInBBox(bbox, px, py, tol = 0) {
  return px >= bbox.x - tol && px <= bbox.x + bbox.width  + tol &&
         py >= bbox.y - tol && py <= bbox.y + bbox.height + tol;
}
