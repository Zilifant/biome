/**
 * Species definition — biology only. No glyphs, colors, or UI labels: those
 * are the renderer's business (invariant 20). A species definition is plain,
 * JSON-serializable data describing how members of the species work, not how
 * they look.
 *
 * The first real herbivore, and the animal every global default in the config
 * was tuned around — so it overrides almost nothing. Read this file as "the
 * baseline"; the interesting reading is what the *other* species change about it
 * (see `config/species/schema.js` for how the blocks fall back to the config).
 *
 * ⚠ **Was `herbivore.gazelle` until 2026-07-29** (PLAN-SPECIES.md phase 7). The
 * conversion was deliberately a **rename and nothing else** — every number below
 * is the grazer's, unchanged, and the demo is byte-identical across seeds to the
 * tree before it. That was the point: the plan put the gazelle rather than the
 * wildebeest in the first batch precisely because a 30 kg generic grazer already
 * *is* a gazelle, so batch 1 could prove "nothing changed" instead of
 * re-deriving every measured number in the demo at 6.7× the mass.
 *
 * Three things follow from keeping `bodyMass: 30`:
 *
 * - `metabolism.referenceMass: 30` stays honest — the reference animal still
 *   exists in the world, as it has since Step 4.
 * - The mass audit (PLAN-SPECIES §4) does not fire on the herbivore side.
 * - Every dated measurement taken against "the grazer" still describes this
 *   animal. A reading is not invalidated by the animal being renamed.
 *
 * What a real gazelle additionally wants is scheduled rather than missing:
 * short-grass preference waits for forage guilds (phase 9, since it is the only
 * herbivore in batch 1 and has nothing to prefer *against*), the hidden-fawn
 * stage waits for phase 8 (A12 — never two juvenile-survival changes at once),
 * male rut territory waits for sex-restricted territory (phase 15), and
 * heterospecific association waits for a second herbivore (phase 12). The rest
 * of the model — loose fission–fusion herds, alarm propagation, forage-tracking
 * migration, mother–calf attachment, fast juvenile development, heavy predation
 * pressure, and male competition through mate contests — is already here and
 * already tuned.
 */
export const herbivoreGazelle = Object.freeze({
  id: 'herbivore.gazelle',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30, // kg (adult) — between a Thomson's and a Grant's gazelle
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
  // `choosiness`. Gazelle display **size** — deliberately a trait natural
  // selection pushes the other way, since a bigger animal is slower (the
  // size→speed tradeoff) and burns more energy at rest. Preferring it therefore
  // makes sexual and natural selection pull against each other, which is what
  // lets the metrics tell them apart. `span` is the trait deviation that
  // saturates the signal; `conditionWeight` is how much plain body condition
  // counts beside it (see mating/mateChoice.js). This is also exactly the "size,
  // condition, and display traits" a gazelle's male competition runs on, which
  // is why phase 7 needed to add nothing for it.
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  // Territory (Step 24). A **home range but no defense** — a herd animal whose
  // range overlaps its neighbours' freely, so `defends: false` buys site
  // fidelity (an animal returns to familiar ground instead of wandering off
  // forever) without exclusivity. That is the honest split: every animal lives
  // somewhere, not every animal owns it.
  // ⚠ A real gazelle buck holds a rut territory that females and juveniles walk
  // straight through, which `territory.defends` cannot express (it is a
  // species-wide boolean). Until it can (phase 15), male competition runs
  // entirely through mate contests — which is both what the source analysis
  // recommends and exactly what this animal already did as the grazer.
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  // Persistent social groups (PLAN-SPECIES.md §3.8). ⚠ **No**, and stating it is
  // the point: this is the species that shows the *other* sociality mechanism
  // working. Gazelle herds are fission–fusion — they form on contact, merge, and
  // tear in half, and every one of those is a `groupId` label propagating
  // between neighbours with nothing anywhere holding a roster. A group *record*
  // models the opposite thing, an identity that survives separation (a pride, a
  // clan, a family), which a loosely-aggregating gazelle simply does not have.
  // The two mechanisms run side by side in one world from batch 1 — the hyena
  // clan on the record, the gazelle herd on the label — and this species is the
  // control that proves the label half still works untouched.
  groups: Object.freeze({ forms: false }),
  // Migration (Step 26). It follows the grass, so it tracks the forage
  // gradient. `cueRadius` is 18 against a perception radius of 6 — deliberately
  // beyond what the animal can see, standing in for the coarse long-range cues
  // this world does not simulate; see migration/migration.js, where that
  // assumption is stated rather than buried. `dispersalTicks` is how long a
  // juvenile holds its outward heading after leaving its guardian.
  // `tracksWater` gives a thirsty animal the same long-range steer toward the
  // lake that `tracksForage` gives it toward grass — it drinks, and the single
  // lake is otherwise unreachable knowledge from most of the map (see
  // world/World.js `nearestWater` and the migration system's thirst cue).
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 18, dispersalTicks: 400 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
