/**
 * biome ethologist — a behavioral anomaly finder.
 *
 * Runs the simulation headlessly over one or more seeds/worlds and surfaces a
 * *ranked shortlist* of animals that behaved unrealistically — the kind of edge
 * case that is invisible in aggregate population numbers but obvious once you
 * look at one animal's last few hundred ticks. It does not decide correctness
 * (that judgement is yours); it makes the suspicious cases cheap to find so you
 * can eyeball the top of the list instead of watching the whole world.
 *
 * It is deliberately *not* `sweep.js`. That tool answers "does this world still
 * work" (populations and deaths by species, across seeds, with a control arm);
 * this one answers "did any individual animal behave absurdly". Both read
 * authoritative state only and neither mutates the engine.
 *
 * Three detector families, all calibrated against real bugs already fixed:
 *
 *   1. **Death autopsy against a counterfactual.** Every death is scored by
 *      whether the thing that would have prevented it was *within reach*: an
 *      animal that died of thirst with drinkable water a few cells away, or one
 *      that died of thirst having never once perceived water in a world that has
 *      reachable water; a starvation on forage; an exposure death beside cover.
 *      "Died of X while the fix for X was right there" is the shape both the
 *      thicket-walled-lake deaths and the corner-lake stalker took.
 *   2. **Unresolved intent / circling.** Not every bug ends in death. An animal
 *      stuck in `seekWater` for scores of ticks without ever getting closer (the
 *      thicket-edge pacing), or one milling in a tight area while genuinely
 *      hungry or thirsty and *searching* (the stalker that "wandered the same
 *      spot"), is flagged from its trajectory and its own stated intent.
 *   3. **Life review** — ⚠ new 2026-07-31, and the family the species plan
 *      forced. These fire on facts that only exist across a whole life: an adult
 *      that never once perceived a mate (A63), a female whose entire adult life
 *      missed her species' breeding window (A62), an animal that joined and left
 *      persistent groups over and over (A56). All three are failures that
 *      **measure as a population number three subsystems from the cause** —
 *      phase 14 built one mechanism wrong twice and both times it read as "no
 *      effect" rather than as an error, which is precisely what this family is
 *      for.
 *   4. **Corruption and runaway commitments** — ⚠ new 2026-08-06, and the family
 *      the *behaviour* plan forced. `non-finite-state` fires on any `NaN` in a
 *      position, a steering drift, a physiological scalar or a utility score;
 *      `commitment-past-ceiling` fires on a ttl further out than its own
 *      world-level bound allows; `sprint-to-exhaustion` fires on an animal
 *      holding `defend`/`chase` far past that bound while its stamina is already
 *      spent; and `lost-from-its-band`, a long-standing record member that never
 *      once had a bandmate in the centre it steers at. All four are **invariants
 *      rather than judgements**, which is why they carry the highest severities in
 *      the tool — and two of them have never fired, which is the correct result
 *      rather than a reason to loosen them.
 *
 * ⚠⚠ **Family 4 exists because this tool was run twice as reassurance that it
 * could not provide.** The herbivore-behaviour plan named four risks for it —
 * "an animal locked on one bearing, a band collapsed to a point, a buffalo
 * sprinting until it dies, an entity at NaN" — and then two phases recorded
 * "`npm run ethologist` reports no new anomaly kind" as evidence they had not
 * happened. It could not have reported any of them: nothing read a position for
 * finiteness, nothing read `stamina` at all, and `defend`/`chase` are
 * *deliberately excluded* from both the seek and circling detectors because their
 * targets move evasively. **A clean report from a detector that cannot see the
 * mechanism is not evidence about the mechanism** — the same shape as D40's null
 * arm and D31's tautological fixture.
 *
 * ### ⛔ Two of the four were measured and deliberately **not** built
 *
 * Both were attempted, both were measured against a null arm *before* any code
 * shipped, and in both cases the measurement says a detector cannot discriminate.
 * Recorded here so the next person reaching for one starts from the numbers rather
 * than from the idea (`ACTION-ITEMS.md` **A83**).
 *
 * - ⛔ **"An animal locked on one bearing."** The obvious measure is net
 *   displacement over path length. At a 600-tick window a *healthy* world already
 *   reaches **0.999** — straight-line travel is ordinary. Lengthening the window to
 *   1500 separates the arms but not enough to be a detector: with the consensus
 *   **on**, max 0.567 / p99 0.506 and the top six animals are all wildebeest (the
 *   species declaring `consensusWeight: 1.0`); with it **off**, max 0.522 /
 *   p99 0.457 and the top six are mixed. So the mechanism genuinely *is* visible —
 *   and any threshold that avoids firing on the control arm has **0.017 of
 *   headroom**, which is noise. The reason is in DOCS §9: consensus strength on the
 *   demo runs ~0.10, a weak bend on a heading that was going to be arbitrary
 *   anyway. ⚠ The sharper framing — a commitment that never *expires* — is already
 *   covered by `commitment-past-ceiling`, which reads the ttl rather than the
 *   trajectory.
 * - ⛔ **"A band collapsed to a point."** `locomotion.maxOccupantsPerCell: 2`
 *   refuses entry to a full cell, so a geometric floor on how tightly N animals can
 *   pack already exists — and healthy records sit **on** it. Measured minimum
 *   mean-distance-from-centre by member count over 7000 ticks: 2 members 0.10,
 *   3 → 0.53, 4 → 0.76, 8 → 1.39, 12 → 1.49, 16 → 2.01, while the tight
 *   buffalo/zebra records run a *median* of ~2.1. There is no gap between
 *   "collapsed" and "a real band standing together", because the engine already
 *   prevents the collapse. ⚠ Same finding the behaviour plan recorded about the
 *   defensive ring, arriving from the other direction.
 *
 * Determinism makes this trustworthy: every flagged case is exactly reproducible
 * from its seed + config, so a finding is a lead you can re-run and drill into,
 * never a fluke. Nothing here mutates the engine — it only reads authoritative
 * state (`action`, `utilityBreakdown`, the perception map, memories) the tick it
 * happens.
 *
 * ⚠⚠ **This tool was written for a three-species world and recalibrated for an
 * eight-species one on 2026-07-31.** Read §"What the roster broke" below before
 * trusting a threshold in here — the failure mode of a stale anomaly finder is
 * not a red test, it is a confident and wrong report (PLAN-SPECIES §5.7, D19).
 *
 * ### What the roster broke, measured rather than assumed
 *
 * Three things went wrong when the roster went from 4–45 kg and three species to
 * **6–600 kg and eight**, and all three were measured before being changed:
 *
 * - ⚠⚠ **`circling-in-need` stopped discriminating.** On seed 1 at 1500 ticks in
 *   a *healthy* world it fired **146 times across ~250 animals** — it flagged
 *   more than half the world, which is not a shortlist. Two causes, neither a
 *   regression in the engine: predators are chronically hungry between kills so
 *   `need >= 0.4` is their resting state, and home ranges, territory and `patrol`
 *   (Steps 24/26) mean an animal legitimately *stays in one place*. The detector
 *   was reading "doing its job in a home range" as "stuck". It now requires the
 *   window to be **dominated by searching** and to have **resolved nothing** —
 *   which is the original bug's actual shape: it looked for food or water for 300
 *   ticks, never ate or drank, and never left the area.
 * - ⚠ **The starvation counterfactual was mass-blind**, which is the corvid
 *   lesson (DOCS §8) at 100× scale: a cell holding one level of grass saves a
 *   30 kg gazelle and is a rounding error to a 600 kg buffalo, whose intake is
 *   mass-scaled by `(bodyMass/30)^0.75` ≈ 9.5×. The bar is now what *this animal*
 *   would have to take out of the ground to live.
 * - ⚠ **A flat top-N became a popularity contest.** With 120 gazelle against 8
 *   leopards, the worst leopard in the world never appears in a global top-12.
 *   The shortlist is now drawn **round-robin across species**, and there is a
 *   per-species table with rates rather than counts.
 *
 * Usage:
 *   npm run ethologist                                  # a small default sweep
 *   npm run ethologist -- --seed=2344255022 --width=180 --height=120 \
 *       --founding=herbivore.gazelle:120,predator.leopard:8,scavenger.vulture:10,scavenger.hyena:6 \
 *       --rocks=5 --thickets=5 --ticks=9200
 *   npm run ethologist -- --seeds=1,2,3,4,5 --ticks=6000 --top=15
 *   npm run ethologist -- --seed=1 --species=predator.leopard   # drill into one animal's kind
 *
 * Flags: --seed=N | --seeds=a,b,c | --seedCount=N (from --seedBase, default 1);
 *   --ticks, --top, --species=id[,id], --width, --height, --herbivores,
 *   --predators, --scavengers, --rocks, --thickets, --json.
 *
 * ⚠ The default sweep is six worlds of the **eight-species** demo and takes a
 * couple of minutes; progress goes to stderr so `--json` stays pipeable.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoSimulation, buildDemoConfig } from '../fixtures/createDemoSimulation.js';
import { TerrainType } from '../simulation/world/TerrainGrid.js';
import { breedingWindowOf, inBreedingWindow } from '../simulation/mating/breeding.js';
import { isChooser } from '../simulation/mating/mateChoice.js';

// --- Detector thresholds. Deliberately loose: this tool ranks and shortlists,
// it does not gate a build, so it errs toward surfacing a lead over hiding one.
// ⚠ Anything expressed in cells or biomass is now a *bound* on a per-species
// quantity rather than a constant — see `speciesFactsOf`. A flat number here is
// a number that has been checked against the 6–600 kg roster. -------------------
const D = Object.freeze({
  seekStuckTicks: 40, //     seeking a fixed cell this long...
  seekProgressMin: 1.0, //   ...without getting at least this much closer is "unresolved"
  // ⚠ A pursuit target is another animal, and an animal that walks away
  // legitimately delays the closing — a stalking leopard, a calf following its
  // mother, a suitor crossing to a female who is herself moving. Same detector,
  // three times the patience, so a stalk that never converts still surfaces
  // (phase 14 §4b) without every ordinary pursuit doing so.
  pursuitStuckTicks: 120,
  refusedEps: 0.05, //       a committed step shorter than this counts as refused/blocked
  circleWindowTicks: 300, // trajectory window for "milling in one spot"
  circleSampleEvery: 15, //  positions sampled this often within the window
  circleRatio: 0.2, //       net displacement / path length below this is circling
  circleMinPath: 20, //      ...but only if it actually covered this much ground
  circleNeed: 0.4, //        ...while hunger or thirst is at least this
  // ⚠⚠ The two terms that took `circling-in-need` from 146 flags per healthy
  // world back to a shortlist. Milling is only anomalous if the animal was
  // *looking* for something (rather than patrolling, herding, resting, stalking
  // or tending, all of which keep it in one place on purpose) and *found*
  // nothing. Either one alone still lets a predator's ordinary between-kills
  // ranging through.
  circleSearchFraction: 0.6, // this much of the window spent in a search action
  closeWaterCap: 10, //      the "water was right there" bound never exceeds this
  forageRadius: 2, //        forage within this many cells of a starvation = suspect
  // How many ticks of *this animal's* mass-scaled intake must be standing within
  // `forageRadius` before a starvation counts as preventable-in-place. Ten ticks
  // is deliberately a low bar: the claim is "there was real food here", not "it
  // could have lived indefinitely".
  forageTicksToSurvive: 10,
  shelterScan: 6, //         cover/shelter within this of an exposure death = suspect
  minFlag: 1, //             deaths scoring below this are treated as ecological, not bugs
  // --- Life review (2026-07-31). All three need a life long enough that the
  // absence means something; an animal that died a juvenile is not evidence.
  adultTicksForReview: 800, // must have been an adult this long to be reviewed
  groupChangesFlag: 6, //    joins+leaves above this is flapping (A56)
  // --- Commitment abuse (2026-08-06, the behaviour plan's mechanisms). Every
  // threshold here is a **multiple of the engine's own configured ceiling**
  // rather than a constant, because the whole question these detectors ask is
  // "is the bound bounding?" — a hardcoded tick count would be a second opinion
  // about what the bound should be (D11).
  // ⚠⚠ **Both numbers below were measured before being trusted, and the first
  // draft of each was wrong in the two opposite directions D39 warns about.**
  // Measured on the demo, seed 42 × 7000 ticks: the longest unbroken
  // `defend`/`chase` run by any animal in a healthy world is **31 ticks** (a
  // leopard), with buffalo at 4 and wildebeest at 2. A factor of 4 against the
  // 40-tick pursuit ceiling put the trigger at 160 — **5× the observed maximum**,
  // which is not a loose threshold, it is an unreachable one. 2 puts it at 80:
  // 2.6× the healthy maximum, clearly anomalous, and still reachable.
  runawayCommitFactor: 2,
  exhaustedStaminaFraction: 0.05, // sprinting at or below this much of maxStamina is spent
  // ⚠⚠ **And the stamina term was very nearly a term that is always true.** The
  // same run spends **64 128 action-ticks sprinting at ≤5% stamina** — about 1.5%
  // of all animal-ticks, roughly 100 per animal per life — so a lifetime threshold
  // of 60 would have been *below typical*, the conjunction would have degenerated
  // to its hold-run half, and deleting the stamina test would have changed nothing.
  // That is D43's shape in a detector written to catch D43. So the term is now
  // scoped to the **episode**: exhausted-sprint ticks *inside the long hold
  // itself*, which is what "sprinting until it drops" actually means.
  exhaustedHoldFraction: 0.5, // this much of the over-ceiling hold spent on an empty tank
});

// ⚠ `hide` belongs here: lying still *is* the behaviour of a concealed neonate
// (phase 8), so a hidden fawn must never be read as a refused step. It produces
// a non-moving intent, so it is already excluded by construction — this is the
// belt to that braces, and the place the next stationary action should be added.
const STATIONARY = new Set(['eat', 'drink', 'rest', 'hide']);

/**
 * Actions that mean "I am looking for something and have not found it". The
 * circling detector fires only inside a window dominated by these — everything
 * else in the table (`patrol`, `herd`, `stalk`, `tend`, `defend`, `rest`…) is an
 * animal staying put on purpose, which the pre-roster detector could not tell
 * apart from being stuck.
 */
