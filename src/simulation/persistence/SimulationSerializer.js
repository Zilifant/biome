/**
 * Versioned save/load for the simulation engine.
 *
 * A save contains everything needed to continue deterministically: tick,
 * random stream states, world configuration, full entity state (including
 * deferred spawn/removal queues), the event outbox, pending deterministic
 * commands, and descriptors of the registered systems (used to verify the
 * restoring code registered the same systems).
 *
 * The spatial grid is NOT saved — it is derived state and is rebuilt from
 * entity positions on restore. Terrain is likewise derived: it regenerates
 * deterministically from the saved seed + config (config.terrain) in the
 * engine constructor, so no terrain grid is stored. Vegetation biomass IS
 * saved: it evolves over time and will be grazed (Step 9), so it is not
 * reproducible from the seed alone.
 *
 * Systems themselves are code, not data: the caller must register the same
 * systems on the target engine before restoring (see createEngineFromSave).
 *
 * Version history:
 *   1 — initial format.
 *   2 — terrain layer added (Step 2). Terrain is derived, so no field was
 *       added, but pre-terrain (v1) saves are explicitly invalidated: their
 *       entities were placed with no notion of impassable cells and could sit
 *       on now-blocked terrain. No committed saves existed, so no migration
 *       path is provided — v1 saves must be regenerated.
 *   3 — vegetation biomass added (Step 3), stored under `vegetation`. Older
 *       saves lack it and are invalidated; regenerate them.
 *   4 — entity physiology fields added (Step 4): bodyMass, speed, health,
 *       maxHealth. They round-trip automatically (EntityManager serializes
 *       whole records), but v3 saves lack them and are invalidated.
 *   5 — locomotion `moveIntent` added to entity records (Step 5). Needed for
 *       deterministic wander continuation across save/load; v4 saves lack it
 *       and are invalidated.
 *   6 — metabolism fields added (Step 6): lastMoveDistance, lowEnergy,
 *       edibleMass; dead animals become `carcass`-kind entities. v5 saves lack
 *       these and are invalidated.
 *   7 — decision fields added (Step 8): action, actionTarget, utilityBreakdown,
 *       and moveIntent gains `moving`. v6 saves lack these and are invalidated.
 *   8 — hydration fields added (Step 10): hydration, maxHydration. v7 saves
 *       lack these and are invalidated.
 *   9 — life stage added (Step 11): `lifeStage`; the demo `LifecycleSystem`
 *       was replaced by `AgingSystem`, so system descriptors also changed. v8
 *       saves lack the field / register different systems and are invalidated.
 *  10 — reproduction fields added (Step 12): parents, gestationUntil,
 *       pendingMateId, lastMatedTick, plus the new `ReproductionSystem`
 *       descriptor. v9 saves are invalidated.
 *  11 — parenting and life-history fields added (Step 13): offspring,
 *       guardianId, weaned, lifeEvents, plus the new `ParentingSystem`
 *       descriptor. v10 saves lack the fields and register a different system
 *       lineup, so they are invalidated; regenerate them.
 *  12 — individual variation added (Step 14): per-entity `traits` and the
 *       trait-derived `adultMass`. Both are sampled once at birth and cannot
 *       be recovered from the seed alone once a population has turned over, so
 *       they are persisted; v11 saves lack them and are invalidated.
 *  13 — bounded spatial memory added (Step 15): per-entity `memories`, plus the
 *       new `MemorySystem` descriptor. What an animal has learned is not
 *       derivable from the seed, so it is persisted; v12 saves lack the field
 *       and register a different system lineup, so they are invalidated.
 *  14 — predation added (Step 16): per-entity `stamina`/`maxStamina`,
 *       `huntTargetId`, `lastHuntTick`, a second species in the demo, and the
 *       new `HuntingSystem` descriptor. v13 saves lack the fields and register
 *       a different system lineup, so they are invalidated.
 *  15 — injuries added (Step 17): per-entity `injuries` and the derived
 *       `impairment`, plus the new `InjurySystem` descriptor. A wound and how
 *       far it has healed cannot be recovered from the seed, so both persist;
 *       v14 saves lack them and register a different system lineup, so they
 *       are invalidated.
 *  16 — carcass decay added (Step 17→18): per-entity `diedTick`, `deathCause`,
 *       `decayStage`, the new `CarcassSystem` descriptor, and a new top-level
 *       `tombstones` block. This is the first format where entities are
 *       *removed* from the world, so the tombstone registry is part of the
 *       saved state — without it a restored run would forget different animals
 *       than the original. v15 saves are invalidated.
 *  17 — season and weather added (Step 19): a top-level `environment` block and
 *       the new `WeatherSystem` descriptor. The season is a pure function of
 *       the tick, but the *weather* is a held stochastic state, so it must be
 *       stored — recomputing it would need the whole roll history. v16 saves
 *       are invalidated.
 *  18 — heredity added (Step 20): a per-entity `genome`, from which `traits`
 *       are now expressed rather than sampled. The genome is the heritable
 *       state and cannot be recovered from the seed once a population has
 *       turned over, so it persists; v17 saves lack it and are invalidated.
 *  19 — evolutionary observation added (Step 21): a per-entity `generation`,
 *       the new `MetricsSystem` descriptor, and a bounded `metricsHistory`.
 *       The metrics *report* is derived and deliberately not saved — it is
 *       recomputed on the next metrics tick — but the history is, so a chart
 *       survives a restore. v18 saves are invalidated.
 *  20 — sexes and mate choice added (Step 22): a per-entity `sex` (fixed for
 *       life), `mateSearchSince` (how long this animal has been receptive,
 *       which is what makes a choosy one's standard decline), and
 *       `lastCourtship`. Genomes also gained a `choosiness` locus. None of it
 *       is recoverable from the seed once a population has turned over — and a
 *       v19 population has no sexes at all, so its animals could never pair.
 *       v19 saves are invalidated.
 *  21 — sociality added (Step 23): a per-entity `groupId` (the herd label),
 *       `alarmedUntil` / `alarmSource`, `lastContestTick`, `defendingId`, and
 *       the new `SocialSystem` descriptor. The label has to persist because it
 *       is the *only* social state there is — the group summary, like
 *       perception, is transient and rebuilt on the next tick, and dominance is
 *       derived on read. v20 saves lack the fields and register a different
 *       system lineup, so they are invalidated.
 *  22 — territories added (Step 24): a per-entity `homeRange` (the running
 *       summary of where an animal lives) and `lastMarkTick`, a new top-level
 *       `scent` block holding the claim layer, and the `TerritorySystem`
 *       descriptor. Both are evolved state: a map of who holds what ground, and
 *       an average built from a walk nobody recorded, cannot be recovered from
 *       the seed. v21 saves are invalidated.
 *  23 — disease added (Step 25): per-entity `diseaseState`, `diseaseSince`, and
 *       `diseaseUntil`, plus the new `DiseaseSystem` descriptor. Who is
 *       currently carrying what, and how far through it they are, is exactly
 *       the kind of thing no seed can reproduce once a population has been
 *       exposed. v22 saves are invalidated.
 *  24 — migration added (Step 26): per-entity `migrationHeading` /
 *       `migrationStrength` (the drift a wander is steered by),
 *       `dispersalHeading` / `dispersalUntil` (a juvenile's bounded outward
 *       walk), `settledX` / `settledY` (where it last lived), plus the new
 *       `MigrationSystem` descriptor. The drift is *derived* from the vegetation
 *       field and would normally be rebuilt rather than saved — but habitat
 *       evaluation is staggered, so a restore would run up to `updateInterval`
 *       ticks on a stale null and diverge from an uninterrupted run. Two numbers
 *       are cheaper than the divergence. v23 saves are invalidated.
 *  25 — local disturbances added (Step 27): a top-level `disturbances` list and
 *       `nextDisturbanceId`, plus the new `DisturbanceSystem` descriptor. The
 *       records are the *only* state the mechanism has — every effect is derived
 *       from them on read — so saving them restores slow ground, cold air, and
 *       an ongoing fire all at once, and saving nothing else would be wrong in
 *       the same three ways. Note that the vegetation a fire already destroyed
 *       rides in the existing `vegetation` block, since it is simply gone. v24
 *       saves are invalidated.
 *  26 — ecosystem engineering added (Step 28): a top-level `features` block (the
 *       sparse map of worn cells) and the new `EngineeringSystem` descriptor.
 *       Ground worn down over thousands of ticks is the clearest case yet of
 *       state no seed can reproduce: it is the accumulated record of where
 *       animals have actually walked and slept. Note the per-entity
 *       `trailHeading` / `trailStrength` ride along automatically, as the
 *       migration drift does, and for the same reason — the drift is recomputed
 *       on a stagger, so a restore running on a stale null would diverge. v25
 *       saves are invalidated.
 *  27 — the species schema (Step 29). **No per-entity field changed**, which is
 *       why this bump is worth explaining: the *config* did. Species now
 *       resolve their biology against the config blocks (`metabolism`,
 *       `hydration`, `aging`, `perception`, `traits`, `genetics`, `disease`,
 *       `reproduction`), and the demo's founding roster moved from
 *       `demo.animalCount` / `demo.predatorCount` to a `demo.founding` list. A
 *       v26 save carries the old shape, so restoring one would silently found
 *       nothing and resolve species against blocks that are no longer where the
 *       loader looks. Config is saved verbatim and is part of the contract, so
 *       a change to its shape invalidates saves exactly as a field change does.
 *  28 — persistent social groups (PLAN-SPECIES.md §3.8): a new top-level
 *       `groups` block holding the bounded group registry, a per-entity
 *       `groupRecordId`, the new `GroupSystem` descriptor, and a new
 *       `config.groups` section. ⚠ This is genuinely new **authoritative**
 *       state, not a second view of something already saved: a herd label is
 *       recomputed from positions every tick and so needs no saving beyond the
 *       label itself, but a group record is an identity that survives
 *       separation — who founded a clan, when, and who is still in it cannot be
 *       recovered from where the animals happen to be standing at load. The
 *       registry's `nextId` rides with it, since a counter that restarted would
 *       reissue the id of a group something still refers to (the same reason
 *       `nextDisturbanceId` is saved). v27 saves lack the block and register a
 *       different system lineup, so they are invalidated.
 *  29 — predation structure (PLAN-SPECIES.md phase 4): a per-carcass
 *       `possessorId` (who is standing over this body), plus new `predation`
 *       and possession config sections. The possessor is the one piece of new
 *       persisted state and it is small, but it is not derivable: a restored
 *       world that forgot it would hand every contested carcass back to
 *       whichever scavenger has the lower id, which is exactly the behaviour
 *       possession replaced. Config is saved verbatim, so the new sections
 *       invalidate v28 saves on their own account too.
 *  30 — elevation (A67, phase T2 of TREES-FLIGHT-VULTURE-PLAN.md): a per-entity
 *       `elevation` (0 ground, 1 canopy) on animals **and carcasses**, plus a
 *       new `config.climbing` section and the `tree` terrain params in
 *       `config.terrain`.
 *
 *       ⚠ **The bump is for the config, not for the field**, and the distinction
 *       is worth stating because it decides what a future field costs. Entities
 *       serialize whole (`{ ...entity }`) and restore whole, so a new entity
 *       field rides along for free and an older save simply lacks it —
 *       `createEntity` defaults it to 0, which is exactly "on the ground", so a
 *       v29 save would restore correctly on that account alone. What genuinely
 *       invalidates v29 is that **terrain is regenerated from `config.terrain`
 *       on load** and that config is saved verbatim: a v29 save carries no tree
 *       params, so restoring one into this engine would rebuild its world with
 *       the *new* defaults underneath animals placed in the old one. That is the
 *       same hazard the terrain-params consolidation fixed on 2026-08-02, and it
 *       is why a terrain generator change is always a save-format change.
 *  31 — flight (phase F1 of TREES-FLIGHT-VULTURE-PLAN.md): a per-entity `flying`
 *       boolean and a new `config.flight` section.
 *
 *       ⚠ **A v30 save would in fact have restored correctly, and it is
 *       invalidated anyway.** `flying` rides along in `{ ...entity }` and defaults
 *       to `false` in `createEntity`, and the missing config section is filled by
 *       `mergeConfig` from the defaults — so nothing here is silently wrong the
 *       way v29's missing tree params were. The bump is the discipline rather than
 *       a repair: §12 says bump when persisted state changes, `restoreSimulationState`
 *       refuses any other version outright, and the alternative is a save that
 *       claims to be v30 while carrying a field v30 never had. A loud refusal
 *       beats a save whose format number no longer identifies its contents.
 *  32 — group dissolution hysteresis (BEHAVIOR-PLAN.md P5a, closing A56): a
 *       per-record `belowMinSince` in the group registry — the tick a record
 *       dropped below its species' `minMembers`, or null while it is at strength —
 *       plus `config.groups.dissolveGraceTicks` and a raised
 *       `config.groups.maxGroups` (64 → 192).
 *
 *       ⚠⚠ **Unlike v31's, this bump is a repair rather than a discipline, and a
 *       v31 save would restore *silently wrong*.** Group records serialize whole
 *       and restore whole, exactly as entities do — but there is no `createEntity`
 *       equivalent to default a missing field on a *record*. A v31 record carries
 *       no `belowMinSince` at all, so it would restore as `undefined`, and
 *       `tick - undefined` is `NaN`, which is never `>= graceTicks`: that record
 *       would sit below its minimum **forever without ever dissolving**, holding a
 *       store slot for the rest of the run. `GroupRegistry.restore` defaults it
 *       with `?? null` for exactly that reason, and this version number is what
 *       makes the defaulting unreachable rather than load-bearing.
 *  33 — herd movement consensus (BEHAVIOR-PLAN.md P8): four per-entity fields
 *       (`herdHeading`, `herdStrength`, `herdCommitUntil`, `herdCommitLabel`), the
 *       new `HerdConsensusSystem` descriptor, a new `config.consensus` section, and
 *       `config.groups.leadWeight` beside two new `config.behavior` weights.
 *
 *       ⚠⚠ **A commitment is the first per-entity drift here that genuinely must be
 *       saved, and the contrast with the pair beside it is the reason.** P7's
 *       `rallyHeading` / `rallyStrength` are deliberately *not* persisted, because
 *       `GroupSystem` (−8) rewrites them from scratch before `DecisionSystem` (0)
 *       reads them every tick, so a restored value cannot matter. This pair is the
 *       opposite kind of state by construction: the whole mechanism is a heading
 *       that **outlives the cue that produced it**, held across up to
 *       `consensus.commitTicks` ticks. A restore that dropped it would put a
 *       marching herd back on its individual noses and diverge immediately from an
 *       uninterrupted run — the same argument that made the migration drift saved
 *       rather than rebuilt at v24, and a stronger one, since a consensus is not
 *       recoverable from the vegetation field at all.
 *
 *       ⚠ Entities serialize whole, so the fields ride along and `createEntity`
 *       would default a missing one — but `herdCommitLabel` defaulting to null on a
 *       v32 save would make every animal in the world a *joiner* on the first
 *       consensus tick, which is a different world, not a missing field. v32 saves
 *       are invalidated on that account, on the config's, and on the system
 *       lineup's.
 *  34 — the charge and the pursuit after it (BEHAVIOR-PLAN.md P9): three per-entity
 *       fields (`defendUntil`, `defendThreatX`, `defendThreatY`), a new
 *       `config.charge` section, and two new `config.behavior` weights.
 *
 *       ⚠ The same argument as v33's, in a second mechanism: this is a commitment,
 *       so it exists precisely to outlive the cue that made it. A restore that
 *       dropped it would stop a herd in the middle of driving a predator off and
 *       diverge from an uninterrupted run. ⚠ No system descriptor changed — the
 *       charge is not a system, it is two lines inside `DecisionSystem` — so unlike
 *       v33 the *only* things invalidating a v33 save are the fields and the config,
 *       which is exactly the case §12 says to bump for anyway.
 *  35 — `bandmates` becomes a per-entity field (**A99**), and this bump is a
 *       **repair** rather than a feature — the second one, after v32's.
 *
 *       ⚠⚠ **A save/load round trip did not reproduce, and the cause was one
 *       number that lived only in a transient map.** `SocialSystem` publishes
 *       `bandmates` into `world.social`, which is never serialized; but
 *       `predation/groupBackingFor` reads it from the **`perception` phase**, which
 *       runs *before* `SocialSystem` every tick. A read that is always one tick
 *       behind is a read across a tick boundary, and across a *load* that boundary
 *       has nothing on the far side: the restored map is empty, every hunter's
 *       count reads 0 for one tick, the cooperative prey ceiling collapses to the
 *       solo ceiling, and prey a clan could take is briefly ineligible. Measured on
 *       seed 11: a hyena at distance 4.83 was `nearestThreat` in the original and
 *       `null` in the restored, and everything downstream — no flee, an alarm
 *       arriving relayed instead of first-hand, `alarmedUntil` one tick late,
 *       headings, positions, and the `homeRange` running average — drifted from
 *       there. It read like float noise 400 fields deep.
 *
 *       ⚠ **This is v24's and v26's argument, one notch sharper.** Those persisted
 *       `migrationHeading`/`migrationStrength` and `trailHeading`/`trailStrength`
 *       because a *staggered* evaluation would run up to `updateInterval` ticks on a
 *       stale null. This read is stale across a **phase** boundary on *every* tick,
 *       not merely on a stagger. **The generalisation worth keeping: transient state
 *       read across a phase boundary is not transient.**
 *
 *       ⚠ A v34 save carries no `bandmates`, `createEntity` defaults it to 0, and
 *       that is exactly the bug — so v34 saves are invalidated rather than
 *       defaulted, the same call v32 made.
 *
 *       ⚠ Also in this version, and neither one changes the format: `FeatureGrid`
 *       returns its demotions in ascending cell order (they were emitted in `Map`
 *       insertion order, which a restore re-sorts — same events, different
 *       sequence), and `assertKnownSpecies` now checks `pendingCommands`, the third
 *       place a `speciesId` can hide and the one it was not looking in.
 *  36 — the year becomes **wet/dry** (SEASON-PLAN.md D1). The `environment` block
 *       gains `phase` and `phaseProgress`; `season` changes from one of
 *       `spring|summer|autumn|winter` to one of `wet|dry`; and `seasonProgress`
 *       changes meaning from "through this quarter" to "through this half-year
 *       season".
 *
 *       ⚠ **The config is what actually invalidates a v35 save, not the fields.**
 *       `config.environment` moved under it — `ticksPerYear 8000 → 4000`,
 *       `spellTicks 400 → 200`, `temperatureAmplitude 9 → 2` — and the whole
 *       environment record is a pure function of the tick and those numbers, so a
 *       v35 save restored into this engine would resume at a different point in a
 *       different year with a different climate. That is not a missing field, it
 *       is a different world, which is the case §12 says to bump for.
 *
 *       ⚠ Also in this version, and it is a *behaviour* change rather than a
 *       format one: the wildebeest's `reproduction.gestationTicks` moved
 *       1400 → 2400 and its `breedingWindow` to `{0.40, 0.60}`, so that calving
 *       lands at the start of the wet season rather than being smeared across the
 *       dry one. A v35 save carries gestating females whose `gestationUntil` was
 *       set on the old clock; they would simply calve early, which is harmless,
 *       but the save is invalidated on the config's account anyway.
 *  37 — the **dry bed** terrain code (SEASON-PLAN.md D4). `DRY_BED: 7` is an
 *       eighth entry in `TERRAIN_LEGEND`, with rows in all five terrain-keyed
 *       tables and a `dry_bed` habitat weight on the five species that name
 *       `water`.
 *
 *       ⚠ **Nothing generates one yet, so no v36 world contained the code** — and
 *       the bump is still required, because terrain is regenerated from
 *       `config.terrain` on load and a species block moved. This is the same
 *       reasoning v30 recorded: a terrain generator change is always a save-format
 *       change, whether or not the current parameters exercise it.
 */
