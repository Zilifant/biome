/**
 * Species definition — biology only. No glyphs, colors, or UI labels: those
 * are the renderer's business (invariant 20). A species definition is plain,
 * JSON-serializable data describing how members of the species work, not how
 * they look.
 *
 * The first real herbivore: a generic grazer, and the animal every global
 * default in the config was tuned around — so it overrides almost nothing. Read
 * this file as "the baseline"; the interesting reading is what the *other*
 * species change about it (see `config/species/schema.js` for how the blocks
 * fall back to the config).
 */
export const herbivoreGrazer = Object.freeze({
  id: 'herbivore.grazer',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30, // kg (adult)
  baseSpeed: 1.2, // world units per tick
  maxEnergy: 100, // energy units
  maxHealth: 100, // health units
  maxHydration: 100, // hydration units
  maxStamina: 100, // sprint budget, spent fleeing (Step 16)
  // Perception (Step 29, closing §1.4 B4). Was a bare `perceptionRadius`
  // scalar — a *third* config pattern beside the global sections and the
  // per-species blocks. Now a block like every other.
  perception: Object.freeze({ radius: 6 }),
  // Thermal comfort band (Step 19), °C. Outside it the animal pays energy to
  // hold its body temperature; cover takes the edge off.
  comfortMin: 2,
  comfortMax: 27,
  // Mate choice (Step 22). Females gestate and therefore choose; what they read
  // is this species fact, how hard they weigh it is the individual's heritable
  // `choosiness`. Grazers display **size** — deliberately a trait natural
  // selection pushes the other way, since a bigger grazer is slower (the
  // size→speed tradeoff) and burns more energy at rest. Preferring it therefore
  // makes sexual and natural selection pull against each other, which is what
  // lets the metrics tell them apart. `span` is the trait deviation that
  // saturates the signal; `conditionWeight` is how much plain body condition
  // counts beside it (see mating/mateChoice.js).
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  // Territory (Step 24). Grazers have a **home range but do not defend it** —
  // they are herd animals whose ranges overlap freely, so `defends: false`
  // buys site fidelity (an animal returns to familiar ground instead of
  // wandering off forever) without exclusivity. That is the honest split:
  // every animal lives somewhere, not every animal owns it.
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  // Migration (Step 26). A grazer follows the grass, so it tracks the forage
  // gradient. `cueRadius` is 18 against a perception radius of 6 — deliberately
  // beyond what the animal can see, standing in for the coarse long-range cues
  // this world does not simulate; see migration/migration.js, where that
  // assumption is stated rather than buried. `dispersalTicks` is how long a
  // juvenile holds its outward heading after leaving its guardian.
  // `tracksWater` gives a thirsty grazer the same long-range steer toward the
  // lake that `tracksForage` gives it toward grass — it drinks, and the single
  // lake is otherwise unreachable knowledge from most of the map (see
  // world/World.js `nearestWater` and the migration system's thirst cue).
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 18, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