const SEARCH_ACTIONS = new Set(['wander', 'seekFood', 'seekWater', 'recallFood', 'recallWater']);

/**
 * Directed actions whose target is a **fixed cell**: it does not move, so
 * failing to close on it is unambiguous.
 */
const CELL_SEEK_ACTIONS = new Set([
  'seekWater', 'recallWater', 'seekFood', 'recallFood', 'shelter', 'leaveThicket',
]);

/**
 * Directed actions whose target is **another animal**. Judged on the same "did
 * it get closer" question at `pursuitStuckTicks` rather than `seekStuckTicks`.
 *
 * ⚠ `chase`, `defend` and `herd` are deliberately *absent*. Their targets move
 * fast and evasively (or are a drifting centroid), so "no progress" is the
 * normal case rather than the anomalous one, and including them was the
 * difference between a report and a wall of text.
 */
const PURSUIT_ACTIONS = new Set(['stalk', 'seekMate', 'followParent', 'tend']);

/**
 * Actions an animal *holds a position or a target under load* in — the two the
 * comment above deliberately excludes from every other detector.
 *
 * ⚠⚠ **That exclusion left a hole, and it is the hole detector 4c fills.** It is
 * right that "made no progress toward a fleeing lion" is not an anomaly, and the
 * consequence is that `defend` and `chase` are invisible to *both* the seek and
 * circling detectors — so a mechanism whose named failure mode was "a buffalo
 * sprinting until it dies" had nothing watching it at all. The claim here is not
 * about progress; it is about **duration against the engine's own ceiling, while
 * the sprint budget is already spent.**
 */
const HOLD_ACTIONS = new Set(['defend', 'chase']);