import { SimulationEngine } from '../engine/SimulationEngine.js';

export const SAVE_FORMAT_VERSION = 37;

/**
 * Capture a deep, plain-data save of the engine's complete state.
 * Call between step() calls (never re-entrantly from inside a system).
 * @param {SimulationEngine} engine
 */
export function captureSimulationState(engine) {
  return structuredClone({
    formatVersion: SAVE_FORMAT_VERSION,
    simulationId: engine.simulationId,
    seed: engine.seed,
    tick: engine.tick,
    config: engine.config,
    randomStreams: engine.serializeRandomStreams(),
    entities: engine.world.entities.serialize(),
    tombstones: engine.world.serializeTombstones(),
    environment: { ...engine.world.environment },
    // Active local disturbances (Step 27), plus the id counter. Both are
    // genuinely evolved state: where a fire started and how long it has left to
    // burn is not recoverable from the seed, and a counter that restarted would
    // reissue the id of something still running.
    disturbances: engine.world.disturbances.map((d) => ({ ...d })),
    nextDisturbanceId: engine.world.nextDisturbanceId,
    // Worn ground (Step 28). Ground animals wore down over thousands of ticks
    // is the definition of evolved state — nothing about it is recoverable from
    // the seed, and a restore that forgot it would erase every trail in the
    // world at the moment of loading.
    features: engine.world.features.serialize(),
    // Persistent social groups (PLAN-SPECIES.md §3.8). Unlike the herd label,
    // which propagates back out of the entities' positions on the first tick
    // after a load, a group record is state in its own right: nothing about who
    // belongs to which clan is derivable from where anyone is standing.
    groups: engine.world.groups.serialize(),
    // The report itself is derived and recomputed on the next metrics tick;
    // only the bounded history is stored, so a chart survives a restore.
    metricsHistory: engine.world.metricsHistory,
    vegetation: engine.world.vegetation.serialize(),
    scent: engine.world.scent.serialize(),
    events: engine.events.serialize(),
    pendingCommands: engine.commands.serialize(),
    systems: engine.scheduler.describeSystems(),
  });
}

