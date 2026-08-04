/**
 * Sprite editor entry point: composes the pure editor state with the sheet and
 * slot panels, the tint and background pickers, and the config lifecycle
 * (localStorage live-save, JSON export/import, reset, custom-PNG loading).
 *
 * Every state change saves and re-renders wholesale — this is a tool page, not
 * the renderer's hot rAF path, and simplicity wins here.
 */
import {
  initialState,
  selectSlot,
  pickSprite,
  setTint,
  clearAssignment,
  setBackground,
  setSheetDataUrl,
  importConfig,
  resetToDefault,
} from './EditorState.js';
import { SheetPanel } from './SheetPanel.js';
import { SlotsPanel } from './SlotsPanel.js';
import { loadSpriteConfig, saveSpriteConfig, resetSpriteConfig, SHEET } from '../rendering/SpriteConfig.js';
import { DRACULA_COLORS } from '../rendering/EntityAppearance.js';
import { describeSpriteSlots } from '../rendering/SpriteSlots.js';

/** data: URLs above this length may exceed the localStorage quota. */
const SHEET_SIZE_WARNING_BYTES = 2 * 1024 * 1024;

let state = initialState(loadSpriteConfig());
/** @type {HTMLImageElement | null} */
let atlas = null;

const slotLabels = new Map(
  describeSpriteSlots().flatMap((group) => group.slots.map((slot) => [slot.slotId, slot.label]))
);

const statusLine = document.getElementById('editor-status');
const tintInput = document.getElementById('tint-input');
const backgroundInput = document.getElementById('background-input');
const previewCanvas = document.getElementById('editor-preview');

const sheetPanel = new SheetPanel(document.getElementById('sheet-panel'), {
  onPick: (col, row) => update(pickSprite(state, col, row)),
});
const slotsPanel = new SlotsPanel(document.getElementById('slots-panel'), {
  onSelect: (slotId) => update(selectSlot(state, slotId)),
});

function update(next) {
  if (next === state) return;
  state = next;
  saveSpriteConfig(state.config);
  render();
}

function render() {
  sheetPanel.render(state);
  slotsPanel.render(state);
  renderStatus();
  renderPickers();
  renderPreview();
}

function renderStatus() {
  const slotId = state.selectedSlotId;
  if (state.selectedSprite) {
    statusLine.textContent = `sprite ${state.selectedSprite.col},${state.selectedSprite.row} in hand — click a glyph to assign it`;
  } else if (slotId) {
    const assignment = state.config.assignments[slotId];
    statusLine.textContent = assignment
      ? `${slotLabels.get(slotId) ?? slotId} → sprite ${assignment.col},${assignment.row}${assignment.tint ? `, tinted ${assignment.tint}` : ''}`
      : `${slotLabels.get(slotId) ?? slotId} — click a sprite on the sheet to assign it`;
  } else {
    statusLine.textContent = atlas
      ? 'click a glyph on the right, then a sprite on the left — or the other way round'
      : 'no spritesheet loaded — glyphs render as ASCII until one is supplied';
  }
}

function renderPickers() {
  const assignment = state.selectedSlotId ? state.config.assignments[state.selectedSlotId] : null;
  tintInput.disabled = !assignment;
  document.getElementById('tint-clear').disabled = !assignment?.tint;
  document.getElementById('assignment-clear').disabled = !assignment;
  for (const button of document.querySelectorAll('#tint-swatches button')) {
    button.disabled = !assignment;
  }
  if (assignment?.tint) tintInput.value = assignment.tint;
  if (state.config.canvasBackground) backgroundInput.value = state.config.canvasBackground;
  document.getElementById('background-clear').disabled = !state.config.canvasBackground;
  document.getElementById('sheet-default').disabled = !state.config.sheetDataUrl;
}

