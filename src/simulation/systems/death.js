import { EventTypes } from '../events/EventTypes.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';

/**
 * Turn a living animal into a carcass in place (Step 6 model), emitting
 * `entity.died` with the given cause. Shared by every system that can kill an
 * animal — starvation (metabolism), dehydration (hydration), and later
 * predation/injury — so the carcass transformation lives in one place.
 *
 * Identity is preserved (same id/position, valid spatial-grid entry); the
 * `kind === 'animal' && alive` guard in every animal system then skips it.
 * From Step 18 the body is on a clock: the carcass system decays it and
 * eventually removes it from the world.
 *
 * @param {object} entity the animal to kill (mutated to a carcass)
 * @param {string} cause death cause for the event (e.g. 'starvation')
 * @param {number} edibleMass carcass edible mass (∝ body mass)
 * @param {(type: string, payload: object) => void} emit context.emit
 * @param {number} [tick] tick to stamp on the closing life-history entry
 */
export function killAnimal(entity, cause, edibleMass, emit, tick = null) {
  entity.alive = false;
  entity.kind = 'carcass';
  entity.lowEnergy = false;
  // ⚠⚠ **A carcass has no wings** (found 2026-08-05). `flying` is written once per
  // tick by the decision system for living animals only, so a bird that died
  // *airborne* kept the flag forever — a flying carcass, projected as one in every
  // bulk snapshot, for as long as the body lasted. Latent since flight landed
  // (phase F1): nothing in this file has ever mentioned the field, and the
  // invariant test that catches it only fires when a vulture happens to die
  // mid-flight inside its sampled window, which no seed had managed until a
  // trajectory change moved which animals die when.
  //
  // ⚠ `elevation` is deliberately **not** cleared beside it: a body cached up a
  // tree really is aloft, and that is the whole of the leopard's kill caching.
  // Being off the ground and having wings are different claims, and only the
  // second one dies with the animal.
  entity.flying = false;
  entity.edibleMass = edibleMass;
  // Step 18: the decay clock starts now, and the cause travels with the body
  // so it can be carried into the tombstone when the carcass finally goes.
  entity.diedTick = tick;
  entity.deathCause = cause;
  entity.decayStage = 0;
  if (tick !== null) recordLifeEvent(entity, tick, LifeEventTypes.DIED, { cause });
  emit(EventTypes.ENTITY_DIED, { entityId: entity.id, cause });
}