/**
 * Refuse a save containing a species this build has never heard of.
 *
 * ⚠ **Save compatibility is asymmetric, and the failing half used to fail
 * silently.** Adding a species is compatible — a save stores `speciesId` and the
 * registry resolves it at load. Renaming or removing one is not: every system
 * reads biology through `world.species.get(id)`, which returns `null` for an
 * unknown id, and the `?? this` fallbacks that make an unknown species harmless
 * in a unit test make it *catastrophic* here. The animal keeps its saved mass and
 * age but silently reverts to global-config metabolism, hydration, aging,
 * perception and diet — a restored run that continues with different physics and
 * no error anywhere.
 *
 * A rename is coming (the species roster becomes an African savanna guild), so
 * this converts that from a silent wrong-physics bug into a message naming the
 * ids at fault. Checked once at restore, over the saved entity array — not in any
 * hot path.
 */
function assertKnownSpecies(engine, saved) {
  const unknown = new Set();
  const check = (id) => {
    // Carcasses keep the speciesId of what they were, so they are checked too:
    // a body still resolves its species for edible mass and lineage.
    if (id != null && !engine.species.get(id)) unknown.add(id);
  };
  // ⚠ `saved.entities` is the EntityManager's record — `{ nextId, entities,
  // pendingSpawns, pendingRemovals }` — not the array its name suggests. The
  // deferred queues are part of the save (an animal born on the tick it was
  // captured lives there), so they are checked too.
  for (const entity of saved.entities?.entities ?? []) check(entity?.speciesId);
  for (const spawn of saved.entities?.pendingSpawns ?? []) check(spawn?.definition?.speciesId);
  // ⚠⚠ **And the third place a species id can hide: a queued `entity.spawn`
  // command** (2026-08-09, **A99**). This guard checked two of the three and the
  // gap was invisible because it fails the way the guard exists to prevent — a
  // save whose *pending command* names an unknown species restored without a
  // murmur, then spawned an animal with no biology on the next tick. That is
  // precisely the "different physics and no error anywhere" this function is
  // written to refuse, arriving through the one door it did not check.
  //
  // ⚠ The queue entry is `{ command, entityId }` and the id sits at
  // `command.entity.speciesId` — a different shape from `pendingSpawns` above,
  // which is `{ id, definition }`. Two shapes for one concept is exactly how the
  // third door went unnoticed.
  for (const entry of saved.pendingCommands ?? []) check(entry?.command?.entity?.speciesId);
  if (unknown.size > 0) {
    throw new Error(
      `save references unknown species: ${[...unknown].sort().join(', ')} ` +
        `(known: ${engine.species.ids().join(', ')}). Restoring would silently fall back to global config defaults.`,
    );
  }
}

