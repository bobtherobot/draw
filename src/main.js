/**
 * Application entry point — ~30 lines.
 * Registers all built-in modules, installs any plugins, then boots the app.
 */
import { buildApp, applyTheme }  from './app.js';
import { state }                 from './core/state.js';
import { fitToArtboard }         from './viewport.js';
import { initIO }                from './io/io.js';

// Built-in registrations (each module self-registers on import)
import './objects/index.js';
import './tools/index.js';
import './modes/index.js';

// Controls
import { initKeyboard }    from './controls/keyboard.js';
import { initToolbar }     from './controls/toolbar.js';
import { initStylePanel }  from './controls/style-panel.js';
import { initLayersPanel } from './controls/layers-panel.js';
import { initCommandbar }  from './controls/commandbar.js';

// Renderer
import { initRenderer, render } from './render/renderer.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

const dom = buildApp();

applyTheme(state.options.theme);

// Renderer needs SVG groups set up by buildApp
initRenderer(dom.svg);

// Keyboard must be initialized before toolbar so setActiveTool is available
initKeyboard();
initToolbar(dom.toolbar, dom.canvasWrap);
initStylePanel(dom.panels);
initLayersPanel(dom.panels);
initCommandbar(dom.commandbar);
initIO();

fitToArtboard();
render();