function parseArgs(argv) {
  const opts = {
    seeds: null,
    seedBase: 1,
    seedCount: null,
    ticks: 6000,
    top: 12,
    json: false,
    species: null, // report filter, not a world change
    composition: {}, // width/height/herbivores/predators/scavengers/rocks/thickets
  };
  const compKeys = new Set(['width', 'height', 'herbivores', 'predators', 'scavengers', 'rocks', 'thickets']);
  for (const arg of argv) {
    if (arg === '--json') { opts.json = true; continue; }
    const m = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (!m) { fail(`unknown argument: ${arg}`); }
    const [, key, value] = m;
    // ⚠ `--founding=id:count,...` is the protocol-v29 form and the one to use.
    // The three role flags below still work, are deprecated with the protocol
    // fields they mirror, and cannot express a roster where one species is both
    // predator and scavenger — which is the whole reason the roster exists.
    if (key === 'founding') opts.composition.founding = parseFoundingRoster(value);
    else if (key === 'seed') opts.seeds = [Number(value)];
    else if (key === 'seeds') opts.seeds = value.split(',').map(Number);
    else if (key === 'seedBase') opts.seedBase = Number(value);
    else if (key === 'seedCount') opts.seedCount = Number(value);
    else if (key === 'ticks') opts.ticks = Number(value);
    else if (key === 'top') opts.top = Number(value);
    // ⚠ Filters the *report*, never the world. Narrowing a sweep to one species
    // by founding only that species would measure a different ecosystem, which
    // is the opposite of drilling into this one.
    else if (key === 'species') opts.species = new Set(value.split(','));
    else if (compKeys.has(key)) opts.composition[key] = Number(value);
    else fail(`unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * `herbivore.gazelle:120,predator.leopard:8` → `[{ speciesId, count }]`.
 * A malformed entry fails loudly rather than being skipped: a sweep quietly run
 * on a different world than the one asked for is worse than no sweep.
 */
function parseFoundingRoster(value) {
  return value.split(',').map((pair) => {
    const [speciesId, count] = pair.split(':');
    if (!speciesId || !/^\d+$/.test(count ?? '')) fail(`--founding entries must be speciesId:count, got "${pair}"`);
    return { speciesId, count: Number(count) };
  });
}

/**
 * A composition as a one-line label. The founding roster is a list of objects,
 * so the obvious `${value}` prints `[object Object]` — worth a helper rather
 * than a header that silently stops saying which world was run.
 * @param {object} composition @param {string} separator
 */
function describeComposition(composition, separator) {
  return Object.entries(composition)
    .map(([key, value]) =>
      key === 'founding' && Array.isArray(value)
        ? `founding=${value.map((entry) => `${entry.speciesId}:${entry.count}`).join('+')}`
        : `${key}=${value}`,
    )
    .join(separator);
}

function fail(message) {
  console.error(message);
  console.error('usage: ethologist.js [--seed=N | --seeds=a,b,c | --seedCount=N] [--ticks=N] [--top=N]');
  console.error('       [--species=id,id] [--width --height --rocks --thickets]');
  console.error('       [--founding=id:count,id:count] [--json]');
  console.error('       (--herbivores/--predators/--scavengers are deprecated aliases for --founding)');
  process.exit(1);
}

/**
 * ⚠⚠ **The one place this tool asks what an animal eats** — PLAN-SPECIES §5.7,
 * which named this comparison as the harness's own exposure to the species plan.
 *
 * The counterfactual in `autopsy` is diet-dependent or it lies: grass is food to
 * a herbivore and irrelevant to a leopard, which starves *with grass all around
 * it* and is not being failed by anything. §3.2 replaces the two-valued `diet`
 * string with a forage-source list at phase 15, and a silent misread here
 * reclassifies every carnivore in the world as a herbivore — which does not fail
 * a test, it produces a confident and wrong report (D19).
 *
 * So it throws rather than guessing. When `diet` becomes a structure, this
 * function is the whole edit, and an unmigrated ethologist stops instead of
 * lying.
 *
 * @param {object} species a resolved species record
 * @returns {{plants: boolean, carrion: boolean}}
 */
function foodModelOf(species) {
  if (species?.diet === 'carnivore') return { plants: false, carrion: true };
  if (species?.diet === 'herbivore') return { plants: true, carrion: false };
  throw new Error(
    `ethologist cannot classify what "${species?.id}" eats (diet=${JSON.stringify(species?.diet)}). ` +
      'PLAN-SPECIES §3.2/§5.7: update foodModelOf() in the same commit as the `diet` change.',
  );
}

/**
 * Per-species facts the detectors need, resolved once per run rather than per
 * animal per tick.
 *
 * ⚠ **`bodyMass` here is the species' adult mass and is NOT what an individual
 * weighs** — `entity.bodyMass` grows along the aging curve, which is exactly the
 * "a species-level constant is not an entity-level one" trap (HANDOFF §5). Every
 * mass-scaled bound below is therefore computed from the *entity*; the species
 * mass is carried only for the report.
 *
 * @param {object} world
 * @returns {Map<string, object>}
 */
function speciesFactsOf(world) {
  const facts = new Map();
  for (const species of world.species.all()) {
    const window = breedingWindowOf(species.reproduction);
    facts.set(species.id, {
      id: species.id,
      bodyMass: species.bodyMass,
      // Fails loudly, up front, for every species in the roster — before six
      // thousand ticks have been spent producing a wrong report.
      food: foodModelOf(species),
      perceptionRadius: species.perception?.radius ?? species.perception?.defaultRadius ?? 8,
      referenceMass: species.metabolism?.referenceMass ?? 30,
      massExponent: species.metabolism?.massScalingExponent ?? 0.75,
      intakeRate: species.feeding?.intakeRate ?? 0.6,
      // Phase 14: how well this animal uses cover. Nonzero only for the leopard,
      // and the reason its mate-blindness was worth a detector.
      crypsis: species.crypsis ?? 0,
      breedingWindow: window,
      formsGroups: species.groups?.forms === true,
      huntsAnything: (species.preySpeciesIds?.length ?? 0) > 0,
      // --- The behaviour plan's per-species weights (2026-08-06). All three are
      // 0 for most of the roster, and 0 means "this species never has the field
      // written at all" — so a detector reading them must treat 0 as *exempt*
      // rather than as a low value.
      chargeWeight: species.behavior?.chargeWeight ?? 0,
      pursuitTicks: species.behavior?.pursuitTicks ?? 0,
      consensusWeight: species.behavior?.consensusWeight ?? 0,
    });
  }
  return facts;
}

/**
 * How much more than the reference animal this *individual* burns and eats —
 * the same `(bodyMass / referenceMass) ** exponent` every energy cost and the
 * feeding intake are multiplied by. Read off the entity, never the species.
 * @param {object} entity @param {object} facts
 */
function massFactorOf(entity, facts) {
  return (entity.bodyMass / facts.referenceMass) ** facts.massExponent;
}

/** Straight-line distance to the nearest shallow-water cell, ignoring passability. */
function nearestShallowStraight(waterCells, x, y) {
  let best = Infinity;
  for (const [cx, cy] of waterCells) {
    const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Total standing crop within `radius` cells of a position.
 *
 * ⚠ **A sum of raw biomass, where this used to take the max quantized `levelAt`.**
 * Two changes, both forced by the roster: `levelAt` is a *projection* quantization
 * (0..4 by fraction of a reference capacity) while `biomassAt` is the field the
 * forage mechanism itself reads (PLAN-SPECIES §3.3), and a maximum answers "was
 * there grass" where a 600 kg animal needs the answer to "was there *enough*".
 */
function forageWithin(world, x, y, radius) {
  const { cellX, cellY } = world.cellOf(x, y);
  let total = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      total += world.vegetation.biomassAt(gx, gy);
    }
  }
  return total;
}

/** Distance (cells) to the nearest sheltered cell, or Infinity within the scan. */
function nearestShelter(world, x, y, radius) {
  const { cellX, cellY } = world.cellOf(x, y);
  let best = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      if (world.isShelteredAt(gx + 0.5, gy + 0.5)) best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

/**
 * The nearest carcass within `radius`, and whether somebody else was standing on
 * it.
 *
 * ⚠ **The possession half is new and it removes a whole class of false
 * positive.** Since carcass possession shipped (PLAN-SPECIES §3.9) a carnivore
 * can perfectly well starve beside a body it is not allowed to eat — that is
 * kleptoparasitism working, and it is the hyena's entire living read backwards.
 * "Starved next to food" is only a bug when the food was actually *available*.
 */
function carcassNear(world, entity, radius) {
  let best = null;
  for (const id of world.grid.queryRadius(entity.x, entity.y, radius)) {
    const other = world.entities.get(id);
    if (!other || other.kind !== 'carcass' || other.id === entity.id) continue;
    const distance = Math.hypot(other.x - entity.x, other.y - entity.y);
    if (best === null || distance < best.distance) {
      best = { distance, heldByOther: other.possessorId != null && other.possessorId !== entity.id };
    }
  }
  return best;
}

/** Whether a thicket cell sits near the animal (the walled-lake signature). */
function walledByThicket(world, x, y) {
  const { cellX, cellY } = world.cellOf(x, y);
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      if (world.terrain.codeAt(gx, gy) === TerrainType.THICKET) return true;
    }
  }
  return false;
}

/**
 * Score a death by how much its cause looks preventable-in-place. Returns a
 * suspicion in roughly [0, 12] and a one-line reason, or suspicion 0 for a
 * death that reads as ordinary ecology (old age, a clean kill, a distant lake).
 */
function autopsy(world, entity, tracker, ctx) {
  const cause = entity.deathCause;
  const facts = ctx.facts.get(entity.speciesId);
  if (!facts) return { suspicion: 0, reason: '' };

  if (cause === 'dehydration') {
    // ⚠ "A few cells away" is not one number across a roster whose sight spans
    // 6 cells (gazelle) to 14 (vulture). Dying of thirst inside your own
    // perception radius means you could *see* the water — which is a much
    // stronger claim for a leopard at 12 than for a gazelle at 6, and the old
    // flat 6 quietly held every long-sighted species to the gazelle's standard.
    const nearBound = Math.min(facts.perceptionRadius, D.closeWaterCap);
    const straight = nearestShallowStraight(ctx.waterCells, entity.x, entity.y);
    if (straight <= nearBound) {
      const walled = walledByThicket(world, entity.x, entity.y);
      return {
        suspicion: 6 + (nearBound - straight),
        reason: `died of thirst with water ~${straight.toFixed(1)}c away (sees ${facts.perceptionRadius}c)${walled ? ', walled by thicket' : ''}; action=${entity.action}, ${tracker.everDrank ? 'had drunk before' : 'never drank'}`,
      };
    }
    if (!tracker.everPerceivedWater && ctx.waterCells.length > 0) {
      return {
        suspicion: 5,
        reason: `died of thirst having NEVER perceived water (world has reachable water); roamed ${tracker.bbox()}`,
      };
    }
    return { suspicion: 0, reason: '' };
  }

  if (cause === 'starvation') {
    if (!facts.food.plants) {
      // A carnivore's food is a carcass it may actually feed on.
      const carcass = carcassNear(world, entity, D.forageRadius);
      if (carcass && !carcass.heldByOther) {
        return { suspicion: 6, reason: `carnivore starved with an unclaimed carcass ${carcass.distance.toFixed(1)}c away; action=${entity.action}` };
      }
      if (carcass) {
        // Ordinary ecology since §3.9, and worth one line rather than six points:
        // it says "this animal lost a carcass contest", which is a tuning
        // question for `possession`, not a behavioural bug.
        return { suspicion: 1, reason: `carnivore starved beside a carcass held by another animal (kleptoparasitism, not a bug); action=${entity.action}` };
      }
      if (!tracker.everPerceivedFood) {
        return {
          suspicion: facts.huntsAnything ? 2 : 3,
          reason: facts.huntsAnything
            ? 'predator starved having never perceived prey or carrion'
            : 'obligate scavenger starved having never perceived carrion — nothing died within its sight, all life',
        };
      }
      return { suspicion: 0, reason: '' };
    }
    // ⚠ Mass-aware, and this is the corvid lesson (DOCS §8) on the herbivore
    // side. Intake is multiplied by `(bodyMass/30)^0.75`, so the standing crop
    // that would have saved a 30 kg gazelle is ~9.5× short of saving a 600 kg
    // buffalo. The old bar — one quantized vegetation level anywhere in the scan
    // — flagged every large-herbivore starvation in a green field as a bug.
    const massFactor = massFactorOf(entity, facts);
    const needed = D.forageTicksToSurvive * facts.intakeRate * massFactor;
    const standing = forageWithin(world, entity.x, entity.y, D.forageRadius);
    if (standing >= needed) {
      // Score by how far past the bar it is, so "starved in deep grass" outranks
      // "starved on a bar it only just cleared". Capped: the interesting fact is
      // that it happened, not by how much.
      return {
        suspicion: 5 + Math.min(4, standing / needed),
        reason: `starved with ${standing.toFixed(0)} biomass within ${D.forageRadius}c (needed ~${needed.toFixed(0)} at ${entity.bodyMass.toFixed(0)}kg, ${massFactor.toFixed(1)}× reference intake); action=${entity.action}`,
      };
    }
    if (!tracker.everPerceivedFood) return { suspicion: 3, reason: 'starved having never perceived food' };
    return { suspicion: 0, reason: '' };
  }

  if (cause === 'exposure') {
    // ⚠⚠ **"Standing on shelter" is not the strongest case, it is a different
    // case — and the old scoring had them backwards.** `shelterRelief` is 0.55,
    // so cover removes just over half the thermal stress rather than all of it,
    // and an animal can freeze while genuinely sheltered. The old branch scored
    // by proximity alone, which meant it scored *highest* (6.4) exactly when the
    // animal had already done the thing the counterfactual asks about. That is
    // "measure the shift, not the state" (HANDOFF §5) inverted: the fix was not
    // within reach, it was already applied.
    if (world.isShelteredAt(entity.x, entity.y)) {
      return {
        suspicion: 1,
        reason: `froze while already on shelter — a question about shelterRelief (0.55 relief, not immunity), not a behavioural bug; action=${entity.action}, ${entity.bodyMass.toFixed(0)}kg`,
      };
    }
    const shelter = nearestShelter(world, entity.x, entity.y, D.shelterScan);
    if (Number.isFinite(shelter)) {
      return {
        suspicion: 4 + (D.shelterScan - shelter) * 0.4,
        reason: `froze in the open with shelter ~${shelter.toFixed(1)}c away; action=${entity.action}, ${entity.bodyMass.toFixed(0)}kg`,
      };
    }
    return { suspicion: 0, reason: '' };
  }
  // predation / disease / disturbance / age read as ecology here — recorded in
  // the histogram, never flagged as a behavioral bug.
  return { suspicion: 0, reason: '' };
}

/** Fresh per-animal tracker. */
function newTracker(tick, entity) {
  return {
    bornTick: tick,
    everPerceivedWater: false,
    everPerceivedFood: false,
    everDrank: false,
    minX: entity.x, maxX: entity.x, minY: entity.y, maxY: entity.y,
    // Where it stood at the end of the previous tick, so this tool can measure
    // its own step distances — see the note beside `refusedSteps` below.
    lastX: entity.x, lastY: entity.y,
    refusedSteps: 0,
    ring: [], // [x, y, tick, searching] sampled positions, for circling
    lastResolvedTick: -Infinity, // last tick it actually ate or drank
    seek: null, // { action, startTick, startDist, minDist }
    seekRecord: null, // the pushed finding, so repeats can be counted onto it
    circleRecord: null,
    // --- Life review (2026-07-31).
    adultTicks: 0,
    inWindowAdultTicks: 0,
    everSawMate: false,
    groupChanges: 0,
    lastGroupRecordId: entity.groupRecordId ?? null,
    // --- Commitment abuse (2026-08-06). `corrupted` and `overrunReported` are
    // one-shot latches: both findings describe a state that persists, so without
    // them one animal fills the report.
    corrupted: false,
    overrunReported: false,
    holdRun: 0, //           consecutive ticks in `defend`/`chase` right now
    holdSpent: 0, //         ...of which this many were sprinting on an empty tank
    holdRunMax: 0, //        the longest such run in this life
    holdRunSpent: 0, //      the spent-sprint count *of that same episode*
    holdRunAction: null, //  which action that longest run was
    // Lifetime total, reported for context but ⚠ **not** a trigger: 1.5% of all
    // animal-ticks in a healthy world are sprints on an empty tank, so a lifetime
    // count discriminates nothing (see `D.exhaustedHoldFraction`).
    sprintExhaustedTicks: 0,
    // P7's premise, counted: how long this animal has belonged to a record, and
    // how much of that it spent with any of its own band in the centre it steers
    // at. A member of a band it never once meets is a rally that never worked.
    inRecordTicks: 0,
    withBandmateTicks: 0,
    bbox() { return `x[${this.minX.toFixed(0)}..${this.maxX.toFixed(0)}] y[${this.minY.toFixed(0)}..${this.maxY.toFixed(0)}]`; },
  };
}

function needOf(entity) {
  const hunger = entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0;
  const thirst = entity.maxHydration > 0 ? 1 - entity.hydration / entity.maxHydration : 0;
  return { hunger, thirst, need: Math.max(hunger, thirst) };
}

/**
 * A severity that rises with `ratio` and saturates at `ceiling`.
 *
 * ⚠ **Every score in this tool is ranked against every other one**, so an
 * unbounded term does not just look odd — it takes over the shortlist. A lion
 * that changed groups 901 times scored 152 against a `circling-in-need` at 1.8,
 * which is not "much worse", it is a different unit of measurement leaking into
 * a shared column. Saturating keeps "this is as bad as this kind of thing gets"
 * distinguishable from "this is worse than every other kind of thing".
 */
function saturate(base, ceiling, ratio) {
  return base + (ceiling - base) * (1 - 1 / (1 + Math.max(0, ratio)));
}

/**
 * The two world-level commitment ceilings, derived from the config rather than
 * restated — so a retuned bound retunes the detector.
 *
 * ⚠⚠ **`+ updateInterval` is load-bearing and it is the one line here that is a
 * claim about the *engine* rather than about the config.** A herd label re-decides
 * only on a tick `HerdConsensusSystem` actually runs, so a commitment legitimately
 * quantizes up to the cadence (DOCS §15). A ceiling of `commitTicks` alone would
 * report the design as a defect on every committed wildebeest in the world.
 *
 * ⚠ Extracted from `analyzeRun` so it can be tested. It was inline first, and the
 * mutation that dropped the slack **survived the whole suite** — because the test
 * built its own ceiling as a literal `65` and was therefore asserting against
 * itself rather than against this arithmetic. That is D31 exactly, in a fixture
 * written the same afternoon as a warning about D31.
 *
 * @param {object} config a resolved simulation config
 */
export function commitmentCeilingsOf(config) {
  return {
    chargeEnabled: config.charge?.enabled !== false,
    pursuitCeiling: config.charge?.maxPursuitTicks ?? 40,
    consensusEnabled: config.consensus?.enabled !== false,
    consensusCeiling: (config.consensus?.commitTicks ?? 60) + (config.consensus?.updateInterval ?? 5),
  };
}

/**
 * Every scalar on an animal that a `NaN` would silently poison, with the ones
 * that are legitimately `null` marked as nullable.
 *
 * ⚠⚠ **This list is the point of the detector, so it is written out rather than
 * derived.** A generic "walk every numeric property" scan would also walk fields
 * that are *meant* to be absent and would go quiet the first time somebody added
 * a legitimately-undefined one; naming them means a new steering field has to be
 * added here deliberately, which is the same discipline `flatTerrain.js` imposes
 * on terrain quantities.
 */
const FINITE_FIELDS = Object.freeze(['x', 'y', 'heading', 'energy', 'hydration', 'health', 'stamina', 'bodyMass']);
const NULLABLE_FINITE_FIELDS = Object.freeze([
  'migrationHeading', 'migrationStrength',
  // The behaviour plan's three steering channels. Every one of them had a
  // near-miss NaN in its own phase (a divide by ~0 affinity, `pullScale = 0/0`,
  // `clamp01(undefined)`, `atan2(0, 0)`), which is why they are listed together.
  'herdHeading', 'herdStrength', 'herdCommitUntil',
  'rallyHeading', 'rallyStrength',
  'trailHeading', 'trailStrength',
  'defendUntil', 'defendThreatX', 'defendThreatY',
]);

/**
 * Detector 4a — **non-finite state**, the failure this whole tool could not see
 * until 2026-08-06.
 *
 * ⚠⚠ **A `NaN` here is not a crash, it is a silent permanent deletion**, and it
 * has two distinct shapes. A `NaN` *position* removes the animal from every
 * spatial query while leaving it in `world.entities`, so it is alive, invisible,
 * and unreachable forever. A `NaN` *utility* loses every `argmaxUtility`
 * comparison — `NaN > x` is false — so that action is never chosen again, nothing
 * throws, and the inspector reports `null`. Both read as "the mechanism has no
 * effect" from any population number, which is exactly what an anomaly finder is
 * for.
 *
 * The behaviour plan produced **four** near-misses of this family in ten phases
 * (DOCS §16, and see `NULLABLE_FINITE_FIELDS`), every one caught by review rather
 * than by measurement. This is the measurement.
 *
 * ⚠ Fires **at most once per animal**: a corrupted animal stays corrupted for the
 * rest of the run, so a per-tick finding would be one animal filling the report.
 *
 * @param {object} entity
 * @param {object|null} summary this animal's `world.social` entry, or null
 * @param {object} tracker
 * @param {number} tick
 * @returns {object|null}
 */
function nonFiniteState(entity, summary, tracker, tick) {
  if (tracker.corrupted) return null;
  const broken = [];
  for (const field of FINITE_FIELDS) {
    if (!Number.isFinite(entity[field])) broken.push(`${field}=${entity[field]}`);
  }
  // ⚠⚠ **`pullScale` is a divisor, so zero is as fatal as NaN and does not look
  // it.** `DecisionSystem` computes `herdDistance / pullScale`: at 0 that is
  // `Infinity`, so the animal is always already "close enough" to its herd and
  // `herd` never fires as a closing action; at NaN the utility loses every
  // comparison instead. Both read as "herding stopped working" with nothing
  // thrown. It lives on the social summary rather than the entity, which is why
  // it is checked here rather than in the field lists above.
  if (summary && 'pullScale' in summary) {
    const pull = summary.pullScale;
    if (!Number.isFinite(pull)) broken.push(`social.pullScale=${pull}`);
    else if (pull <= 0) broken.push(`social.pullScale=${pull} (a divisor: herdDistance/0 is Infinity)`);
  }
  for (const field of NULLABLE_FINITE_FIELDS) {
    const value = entity[field];
    if (value !== null && value !== undefined && !Number.isFinite(value)) broken.push(`${field}=${value}`);
  }
  // A non-finite utility is the quieter half and needs no extra state — the
  // breakdown is already on the entity for inspection.
  for (const [action, score] of Object.entries(entity.utilityBreakdown ?? {})) {
    if (!Number.isFinite(score)) broken.push(`utility.${action}=${score}`);
  }
  if (broken.length === 0) return null;
  tracker.corrupted = true;
  return {
    kind: 'non-finite-state',
    id: entity.id,
    species: entity.speciesId,
    tick,
    // ⚠ Deliberately above every other kind's ceiling. Nothing else in this tool
    // is a *corruption*: the rest are judgements about whether behaviour looks
    // sensible, and this is state that can no longer mean anything.
    severity: 20,
    detail:
      `non-finite state: ${broken.join(', ')} — at (${entity.x},${entity.y}), action=${entity.action}. ` +
      'A NaN position leaves the animal alive and outside every spatial query; a NaN utility means that ' +
      'action is silently never chosen again (DOCS §16)',
  };
}

/**
 * Detector 4b — **a commitment further out than its own configured ceiling.**
 *
 * Both of the plan's commitments are bounded by a world-level number precisely so
 * a species file cannot raise them (`config.charge.maxPursuitTicks`,
 * `config.consensus.commitTicks`). This asks the only question that matters about
 * such a bound: is it bounding? A ttl beyond it is an invariant violation rather
 * than a judgement, which is why it fires on the first tick it is seen rather than
 * accumulating evidence.
 *
 * ⚠ The consensus ceiling is `commitTicks + updateInterval`, not `commitTicks`.
 * A label re-decides only on a tick `HerdConsensusSystem` runs, so a commitment
 * legitimately quantizes up to the cadence — that slack is part of the mechanism
 * (DOCS §15), and a detector that did not know it would report the design.
 *
 * ⚠ Checked whether or not the mechanism is switched **on**: with `charge.enabled`
 * false a `defendUntil` should be null, so a non-null one is a leak rather than a
 * control arm.
 *
 * @returns {object|null}
 */
function commitmentPastCeiling(entity, tracker, tick, ctx) {
  if (tracker.overrunReported) return null;
  const over = [];
  if (entity.defendUntil !== null && entity.defendUntil - tick > ctx.pursuitCeiling) {
    over.push(
      `defendUntil is ${entity.defendUntil - tick} ticks out against a charge.maxPursuitTicks of ${ctx.pursuitCeiling}` +
        (ctx.chargeEnabled ? '' : ' — and charge.enabled is false, so it should be null'),
    );
  }
  if (entity.herdCommitUntil !== null && entity.herdCommitUntil - tick > ctx.consensusCeiling) {
    over.push(
      `herdCommitUntil is ${entity.herdCommitUntil - tick} ticks out against a ceiling of ${ctx.consensusCeiling} ` +
        '(commitTicks + updateInterval)' +
        (ctx.consensusEnabled ? '' : ' — and consensus.enabled is false, so it should be null'),
    );
  }
  if (over.length === 0) return null;
  tracker.overrunReported = true;
  return {
    kind: 'commitment-past-ceiling',
    id: entity.id,
    species: entity.speciesId,
    tick,
    severity: 12,
    detail: `${over.join('; ')} — a bound a mechanism can exceed is not a bound`,
  };
}

/**
 * Accumulate one tick of hold-and-sprint state onto a tracker, for detector 4c.
 *
 * ⚠ **Extracted so it can be tested, and the reason is a survived mutation.** With
 * this inline in `analyzeRun`, deleting the line that increments the per-episode
 * counter left the whole unit suite green — because the tests drove the *detector*
 * with hand-built trackers and never ran the code that fills one. A detector whose
 * accumulator is broken reports nothing and looks exactly like a healthy world
 * (D19: a half-working feature hides better than a broken one).
 *
 * ⚠⚠ The run length and its spent-sprint count are captured **together**, so the
 * pair always describes *one episode*. Two independent maxima would let a long hold
 * in one fight borrow an empty tank from a different one — the cross-episode
 * version of the always-true term this detector was reshaped to avoid.
 *
 * @param {object} tracker mutated in place
 * @param {object} entity this tick's authoritative state
 */
export function accumulateHold(tracker, entity) {
  const spent =
    entity.moveIntent?.sprint === true &&
    entity.maxStamina > 0 &&
    entity.stamina / entity.maxStamina <= D.exhaustedStaminaFraction;
  if (spent) tracker.sprintExhaustedTicks += 1;
  if (!HOLD_ACTIONS.has(entity.action)) {
    tracker.holdRun = 0;
    tracker.holdSpent = 0;
    return;
  }
  tracker.holdRun += 1;
  if (spent) tracker.holdSpent += 1;
  if (tracker.holdRun > tracker.holdRunMax) {
    tracker.holdRunMax = tracker.holdRun;
    tracker.holdRunSpent = tracker.holdSpent;
    tracker.holdRunAction = entity.action;
  }
}

/**
 * Accumulate one tick of band-contact state onto a tracker, for detector 4d.
 *
 * Counted only while the animal actually holds a membership, so a species that
 * forms no records never accrues either number and the detector below can never
 * reach it.
 *
 * ⚠ **Extracted for the same reason `accumulateHold` was, and after the same
 * mutation survived twice.** Deleting the `withBandmateTicks` increment left the
 * suite green while it was inline, because the detector tests drive hand-built
 * trackers. An accumulator that never counts makes its detector fire on *every*
 * long-standing member — the opposite failure to the silent one, and just as
 * invisible from a clean report.
 *
 * @param {object} tracker mutated in place
 * @param {object} entity
 * @param {object|null} summary this animal's `world.social` entry, or null
 */
export function accumulateBand(tracker, entity, summary) {
  if (entity.groupRecordId === null || entity.groupRecordId === undefined) return;
  tracker.inRecordTicks += 1;
  if ((summary?.bandmates ?? 0) > 0) tracker.withBandmateTicks += 1;
}

/**
 * Findings that can only be made about a *whole life*, run once per animal — at
 * its death, or at the end of the run for a survivor.
 *
 * ⚠⚠ **This family exists because phase 14 built one mechanism wrong twice and
 * both failures measured as "no effect" rather than as an error** (HANDOFF §4a,
 * A63). Cover concealment first hid the leopard's prey from the leopard, then —
 * once crypsis fixed that — hid *mates* from a solitary cryptic species, because
 * mate candidates come through the same perception gate as prey. Each showed up
 * as a population number three subsystems from the cause and looked like bad
 * tuning. A detector that says "this adult never once saw a mate" names it
 * directly.
 *
 * @returns {object[]} zero or more anomalies
 */
function lifeReview(entity, tracker, tick, ctx) {
  const facts = ctx.facts.get(entity.speciesId);
  if (!facts || tracker.adultTicks < D.adultTicksForReview) return [];
  const found = [];
  const base = { id: entity.id, species: entity.speciesId, tick };

  // A63 — the perception gate is not a predation gate.
  if (!tracker.everSawMate) {
    found.push({
      ...base,
      kind: 'never-saw-a-mate',
      severity: saturate(4, 11, tracker.adultTicks / D.adultTicksForReview - 1),
      detail:
        `adult for ${tracker.adultTicks} ticks and never once perceived a mate candidate` +
        (facts.crypsis > 0 ? ` — ⚠ this species has crypsis ${facts.crypsis} (A63: everything one animal knows about another comes through one test)` : '') +
        `, roamed ${tracker.bbox()}`,
    });
  }

  // A62 — a calendar mechanism meets the compressed lifespan. Only the gestating
  // sex is gated by the window (`isReproductivelyReady`), so only she can lose a
  // whole life to it.
  if (ctx.breedingEnabled && facts.breedingWindow && isChooser(entity) && tracker.inWindowAdultTicks === 0) {
    found.push({
      ...base,
      kind: 'barren-season',
      severity: saturate(4, 10, tracker.adultTicks / D.adultTicksForReview - 1),
      detail:
        `adult for ${tracker.adultTicks} ticks, none of it inside her species' breeding window ` +
        `(${facts.breedingWindow.startFraction}→${facts.breedingWindow.endFraction} of the year) — ` +
        'A62: an adult life shorter than the closed season is a lifetime spent waiting for a season',
    });
  }

  // A56 — a persistent group flaps. Only reachable for a species that forms one
  // at all, which is the zebra, lion and hyena today.
  //
  // ⚠ **Reported as a rate, because a raw count is length-of-life in disguise**
  // — the same reason the per-species table below reports rates. "901 changes"
  // says as much about how long the animal lived as about how badly it flapped;
  // "one change every 2.9 ticks" is the fact, and it is the one that makes an
  // engine defect obvious rather than merely large.
  if (facts.formsGroups && tracker.groupChanges >= D.groupChangesFlag) {
    const ticksPerChange = tracker.adultTicks / tracker.groupChanges;
    found.push({
      ...base,
      kind: 'group-flapping',
      // Saturates as the interval closes on every-other-tick, which is the
      // tightest a join/leave cycle can physically be.
      severity: saturate(3, 10, D.groupChangesFlag / Math.max(ticksPerChange, 0.5)),
      detail:
        `changed persistent-group membership ${tracker.groupChanges} times in ${tracker.adultTicks} adult ticks ` +
        `— one every ${ticksPerChange.toFixed(1)} ticks (A56)`,
    });
  }

  // ⚠⚠ **Detector 4c — sprinting on a budget nobody is keeping** (2026-08-06).
  // The behaviour plan named "a buffalo sprinting until it dies" as its own
  // headline risk and then shipped without anything able to see it: `defend` and
  // `chase` are *deliberately excluded* from both `SEARCH_ACTIONS` and
  // `PURSUIT_ACTIONS` above, because their targets move evasively and "made no
  // progress" is their normal case. So the two detectors that would otherwise
  // notice a stuck animal are both structurally blind here, and this is the gap.
  //
  // The claim is deliberately a **conjunction**, because either half alone is
  // ordinary: a long hold is a mob standing its ground, and bottomed-out stamina
  // is any animal that has just run for its life. Together they are an animal
  // still spending a budget it has already exhausted — which is what a charge
  // whose stamina gate has stopped biting looks like, and what
  // `config.charge.staminaFraction` exists to prevent.
  // ⚠ **Detector 4d — a member of a band it never meets** (P7's premise).
  // `GroupSystem`'s rally exists to walk a separated member back to its record,
  // and the one number it gates on is `bandmates` — how many of this animal's own
  // record are in the centre it is steering at. An animal that held a membership
  // for a long life and **never once** had a bandmate in that centre is a rally
  // that never completed: it belongs to a group it has never been with.
  //
  // ⚠ This is a **guard rather than a finding**, and that is stated rather than
  // discovered later: measured over 7000 ticks on seed 42, **295 animals held a
  // membership for more than 800 ticks and 0 of them never met a bandmate.** It is
  // here because it is the only coverage P7's mechanism has, and because the
  // failure it describes is invisible in every population number — the record
  // still exists, still has members, and still reports a size.
  if (facts.formsGroups && tracker.inRecordTicks >= D.adultTicksForReview && tracker.withBandmateTicks === 0) {
    found.push({
      ...base,
      kind: 'lost-from-its-band',
      severity: saturate(4, 11, tracker.inRecordTicks / D.adultTicksForReview - 1),
      detail:
        `held a persistent-group membership for ${tracker.inRecordTicks} ticks and never once had a bandmate ` +
        `in the centre it steers at — the rally's own gate (P7) never cleared, so this animal belongs to a ` +
        `band it has never been with, roamed ${tracker.bbox()}`,
    });
  }

  const holdCeiling = ctx.pursuitCeiling * D.runawayCommitFactor;
  const spentFraction = tracker.holdRunMax > 0 ? tracker.holdRunSpent / tracker.holdRunMax : 0;
  if (tracker.holdRunMax > holdCeiling && spentFraction >= D.exhaustedHoldFraction) {
    found.push({
      ...base,
      kind: 'sprint-to-exhaustion',
      severity: saturate(5, 13, tracker.holdRunMax / holdCeiling - 1),
      detail:
        `held ${tracker.holdRunAction} for ${tracker.holdRunMax} consecutive ticks (ceiling ` +
        `${ctx.pursuitCeiling} × ${D.runawayCommitFactor} = ${holdCeiling}; the healthy demo maximum is 31) ` +
        `with ${tracker.holdRunSpent} of those ticks sprinting at ≤${(D.exhaustedStaminaFraction * 100).toFixed(0)}% ` +
        `stamina (${(spentFraction * 100).toFixed(0)}% of the episode; ${tracker.sprintExhaustedTicks} such ticks in its whole life)` +
        (facts.chargeWeight > 0
          ? ` — ⚠ this species declares chargeWeight ${facts.chargeWeight} / pursuitTicks ${facts.pursuitTicks}, so check config.charge.staminaFraction is still biting`
          : ' — ⚠ this species declares no chargeWeight, so the sprint is not a charge and the cause is elsewhere'),
    });
  }
  return found;
}

