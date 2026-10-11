/**
 * Tests for the style panel's "last real colour" memory.
 *
 * Context: setting fill/stroke to `none` used to be near-unrecoverable. The
 * hidden <input type="color"> was reseeded to a hardcoded '#000000', so
 * re-picking black in the native picker changed nothing, fired no `input` or
 * `change` event, and left the style stuck on `none`.
 *
 * This module remembers the last real colour per property so the panel can
 * seed the picker with something meaningful and offer a deterministic toggle
 * back — a recovery path that does not depend on native picker event timing.
 *
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createColorMemory, NONE } from '../src/utils/color-memory.js';

test('recalls the configured default before anything is remembered', () => {
  const mem = createColorMemory({ fill: '#111111', stroke: '#222222' });

  assert.equal(mem.recall('fill'), '#111111');
  assert.equal(mem.recall('stroke'), '#222222');
});

test('falls back to black for a property with no configured default', () => {
  const mem = createColorMemory();

  assert.equal(mem.recall('fill'), '#000000');
});

test('remembers a real colour and recalls it', () => {
  const mem = createColorMemory();

  mem.remember('fill', '#ff0000');

  assert.equal(mem.recall('fill'), '#ff0000');
});

test('keeps each property independent', () => {
  const mem = createColorMemory();

  mem.remember('fill', '#ff0000');
  mem.remember('stroke', '#00ff00');

  assert.equal(mem.recall('fill'), '#ff0000');
  assert.equal(mem.recall('stroke'), '#00ff00');
});

test('never remembers "none" — that would defeat the whole point', () => {
  const mem = createColorMemory();

  mem.remember('fill', '#ff0000');
  mem.remember('fill', NONE);

  assert.equal(mem.recall('fill'), '#ff0000');
});

test('ignores empty and non-string values instead of poisoning the memory', () => {
  const mem = createColorMemory({ fill: '#123456' });

  for (const bad of [null, undefined, '', '   ', 42, {}]) {
    mem.remember('fill', bad);
  }

  assert.equal(mem.recall('fill'), '#123456');
});

// ── toggle ───────────────────────────────────────────────────────────────────

test('toggling a real colour yields none, and remembers the colour', () => {
  const mem = createColorMemory();

  assert.equal(mem.toggle('fill', '#abcdef'), NONE);
  assert.equal(mem.recall('fill'), '#abcdef');
});

test('toggling none restores the last real colour', () => {
  const mem = createColorMemory();

  mem.toggle('fill', '#abcdef');

  assert.equal(mem.toggle('fill', NONE), '#abcdef');
});

test('toggling none with nothing remembered restores the default', () => {
  const mem = createColorMemory({ fill: '#c0ffee' });

  assert.equal(mem.toggle('fill', NONE), '#c0ffee');
});

test('toggle round-trips — the original colour survives none and back', () => {
  const mem = createColorMemory();
  const original = '#3366cc';

  const off = mem.toggle('fill', original);
  const on  = mem.toggle('fill', off);

  assert.equal(off, NONE);
  assert.equal(on, original);
});

test('treats a missing current value as none so the toggle still recovers', () => {
  const mem = createColorMemory({ fill: '#c0ffee' });

  assert.equal(mem.toggle('fill', undefined), '#c0ffee');
});
