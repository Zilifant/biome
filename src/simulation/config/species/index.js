/**
 * Species registry. Species definitions are code (biology-only data), keyed by
 * a stable `speciesId` string that also travels through the protocol. Systems
 * look species up by id rather than branching on species names — an invariant
 * since Step 4, and from Step 29 enforced mechanically by a source scan (see
 * `test/species-schema.test.js`).
 *
 * ⚠ **These are the raw definitions, not the resolved species.** From Step 29 a
 * species inherits most of its biology from the global config and overrides only
 * what differs (see `schema.js`), so the objects here are *incomplete* — reading
 * `SPECIES['predator.leopard'].metabolism.massScalingExponent` gives undefined.
 * Resolution needs the config, which is per-engine, so it happens once at engine
 * construction and the result is hung on the world:
 *
 *     world.species.get(entity.speciesId)   // resolved, frozen, allocation-free
 *
 * Systems must use that. This module exists to *declare* the roster; a
 * module-level singleton of resolved species would be wrong the moment two
 * engines with different configs share a process, which every sweep and half the
 * test suite does.
 */
import { herbivoreGazelle } from './herbivoreGazelle.js';
import { predatorLeopard } from './predatorLeopard.js';
import { scavengerVulture } from './scavengerVulture.js';
import { scavengerHyena } from './scavengerHyena.js';
import { herbivoreBuffalo } from './herbivoreBuffalo.js';
import { predatorLion } from './predatorLion.js';
import { herbivoreWildebeest } from './herbivoreWildebeest.js';
import { herbivoreZebra } from './herbivoreZebra.js';

/**
 * The declared roster, in a fixed order. Iteration order is deterministic
 * everywhere in this engine by rule, and this list is what founding spawns and
 * metrics bucketing walk.
 * @type {ReadonlyArray<object>}
 */
export const SPECIES_DEFINITIONS = Object.freeze([
  herbivoreGazelle,
  herbivoreWildebeest,
  herbivoreZebra,
  herbivoreBuffalo,
  predatorLeopard,
  predatorLion,
  scavengerVulture,
  scavengerHyena,
]);

/** @type {Readonly<Record<string, object>>} raw definitions by id */
export const SPECIES = Object.freeze(Object.fromEntries(SPECIES_DEFINITIONS.map((s) => [s.id, s])));

/**
 * Look up a raw species definition by id.
 *
 * For fixtures and tests that need the declared facts (`bodyMass`, `baseSpeed`,
 * `id`) before an engine exists. Anything reading *resolved* biology wants
 * `world.species` instead.
 * @param {string} id
 * @returns {object}
 */
export function getSpecies(id) {
  const species = SPECIES[id];
  if (!species) {
    throw new Error(`unknown species "${id}" (known: ${Object.keys(SPECIES).join(', ')})`);
  }
  return species;
}

/** @returns {object[]} all raw species definitions */
export function listSpecies() {
  return [...SPECIES_DEFINITIONS];
}
