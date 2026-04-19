/**
 * Application entry point — ~30 lines.
 * Registers all built-in modules, installs any plugins, then boots the app.
 */
import { buildApp, applyTheme } from './app.js';
import { state }                from './core/state.js';
import { fitToArtboard }        from './viewport.js';

// Built-in registrations (each module self-registers on import)
import './objects/index.js';
import './tools/index.js';
import './modes/index.js';

// Controls (wire DOM after buildApp)
import { initToolbar }     from './controls/toolbar.js';
import { initKeyboard }    from './controls/keyboard.js';
import { initStylePanel }  from './controls/style-panel.js';
import { initLayersPanel } from './controls/layers-panel.js';
import { initCommandbar }  from './controls/commandbar.js';

// Renderer
import { initRenderer, render } from './render/renderer.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

const dom = buildApp();

applyTheme(state.options.theme);

initRenderer(dom.svg);
initToolbar(dom.toolbar);
initKeyboard();
initStylePanel(dom.panels);
initLayersPanel(dom.panels);
initCommandbar(dom.commandbar);

fitToArtboard();
render();