/** Analyze a single (seed, config) world; returns a report object. */
function analyzeRun({ seed, composition, ticks, onProgress }) {
  const config = buildDemoConfig(composition);
  const engine = createDemoSimulation({ seed, config });
  const world = engine.world;
  const W = world.terrain.width, H = world.terrain.height;

  // Terrain geography, once.
  const waterCells = [];
  const terrainCounts = {};
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const c = world.terrain.codeAt(x, y);
      terrainCounts[c] = (terrainCounts[c] ?? 0) + 1;
      if (c === TerrainType.WATER) waterCells.push([x, y]);
    }
  }
  const facts = speciesFactsOf(world);
  const ctx = {
    waterCells,
    facts,
    // ⚠ Both mechanisms have a global off switch by the species-block rule
    // (DOCS §8), and a detector that fires on a switched-off mechanism is
    // reporting the control arm as a bug.
    breedingEnabled: engine.config.breeding?.enabled !== false,
    // --- The behaviour plan's two world-level ceilings (2026-08-06). Derived by
    // `commitmentCeilingsOf`, which is exported so the arithmetic is testable —
    // inline, the mutation that dropped its `updateInterval` slack survived the
    // whole suite.
    ...commitmentCeilingsOf(engine.config),
  };
  // Species that gate receptivity on the calendar — one today (the wildebeest),
  // and the loop below only pays for the ones that do.
  const windowed = [...facts.values()].filter((f) => f.breedingWindow !== null);

  const trackers = new Map();
  const deaths = {}; // cause -> count
  const everLived = {}; // speciesId -> distinct animals seen
  const deathsBySpecies = {}; // speciesId -> count
  const flaggedDeaths = [];
  const anomalies = [];

  for (let t = 1; t <= ticks; t += 1) {
    engine.step(1);
    const tick = engine.tick;
    // Once per tick, not once per animal: the calendar is a world fact.
    const yearProgress = world.environment?.yearProgress ?? 0;
    const inWindowNow = {};
    if (ctx.breedingEnabled) {
      for (const f of windowed) inWindowNow[f.id] = inBreedingWindow(yearProgress, f.breedingWindow);
    }

    for (const e of world.entities.all()) {
      if (e.kind === 'animal' && e.alive) {
        let tr = trackers.get(e.id);
        if (!tr) {
          tr = newTracker(tick, e);
          trackers.set(e.id, tr);
          everLived[e.speciesId] = (everLived[e.speciesId] ?? 0) + 1;
        }
        // Life-history flags.
        const perc = world.perception.get(e.id);
        if (perc?.nearestWater) tr.everPerceivedWater = true;
        if (perc?.nearestFood || perc?.nearestCarcass) tr.everPerceivedFood = true;
        // ⚠ The A63 read: mate candidates come through the *same* perception
        // summary as prey and threats, which is exactly why a change to that
        // gate silently gates reproduction too.
        if (perc?.mateCandidates?.length > 0) tr.everSawMate = true;
        if (e.action === 'drink') { tr.everDrank = true; tr.lastResolvedTick = tick; }
        if (e.action === 'eat') { tr.lastResolvedTick = tick; }
        // Life review counters.
        if (e.lifeStage === 'adult') {
          tr.adultTicks += 1;
          if (inWindowNow[e.speciesId]) tr.inWindowAdultTicks += 1;
        }
        // ⚠ `groupRecordId` is registry membership, NOT the `groupId` herd label
        // — the label is recomputed by propagation every tick and would count as
        // "flapping" constantly. The distinction is the whole point of the
        // persistent registry (EntityManager's note on the two fields).
        if ((e.groupRecordId ?? null) !== tr.lastGroupRecordId) {
          tr.groupChanges += 1;
          tr.lastGroupRecordId = e.groupRecordId ?? null;
        }
        // Path + bounding box + refused steps.
        //
        // ⚠⚠ **Measured from position, not from `entity.lastMoveDistance`, and
        // that was a real bug in this tool.** That field is a scratch channel
        // from the movement system to the metabolism system, and metabolism —
        // which runs in the *physiology* phase, after *movement* — zeroes it once
        // it has charged for it. So by the time `engine.step(1)` returns it is 0
        // for every living animal, always. The path-length accumulator this used
        // to feed was therefore always 0 — never read, so nobody noticed it was
        // lying — and `refusedSteps` counted every tick
        // the animal held a moving intent rather than the ticks it was actually
        // blocked: 1241 "refused steps" in a 1500-tick life, reported with a
        // straight face. A tick-boundary observer must derive movement from the
        // positions it can see, which is what the two lines below do.
        const moved = Math.hypot(e.x - tr.lastX, e.y - tr.lastY);
        tr.lastX = e.x; tr.lastY = e.y;
        tr.minX = Math.min(tr.minX, e.x); tr.maxX = Math.max(tr.maxX, e.x);
        tr.minY = Math.min(tr.minY, e.y); tr.maxY = Math.max(tr.maxY, e.y);
        if (e.moveIntent?.moving && moved < D.refusedEps && !STATIONARY.has(e.action)) tr.refusedSteps += 1;

        // Detectors 4a/4b — corruption, and a commitment past its own ceiling.
        // Both are one-shot per animal and both are *invariants* rather than
        // judgements, so they run before anything that reads the same fields.
        const corrupt = nonFiniteState(e, world.social.get(e.id) ?? null, tr, tick);
        if (corrupt) anomalies.push(corrupt);
        const overrun = commitmentPastCeiling(e, tr, tick, ctx);
        if (overrun) anomalies.push(overrun);

        // Detector 4c's counters — a held stand and a spent sprint budget. Both
        // are accumulated here and judged once per life in `lifeReview`, because
        // "the longest run in this life" is not a fact any single tick knows.
        accumulateHold(tr, e);
        accumulateBand(tr, e, world.social.get(e.id) ?? null);

        // Detector 2a — unresolved intent: committed to reaching something and
        // never closing on it. Two patiences, because a fixed cell and a walking
        // animal are not the same claim.
        const isCellSeek = CELL_SEEK_ACTIONS.has(e.action);
        const isPursuit = PURSUIT_ACTIONS.has(e.action);
        if ((isCellSeek || isPursuit) && e.actionTarget) {
          // ⚠ Two target shapes. A cell target is `{cellX, cellY}`; a mate,
          // guardian, calf or prey target carries an exact `{x, y}`. Reading
          // only the first produced NaN distances the moment pursuit actions
          // were added here, and a NaN comparison is silently false — the
          // detector would have gone quiet rather than wrong.
          const tx = e.actionTarget.x ?? (e.actionTarget.cellX + 0.5);
          const ty = e.actionTarget.y ?? (e.actionTarget.cellY + 0.5);
          const dist = Math.hypot(tx - e.x, ty - e.y);
          if (!tr.seek || tr.seek.action !== e.action) tr.seek = { action: e.action, startTick: tick, startDist: dist, minDist: dist };
          else tr.seek.minDist = Math.min(tr.seek.minDist, dist);
          const dur = tick - tr.seek.startTick;
          const patience = isPursuit ? D.pursuitStuckTicks : D.seekStuckTicks;
          if (dur >= patience && tr.seek.startDist - tr.seek.minDist < D.seekProgressMin) {
            const { need } = needOf(e);
            if (tr.seekRecord && tr.seekRecord.action === e.action) {
              // Same animal, same unresolved intent, a later episode. Counting
              // repeats onto one finding is strictly more informative than a
              // second identical line, and it keeps one pacing animal from
              // filling the report — which is what "at most one per animal" was
              // protecting against, at the cost of the count.
              tr.seekRecord.episodes += 1;
            } else {
              const record = {
                kind: 'unresolved-intent', id: e.id, species: e.speciesId, tick, action: e.action, episodes: 1,
                severity: (dur / 50) * (1 + need),
                detail: `${e.action} for ${dur} ticks with no progress (dist ${tr.seek.startDist.toFixed(1)}→${tr.seek.minDist.toFixed(1)}), ${tr.refusedSteps} refused steps, at (${e.x.toFixed(0)},${e.y.toFixed(0)})`,
              };
              anomalies.push(record);
              tr.seekRecord = record;
            }
            tr.seek = null; // start a fresh episode rather than re-firing every tick
          }
        } else if (!isCellSeek && !isPursuit) {
          tr.seek = null;
        }

        // Detector 2b — circling in need: much path, little net displacement,
        // while searching and finding nothing.
        if (tick % D.circleSampleEvery === 0) {
          tr.ring.push([e.x, e.y, tick, SEARCH_ACTIONS.has(e.action)]);
          const maxSamples = Math.ceil(D.circleWindowTicks / D.circleSampleEvery);
          if (tr.ring.length > maxSamples) tr.ring.shift();
          if (tr.ring.length === maxSamples) {
            let path = 0;
            let searching = 0;
            for (let i = 1; i < tr.ring.length; i += 1) path += Math.hypot(tr.ring[i][0] - tr.ring[i - 1][0], tr.ring[i][1] - tr.ring[i - 1][1]);
            for (const sample of tr.ring) if (sample[3]) searching += 1;
            const net = Math.hypot(tr.ring.at(-1)[0] - tr.ring[0][0], tr.ring.at(-1)[1] - tr.ring[0][1]);
            const { need } = needOf(e);
            const searchFraction = searching / tr.ring.length;
            const windowStart = tr.ring[0][2];
            // ⚠⚠ The two new terms. Without them this fired 146 times per healthy
            // world (see the header): a lion between kills is hungry and ranges a
            // home range, and neither fact is a bug. The anomaly is *searching and
            // never resolving*.
            const resolvedInWindow = tr.lastResolvedTick >= windowStart;
            if (
              path >= D.circleMinPath &&
              net / path < D.circleRatio &&
              need >= D.circleNeed &&
              searchFraction >= D.circleSearchFraction &&
              !resolvedInWindow
            ) {
              if (tr.circleRecord) {
                tr.circleRecord.episodes += 1;
              } else {
                const record = {
                  kind: 'circling-in-need', id: e.id, species: e.speciesId, tick, episodes: 1,
                  severity: (D.circleWindowTicks / 100) * need * (1 - net / path),
                  detail: `covered ${path.toFixed(0)}u over ${D.circleWindowTicks} ticks but drifted only ${net.toFixed(0)}u (net/path ${(net / path).toFixed(2)}), ${(searchFraction * 100).toFixed(0)}% of it searching, ate/drank nothing, need ${need.toFixed(2)}, around (${e.x.toFixed(0)},${e.y.toFixed(0)})`,
                };
                anomalies.push(record);
                tr.circleRecord = record;
              }
            }
          }
        }
      } else if (e.kind === 'carcass' && e.diedTick === tick) {
        deaths[e.deathCause] = (deaths[e.deathCause] ?? 0) + 1;
        deathsBySpecies[e.speciesId] = (deathsBySpecies[e.speciesId] ?? 0) + 1;
        const tr = trackers.get(e.id);
        if (tr) {
          const verdict = autopsy(world, e, tr, ctx);
          if (verdict.suspicion >= D.minFlag) {
            flaggedDeaths.push({ id: e.id, species: e.speciesId, cause: e.deathCause, tick, x: e.x, y: e.y, ...verdict });
          }
          anomalies.push(...lifeReview(e, tr, tick, ctx));
          trackers.delete(e.id); // bound memory: the animal is gone
        }
      }
    }
    if (onProgress && t % 1000 === 0) onProgress(t, ticks);
  }

  // Final populations, and the life review for everything still alive — a
  // survivor that never saw a mate is the *stronger* case, not the weaker one:
  // it had a whole run to manage it.
  const pop = {};
  for (const e of world.entities.all()) {
    if (e.kind !== 'animal' || !e.alive) continue;
    pop[e.speciesId] = (pop[e.speciesId] ?? 0) + 1;
    const tr = trackers.get(e.id);
    if (tr) anomalies.push(...lifeReview(e, tr, engine.tick, ctx));
  }

  flaggedDeaths.sort((a, b) => b.suspicion - a.suspicion);
  anomalies.sort((a, b) => b.severity - a.severity);

  const name = (c) => Object.keys(TerrainType).find((k) => TerrainType[k] === c);
  return {
    seed, composition, ticks, world: `${W}x${H}`,
    terrain: Object.fromEntries(Object.entries(terrainCounts).map(([c, n]) => [name(+c), n])),
    waterBbox: waterCells.length ? bbox(waterCells, W, H) : 'no water',
    pop, deaths, everLived, deathsBySpecies, flaggedDeaths, anomalies,
    totalDeaths: Object.values(deaths).reduce((a, b) => a + b, 0),
  };
}

