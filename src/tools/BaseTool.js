/**
 * BaseTool base class.
 *
 * Tools are stateful singletons held by the registry.
 * They receive an AppContext at init() instead of importing from core directly.
 *
 * See .claude/docs/TOOL-CONTRACT.md for full contract documentation.
 *
 * @typedef {Object} AppContext
 * @property {import('../core/state.js').state}       state
 * @property {import('../core/history.js').execute}   execute
 * @property {Function}  render        - () => void
 * @property {Function}  screenToDoc   - (sx, sy) => {x, y}
 * @property {Function}  getDisplayObject - (typeId) => DisplayObject|null
 * @property {Function}  setActiveTool - (toolId) => void
 * @property {Function}  emit          - (event, data) => void
 * @property {Function}  getModifiers  - () => modifiers snapshot
 * @property {import('../render/overlay.js').OverlayManager} overlay
 */

/**
 * @typedef {Object} SubFeature
 * @property {string}   id
 * @property {string}   label
 * @property {string}   [icon]       - icon name in tools/ category
 * @property {string[]} [modifiers]  - modifier combo that activates this
 * @property {Function} activate     - () => void
 * @property {Function} [deactivate] - () => void
 */

export class BaseTool {
  /** Unique tool id. @type {string} */
  get id()       { throw new Error(`${this.constructor.name}: id not implemented`); }

  /** Display name. @type {string} */
  get label()    { return this.id; }

  /** Keyboard shortcut character, or null. @type {string|null} */
  get shortcut() { return null; }

  /** Icon name in tools/ category. @type {string} */
  get icon()     { return this.id; }

  /**
   * Called once at startup with the AppContext.
   * Store ctx for use in handlers: this._ctx = ctx
   * @param {AppContext} ctx
   */
  init(ctx) { this._ctx = ctx; }

  /** Called when this tool becomes active. */
  activate() {}

  /** Called when another tool becomes active. Must clean up overlay elements. */
  deactivate() {}

  /**
   * Called when a modifier override temporarily replaces this tool.
   * Park in-progress state without fully deactivating.
   * @param {string} overrideTool
   */
  suspendTo(overrideTool) {}

  /**
   * Called when the modifier is released and this tool resumes.
   * Default: re-runs activate().
   */
  resume() { this.activate(); }

  /**
   * Declare sub-features this tool supports.
   * @returns {SubFeature[]}
   */
  subFeatures() { return []; }

  /** Currently active sub-feature id. @type {string|null} */
  get activeSubFeature() { return this._activeSubFeature ?? null; }

  /** @param {string|null} id */
  setSubFeature(id) {
    const prev = this._activeSubFeature ?? null;
    if (prev === id) return;

    const prevDef = this.subFeatures().find(f => f.id === prev);
    const nextDef = this.subFeatures().find(f => f.id === id);

    if (prevDef?.deactivate) prevDef.deactivate();
    this._activeSubFeature = id;
    if (nextDef?.activate)   nextDef.activate();

    if (this._ctx) this._ctx.emit('subfeature-change', { tool: this.id, subFeature: id });
  }

  // ── Shared helpers ──────────────────────────────────────────────────────────

  _clearSelection() {
    const s = this._ctx.state;
    s.selection        = new Set();
    s.selectionOrigin  = null;
    s.selectionRotation = null;
  }

  // ── Event handlers (override as needed) ────────────────────────────────────

  /** @param {MouseEvent} e */   onMouseDown(e) {}
  /** @param {MouseEvent} e */   onMouseMove(e) {}
  /** @param {MouseEvent} e */   onMouseUp(e)   {}
  /** @param {MouseEvent} e */   onDblClick(e)  {}
  /** @param {KeyboardEvent} e */onKeyDown(e)   {}
}