/**
 * Restore a save into an engine that was constructed with the saved seed and
 * config and already has the same systems registered.
 * @param {SimulationEngine} engine
 * @param {ReturnType<typeof captureSimulationState>} saved
 * @returns {SimulationEngine} the same engine, restored
 */
export function restoreSimulationState(engine, saved) {
  if (saved?.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(`unsupported save format version: ${saved?.formatVersion} (expected ${SAVE_FORMAT_VERSION})`);
  }
  if (engine.simulationId !== saved.simulationId || engine.seed !== saved.seed) {
    throw new Error('engine identity does not match the save (construct it with the saved seed and simulationId)');
  }
  const currentSystems = JSON.stringify(engine.scheduler.describeSystems());
  const savedSystems = JSON.stringify(saved.systems);
  if (currentSystems !== savedSystems) {
    throw new Error('registered systems do not match the save; deterministic continuation is not possible');
  }
  assertKnownSpecies(engine, saved);
  engine.clock.setTick(saved.tick);
  engine.restoreRandomStreams(saved.randomStreams);
  engine.world.entities.restore(saved.entities);
  engine.world.restoreTombstones(saved.tombstones);
  if (saved.environment) {
    engine.world.environment = { ...saved.environment };
    // ⚠ A world restored mid-dry-season has a drained map, and it has to have it
    // *before* anything reads a cell rather than from the first tick onward.
    // `WeatherSystem` would set this on its next update, but a caller is entitled
    // to inspect a restored world without stepping it — and a save/load round trip
    // that reported different terrain for one tick is exactly the kind of drift
    // §12 exists to prevent. The season is a pure function of the saved tick, so
    // nothing extra is stored for this.
    engine.world.setSeason(saved.environment.season);
  }
  engine.world.disturbances = (saved.disturbances ?? []).map((d) => ({ ...d }));
  engine.world.nextDisturbanceId = saved.nextDisturbanceId ?? 1;
  engine.world.features.restore(saved.features);
  engine.world.groups.restore(saved.groups);
  engine.world.metricsHistory = saved.metricsHistory ? structuredClone(saved.metricsHistory) : [];
  engine.world.metrics = null; // derived; the next metrics tick rebuilds it
  engine.world.rebuildSpatialIndex();
  engine.world.vegetation.restore(saved.vegetation);
  engine.world.scent.restore(saved.scent);
  engine.events.restore(saved.events);
  engine.commands.restore(saved.pendingCommands);
  return engine;
}

/**
 * Convenience: construct an engine from a save, register systems, restore.
 * @param {ReturnType<typeof captureSimulationState>} saved
 * @param {object} options
 * @param {(engine: SimulationEngine) => void} options.registerSystems must
 *        register exactly the systems that were registered when saving
 */
export function createEngineFromSave(saved, { registerSystems }) {
  const engine = new SimulationEngine({
    seed: saved.seed,
    config: saved.config,
    simulationId: saved.simulationId,
  });
  registerSystems?.(engine);
  return restoreSimulationState(engine, saved);
}
