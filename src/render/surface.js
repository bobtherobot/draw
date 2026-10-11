/**
 * CanvasKit surface acquisition.
 *
 * Kept dependency-free (no DOM, no app imports) so it can be unit tested —
 * see tests/surface.test.mjs.
 */

/**
 * Acquire a CanvasKit drawing surface, preferring GPU (WebGL) and degrading to
 * CPU rendering when WebGL is unavailable.
 *
 * CanvasKit's `MakeWebGLCanvasSurface` does NOT return null on failure — when
 * it cannot obtain a WebGL context it throws a *string*:
 *
 *   if (!m || 0 > m) throw "failed to create webgl context: err " + m;
 *
 * so a `?? MakeSWCanvasSurface(...)` fallback is unreachable dead code and the
 * throw escapes into main.js's top-level await, aborting module evaluation and
 * leaving a completely blank page. The throw must be caught explicitly.
 *
 * @param {object} CK      CanvasKit instance
 * @param {HTMLCanvasElement} canvas
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {object} a CanvasKit Surface
 * @throws {Error} if neither a GPU nor a CPU surface can be created
 */
export function makeSurface(CK, canvas, { warn = console.warn } = {}) {
  try {
    const gpu = CK.MakeWebGLCanvasSurface(canvas);
    if (gpu) return gpu;
    warn('[renderer] WebGL surface unavailable — falling back to CPU rendering.');
  } catch (err) {
    // err is a plain string from CanvasKit, not an Error — interpolate, don't rethrow.
    warn(`[renderer] WebGL unavailable (${err}) — falling back to CPU rendering. ` +
         'Check hardware acceleration is enabled in your browser.');
  }

  const cpu = CK.MakeSWCanvasSurface(canvas);
  if (!cpu) {
    throw new Error('[renderer] could not create a CanvasKit surface — ' +
                    'both WebGL and CPU rendering failed.');
  }
  return cpu;
}
