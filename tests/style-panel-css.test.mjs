/**
 * Regression tests for the style panel's colour swatch.
 *
 * Context: the swatch is a 24x24 <div> with a full-bleed, opacity:0
 * <input type="color"> stretched over it — clicking the swatch is what opens
 * the native colour picker.
 *
 * When fill/stroke is "none" the swatch also gets a `.none` class, which draws
 * a red diagonal slash via `::after { position:absolute; inset:0 }`. A
 * pseudo-element is the *last* child in tree order, so with `z-index:auto` it
 * paints on top of the input — and pseudo-elements are hit-testable by
 * default. The slash therefore swallowed the click, `elementFromPoint` at the
 * swatch centre returned the <div> instead of the <input>, the picker never
 * opened, and "none" became a one-way trip with no way to re-apply a colour.
 *
 * Every other decorative overlay in this codebase sets `pointer-events: none`
 * (canvas.less, toolbar.less, layers.less, statusbar.less, mixins.less); this
 * rule was the outlier.
 *
 * Run: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import less from 'less';

const ROOT  = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = `${ROOT}styles/main.less`;

/** Compile the real LESS entrypoint so the test never reads a stale dist/. */
async function compiledCss() {
  const src = await readFile(ENTRY, 'utf8');
  const { css } = await less.render(src, { filename: ENTRY, paths: [`${ROOT}styles`] });
  return css;
}

/** Return the declaration block for `selector`, or null if the rule is absent. */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match   = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : null;
}

test('the "none" slash overlay does not intercept clicks meant for the colour input', async () => {
  const body = ruleBody(await compiledCss(), '.style-panel__swatch.none::after');

  assert.notEqual(body, null, 'expected a .style-panel__swatch.none::after rule');
  assert.match(
    body,
    /pointer-events\s*:\s*none/,
    'the slash overlay covers the whole swatch and paints above the hidden ' +
    '<input type="color">; without pointer-events:none it swallows the click ' +
    'and the user can never re-apply a colour after choosing "none"',
  );
});

test('the hidden colour input still covers the full swatch', async () => {
  // If the input ever stops being full-bleed, the swatch becomes partly dead
  // even with the overlay fixed.
  const body = ruleBody(await compiledCss(), '.style-panel__swatch input[type="color"]');

  assert.notEqual(body, null, 'expected a .style-panel__swatch input[type="color"] rule');
  assert.match(body, /position\s*:\s*absolute/);
  assert.match(body, /inset\s*:\s*0/);
});
