/**
 * The species schema (Step 29) — where a species' biology actually lives.
 *
 * For twenty-five steps, "what an animal is like" was written in two different
 * places at once. Some of it was per-species (`perceptionRadius`, `territory`,
 * `matePreference`); most of it was in **global** config sections that every
 * animal shared, so a predator's cub was born at the grazer's 5 kg and every
 * species aged, starved, and dried out on identical curves. §1.4 named the
 * pieces — B3, B4, A13, A17, A29, A30, A38, A41 — and this is where they land.
 *
 * `feeding` and `hunting` joined the list on 2026-07-28 (PLAN-SPECIES.md §3.2),
 * so a browser and a grazer can differ in what they get out of the same ground
 * and two predators can differ in how they capture; `behavior` and `predation`
 * followed the same day. ⚠ **They landed inert** — every species inherited the
 * config — which is the shape `disease` had at Step 29 (§1.4 A38): the schema
 * arriving ahead of the roster that needs it. ✅ **That gap closed on 2026-07-30**:
 * the lion declares `hunting.cooperationWeight`, the buffalo `behavior.mobWeight`,
 * three predators declare `predation` ratios, and the wildebeest a
 * `reproduction.breedingWindow`. ⚠ **Four blocks are still inert**, though —
 * `traits`, `genetics`, `disease`, and `feeding` are inherited unchanged by all
 * eight species, so no animal yet varies how widely its individuals differ, how
 * fast it mutates, how it takes an infection, or what it gets out of a mouthful.
 *
 * **A species overrides; the config supplies defaults.** Each block below falls
 * back to the same-named global config section, so a species file states only
 * what is *different* about that animal and the shared numbers stay in one
 * place. That is deliberate: the alternative (every species restating every
 * parameter) makes the interesting differences impossible to see, and makes a
 * change to a shared default a twelve-file edit.
 *
 * **Resolution happens once, at engine construction.** `SpeciesRegistry` merges
 * and deep-freezes every species up front, and systems read a plain frozen
 * record by id. The step's performance note is explicit that config indirection
 * must not add per-tick allocation, so there is no merging, spreading, or
 * defaulting anywhere in a hot loop — a lookup is one `Map.get`.
 *
 * **No system may branch on a species name.** That has been an invariant since
 * Step 4 and is now enforced mechanically by a source scan in
 * `test/species-schema.test.js`: species ids appear in `config/species/` and in
 * the demo scenario block, and nowhere else in `src/simulation`. Behaviour comes
 * from data — `diet`, `preySpeciesIds`, `territory.defends`,
 * `migration.tracksForage` — which is what makes adding a species a config edit
 * rather than a code edit.
 */

/**
 * Blocks a species may override, each falling back to the global config section
 * of the same name. Anything not listed here is either already per-species
 * (`matePreference`, `territory`, `migration`, `diet`, `preySpeciesIds`, and —
 * from the species plan — `groups`, `forage`, `habitat`, `association`, `crypsis`,
 * and `climbs` from 2026-08-03) or genuinely world-level (terrain, weather,
 * disturbances, the decision weights) and stays in the config.
 *
 * ⚠ **`climbs` is a bare boolean with no config section of its own**, exactly as
 * `crypsis` is a bare number — there is nothing world-level to say about whether
 * an animal can get up a tree beyond the switch in `config.climbing`. Adding a
 * `climbing` *block* here would have been the mistake the note below describes:
 * a species block beats the config, so `config.climbing.enabled: false` would
 * stop switching anything off for any species that stated its own.
 *
 * ⚠ **The always-per-species *fields* are not a leftover; they are the shape a
 * mechanism takes when it needs a reproducible control.** A species block beats
 * the config, so an `enabled` inside one cannot switch anything off — the trap
 * phase 8 fell into. Every mechanism since has put its biology in a field beside
 * a global section holding the switch, and that is now the rule rather than a
 * preference.
 */
