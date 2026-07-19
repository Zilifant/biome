import { EventTypes } from '../events/EventTypes.js';

/**
 * Turn a living animal into a carcass in place (Step 6 model), emitting
 * `entity.died` with the given cause. Shared by every system that can kill an
 * animal — starvation (metabolism), dehydration (hydration), and later
 * predation/injury — so the carcass transformation lives in one place.
 *
 * Identity is preserved (same id/position, valid spatial-grid entry); the
 * `kind === 'animal' && alive` guard in every animal system then skips it.
 *
 * @param {object} entity the animal to kill (mutated to a carcass)
 * @param {string} cause death cause for the event (e.g. 'starvation')
 * @param {number} edibleMass carcass edible mass (∝ body mass)
 * @param {(type: string, payload: object) => void} emit context.emit
 */
export function killAnimal(entity, cause, edibleMass, emit) {
  entity.alive = false;
  entity.kind = 'carcass';
  entity.lowEnergy = false;
  entity.edibleMass = edibleMass;
  emit(EventTypes.ENTITY_DIED, { entityId: entity.id, cause });
}