function bbox(cells, W, H) {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  return `x[${Math.min(...xs)}..${Math.max(...xs)}] y[${Math.min(...ys)}..${Math.max(...ys)}] of ${W}x${H}`;
}

/**
 * Take `n` findings, drawn **round-robin across species** from each species' own
 * ranking rather than off one global list.
 *
 * ⚠⚠ **A flat top-N is a popularity contest once the roster is uneven.** The
 * demo founds 120 gazelle against 8 leopards, so gazelle outnumber leopards 15:1
 * in every list this tool builds and the worst leopard in the world never
 * reaches a global top-12 — which is backwards, because the rare species is the
 * one whose anomaly nobody else will notice. Round-robin guarantees every
 * species that has *anything* flagged is represented before any species gets a
 * second line.
 *
 * @param {object[]} sorted findings already in descending severity/suspicion
 * @param {number} n
 */
function roundRobinBySpecies(sorted, n) {
  const bySpecies = new Map();
  for (const item of sorted) {
    if (!bySpecies.has(item.species)) bySpecies.set(item.species, []);
    bySpecies.get(item.species).push(item);
  }
  const queues = [...bySpecies.values()];
  const out = [];
  for (let round = 0; out.length < n; round += 1) {
    let took = 0;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      out.push(queue[round]);
      took += 1;
      if (out.length >= n) break;
    }
    if (took === 0) break;
  }
  return out;
}

