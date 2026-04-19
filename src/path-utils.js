export function parsePathD(d) {
  const result = [];
  let cp = false;

  const tokens = d.trim().split(/(?=[MLCZmlcz])/);
  for (const token of tokens) {
    if (!token.trim()) continue;
    const cmd  = token[0].toUpperCase();
    const nums = token.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);

    if (cmd === 'M') {
      result.push({ x: nums[0], y: nums[1], hIn: null, hOut: null });
    } else if (cmd === 'L') {
      result.push({ x: nums[0], y: nums[1], hIn: null, hOut: null });
    } else if (cmd === 'C') {
      const prev = result[result.length - 1];
      if (prev) prev.hOut = { x: nums[0], y: nums[1] };
      const endX = nums[4], endY = nums[5];
      const a0   = result[0];
      if (result.length > 1 && a0 && Math.abs(endX - a0.x) < 0.02 && Math.abs(endY - a0.y) < 0.02) {
        a0.hIn = { x: nums[2], y: nums[3] };
      } else {
        result.push({ x: endX, y: endY, hIn: { x: nums[2], y: nums[3] }, hOut: null });
      }
    } else if (cmd === 'Z') {
      cp = true;
    }
  }

  return { anchors: result, closePath: cp };
}
