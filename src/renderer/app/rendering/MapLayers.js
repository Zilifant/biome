/**
 * The map layers a viewer can switch on and off, and the presentation state
 * that remembers which are on.
 *
 * A **layer** is something drawn over the whole grid that is *not* the world
 * itself — a reading of the authoritative output rather than a redraw of it. The
 * grid's own passes (terrain, forage, worn ground, disturbances, entities) are
 * not layers and are never toggleable: switching off the animals would leave a
 * renderer that portrays nothing. Neither are the **selected animal's** overlays
 * — its memories, its home range, its family, its quarry — which appear and
 * vanish with the selection and are therefore already under the viewer's
 * control.
 *
 * What is left is the class this registry is for: a fact about *every* animal on
 * the map at once, drawn from bulk-snapshot fields, worth seeing sometimes and
 * in the way the rest of the time.
 *
 * ⚠ **One entry here is the whole cost of a new layer's UI.** The panel
 * (`ui/LayerPanel.js`) builds a row per entry, the persisted set is keyed by
 * `id`, and the legend reads whatever registry the layer draws from — exactly as
 * a species is one entry in `SPECIES_APPEARANCE` and a status one in
 * `STATUS_APPEARANCE`. What a layer *draws* is its own module; this says only
 * that it exists, what to call it, and whether it starts on.
 *
 * ⚠ **Layers default to off.** A layer earns the screen when it is asked for: the
 * grid is dense already, and something drawn over every animal on every tick that
 * nobody switched on is noise the first time it is seen. `defaultEnabled` is here
 * so that judgement can be made per layer rather than assumed.
 *
 * @type {ReadonlyArray<{id: string, label: string, note: string, defaultEnabled: boolean}>}
 */
export const MAP_LAYERS = Object.freeze([
  Object.freeze({
    id: 'social',
    label: 'Social',
    note: 'outlines each herd, band, clan and pride',
    defaultEnabled: false,
  }),
  // ⚠ The one layer here that is **not** read off the entities. Its fact is the
  // claim grid (protocol v37) — a projection of the world rather than of the
  // animals in it — which is why the "a fact about every animal at once" test
  // above is worded as it is: what a layer must not be is a fact about *one*
  // animal. Territory is about every claim at once, and answering "where is each
  // pride's ground" from a query about one lion is exactly as impossible as
  // answering "where is each pride" was at v33.
  Object.freeze({
    id: 'territory',
    label: 'Territory',
    note: 'outlines the ground each pride, clan and lone holder marks',
    defaultEnabled: false,
  }),
]);

/** Presentation state, so it lives in the browser rather than in the store. */
export const LAYERS_STORAGE_KEY = 'biome.layers.enabled';

/**
 * Which layers are on, given whatever was stored (or nothing at all).
 *
 * ⚠ **An unknown id is dropped and a known one absent from the stored set is
 * *off*, not defaulted.** An empty stored set means "I turned everything off"
 * and is honoured — the same rule the event filter follows, and for the same
 * reason: only an absent or unreadable value falls back to the defaults. A layer
 * added to the registry after a viewer last stored their choices is the one case
 * that genuinely has no answer, and it takes its own default.
 *
 * @param {string[] | null | undefined} stored ids read from storage, or null
 * @returns {Set<string>}
 */
export function resolveEnabledLayers(stored) {
  const known = new Set(MAP_LAYERS.map((layer) => layer.id));
  if (!Array.isArray(stored)) {
    return new Set(MAP_LAYERS.filter((layer) => layer.defaultEnabled).map((layer) => layer.id));
  }
  const remembered = new Set(stored.filter((id) => known.has(id)));
  // A layer the stored set could not have known about takes its default.
  const seen = new Set(stored);
  for (const layer of MAP_LAYERS) {
    if (layer.defaultEnabled && !seen.has(layer.id)) remembered.add(layer.id);
  }
  return remembered;
}