/** Per-species roll-up: a *rate*, because a count is a headcount in disguise. */
function perSpeciesRows(report) {
  const ids = new Set([
    ...Object.keys(report.everLived),
    ...report.flaggedDeaths.map((d) => d.species),
    ...report.anomalies.map((a) => a.species),
  ]);
  const rows = [];
  for (const id of ids) {
    const lived = report.everLived[id] ?? 0;
    const flagged = report.flaggedDeaths.filter((d) => d.species === id);
    const anomalies = report.anomalies.filter((a) => a.species === id);
    const kinds = {};
    for (const a of anomalies) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
    for (const d of flagged) kinds[`death:${d.cause}`] = (kinds[`death:${d.cause}`] ?? 0) + 1;
    const flaggedAnimals = new Set([...flagged, ...anomalies].map((item) => item.id)).size;
    rows.push({
      id, lived,
      deaths: report.deathsBySpecies[id] ?? 0,
      flaggedAnimals,
      rate: lived > 0 ? flaggedAnimals / lived : 0,
      worst: Math.max(0, ...flagged.map((d) => d.suspicion), ...anomalies.map((a) => a.severity)),
      kinds,
    });
  }
  return rows.sort((a, b) => b.rate - a.rate);
}

function printReport(report, top, speciesFilter) {
  const keep = (item) => !speciesFilter || speciesFilter.has(item.species);
  const flaggedDeaths = report.flaggedDeaths.filter(keep);
  const anomalies = report.anomalies.filter(keep);
  const compStr = describeComposition(report.composition, ' ') || '(demo defaults)';
  console.log(`\n${'='.repeat(78)}\nseed ${report.seed} — ${report.world} — ${compStr} — ${report.ticks} ticks`);
  console.log(`terrain: ${JSON.stringify(report.terrain)}`);
  console.log(`water: ${report.waterBbox}`);
  console.log(`final population: ${JSON.stringify(report.pop)}`);
  console.log(`deaths (${report.totalDeaths}): ${JSON.stringify(report.deaths)}`);
  console.log(`flagged: ${flaggedDeaths.length} suspicious deaths, ${anomalies.length} anomalies${speciesFilter ? ` (filtered to ${[...speciesFilter].join(',')})` : ''}`);

  // Per-species first: with eight species the rates are what tell you where to
  // look, and the shortlists below are the drill-down.
  const rows = perSpeciesRows(report).filter((row) => !speciesFilter || speciesFilter.has(row.id));
  if (rows.length) {
    console.log('\n  per species — flagged animals / animals that ever lived:');
    for (const row of rows) {
      const kinds = Object.entries(row.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(', ');
      console.log(
        `   ${row.id.padEnd(22)} ${String(row.flaggedAnimals).padStart(4)}/${String(row.lived).padEnd(5)} ` +
          `${(row.rate * 100).toFixed(1).padStart(5)}%  worst ${row.worst.toFixed(1).padStart(5)}  ${row.deaths} died  ${kinds}`,
      );
    }
  }

  if (flaggedDeaths.length) {
    const shortlist = roundRobinBySpecies(flaggedDeaths, top);
    console.log(`\n  top ${shortlist.length} suspicious deaths (preventable-in-place score, round-robin by species):`);
    for (const d of shortlist) {
      console.log(`   [${d.suspicion.toFixed(1)}] #${d.id} ${label(d.species)} ${d.cause} @t=${d.tick} (${d.x.toFixed(0)},${d.y.toFixed(0)}) — ${d.reason}`);
    }
  }
  if (anomalies.length) {
    const shortlist = roundRobinBySpecies(anomalies, top);
    console.log(`\n  top ${shortlist.length} anomalies (severity, round-robin by species):`);
    for (const s of shortlist) {
      const repeats = s.episodes > 1 ? ` ×${s.episodes}` : '';
      console.log(`   [${s.severity.toFixed(1)}] #${s.id} ${label(s.species)} ${s.kind}${repeats} — ${s.detail}`);
    }
  }
  if (!flaggedDeaths.length && !anomalies.length) {
    console.log('  nothing flagged — no preventable-in-place deaths or anomalies over this run.');
  }
}

function label(speciesId) {
  return speciesId.split('.').pop();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Which worlds to sweep. An explicit seed/composition runs exactly that; with
  // nothing given, a small default sweep — a few seeds across the demo default
  // and a rock/thicket-heavy stress world, the terrain most likely to trap an
  // animal — so `npm run ethologist` produces a useful report out of the box.
  let runs;
  if (opts.seeds) {
    runs = opts.seeds.map((seed) => ({ seed, composition: opts.composition }));
  } else if (opts.seedCount) {
    runs = Array.from({ length: opts.seedCount }, (_, i) => ({ seed: opts.seedBase + i, composition: opts.composition }));
  } else {
    const seeds = [1, 2, 3];
    const configs = [{}, { rocks: 6, thickets: 8 }];
    runs = configs.flatMap((composition) => seeds.map((seed) => ({ seed, composition })));
  }

  // ⚠ Progress and headers go to **stderr**. They used to go to stdout, which
  // meant `--json` emitted a banner line before the JSON and nothing could parse
  // it — the same discipline `sweep.js` already keeps.
  console.error(`biome ethologist — ${runs.length} world(s), ${opts.ticks} ticks each`);
  const reports = [];
  for (const run of runs) {
    const compStr = describeComposition(run.composition, ' ') || 'demo defaults';
    console.error(`  seed ${run.seed} [${compStr}]…`);
    const report = analyzeRun({ ...run, ticks: opts.ticks });
    reports.push(report);
    if (!opts.json) printReport(report, opts.top, opts.species);
  }

  if (opts.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  // Cross-run summary: where the anomalies concentrate.
  console.log(`\n${'='.repeat(78)}\nSUMMARY — ${reports.length} world(s)`);
  const keep = (item) => !opts.species || opts.species.has(item.species);
  const ranked = reports
    .map((r) => {
      const flaggedDeaths = r.flaggedDeaths.filter(keep);
      const anomalies = r.anomalies.filter(keep);
      return {
        seed: r.seed,
        comp: describeComposition(r.composition, ',') || 'demo',
        flaggedDeaths: flaggedDeaths.length,
        anomalies: anomalies.length,
        worst: flaggedDeaths[0]?.suspicion ?? 0,
      };
    })
    .sort((a, b) => b.flaggedDeaths + b.anomalies - (a.flaggedDeaths + a.anomalies));
  for (const r of ranked) {
    console.log(`  seed ${String(r.seed).padStart(10)} [${r.comp}] — ${r.flaggedDeaths} flagged deaths, ${r.anomalies} anomalies (worst death score ${r.worst.toFixed(1)})`);
  }
  console.log('\nRe-run any world with --seed=<n> [same composition flags] to drill into it,');
  console.log('and add --species=<id> to narrow the report (never the world) to one animal.');
}

/**
 * ⚠ **Run only when this file is the entry point.** The three family-4 detectors
 * below are `export`ed so `test/ethologist.test.js` can drive them against
 * hand-built animals — which is the only way to prove a detector *can* fire, and
 * D43 is the whole reason that proof is required rather than optional. Without
 * this guard, importing the module would kick off a six-world sweep.
 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { nonFiniteState, commitmentPastCeiling, lifeReview, D, HOLD_ACTIONS };
