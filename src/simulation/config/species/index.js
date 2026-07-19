/**
 * Species registry. Species definitions are code (biology-only data), keyed by
 * a stable `speciesId` string that also travels through the protocol. Systems
 * look species up by id rather than branching on species names (invariant:
 * no species-name conditionals in core systems — Step 29 generalizes this).
 */
import { herbivoreGrazer } from './herbivoreGrazer.js';

/** @type {Readonly<Record<string, object>>} */
export const SPECIES = Object.freeze({
  [herbivoreGrazer.id]: herbivoreGrazer,
});

/**
 * Look up a species definition by id.
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

/** @returns {object[]} all species definitions */
export function listSpecies() {
  return Object.values(SPECIES);
}