export const SPECIES_BLOCKS = Object.freeze([
  'metabolism', // B3 — basal cost, movement cost, mass scaling
  'hydration', // B3 — how fast it dries out and how fast it drinks
  'aging', // B3, A17 — birth mass, growth curve, life stages, lifespan
  'perception', // B4 — how far it senses (was the bare `perceptionRadius`)
  'traits', // A13 — how widely individuals of this species vary
  'genetics', // A13 — mutation rate and step
  'disease', // A38 — susceptibility, incubation, virulence
  'reproduction', // energy bars, gestation, cooldowns, and which sex gestates
  // Added 2026-07-28 for the species plan (PLAN-SPECIES.md §3.2). Both were
  // global, which meant a 6 kg animal and a 600 kg one ate at the same rate and
  // two predators could not differ in how they capture. Neither varies by
  // species yet — every species inherits the config — so this is the schema
  // landing ahead of the roster that needs it, exactly as `disease` did at Step
  // 29 (A38: "a species block; it simply does not *vary* by species yet").
  'feeding', // intake rates, energy density, assimilation efficiency
  'hunting', // capture odds, stamina costs, cooperative-defense weights
  // What this animal *wants*, and how it weighs competing needs — the half of
  // the old `config.decision` that is biology rather than machinery. The other
  // half stays global as `config.decision`; the split and its reasoning are
  // written up beside the two sections in `defaultSimulationConfig.js`.
  'behavior', // flee/herd/hunt/rest weights, thresholds an animal acts on
  // Which *individuals* this predator will commit to, as opposed to which
  // species it hunts (PLAN-SPECIES.md §3.6). Added 2026-07-28 with phase 4.
  // ⚠ Its ratios ship as `null` — no bound — so it is inert until a species
  // states one; see `predation/predation.js` for why that is deliberate rather
  // than timid.
  'predation', // prey mass ceiling and floor, and how dangerous heavy prey gets
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Recursively merge an override over a default.
 *
 * Recursive rather than one level deep because at least one block is nested
 * (`traits.spread`), and a shallow merge would silently make a species that
 * tweaks the spread of *one* trait drop the other seven — the kind of bug that
 * shows up as "why is everything the same size" six steps later.
 */
function mergeBlock(base, override) {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeBlock(base[key], value) : value;
  }
  return merged;
}

/** Freeze an object graph so a resolved species cannot be mutated by a consumer. */
function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/**
 * Merge one species definition against the global config defaults.
 *
 * @param {object} definition a species file's exported object
 * @param {object} config the resolved simulation config
 * @returns {object} a deep-frozen resolved species
 */
export function resolveSpecies(definition, config) {
  const resolved = { ...definition };
  for (const block of SPECIES_BLOCKS) {
    const defaults = config?.[block];
    const override = definition[block];
    if (defaults === undefined && override === undefined) continue;
    resolved[block] = mergeBlock(defaults ?? {}, override);
  }
  return deepFreeze(resolved);
}

/**
 * The resolved species of one world.
 *
 * Built once by the engine and hung on the world, so systems reach it the same
 * way they reach the vegetation or the terrain. That placement matters more than
 * it looks: resolution depends on the *config*, so a module-level singleton
 * would be wrong the moment two engines with different configs exist in one
 * process — which is exactly what every sweep and half the test suite does.
 */
export class SpeciesRegistry {
  /** @type {Map<string, object>} */
  #byId = new Map();

  /**
   * @param {object[]} definitions species files' exports
   * @param {object} config the resolved simulation config
   */
  constructor(definitions, config) {
    for (const definition of definitions) {
      this.#byId.set(definition.id, resolveSpecies(definition, config));
    }
  }

  /**
   * Resolved species by id, or null. The hot path — one `Map.get`, no
   * allocation, returning a frozen record.
   * @param {string} speciesId
   * @returns {object | null}
   */
  get(speciesId) {
    return this.#byId.get(speciesId) ?? null;
  }

  /**
   * Resolved species by id, throwing if unknown. For setup code, where a typo
   * should fail loudly rather than silently produce an animal with no biology.
   * @param {string} speciesId
   */
  require(speciesId) {
    const species = this.#byId.get(speciesId);
    if (!species) {
      throw new Error(`unknown species "${speciesId}" (known: ${[...this.#byId.keys()].join(', ')})`);
    }
    return species;
  }

  /** @returns {string[]} every known species id, in registration order */
  ids() {
    return [...this.#byId.keys()];
  }

  /** @returns {object[]} every resolved species, in registration order */
  all() {
    return [...this.#byId.values()];
  }

  /**
   * Whether one species hunts another. The single source of the predator/prey
   * relation, read in both directions — perception uses it to tell a predator
   * what to hunt *and* to tell prey what to fear — which is what keeps predation
   * working without a species-name conditional anywhere.
   *
   * A species with no `preySpeciesIds` hunts nothing, which is not an oversight
   * but a niche: it is how a scavenger is expressed with no code at all.
   *
   * ⚠ The linear `includes` is deliberate and was **measured** in Step 30, not
   * assumed. This is the busiest predicate in the engine — asked twice per
   * neighbour per animal per tick — so precomputing a `Set` per predator looked
   * like an obvious win. It is a 35% *loss* at 20M calls: the rosters are one
   * or zero entries long, and hashing a string costs more than scanning an
   * array of one. Whole-simulation timings could not resolve the difference in
   * either direction (§1.4 D24), which is why the answer came from a
   * microbenchmark of the predicate itself. Revisit only with a roster large
   * enough to change the arithmetic, and re-measure when you do.
   *
   * ✅ **Re-measured 2026-07-30 at batch 3, which is the roster PLAN-SPECIES §7
   * said would force this**: the lion now lists three prey species and the hyena
   * two. Same microbenchmark, 20M calls over all 64 species pairs, interleaved
   * three rounds — `includes` **259/362/360 ms against the `Set`'s 372/368/368**,
   * winning every round. The arithmetic has not changed: a linear scan of three
   * strings still beats hashing one, and the answer is "false" often enough that
   * the empty-array case dominates either way. Left exactly as it was.
   *
   * @param {string} predatorSpeciesId @param {string} preySpeciesId
   */
  hunts(predatorSpeciesId, preySpeciesId) {
    return this.#byId.get(predatorSpeciesId)?.preySpeciesIds?.includes(preySpeciesId) ?? false;
  }
}
