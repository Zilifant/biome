/**
 * The map-layer switchboard: one checkbox per entry in `MAP_LAYERS`, plus the
 * key to whatever each switched-on layer draws.
 *
 * Which layers are on is **renderer-owned presentation state**, so it lives in
 * `localStorage` beside the inspector's open sections and the event filter's
 * type set rather than in the store — nothing here is a fact about the world,
 * and nothing here is ever sent anywhere.
 *
 * ⚠ **The panel is built once and never rebuilt.** The registry is static, so
 * there is nothing to re-render: the checkboxes are the state, and the app asks
 * this panel what is on rather than being told. That is why `isEnabled` is the
 * whole interface — a layer's *data* is computed in `RendererApp` when a frame
 * needs it, which is what keeps a switched-off layer costing exactly nothing.
 */
import { MAP_LAYERS, LAYERS_STORAGE_KEY, resolveEnabledLayers } from '../rendering/MapLayers.js';
import { SOCIAL_GROUP_APPEARANCE } from '../rendering/EntityAppearance.js';

function loadStored() {
  try {
    const raw = globalThis.localStorage?.getItem(LAYERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function store(enabled) {
  try {
    globalThis.localStorage?.setItem(LAYERS_STORAGE_KEY, JSON.stringify([...enabled]));
  } catch {
    // A browser that refuses storage still gets working toggles, just no memory
    // of them — the same trade every other persisted panel here makes.
  }
}

/**
 * The key to the group colours, built from the appearance registry so it cannot
 * drift from what is drawn — the same rule the legend follows.
 *
 * It sits with the switches rather than in the legend panel because a colour
 * that only means something while a layer is on belongs beside that layer's
 * switch, and because the legend is already the longest panel in the sidebar.
 * ⚠ The legend carries these rows too (`describeLegend`); this is the second
 * reader of one registry, not a second copy of it.
 *
 * ⚠ **One key serves both layers, because they share the palette on purpose.** A
 * pride's territory is drawn in the same purple as the pride, so a bubble a long
 * way outside its own ground reads as one fact rather than two — see
 * `rendering/TerritoryLayer.js`. What the key cannot cover is a *lone* holder,
 * whose ground takes its species' colour; that is what the line below says, and
 * those colours are already the legend's Animals rows.
 */
function socialKeyMarkup() {
  return Object.entries(SOCIAL_GROUP_APPEARANCE)
    .map(
      ([kind, appearance]) => `
      <span class="layer-swatch" style="color: var(--dracula-${appearance.colorToken})">▢</span>
      <span class="layer-swatch-label">${appearance.label}</span>`,
    )
    .join('');
}

export class LayerPanel {
  #enabled;
  #onChange;

  /**
   * @param {HTMLElement} container
   * @param {{onChange?: (id: string, enabled: boolean) => void}} [callbacks]
   */
  constructor(container, { onChange } = {}) {
    this.#enabled = resolveEnabledLayers(loadStored());
    this.#onChange = onChange ?? (() => {});
    container.innerHTML = `
      <h2>Layers</h2>
      <p class="hint">Drawn over the whole map, whatever is selected.</p>
      ${MAP_LAYERS.map(
        (layer) => `
        <label class="layer-row">
          <input type="checkbox" data-layer="${layer.id}" ${this.#enabled.has(layer.id) ? 'checked' : ''} />
          <span>${layer.label} <span class="dim">${layer.note}</span></span>
        </label>`,
      ).join('')}
      <div class="layer-key">${socialKeyMarkup()}</div>
      <p class="hint">A territory takes its holders' colour above — or the species' own where one animal holds it alone.</p>`;
    // One delegated listener on the container, which is stable — the panel is
    // never rebuilt, but this is also what makes it correct if it ever is.
    container.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.layer) return;
      const id = target.dataset.layer;
      if (target.checked) this.#enabled.add(id);
      else this.#enabled.delete(id);
      store(this.#enabled);
      this.#onChange(id, target.checked);
    });
  }

  /** @param {string} id a layer id from MAP_LAYERS @returns {boolean} */
  isEnabled(id) {
    return this.#enabled.has(id);
  }
}
