/**
 * Modal dialogs — Document Settings, Options.
 */
import { state, getActiveArtboard } from '../core/state.js';
import { render }         from '../render/renderer.js';
import { applyTheme }     from '../app.js';
import { fitToArtboard }  from '../core/Viewport.js';
import { saveSettings, exportSettings, importSettings } from '../core/settings.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function _el(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function _field(labelText, inputEl) {
  const row = _el('div', 'dialog__field');
  const lbl = document.createElement('label');
  lbl.textContent = labelText;
  row.append(lbl, inputEl);
  return row;
}

function _textInput(value, onChange) {
  const el = document.createElement('input');
  el.type  = 'text';
  el.value = value;
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function _numberInput(value, min, onChange) {
  const el  = document.createElement('input');
  el.type   = 'number';
  el.min    = String(min);
  el.value  = String(value);
  el.addEventListener('input', () => {
    const n = parseFloat(el.value);
    if (!isNaN(n) && n >= min) onChange(n);
  });
  return el;
}

function _select(options, value, onChange) {
  const el = document.createElement('select');
  for (const [val, label] of options) {
    const opt = document.createElement('option');
    opt.value       = val;
    opt.textContent = label;
    if (val === value) opt.selected = true;
    el.appendChild(opt);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function _openDialog({ title, buildBody, onApply, onCancel }) {
  const backdrop = _el('div', 'dialog-backdrop');
  const dialog   = _el('div', 'dialog');

  const header  = _el('div', 'dialog__header');
  const titleEl = _el('span', 'dialog__title');
  titleEl.textContent = title;
  const closeBtn = _el('button', 'dialog__close');
  closeBtn.innerHTML = '&times;';
  header.append(titleEl, closeBtn);

  const body = _el('div', 'dialog__body');
  buildBody(body);

  const footer    = _el('div', 'dialog__footer');
  const cancelBtn = _el('button', 'dialog__btn dialog__btn--secondary');
  cancelBtn.textContent = 'Cancel';
  const applyBtn  = _el('button', 'dialog__btn dialog__btn--primary');
  applyBtn.textContent  = 'Apply';
  footer.append(cancelBtn, applyBtn);

  dialog.append(header, body, footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const cancel = () => { onCancel?.(); backdrop.remove(); };
  const close  = () => backdrop.remove();
  closeBtn.addEventListener('click', cancel);
  cancelBtn.addEventListener('click', cancel);
  applyBtn.addEventListener('click', () => { onApply(); close(); });
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) cancel(); });

  // Drag by header
  header.style.cursor = 'grab';
  header.addEventListener('mousedown', e => {
    if (e.target === closeBtn) return;
    e.preventDefault();
    const rect = dialog.getBoundingClientRect();
    dialog.style.cssText += ';position:fixed;margin:0;';
    dialog.style.left = `${rect.left}px`;
    dialog.style.top  = `${rect.top}px`;
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    header.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    const onMove = ev => {
      dialog.style.left = `${ev.clientX - ox}px`;
      dialog.style.top  = `${ev.clientY - oy}px`;
    };
    const onUp = () => {
      header.style.cursor = 'grab';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  requestAnimationFrame(() => body.querySelector('input, select')?.focus());
}

// ── Document Settings ─────────────────────────────────────────────────────────

const PRESETS = [
  ['',          'Custom'],
  ['800x600',   '800 × 600  (default)'],
  ['1920x1080', '1920 × 1080  (HD)'],
  ['1280x720',  '1280 × 720  (720p)'],
  ['1024x768',  '1024 × 768'],
  ['794x1123',  'A4 Portrait  (794 × 1123)'],
  ['1123x794',  'A4 Landscape  (1123 × 794)'],
  ['816x1056',  'US Letter  (816 × 1056)'],
  ['1000x1000', '1000 × 1000  (square)'],
];

function _dimensionRow(labelText, value, onChange) {
  const row   = _el('div', 'dialog__field');
  const lbl   = document.createElement('label');
  lbl.textContent = labelText;
  const input = _numberInput(value, 1, onChange);
  const unit  = _el('span', 'dialog__unit');
  unit.textContent = 'px';
  row.append(lbl, input, unit);
  return { row, input };
}

export function showDocumentSettings() {
  const ab   = getActiveArtboard();
  const vals = {
    width:  ab?.attrs.width  ?? 800,
    height: ab?.attrs.height ?? 600,
  };

  _openDialog({
    title: 'Document Settings',
    buildBody(body) {
      const presetSel = _select(PRESETS, '', () => {});

      // Sync preset dropdown to current dimensions
      const matchingPreset = PRESETS.find(([v]) => {
        if (!v) return false;
        const [pw, ph] = v.split('x').map(Number);
        return pw === vals.width && ph === vals.height;
      });
      presetSel.value = matchingPreset ? matchingPreset[0] : '';

      const { row: wRow, input: wInput } = _dimensionRow('Width',  vals.width,  v => { vals.width  = v; presetSel.value = ''; });
      const { row: hRow, input: hInput } = _dimensionRow('Height', vals.height, v => { vals.height = v; presetSel.value = ''; });

      presetSel.addEventListener('change', () => {
        if (!presetSel.value) return;
        const [pw, ph] = presetSel.value.split('x').map(Number);
        vals.width  = pw;  wInput.value = pw;
        vals.height = ph;  hInput.value = ph;
      });

      const sep = _el('hr', 'dialog__sep');
      body.append(_field('Preset', presetSel), sep, wRow, hRow);
    },
    onApply() {
      const artboard = getActiveArtboard();
      if (artboard) {
        artboard.attrs.width  = vals.width;
        artboard.attrs.height = vals.height;
      }
      fitToArtboard();
      render();
    },
  });
}

// ── Options ───────────────────────────────────────────────────────────────────

export function showOptions() {
  const original = { theme: state.options.theme, units: state.options.units };
  const vals     = { ...original };

  _openDialog({
    title: 'Options',
    buildBody(body) {
      // Theme — live preview on change
      const themeSel = _select(
        [['dark', 'Dark'], ['light', 'Light']],
        vals.theme,
        v => { vals.theme = v; applyTheme(v); render(); },
      );

      const unitsSel = _select(
        [['px', 'Pixels (px)'], ['mm', 'Millimeters (mm)'], ['in', 'Inches (in)']],
        vals.units,
        v => { vals.units = v; },
      );

      // Export / Import row
      const ioRow  = _el('div', 'dialog__field dialog__field--actions');
      const expBtn = _el('button', 'dialog__btn dialog__btn--secondary');
      expBtn.textContent = 'Export Settings…';
      expBtn.addEventListener('click', exportSettings);
      const impBtn = _el('button', 'dialog__btn dialog__btn--secondary');
      impBtn.textContent = 'Import Settings…';
      impBtn.addEventListener('click', () => {
        importSettings(() => {
          // Sync selects to imported values
          themeSel.value = state.options.theme;
          unitsSel.value = state.options.units;
          vals.theme = state.options.theme;
          vals.units = state.options.units;
          render();
        });
      });
      ioRow.append(expBtn, impBtn);

      body.append(
        _field('Theme', themeSel),
        _field('Units', unitsSel),
        ioRow,
      );
    },
    onApply() {
      state.options.units = vals.units;
      if (vals.theme !== state.options.theme) applyTheme(vals.theme);
      saveSettings();
      render();
    },
    onCancel() {
      // Revert live theme preview if user cancels
      if (original.theme !== state.options.theme) {
        applyTheme(original.theme);
        render();
      }
    },
  });
}
