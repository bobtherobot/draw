/**
 * Plugin registry — the single public extension API.
 * All built-in tools, objects, modes, and panels register here.
 * External plugins call installPlugin({ id, version, install(registry) }).
 */
import { registerDispatch } from './intent.js';
import { registerModifierOverride } from './modifiers.js';
import { on, emit } from './events.js';
import { DisplayObject } from '../objects/DisplayObject.js';
import { Container }     from '../objects/Container.js';
import { BaseTool }      from '../tools/BaseTool.js';
import { Mode }          from '../modes/Mode.js';

const _displayObjects = new Map();  // type id → DisplayObject singleton
const _controllers    = new Map();  // type id → Container subclass constructor
const _tools          = new Map();
const _modes          = new Map();
const _panels         = new Map();
const _keybindings    = [];

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a concrete item type.
 * ControllerClass must be a Container subclass with static `id` and `renderer` properties.
 * @param {typeof Container} ControllerClass
 */
export function registerObjectType(ControllerClass) {
  const id       = ControllerClass.id;
  const renderer = ControllerClass.renderer;
  if (!id)       throw new Error(`${ControllerClass.name}: missing static id`);
  if (!renderer) throw new Error(`${ControllerClass.name}: missing static renderer`);
  _displayObjects.set(id, renderer);
  _controllers.set(id, ControllerClass);
}

/** @param {import('../tools/BaseTool.js').BaseTool} tool */
export function registerTool(tool)     { _tools.set(tool.id, tool); }

/** @param {import('../modes/Mode.js').Mode} mode */
export function registerMode(mode)     { _modes.set(mode.id, mode); }

/**
 * @typedef {Object} PanelDef
 * @property {string}   id
 * @property {string}   label
 * @property {Function} build    - () => HTMLElement
 * @property {Function} [refresh]- (state) => void
 */
/** @param {PanelDef} def */
export function registerPanel(def) { _panels.set(def.id, def); }

/**
 * @typedef {Object} KeyBinding
 * @property {string}   id
 * @property {string}   key      - e.g. 'v', 'Escape', 'ctrl+z'
 * @property {boolean}  [repeat]
 * @property {Function} action   - (e: KeyboardEvent) => void
 */
/** @param {KeyBinding[]} bindings */
export function registerKeybindings(bindings) { _keybindings.push(...bindings); }

// ── Getters ───────────────────────────────────────────────────────────────────

/** Return the DisplayObject singleton for a type id (for draw, getBBox, createShape, etc.). */
export const getDisplayObject   = id => _displayObjects.get(id) ?? null;

/** Return the Container subclass constructor for a type id (for creating per-item controllers). */
export const getControllerClass = id => _controllers.get(id) ?? null;

export const getTool        = id => _tools.get(id) ?? null;
export const getMode        = id => _modes.get(id) ?? null;
export const getPanel       = id => _panels.get(id) ?? null;

export const getAllDisplayObjects    = () => [..._displayObjects.values()];
export const getAllControllerClasses = () => [..._controllers.values()];
export const getAllTools          = () => [..._tools.values()];
export const getAllModes          = () => [..._modes.values()];
export const getAllPanels         = () => [..._panels.values()];
export const getAllKeybindings    = () => [..._keybindings];

// ── Plugin install ────────────────────────────────────────────────────────────

/**
 * Install a plugin. The plugin receives the full registry API surface.
 * @param {{ id: string, version?: string, install: Function }} plugin
 */
export function installPlugin(plugin) {
  plugin.install({
    registerObjectType,
    registerTool,
    registerMode,
    registerPanel,
    registerKeybindings,
    registerDispatch,
    registerModifierOverride,
    on,
    emit,
    DisplayObject,
    Container,
    BaseTool,
    Mode,
    getDisplayObject,
    getControllerClass,
    getAllDisplayObjects,
    getAllControllerClasses,
  });
}
