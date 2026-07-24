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
 *
 * From Step 29 this species finally has a **body of its own**. For thirteen
 * steps a stalker cub was born at the grazer's 5 kg, grew on the grazer's
 * curve, and died of old age on the grazer's schedule, because all of it lived
 * in global config (§1.4 A17, B3). The blocks below are where that is fixed,
 * and each one states only what differs from the config defaults.
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
  // Hunts by detection, so it senses much further than its prey.
  perception: Object.freeze({ radius: 12 }),
  // Bigger and better insulated than its prey, so it tolerates the cold
  // better and the heat worse (Step 19), °C.
  comfortMin: -3,
  comfortMax: 24,
  // §1.4 A17, closed. A predator is born larger, takes longer to reach a bigger
  // adult size, and lives longer than its prey — all of which used to be the
  // grazer's numbers applied to a different animal.
  aging: Object.freeze({
    birthMass: 8, // kg — a cub, not a calf
    maturityAge: 1400, // slower to grow into a bigger body
    juvenileUntil: 500,
    subadultUntil: 1400,
    adultUntil: 7000, // a longer prime than the grazer's 6000
    maxAge: 14000,
  }),
  // A predator at rest is expensive (more muscle) but travels cheaply for its
  // mass — the economics that make ambush and long patrols both viable.
  metabolism: Object.freeze({ basalRate: 0.045, moveCostFactor: 0.017 }),
  // Gets much of its water from what it eats, so it dries out more slowly.
  hydration: Object.freeze({ dehydrationRate: 0.028 }),
  // Mate choice (Step 22). A different species, a different display: stalkers
  // read **speed**, the trait their whole living depends on, and weigh it more
  // sharply (a smaller `span`) than grazers weigh size. Nothing in the code
  // knows which species is which — the preference is read generically from
  // here (see mating/mateChoice.js).
  matePreference: Object.freeze({ trait: 'speed', span: 0.22, conditionWeight: 0.4 }),
  // Solitary and slow to breed, as a top predator at low density must be.
  reproduction: Object.freeze({ gestationTicks: 1000, cooldownTicks: 2400 }),
  // Territory (Step 24). A solitary ambush predator holds ground: it marks,
  // it avoids a rival's marks, and it disputes ground it finds occupied. The
  // range is wide because a predator needs a lot of prey to live off, and it
  // settles slowly because a territory is a claim built over time, not a
  // decision taken once.
  territory: Object.freeze({ defends: true, rangeRadius: 26, settleTicks: 1400 }),
  // Migration (Step 26). A stalker does **not** track forage: its food is the
  // grazer, and it already follows that through perception and the hunt
  // pipeline — a vegetation gradient would point it at grass it cannot eat.
  // It **does** track water: a predator gets most of its water from what it
  // eats and so rarely needs the lake, but when it does dry out it needs the
  // same long-range steer toward it a grazer has — without it a stalker that
  // spends its life in a corner of the map far from the one lake can dehydrate
  // having never encountered water, with no cue to tell it which way to go
  // (measured on a corner-lake seed: the last stalkers died of thirst having
  // never perceived water once). The cue only bends a wander and only while the
  // animal is thirsty, so a fed, watered predator behaves exactly as before.
  // What it also shares is **natal dispersal**, and for a territorial species
  // that is the important half: a young stalker cannot inherit its parent's
  // ground, so it must leave and found its own. It walks out for longer than a
  // grazer does, because it has further to go before the ground is unclaimed.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 0, dispersalTicks: 700 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
