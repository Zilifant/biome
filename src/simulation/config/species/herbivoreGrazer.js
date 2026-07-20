/**
 * Species definition — biology only. No glyphs, colors, or UI labels: those
 * are the renderer's business (invariant 20). A species definition is plain,
 * JSON-serializable data describing how members of the species work, not how
 * they look.
 *
 * The first real herbivore: a generic grazer. Fields marked "(Step N)" are
 * declared now so the species seam is stable, but only mass/speed/energy/
 * health are exercised in Step 4 — behavior, metabolism, and life stages
 * arrive in later steps.
 */
export const herbivoreGrazer = Object.freeze({
  id: 'herbivore.grazer',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30, // kg (adult); individual variation arrives in Step 14
  baseSpeed: 1.2, // world units per tick
  maxEnergy: 100, // energy units
  maxHealth: 100, // health units
  maxHydration: 100, // hydration units
  maxStamina: 100, // sprint budget, spent fleeing (Step 16)
  perceptionRadius: 6, // world units the animal can sense around itself
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
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
