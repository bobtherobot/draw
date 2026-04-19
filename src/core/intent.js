/**
 * Intent dispatch table.
 *
 * Dispatch key format: `${effectiveTool}:${mode}:${objectType ?? 'null'}:${part ?? 'null'}`
 *
 * objectType and part accept '*' as a wildcard.
 * Matching priority (first match wins):
 *   1. exact tool + mode + objectType + part
 *   2. exact tool + mode + '*'        + part
 *   3. exact tool + mode + objectType + '*'
 *   4. exact tool + mode + '*'        + '*'
 */

/** @type {Array<{tool:string,mode:string,objectType:string,part:string,event:string,handler:Function}>} */
const _table = [];

/**
 * Register a dispatch entry.
 * @param {string}   tool
 * @param {string}   mode        - mode id or '*'
 * @param {string}   objectType  - type id or '*' or null
 * @param {string}   part        - part id or '*' or null
 * @param {string}   event       - 'mousedown'|'mousemove'|'mouseup'|'dblclick'|'keydown'
 * @param {Function} handler     - (intent, ctx, domEvent) => void
 */
export function registerDispatch(tool, mode, objectType, part, event, handler) {
  _table.push({ tool, mode, objectType: objectType ?? 'null', part: part ?? 'null', event, handler });
}

/**
 * Find and invoke the best matching handler for the given intent + event.
 * @param {import('./state.js').Intent} intent
 * @param {string}   event
 * @param {object}   ctx       - AppContext
 * @param {Event}    domEvent
 * @returns {boolean} true if a handler was found
 */
export function dispatch(intent, event, ctx, domEvent) {
  const { effectiveTool: tool, mode, objectType, part } = intent;
  const ot = objectType ?? 'null';
  const pt = part ?? 'null';

  const candidates = _table.filter(e => e.tool === tool && e.event === event &&
    (e.mode === mode || e.mode === '*'));

  const priorities = [
    e => e.objectType === ot   && e.part === pt,
    e => e.objectType === '*'  && e.part === pt,
    e => e.objectType === ot   && e.part === '*',
    e => e.objectType === '*'  && e.part === '*',
  ];

  for (const match of priorities) {
    const entry = candidates.find(match);
    if (entry) {
      entry.handler(intent, ctx, domEvent);
      return true;
    }
  }
  return false;
}
