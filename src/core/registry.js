/**
 * Plugin registry — the single public extension API.
 * All built-in tools, objects, modes, and panels register here.
 * External plugins call installPlugin({ id, version, install(registry) }).
 */
import { registerDispatch } from './intent.js';
import { registerModifierOverride } from './modifiers.js';
import { on, emit } from './events.js';
import { ObjectType } from '../objects/base.js';
import { Tool }       from '../tools/base.js';
import { Mode }       from '../modes/base.js';

const _objectTypes  = new Map();
const _tools        = new Map();
const _modes        = new Map();
const _panels       = new Map();
const _keybindings  = [];

// ── Registration

/** @param {import('../objects/base.js').ObjectType} ot */
export function registerObjectType(ot) { _objectTypes.set(ot.id, ot); }

/** @param {import('../tools/base.js').Tool} tool */
export function registerTool(tool)     { _tools.set(tool.id, tool); }

/** @param {import('../modes/base.js').Mode} mode */
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

// ── Getters

export const getObjectType  = id => _objectTypes.get(id) ?? null;
export const getTool        = id => _tools.get(id) ?? null;
export const getMode        = id => _modes.get(id) ?? null;
export const getPanel       = id => _panels.get(id) ?? null;

export const getAllObjectTypes = () => [..._objectTypes.values()];
export const getAllTools       = () => [..._tools.values()];
export const getAllModes       = () => [..._modes.values()];
export const getAllPanels      = () => [..._panels.values()];
export const getAllKeybindings = () => [..._keybindings];

// ── Plugin install

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
    ObjectType,
    Tool,
    Mode,
  });
}
