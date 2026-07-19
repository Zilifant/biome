/**
 * Species registry. Species definitions are code (biology-only data), keyed by
 * a stable `speciesId` string that also travels through the protocol. Systems
 * look species up by id rather than branching on species names (invariant:
 * no species-name conditionals in core systems — Step 29 generalizes this).
 */
import { herbivoreGrazer } from './herbivoreGrazer.js';
import { predatorStalker } from './predatorStalker.js';

/** @type {Readonly<Record<string, object>>} */
export const SPECIES = Object.freeze({
  [herbivoreGrazer.id]: herbivoreGrazer,
  [predatorStalker.id]: predatorStalker,
});

/**
 * Whether `predatorId`'s species hunts `preyId`'s species. The single source
 * of the predator/prey relation, read in both directions: perception uses it to
 * tell a predator what to hunt and to tell prey what to fear, so no system ever
 * branches on a species name.
 * @param {string} predatorSpeciesId
 * @param {string} preySpeciesId
 */
export function hunts(predatorSpeciesId, preySpeciesId) {
  return SPECIES[predatorSpeciesId]?.preySpeciesIds?.includes(preySpeciesId) ?? false;
}

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
