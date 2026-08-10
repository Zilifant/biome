/**
 * Finding a body by smell rather than by sight (2026-08-10, **A102**).
 *
 * ⚠⚠ **The finding this exists for.** A scavenger in this world could only reach
 * a carcass three ways: see it inside its own `perception.radius`, remember a
 * place *it personally* had fed, or join a **conspecific's** hunt. There is no
 * fourth. A hyena cannot perceive a lion in any actionable way — no cat has
 * `scavenger.hyena` on its prey list, so `threatens` is false, and the hyena does
 * not hunt cats, so the species relation is false in the other direction too;
 * `nearestAnimal` is written by perception and read by **nothing**. So a hyena has
 * no way to know a hunt is even happening. A body springs into existence when
 * `killAnimal` runs, and the hyena learns of it only if it happens to be standing
 * within 13 cells with clear sight at that moment.
 *
 * That is what made `behavior.minHungerToHunt: 0.75` lethal (A102): the threshold
 * assumes a scavenging income the animal has no means to go and get. Carrion was
 * in a hyena's perception on **14.8–23.3%** of its ticks and it could do nothing
 * to raise that number.
 *
 * **What this adds.** One species field, `perception.carrionRadius` — how far this
 * animal detects a body, as opposed to how far it sees. Absent (`null`) means "the
 * same as sight", which is exactly the old behaviour, so a roster that declares
 * none is byte-identical and pays one `Map.size` comparison.
 *
 * ⚠⚠ **It is a nose, so it is not blocked by rock.** A species that declares a
 * carrion radius stops applying the line-of-sight test to *carcasses only* — smell
 * goes around an obstacle and sight does not. That is a second behaviour change
 * riding on one field, stated here rather than left to be discovered, and the two
 * are deliberately not separable: setting `carrionRadius` equal to
 * `perception.radius` turns both off together and is the honest off-state to
 * measure against. Living animals, mates, threats and prey are untouched — the
 * shared perception gate is **A63**, and a condition added there gates
 * reproduction three subsystems away.
 *
 * ⚠ **The cost is real and it lands in the hottest loop in the engine.** It widens
 * `grid.queryRadius` — the linear bounding-box cell walk — and **not** the (2r+1)²
 * cell scan, which stays on the sight radius. That is the same bargain
 * `herdRadiiIn` struck for BEHAVIOR-PLAN P1 and the reason this is a per-species
 * map rather than a global number: only the species that asked for it pays, and on
 * the shipped demo that is ~10–20 animals out of ~500.
 */

/**
 * How far this species detects a carcass, or `null` for "no further than it sees".
 *
 * ⚠ Returns null rather than 0 for an absent value, matching `herdRadiusOf`: 0
 * would read as "detects carrion nowhere", which is a different and much worse
 * claim than "detects it as far as it can see".
 *
 * @param {{perception?: {carrionRadius?: number}}} [species] a resolved species record
 * @returns {number|null}
 */
export function carrionRadiusOf(species) {
  const radius = species?.perception?.carrionRadius;
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : null;
}

/**
 * Every species in a world that declares a carrion radius, keyed by id.
 *
 * Built **once per world** and checked for emptiness before anything else — the
 * same early-out `herdRadiiIn` and `crypticSpeciesIn` use, and for the same
 * reason: a mechanism no species asks for should cost one `size` comparison, not
 * a lookup per animal per tick.
 *
 * @param {{all: () => object[]}} [registry] the species registry
 * @returns {Map<string, number>}
 */
export function carrionRadiiIn(registry) {
  const byId = new Map();
  for (const species of registry?.all?.() ?? []) {
    const radius = carrionRadiusOf(species);
    if (radius !== null) byId.set(species.id, radius);
  }
  return byId;
}
