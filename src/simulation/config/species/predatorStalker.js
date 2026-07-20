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
  // Mate choice (Step 22). A different species, a different display: stalkers
  // read **speed**, the trait their whole living depends on, and weigh it more
  // sharply (a smaller `span`) than grazers weigh size. Nothing in the code
  // knows which species is which — the preference is read generically from
  // here (see mating/mateChoice.js).
  matePreference: Object.freeze({ trait: 'speed', span: 0.22, conditionWeight: 0.4 }),
  // Territory (Step 24). A solitary ambush predator holds ground: it marks,
  // it avoids a rival's marks, and it disputes ground it finds occupied. The
  // range is wide because a predator needs a lot of prey to live off, and it
  // settles slowly because a territory is a claim built over time, not a
  // decision taken once.
  territory: Object.freeze({ defends: true, rangeRadius: 26, settleTicks: 1400 }),
  // Migration (Step 26). A stalker does **not** track forage: its food is the
  // grazer, and it already follows that through perception and the hunt
  // pipeline — a vegetation gradient would point it at grass it cannot eat.
  // What it does share is **natal dispersal**, and for a territorial species
  // that is the important half: a young stalker cannot inherit its parent's
  // ground, so it must leave and found its own. It walks out for longer than a
  // grazer does, because it has further to go before the ground is unclaimed.
  migration: Object.freeze({ tracksForage: false, cueRadius: 0, dispersalTicks: 700 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
