/**
 * Habitat preference — which ground a species wants to live on (DOCS A49,
 * PLAN-SPECIES.md §3.4, phase 9).
 *
 * Nothing let a species prefer thicket over open plain, or open plain over cover.
 * Habitat was expressed only through `migration.tracksForage` and the comfort
 * band, which is to say through what an animal *eats* and how warm it is — so
 * every species in the world wanted the same ground, and §2's competitive
 * exclusion came back through the one axis nothing could separate. The roster
 * makes it load-bearing rather than decorative: gazelle, wildebeest, and zebra are
 * open-plain animals, leopard and rhino are cover animals, and buffalo sit near
 * water.
 *
 * **A preference is one weight per terrain code, keyed by the legend's own
 * names**, so a species file reads as English and a new terrain type needs no
 * change here. `1` is neutral; above 1 attracts, below 1 repels; an unnamed
 * terrain is neutral. That makes a partial declaration meaningful — "avoids
 * thicket, otherwise indifferent" is one number.
 *
 * ⚠ **Where this is consumed, and the two candidate consumers that were declined
 * on evidence.** §3.4 named three chokepoints — the wander/patrol heading, the
 * migration cue, and settling. Only the cue was built, and the reasons are worth
 * keeping:
 *
 *   - ✅ **The long-range cue** (`habitatGradient`, sampled by `MigrationSystem`).
 *     A drift toward preferred ground, folded into `migrationHeading` — the same
 *     field the forage gradient and the water bearing already write, so it needs
 *     no new entity state and reaches the animal through the wander heading, which
 *     is where 40–77% of all animal-ticks are spent (measured 2026-07-29). That is
 *     the *only* place in this engine where a preference of this size can do
 *     visible work.
 *   - ❌ **Scaling `rest` by the ground underfoot** — "linger where you like it" —
 *     was the obvious local half and would have been **born near-inert**: `rest`
 *     is 0.8–1.6% of animal-ticks in the demo (measured 2026-07-29, four species,
 *     2000 ticks), and it is already gated to satisfied animals. That is A34's
 *     shape exactly — a real mechanism that never fires — so it was not built.
 *   - ❌ **Weighting the home range** (settling). A home range is a *running
 *     average of where the animal has actually been* (DOCS §9 Territory); bending
 *     it toward liked ground would make it a statement of preference rather than a
 *     measurement, and `patrol`, its only consumer, is near-inert anyway (A34).
 *
 * ⚠⚠ **A species with no `habitat` field is exactly unaffected, and so is one whose
 * `migration.cueRadius` is 0** — no cue radius means no long-range sense of any
 * kind, so its preference has nowhere to act. This was written for a four-species
 * world where only the gazelle had a cue, and it was stated here *rather than left
 * to be discovered* because a cover-loving predator would need a cue radius before
 * its habitat block did anything.
 *
 * ✅ **It has now been needed twice, by exactly the species predicted and one
 * more.** The leopard raised its `cueRadius` from 0 to 8 at phase 14 for its cover
 * preference, and the **vulture** from 0 to 18 at phase V1 for a `tree` preference
 * (2026-08-04). **Six of the eight shipped species declare `habitat`**, and every
 * one of them carries a non-zero `cueRadius` — so the trap this note exists to
 * prevent has caught nobody, which is the outcome a written-down trap is for.
 *
 * ⚠ The vulture's 18 is chosen against its **flying** perception radius (13.95),
 * not its ground one (9): the cue's whole modelling assumption is that it reaches
 * beyond what the animal can see, and for a flier "what it can see" is the wider
 * number.
 *
 * The world-level off switch is `config.habitat.enabled`. Like `config.forage`,
 * and for the same reason, `habitat` is an always-per-species **field** beside a
 * global section rather than a `SPECIES_BLOCKS` block: a species block beats the
 * config (DOCS §8), so a switch inside one could not switch anything off.
 */
import { TERRAIN_LEGEND } from '../world/TerrainGrid.js';

/** Weight of a terrain a species says nothing about. Exactly neutral. */
export const NEUTRAL_WEIGHT = 1;

/**
 * Terrain code → legend name, so a species file names `cover` rather than `3`.
 * Built once from the legend the protocol already publishes, which is what keeps
 * the two spellings of a terrain type from drifting apart.
 * @type {ReadonlyArray<string>}
 */
const NAME_BY_CODE = Object.freeze(TERRAIN_LEGEND.map((entry) => entry.name));

/**
 * The habitat preference of a species, or null when it has none.
 * @param {{habitat?: Record<string, number>}} [species]
 * @returns {Record<string, number> | null}
 */
export function habitatOf(species) {
  const habitat = species?.habitat;
  return habitat && typeof habitat === 'object' ? habitat : null;
}

/**
 * How much this animal wants to be on a given terrain code, `> 1` attracted and
 * `< 1` repelled. Neutral for a species with no preference, and neutral for any
 * terrain that preference does not name.
 *
 * @param {number} code a `TerrainType` value
 * @param {Record<string, number> | null} weights
 * @returns {number}
 */
export function habitatWeightForCode(code, weights) {
  if (weights === null) return NEUTRAL_WEIGHT;
  const weight = weights[NAME_BY_CODE[code]];
  return typeof weight === 'number' ? weight : NEUTRAL_WEIGHT;
}

/**
 * **Wet ground or dry** — the second axis of habitat preference (2026-08-09).
 *
 * A terrain weight can only say "on the water" or "not on the water", and the
 * ground an animal actually chooses between is neither: a marsh, a lake shore and
 * a stream bank are all *ground*, and so is the arid plain twenty cells away. The
 * distinction the roster needs — a buffalo in the wetland, a gazelle out on the
 * short-grass plain — is a gradient over the same terrain code, which is exactly
 * what `world.wetnessAt` is.
 *
 * ⚠⚠ **A field beside `habitat`, not a key inside it**, and this is the
 * `associationPull` rule (schema.js) applying a second time for the same reason:
 * `habitat` is read as a flat map keyed by **the terrain legend's own names**, so
 * a `wetness` key in it would be a non-terrain entry in a terrain-keyed map —
 * silently accepted by `habitatWeightForCode`, silently ignored, and impossible to
 * tell from a typo'd terrain name.
 *
 * @param {{wetPreference?: number}} [species]
 * @returns {number} 1 when the species states nothing — exactly neutral
 */
export function wetPreferenceOf(species) {
  const preference = species?.wetPreference;
  return typeof preference === 'number' && preference >= 0 ? preference : NEUTRAL_WEIGHT;
}

/**
 * The habitat weight of a cell's *wetness*, as a multiplier on its terrain weight.
 *
 * **Interpolated by wetness rather than applied as a step**, so the preference is
 * a gradient the cue can climb: at wetness 0 (the dry plain) it is exactly 1
 * whatever the species says, and at wetness 1 (in the marsh, on the shore) it is
 * the full `wetPreference`. A dry-country animal therefore does not merely avoid
 * the marsh — it is pushed *down* the gradient continuously, which is what turns a
 * preference into movement across a landscape rather than a fence around one.
 *
 * ⚠ It **multiplies** the terrain weight rather than being averaged with it, so
 * the two axes compose without either needing to know the other's scale: a buffalo
 * that likes water (terrain) and likes wet ground (this) wants a marsh pool more
 * than either fact alone says, which is right.
 *
 * @param {number} wetness `world.wetnessAt` for the cell, in [0, 1]
 * @param {number} preference the species' `wetPreference`
 * @returns {number}
 */
export function wetnessWeight(wetness, preference) {
  return NEUTRAL_WEIGHT + (preference - NEUTRAL_WEIGHT) * wetness;
}
