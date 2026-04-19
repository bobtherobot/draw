/**
 * Shared text editing overlay — a single <textarea> repositioned and restyled
 * for both point-text and area-text tools.
 */
import { state } from '../state.js';

let ta = null;
let _onCommit = null;
let _mirror = null;

function ensureMirror() {
  if (_mirror) return _mirror;
  _mirror = document.createElement('span');
  Object.assign(_mirror.style, {
    position:   'fixed',
    top:        '-9999px',
    left:       '-9999px',
    visibility: 'hidden',
    whiteSpace: 'pre',
    pointerEvents: 'none',
  });
  document.body.appendChild(_mirror);
  return _mirror;
}

export function initTextEditor() {
  if (ta) return;

  ta = document.createElement('textarea');
  ta.id = 'text-edit-ta';
  Object.assign(ta.style, {
    position:   'absolute',
    display:    'none',
    background: 'transparent',
    outline:    'none',
    resize:     'none',
    padding:    '0',
    margin:     '0',
    overflow:   'hidden',
    fontFamily: 'Arial, sans-serif',
    lineHeight: '1.3',
    zIndex:     '50',
    boxSizing:  'border-box',
    minWidth:   '4px',
    color:      '#000000',
  });
  document.getElementById('canvas-wrap').appendChild(ta);

  // Escape key commits
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(); }
  });

  // Clicking outside the textarea (but not on canvas — canvas handled by tool)
  document.addEventListener('mousedown', (e) => {
    if (!isEditing()) return;
    const canvas = document.getElementById('canvas');
    if (!ta.contains(e.target) && !canvas.contains(e.target)) commit();
  }, true);
}

/**
 * @param {object} opts
 *   docX, docY  – top-left of text in document coordinates
 *   fontSize    – in document units
 *   fill        – CSS colour string or 'none'
 *   boxWidth    – (area text only) box width in doc units
 *   boxHeight   – (area text only) box height in doc units
 *   onCommit    – function({ text, docX, docY, fontSize, boxWidth, boxHeight })
 */
export function startEditing({ docX, docY, fontSize = 16, fill = '#000000',
                               boxWidth, boxHeight, initialText, onInput, onCommit }) {
  if (!ta) initTextEditor();
  if (isEditing()) commit();       // flush any previous edit first

  _onCommit = onCommit;

  const svg     = document.getElementById('canvas');
  const wrap    = document.getElementById('canvas-wrap');
  const svgR    = svg.getBoundingClientRect();
  const wrapR   = wrap.getBoundingClientRect();
  const z       = state.viewport.zoom;

  const sx = (docX - state.viewport.x) * z + svgR.left - wrapR.left;
  const sy = (docY - state.viewport.y) * z + svgR.top  - wrapR.top;

  ta.value             = initialText || '';
  ta.dataset.docX      = docX;
  ta.dataset.docY      = docY;
  ta.dataset.fontSize  = fontSize;
  ta.dataset.isArea    = boxWidth !== undefined ? '1' : '0';
  if (boxWidth !== undefined) {
    ta.dataset.boxW = boxWidth;
    ta.dataset.boxH = boxHeight;
  }

  ta.style.left     = `${sx}px`;
  ta.style.top      = `${sy}px`;
  ta.style.fontSize = `${fontSize * z}px`;
  ta.style.color    = fill === 'none' ? '#000000' : fill;
  ta.style.display  = 'block';

  if (boxWidth !== undefined) {
    // Area text — fixed box, wrapping
    ta.style.width      = `${boxWidth  * z}px`;
    ta.style.height     = `${boxHeight * z}px`;
    ta.style.border     = '1px dashed #0066ff';
    ta.style.whiteSpace = 'pre-wrap';
    ta.style.wordBreak  = 'break-word';
    ta.oninput = () => { ta.scrollTop = 0; if (onInput) onInput(ta.value); };
  } else {
    // Point text — auto-expand horizontally and vertically
    ta.style.width      = '4px';
    ta.style.height     = `${fontSize * z * 1.3}px`;
    ta.style.border     = 'none';
    ta.style.whiteSpace = 'pre';
    ta.style.wordBreak  = 'normal';
    ta.oninput = () => { autoResize(); if (onInput) onInput(ta.value); };
  }

  // If pre-filled with existing text, size the textarea immediately
  if (ta.value) {
    if (boxWidth !== undefined) { ta.scrollTop = 0; }
    else autoResize();
  }

  // Defer focus past the mousedown event cycle so nothing steals it
  setTimeout(() => ta.focus(), 0);
}

export function commit() {
  if (!ta || ta.style.display === 'none') return;

  const text     = ta.value;
  const docX     = parseFloat(ta.dataset.docX);
  const docY     = parseFloat(ta.dataset.docY);
  const fontSize = parseFloat(ta.dataset.fontSize) || 16;
  const isArea   = ta.dataset.isArea === '1';
  const boxWidth  = isArea ? parseFloat(ta.dataset.boxW)  : undefined;
  const boxHeight = isArea ? parseFloat(ta.dataset.boxH) : undefined;

  ta.style.display = 'none';
  ta.oninput       = null;
  ta.value         = '';

  const cb   = _onCommit;
  _onCommit  = null;
  if (cb) cb({ text, docX, docY, fontSize, isArea, boxWidth, boxHeight });
}

export function isEditing() {
  return !!ta && ta.style.display !== 'none';
}

function autoResize() {
  // scrollWidth on a textarea with overflow:hidden returns clientWidth, not content width.
  // Use a mirror span to measure the actual rendered text width.
  const m = ensureMirror();
  m.style.fontSize   = ta.style.fontSize;
  m.style.fontFamily = ta.style.fontFamily || 'Arial, sans-serif';
  let maxW = 4;
  for (const line of (ta.value || ' ').split('\n')) {
    m.textContent = line || ' ';
    maxW = Math.max(maxW, m.getBoundingClientRect().width);
  }
  ta.style.width  = (maxW + 4) + 'px';
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