/** A 3× preview of the selected slot's sprite over the chosen background. */
function renderPreview() {
  const size = previewCanvas.width;
  const ctx = previewCanvas.getContext('2d');
  ctx.fillStyle = state.config.canvasBackground ?? DRACULA_COLORS.background;
  ctx.fillRect(0, 0, size, size);
  const assignment = state.selectedSlotId ? state.config.assignments[state.selectedSlotId] : null;
  if (!assignment || !atlas) return;
  const { spriteWidth, spriteHeight, gap, margin } = SHEET;
  const sx = margin + assignment.col * (spriteWidth + gap);
  const sy = margin + assignment.row * (spriteHeight + gap);
  if (sx + spriteWidth > atlas.naturalWidth || sy + spriteHeight > atlas.naturalHeight) return;
  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(size / spriteWidth, size / spriteHeight);
  const dw = Math.max(1, Math.round(spriteWidth * scale));
  const dh = Math.max(1, Math.round(spriteHeight * scale));
  ctx.drawImage(atlas, sx, sy, spriteWidth, spriteHeight, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh);
  if (assignment.tint) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = assignment.tint;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------------------ the sheet

function loadAtlas(url) {
  if (!url) {
    atlas = null;
    sheetPanel.setAtlas(null);
    slotsPanel.setAtlas(null);
    render();
    return;
  }
  const image = new Image();
  image.onload = () => {
    atlas = image;
    sheetPanel.setAtlas(image);
    slotsPanel.setAtlas(image);
    render();
  };
  image.onerror = () => {
    atlas = null;
    sheetPanel.setAtlas(null);
    slotsPanel.setAtlas(null);
    render();
  };
  image.src = url;
}

document.getElementById('sheet-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    update(setSheetDataUrl(state, dataUrl));
    if (dataUrl.length > SHEET_SIZE_WARNING_BYTES) {
      statusLine.textContent =
        'sheet loaded — note: a sheet this large may not persist in localStorage; use Export to keep the config';
    }
    loadAtlas(dataUrl);
  };
  reader.readAsDataURL(file);
  // Allow re-loading the same file later.
  event.target.value = '';
});

document.getElementById('sheet-default').addEventListener('click', () => {
  update(setSheetDataUrl(state, null));
  loadAtlas(SHEET.url);
});

// ------------------------------------------------------- tint and background

function buildSwatches(containerId, onPick) {
  const container = document.getElementById(containerId);
  for (const [token, hex] of Object.entries(DRACULA_COLORS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.backgroundColor = hex;
    button.setAttribute('aria-label', `${token} (${hex})`);
    button.title = `${token} (${hex})`;
    button.addEventListener('click', () => onPick(hex));
    container.appendChild(button);
  }
}

buildSwatches('tint-swatches', (hex) => update(setTint(state, hex)));
buildSwatches('background-swatches', (hex) => update(setBackground(state, hex)));

tintInput.addEventListener('input', () => update(setTint(state, tintInput.value.toUpperCase())));
document.getElementById('tint-clear').addEventListener('click', () => update(setTint(state, null)));
document.getElementById('assignment-clear').addEventListener('click', () => update(clearAssignment(state)));

backgroundInput.addEventListener('input', () => update(setBackground(state, backgroundInput.value.toUpperCase())));
document.getElementById('background-clear').addEventListener('click', () => update(setBackground(state, null)));

// ------------------------------------------------- export / import / reset

document.getElementById('config-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'sprite-config.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

document.getElementById('config-import').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { state: next, ok } = importConfig(state, String(reader.result));
    if (!ok) {
      statusLine.textContent = 'that file is not a usable sprite config — nothing was changed';
      return;
    }
    update(next);
    loadAtlas(next.config.sheetDataUrl ?? SHEET.url);
  };
  reader.readAsText(file);
  event.target.value = '';
});

document.getElementById('config-reset').addEventListener('click', () => {
  // Reset *forgets* — going through update() would immediately re-save the
  // default config under the key we just removed.
  state = resetToDefault(state);
  resetSpriteConfig();
  render();
  loadAtlas(SHEET.url);
});

// --------------------------------------------------------------------- boot

render();
loadAtlas(state.config.sheetDataUrl ?? SHEET.url);
