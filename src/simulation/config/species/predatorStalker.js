/**
 * The first predator (Step 16) — biology only, no glyphs or colors.
 *
 * A stalking pursuit predator: faster than its prey in a sprint but with a
 * limited stamina budget, so a hunt is a gamble rather than a certainty. It
 * closes quietly at walking pace (`stalk`), commits to a sprint only inside
 * `chaseRange` (`chase`), and either catches the grazer or burns its stamina
 * and has to recover.
 *
 * `preySpeciesIds` is the data that makes predation work without a single
 * species-name conditional anywhere in the systems: perception reads it in
 * both directions — this species hunts those, therefore those fear this one.
 */
export const predatorStalker = Object.freeze({
  id: 'predator.stalker',
  kind: 'animal',
  diet: 'carnivore',
  preySpeciesIds: Object.freeze(['herbivore.grazer']),
  bodyMass: 45, // kg (adult) — heavier than the grazer, so costlier to run
  baseSpeed: 1.35, // world units per tick; only modestly faster at a walk
  maxEnergy: 120, // a bigger tank: predators eat rarely and in bulk
  maxHealth: 100,
  maxHydration: 100,
  maxStamina: 100, // sprint budget; see systems/HuntingSystem.js
  perceptionRadius: 12, // hunts by detection, so it senses further than its prey
  // Bigger and better insulated than its prey, so it tolerates the cold
  // better and the heat worse (Step 19), °C.
  comfortMin: -3,
  comfortMax: 24,
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
