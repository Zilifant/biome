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
  perceptionRadius: 6, // world units the animal can sense around itself
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
