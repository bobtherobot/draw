/**
 * Remembers the last real colour chosen for each style property.
 *
 * The style panel drives colour through a hidden `<input type="color">`, which
 * only emits `input` / `change` when its value actually changes. Seeding that
 * input with a hardcoded '#000000' whenever a property was `none` meant
 * re-picking black was a silent no-op — the property stayed `none` with no way
 * back. Keeping the last real colour lets the panel seed the picker with
 * something meaningful and offer a deterministic none-toggle that bypasses the
 * native picker entirely.
 */

export const NONE = 'none';

const FALLBACK = '#000000';

const isRealColor = (value) =>
  typeof value === 'string' && value.trim() !== '' && value !== NONE;

/**
 * @param {Record<string, string>} [defaults] Per-property starting colours,
 *        e.g. `{ fill: '#000000', stroke: '#000000' }`.
 */
export function createColorMemory(defaults = {}) {
  // Seeded from defaults; only ever replaced with real colours.
  let remembered = { ...defaults };

  return {
    /**
     * Record `value` as the property's last real colour. No-op for `none`.
     * Called from the render-driven panel refresh, so unchanged values skip
     * the allocation.
     */
    remember(prop, value) {
      if (!isRealColor(value) || remembered[prop] === value) return;
      remembered = { ...remembered, [prop]: value };
    },

    /** The property's last real colour, its default, or black. */
    recall(prop) {
      return remembered[prop] ?? defaults[prop] ?? FALLBACK;
    },

    /**
     * Flip between `none` and a real colour.
     * A real `current` is remembered on the way out, so toggling back restores
     * it. Anything that is not a real colour counts as `none`.
     *
     * @returns {string} the value the property should take next
     */
    toggle(prop, current) {
      if (!isRealColor(current)) return this.recall(prop);
      this.remember(prop, current);
      return NONE;
    },
  };
}
