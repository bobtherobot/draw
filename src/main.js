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
import { initKeyboard }                    from './controls/keyboard.js';
import { initToolbar }                     from './controls/toolbar.js';
import { initPanelManager, registerPanel } from './controls/panel-manager.js';
import { initStylePanel }                  from './controls/style-panel.js';
import { initLayersPanel }                 from './controls/layers-panel.js';
import { initCommandbar }                  from './controls/commandbar.js';
import { initMenubar }                     from './controls/menubar.js';
import { loadSettings }                    from './core/settings.js';

// Renderer
import { initRenderer, render } from './render/renderer.js';
import { on } from './core/events.js';
import { registerZone } from './core/focus.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

// Restore persisted user settings before any rendering
loadSettings();

const dom = buildApp();

applyTheme(state.options.theme);

// CanvasKit (Skia WASM) is loaded as a classic script in index.html.
// CanvasKitInit() is available as a global at this point.
const CK = await CanvasKitInit({
  locateFile: f => new URL(`../assets/vendor/canvaskit/${f}`, import.meta.url).href,
});

initRenderer(dom.canvas, CK);

// Keyboard must be initialized before toolbar so setActiveTool is available
initKeyboard();
initToolbar(dom.toolbar, dom.canvasWrap, dom.statusbar);
initPanelManager();
initStylePanel(registerPanel);
initLayersPanel(registerPanel);
initMenubar(dom.menubar);
initCommandbar(dom.commandbar);
initIO();

// Zone registration — elements available after buildApp()
registerZone(dom.canvas,    'canvas');
registerZone(dom.toolbar,   'toolbar');
registerZone(dom.menubar,   'menubar');
registerZone(dom.commandbar,'commandbar');
// Panels register their own zones inside initLayersPanel / initStylePanel

// Wire viewport changes (zoom/pan) and canvas resize → full render pipeline
on('viewport-change', render);
on('resize', render);

fitToArtboard();
render();
