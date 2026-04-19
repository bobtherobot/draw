/**
 * SVG icon loader with theme fallback and cache.
 *
 * Icons are loaded as inline SVG elements so CSS currentColor works.
 * Falls back to assets/themes/default when the active theme lacks a file.
 *
 * Usage:
 *   const el = await getIcon('tools', 'select');   // async, cached
 *   const el = getIconSync('tools', 'select');      // sync placeholder, fills in async
 */

const NS      = 'http://www.w3.org/2000/svg';
const DEFAULT = 'assets/themes/default';

/** @type {Map<string, SVGElement>} cache key: 'category/name' */
const _cache = new Map();

let _themePath = DEFAULT;

/** Set the active theme icon path. Clears the cache. */
export function setIconTheme(path) {
  _themePath = path || DEFAULT;
  _cache.clear();
}

/** @returns {string} active theme path */
export function getIconThemePath() { return _themePath; }

/**
 * Load an icon by category + name, returning a cloned SVGElement.
 * Falls back to the default theme if not found in the active theme.
 *
 * @param {string} category - 'tools'|'ui'|'objects'|'handles'|'cursors'
 * @param {string} name     - filename without .svg
 * @returns {Promise<SVGElement>}
 */
export async function getIcon(category, name) {
  const key = `${category}/${name}`;
  if (_cache.has(key)) return _cache.get(key).cloneNode(true);

  const paths = _themePath !== DEFAULT
    ? [`${_themePath}/icons/${category}/${name}.svg`, `${DEFAULT}/icons/${category}/${name}.svg`]
    : [`${DEFAULT}/icons/${category}/${name}.svg`];

  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const text = await res.text();
      const doc  = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg  = doc.documentElement;
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      _cache.set(key, svg);
      return svg.cloneNode(true);
    } catch { /* try next path */ }
  }

  // Return empty SVG placeholder on failure
  const fallback = document.createElementNS(NS, 'svg');
  fallback.setAttribute('viewBox', '0 0 16 16');
  return fallback;
}

/**
 * Synchronously return a placeholder SVGElement, then replace its content
 * once the real icon loads. Safe to use during synchronous init.
 *
 * @param {string} category
 * @param {string} name
 * @returns {SVGElement} placeholder (auto-updates in place)
 */
export function getIconSync(category, name) {
  const placeholder = document.createElementNS(NS, 'svg');
  placeholder.setAttribute('viewBox', '0 0 16 16');
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.dataset.iconPending = `${category}/${name}`;

  getIcon(category, name).then(svg => {
    placeholder.replaceWith(svg);
  });

  return placeholder;
}
