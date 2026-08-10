/**
 * Deterministic demo fixture: a small world with generic wandering animals,
 * seeded terrain, and a cell-level vegetation biomass field, driven by the
 * temporary scaffolding systems plus vegetation regrowth. Used by the server,
 * the headless script, the renderer fixture generator, and the tests. Same
 * seed ⇒ same world, always.
 *
 * Vegetation is now the cell biomass layer, not plant entities — the earlier
 * inert `demo.grass` entities were removed in Step 3.
 */
import { SimulationEngine } from '../simulation/engine/SimulationEngine.js';
import { PerceptionSystem } from '../simulation/systems/PerceptionSystem.js';
import { DecisionSystem } from '../simulation/systems/DecisionSystem.js';
import { MovementSystem } from '../simulation/systems/MovementSystem.js';
import { FeedingSystem } from '../simulation/systems/FeedingSystem.js';
import { HydrationSystem } from '../simulation/systems/HydrationSystem.js';
import { MetabolismSystem } from '../simulation/systems/MetabolismSystem.js';
import { AgingSystem, bodyMassForAge, lifeStageForAge } from '../simulation/systems/AgingSystem.js';
import { ReproductionSystem } from '../simulation/systems/ReproductionSystem.js';
import { ParentingSystem } from '../simulation/systems/ParentingSystem.js';
import { VegetationSystem } from '../simulation/systems/VegetationSystem.js';
import { MemorySystem } from '../simulation/systems/MemorySystem.js';
import { HuntingSystem } from '../simulation/systems/HuntingSystem.js';
import { InjurySystem } from '../simulation/systems/InjurySystem.js';
import { CarcassSystem } from '../simulation/systems/CarcassSystem.js';
import { WeatherSystem } from '../simulation/systems/WeatherSystem.js';
import { MetricsSystem } from '../simulation/systems/MetricsSystem.js';
import { SocialSystem } from '../simulation/systems/SocialSystem.js';
import { GroupSystem } from '../simulation/systems/GroupSystem.js';
import { MigrationSystem } from '../simulation/systems/MigrationSystem.js';
import { HerdConsensusSystem } from '../simulation/systems/HerdConsensusSystem.js';
import { DisturbanceSystem } from '../simulation/systems/DisturbanceSystem.js';
import { EngineeringSystem } from '../simulation/systems/EngineeringSystem.js';
import { TerritorySystem } from '../simulation/systems/TerritorySystem.js';
import { DiseaseSystem } from '../simulation/systems/DiseaseSystem.js';
import { infect } from '../simulation/disease/disease.js';
import { getSpecies } from '../simulation/config/species/index.js';
import { defaultSimulationConfig } from '../simulation/config/defaultSimulationConfig.js';
import { FOUNDING_ROLE_ALIASES } from '../protocol/commands.js';
import { sampleGenome, expressGenome } from '../simulation/traits/genetics.js';
import { Sexes } from '../simulation/mating/mateChoice.js';
import { createEngineFromSave } from '../simulation/persistence/SimulationSerializer.js';

const TWO_PI = Math.PI * 2;

/**
 * Register the demo systems. Restoring a demo save requires registering
 * exactly these systems, so keep this the single source. Execution order is
 * decided by the scheduler (phase → priority → id), not registration order.
 * @param {SimulationEngine} engine
 */
export function registerDemoSystems(engine) {
  const { growthRate, seedFloor, diebackRate, updateInterval } = engine.config.vegetation;
  engine.registerSystem(new WeatherSystem(engine.config.environment));
  engine.registerSystem(new VegetationSystem({ growthRate, seedFloor, diebackRate, updateInterval }));
  // Priority 10 in `environment`: after weather (-10), before vegetation growth
  // (0), so a fire burns the field before the same tick regrows it.
  engine.registerSystem(
    new DisturbanceSystem({
      ...engine.config.disturbance,
      edibleMassFraction: engine.config.metabolism.edibleMassFraction,
      maxMemories: engine.config.memory.maxMemories,
    }),
  );
  // Priority 20 in `environment`: last of the environment systems, and before
  // the `movement` phase whose results it reads next tick.
  engine.registerSystem(new EngineeringSystem(engine.config.engineering));
  // Elevation (phase T2) is wired from `config.climbing`, its one home, into the
  // one system that writes the field. See `locomotion/climbing.js`.
  engine.registerSystem(
    new PerceptionSystem({
      ...engine.config.perception,
      // Whether a hidden calf on sheltering ground is invisible to a hunter
      // (PLAN-SPECIES.md §3.14). Wired from `config.parenting`, its one home, and
      // read by this system and the decision system — ⚠ **not** expressible as
      // `aging.hiddenUntil: 0`, which a species overrides (DOCS §8).
      neonatalConcealment: engine.config.parenting.concealment,
      // Cover concealment (PLAN-SPECIES.md §3.12, phase 14): how far away an
      // animal standing in brush can still be picked out. ⚠ A *different*
      // mechanism from the line above — that one is the hidden calf — and from a
      // different config section, which is why both are named in full here.
      coverConcealment: engine.config.concealment.enabled,
      coverConcealmentStrength: engine.config.concealment.strength,
      // ⚠⚠ **The floor on the shared neighbour walk** (BEHAVIOR-PLAN P0), and the
      // two numbers in it are the reason it exists: the alarm and the join range
      // are **world-level** radii, so a species whose eyes are shorter than either
      // would send `SocialSystem` or `GroupSystem` off to walk the grid a second
      // time — the exact cost §1.4 C6 removed (+26 ms/tick at large-5k). Wired
      // from the sections that own them rather than restated, so there is no
      // second copy to drift (D11), and it is inert for today's roster because
      // every shipped species already senses at least six cells.
      minNeighbourRadius: Math.max(engine.config.social.alarmRadius, engine.config.groups.joinRadius),
      // ⚠ Per-species herd radius (P1), from `config.social` — the same switch
      // `SocialSystem` gets below, wired to both systems so that off means "does
      // not happen" rather than "happens and is ignored". One is what the walk
      // costs, the other is what reads it.
      perSpeciesRadius: engine.config.social.perSpeciesRadius,
    }),
  );
  engine.registerSystem(new MemorySystem(engine.config.memory));
  // Runs at priority -10 in the `decision` phase, i.e. ahead of the decision
  // system, which consumes the group summary it builds.
  engine.registerSystem(
    new SocialSystem({
      ...engine.config.social,
      // Heterospecific association (PLAN-SPECIES.md §3.16, phase 12). Both
      // switches from `config.association`, the global section that owns them —
      // ⚠ *not* from a species block, which a species overrides (DOCS §8). The
      // per-species half is the `association` field (the gazelle and, since P3,
      // the wildebeest) and the `associationPull` beside it.
      associationEnabled: engine.config.association.enabled,
      associationSharesAlarm: engine.config.association.sharesAlarm,
      // The third switch (BEHAVIOR-PLAN P3): whether a declared `associationPull`
      // reaches the distance an animal tolerates from mixed company. Same section,
      // same reason.
      associationScalesPull: engine.config.association.scalesPull,
    }),
  );
  // Priority -8: after the herd labels are settled, before anything that would
  // score an action on membership. ⚠ Different mechanism from the line above —
  // `SocialSystem` owns the positional label, this owns the persistent record
  // (PLAN-SPECIES.md §3.8). Skipped entirely when disabled, which is the
  // reproducible control the first clan-forming species will be measured
  // against. Inert either way today: no shipped species forms persistent groups,
  // so the system returns on its first branch every tick.
  if (engine.config.groups.enabled) {
    engine.registerSystem(new GroupSystem(engine.config.groups));
  }
  // Priority -5: after sociality, still ahead of the decision system. It writes
  // no action — only the drift the decision system folds into a wander. Skipped
  // entirely when migration is disabled, which (with `disperses` below) is the
  // Step 25 control the step was measured against.
  if (engine.config.migration.enabled) {
    engine.registerSystem(
      new MigrationSystem({
        ...engine.config.migration,
        // Grass maturity and habitat (phase 9). Both cues are scored inside this
        // system, and both switches are wired from the global sections that own
        // them — ⚠ *not* from a species block, which a species overrides (DOCS §8).
        // The forage half rescores the existing gradient; the habitat half is a
        // third drift through the same `migrationHeading` field.
        foragePreference: engine.config.forage.enabled,
        forageQualityFloor: engine.config.forage.qualityFloor,
        habitatPreference: engine.config.habitat.enabled,
        habitatBiasWeight: engine.config.habitat.biasWeight,
        habitatCueReference: engine.config.habitat.cueReference,
        // The wet-versus-dry axis of the habitat cue (2026-08-09). Its switch is
        // `config.wetness.enabled`, the same one that decides whether the field
        // exists at all — so turning wetness off restores the pre-wetland world in
        // one place rather than two, for the vegetation and the animals alike.
        wetnessPreference: engine.config.wetness.enabled,
      }),
    );
  }
  // Priority -3: after the migration drift has settled (-5), so the consensus
  // aggregates a finished number, and before the decision system (0), the only
  // consumer. ⚠ Skipped entirely when disabled, which is the reproducible control —
  // and it is byte-identical the other way too, since every species but the
  // wildebeest and the buffalo declares `behavior.consensusWeight: 0` and is never
  // touched. See `social/consensus.js`.
  if (engine.config.consensus.enabled) {
    engine.registerSystem(new HerdConsensusSystem(engine.config.consensus));
  }
  engine.registerSystem(
    new DecisionSystem({
      // ⚠ **Two config sections, one system.** `behavior` is what an animal
      // wants (a species block, resolved per-animal inside the system);
      // `decision` is the machinery of choosing (global). Both are spread here
      // because the system's own fields are the fallback for an animal whose
      // species is unknown — see the note above `behavior` in the config.
      ...engine.config.decision,
      ...engine.config.behavior,
      // Values that live in *another* species block and are read per-species at
      // decision time. Wired from their real home so there is no second copy to
      // drift (D11) — the system's copy is only the unknown-species fallback.
      foodMinLevel: engine.config.perception.foodMinLevel,
      // ⚠⚠ **The herd's packing floor** (2026-08-06), from `config.social` — the
      // section that owns the cohesion radius whose partner it is — and from
      // `config.locomotion`, which owns the cap it is derived from. Two sections,
      // one number, wired from both real homes rather than restated (D11): the
      // floor is meaningless without the cap, and the cap is not this system's to
      // define. ⚠ It is already spread in as part of `config.decision`'s
      // `maxOccupantsPerCell` below; this line is the *slack*, which is the half
      // that can be switched off for a control arm.
      herdPackingSlack: engine.config.social.herdPackingSlack,
      // Forage guilds (PLAN-SPECIES.md §3.3): whether `eat` and `seekFood` are
      // discounted by how well a cell's grass maturity suits the species, and how
      // little the worst-matched grass is worth. From `config.forage`, which is
      // global precisely so the off switch cannot be overridden by a species.
      foragePreference: engine.config.forage.enabled,
      forageQualityFloor: engine.config.forage.qualityFloor,
      // Kill caching (phase T3) — the switch, from `config.climbing`.
      caching: engine.config.climbing.enabled && engine.config.climbing.caching,
      // Flight (phase F1) — the switch, from `config.flight`, wired into the one
      // system that writes `entity.flying`. ⚠ Nothing else is wired: movement,
      // perception, metabolism and predation all read the *flag*, not the switch,
      // so there is exactly one place the mechanism can be turned off and no
      // second copy of the question to drift (D11). Off, `flying` is written
      // `false` every tick for every animal and every reader is the identity.
      flight: engine.config.flight.enabled,
      drinkRange: engine.config.hydration.drinkRange,
      // ⚠ The distance `seekMate` stops at, from `config.reproduction` — the same
      // number `ReproductionSystem` pairs within, wired rather than restated (D11).
      matingRange: engine.config.reproduction.matingRange,
      // ⚠ **From `config.migration`, not `config.decision`** (2026-08-06, A71),
      // even though the line it acts on lives in this system: it is a property of
      // the migration cue — how much of the drift is read — and it belongs beside
      // `biasWeight` and `waterBiasWeight`, which bound the same drift at the other
      // end. One mechanism, one config section, one place to switch it off.
      holdBiasScale: engine.config.migration.holdBiasScale,
      carcassRange: engine.config.feeding.carcassRange,
      // Carcass possession lives in `config.carcass` and is read by two systems
      // — this one asks whether a body is worth walking to, the feeding system
      // whether it may be eaten. One config home, two wired readers, exactly as
      // `foodMinLevel` is wired into both perception and decision.
      possessionEnabled: engine.config.carcass.possessionEnabled,
      possessionRange: engine.config.carcass.possessionRange,
      possessionShare: engine.config.carcass.possessionShare,
      // Numbers at a carcass (P7). ⚠ Wired into **both** readers — the decision
      // system asking whether a body is worth walking to and the feeding system
      // asking whether it may be eaten — because a body that reads as food to one
      // and is refused by the other leaves an animal choosing `eat` and starving on
      // the spot (D11, and the reason `isAvailableTo` exists at all).
      possessionBackingEnabled: engine.config.carcass.possessionBackingEnabled,
      possessionBackingRange: engine.config.carcass.possessionBackingRange,
      // Cooperative action (PLAN-SPECIES.md §3.7, phase 10). Two switches from
      // the two global sections that own them — ⚠ *not* from `hunting` or
      // `behavior`, which are species blocks a species overrides, so a switch
      // inside one is not a switch (DOCS §8). This system reads the joining half
      // of cooperation and the whole trigger for mobbing; `HuntingSystem` below
      // reads the halves that change the odds.
      cooperationEnabled: engine.config.cooperation.enabled,
      cooperationJoinRange: engine.config.cooperation.joinRange,
      // Coordinated stalking (PREDATOR-PLAN P4), from the same global section and
      // for the same reason: these are the rules of the mechanism, not biology a
      // species gets to differ on.
      cooperationJoinStalks: engine.config.cooperation.joinStalks,
      cooperationApproachSpread: engine.config.cooperation.approachSpread,
      cooperationApproachRadius: engine.config.cooperation.approachRadius,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingMinMobbers: engine.config.mobbing.minMobbers,
      mobbingRange: engine.config.mobbing.range,
      // The charge and the pursuit after it (BEHAVIOR-PLAN P9), from
      // `config.charge` — a third global section for the same reason as the two
      // above. ⚠ Everything wired here is a **bound**: the stamina a defender keeps
      // back and the longest a pursuit may run. The biology (`behavior.chargeWeight`
      // / `pursuitTicks`) is per-species and is 0 for everything but the buffalo.
      chargeEnabled: engine.config.charge.enabled,
      chargeStaminaFraction: engine.config.charge.staminaFraction,
      maxPursuitTicks: engine.config.charge.maxPursuitTicks,
      // Neonatal concealment (PLAN-SPECIES.md §3.14): the `tend` action asks
      // whether a mother is close enough to feed her hidden calf and whether she
      // has anything to give, and both answers belong to `ParentingSystem`. Wired
      // from their one home rather than restated, exactly as `drinkRange` is.
      provisionRange: engine.config.parenting.provisionRange,
      parentMinEnergyFraction: engine.config.parenting.parentMinEnergyFraction,
      neonatalConcealment: engine.config.parenting.concealment,
      // Weather machinery: the °C thresholds stay global, and `shelterRelief` is
      // shared with metabolism through the `thermalStress` chokepoint so the
      // system that charges for stress and the one that walks out of it cannot
      // drift. (`shelterWeight` itself moved into `behavior`.)
      shelterStressThreshold: engine.config.locomotion.shelterStressThreshold,
      shelterStressSpan: engine.config.locomotion.shelterStressSpan,
      shelterRelief: engine.config.locomotion.shelterRelief,
      reproduction: {
        minEnergyFraction: engine.config.reproduction.minEnergyFraction,
        cooldownTicks: engine.config.reproduction.cooldownTicks,
        suitorMinEnergyFraction: engine.config.reproduction.suitorMinEnergyFraction,
        suitorCooldownTicks: engine.config.reproduction.suitorCooldownTicks,
        breedingWindow: engine.config.reproduction.breedingWindow,
      },
      // Seasonal breeding (PLAN-SPECIES.md §3.11, phase 12): whether a species'
      // declared window gates its females' readiness. From `config.breeding`,
      // which is global precisely so a species cannot override the switch — the
      // window itself is read per-species from the `reproduction` block above.
      breedingEnabled: engine.config.breeding.enabled,
      // Cover concealment (PLAN-SPECIES.md §3.12, phase 14): the *approach* half,
      // which is a heading rule inside the `stalk` this system already had. The
      // detection half is wired into `PerceptionSystem` above. ⚠ Two switches:
      // `enabled` turns the whole mechanism off, `approach` turns off only this
      // half, so the two can be measured apart.
      coverConcealment: engine.config.concealment.enabled && engine.config.concealment.approach,
      // Obstacle deflection (2026-08-01): this system now *probes* a step before
      // committing a directed heading, and the probe has to ask the movement
      // system's own question or an animal deflects onto a heading that system
      // then refuses. The rule itself lives in `locomotion/steps.js` with one
      // home and two readers; these are its inputs, wired from where they
      // actually live rather than restated (D11), exactly as `drinkRange` and
      // `carcassRange` are above.
      maxOccupantsPerCell: engine.config.locomotion.maxOccupantsPerCell,
      sprintMultiplier: engine.config.locomotion.sprintMultiplier,
      injurySpeedPenalty: engine.config.injury.speedPenalty,
      diseaseSpeedPenalty: engine.config.disease.speedPenalty,
    }),
  );
  engine.registerSystem(
    new MovementSystem({
      ...engine.config.locomotion,
      injurySpeedPenalty: engine.config.injury.speedPenalty,
      diseaseSpeedPenalty: engine.config.disease.speedPenalty,
      // Elevation (phase T2). ⚠ From `config.climbing`, not `config.locomotion`:
      // it is its own mechanism with its own reproducible control, and folding
      // it into the locomotion block would have put the switch one merge away
      // from a species being able to override it.
      climbing: engine.config.climbing.enabled,
      // One reach, two readers: what a carnivore can eat from is what it can
      // drag (D11 — the same reason `carcassRange` has one home).
      cacheHaulReach: engine.config.feeding.carcassRange,
    }),
  );
  engine.registerSystem(
    new FeedingSystem({
      ...engine.config.feeding,
      referenceMass: engine.config.metabolism.referenceMass,
      massScalingExponent: engine.config.metabolism.massScalingExponent,
      injuryFeedPenalty: engine.config.injury.feedPenalty,
      diseaseFeedPenalty: engine.config.disease.feedPenalty,
      maxMemories: engine.config.memory.maxMemories,
      possessionEnabled: engine.config.carcass.possessionEnabled,
      possessionRange: engine.config.carcass.possessionRange,
      possessionShare: engine.config.carcass.possessionShare,
      // Numbers at a carcass (P7). ⚠ Wired into **both** readers — the decision
      // system asking whether a body is worth walking to and the feeding system
      // asking whether it may be eaten — because a body that reads as food to one
      // and is refused by the other leaves an animal choosing `eat` and starving on
      // the spot (D11, and the reason `isAvailableTo` exists at all).
      possessionBackingEnabled: engine.config.carcass.possessionBackingEnabled,
      possessionBackingRange: engine.config.carcass.possessionBackingRange,
      possessionEscalationChance: engine.config.carcass.possessionEscalationChance,
      possessionFightSeverity: engine.config.carcass.possessionFightSeverity,
      possessionWinnerInjuryFraction: engine.config.carcass.possessionWinnerInjuryFraction,
      injuryHealthDamage: engine.config.injury.healthDamage,
    }),
  );
  engine.registerSystem(
    new ReproductionSystem({
      ...engine.config.reproduction,
      // The window is per-species (`reproduction.breedingWindow`, resolved inside
      // the system); this is only the world-level switch, from the one section
      // that a species cannot override (PLAN-SPECIES.md §3.11).
      breedingEnabled: engine.config.breeding.enabled,
      birthMass: engine.config.aging.birthMass,
      genetics: engine.config.genetics,
      injuryHealthDamage: engine.config.injury.healthDamage,
    }),
  );
  engine.registerSystem(
    new HuntingSystem({
      ...engine.config.hunting,
      preyInjuryChance: engine.config.injury.preyInjuryChance,
      preyInjurySeverity: engine.config.injury.preyInjurySeverity,
      predatorInjuryChance: engine.config.injury.predatorInjuryChance,
      predatorInjurySeverity: engine.config.injury.predatorInjurySeverity,
      injuryHealthDamage: engine.config.injury.healthDamage,
      maxMemories: engine.config.memory.maxMemories,
      // From `config.predation`, its one home. The hunting system only needs the
      // risk cap; the mass ratios are read per-species by perception.
      riskyMassRatio: engine.config.predation.riskyMassRatio,
      // Cooperative action, the odds half (phase 10): how many other hunters
      // count as being in on this kill, and how far around the prey a mob is
      // gathered from. The weights themselves are per-species —
      // `hunting.cooperationWeight` here and `behavior.mobWeight` in the decision
      // system — and both are 0 for every species in this world.
      cooperationEnabled: engine.config.cooperation.enabled,
      cooperationRange: engine.config.cooperation.range,
      mobbingEnabled: engine.config.mobbing.enabled,
      mobbingRange: engine.config.mobbing.range,
    }),
  );
  engine.registerSystem(
    new ParentingSystem({ ...engine.config.parenting, disperses: engine.config.migration.enabled }),
  );
  // After movement (so it marks where the animal actually ended up) and after
  // hunting and mating (so a fight over ground cannot pre-empt one over a mate).
  engine.registerSystem(
    new TerritorySystem({ ...engine.config.territory, injuryHealthDamage: engine.config.injury.healthDamage }),
  );
  engine.registerSystem(
    new MetabolismSystem({
      ...engine.config.metabolism,
      staminaRecoveryPerTick: engine.config.locomotion.staminaRecoveryPerTick,
      thermalCostFactor: engine.config.locomotion.thermalCostFactor,
      shelterRelief: engine.config.locomotion.shelterRelief,
      // ⚠ One threshold for two readers (2026-08-01): the stress at which an
      // animal walks to cover is the stress at which an energy death reads as
      // exposure. They were two config fields at 2 °C and 0.35 °C, and the gap
      // was 127 709 animal-ticks of a label with no behaviour behind it.
      shelterStressThreshold: engine.config.locomotion.shelterStressThreshold,
      exposureFrailty: engine.config.locomotion.exposureFrailty,
      exposureFloorFraction: engine.config.locomotion.exposureFloorFraction,
    }),
  );
  engine.registerSystem(new HydrationSystem({ ...engine.config.hydration, maxMemories: engine.config.memory.maxMemories }));
  engine.registerSystem(new InjurySystem(engine.config.injury));
  engine.registerSystem(new DiseaseSystem(engine.config.disease));
  engine.registerSystem(new CarcassSystem(engine.config.carcass));
  // Adult mass comes from the species; the rest of the life curve from config.
  // No species' `adultMass` is baked in any more (Step 29, §1.4 A17): the
  // aging system reads each animal's own species block, and the config values
  // it is constructed with are only the fallback for an unknown species.
  engine.registerSystem(new AgingSystem(engine.config.aging));
  engine.registerSystem(new MetricsSystem(engine.config.metrics));
}

/**
 * A passable position for a founding animal (§1.4 C1). Births have always
 * placed newborns on passable cells; founders used to be able to start inside
 * rock and walk out via the movement guard. Rejection sampling keeps the draw
 * order deterministic; the deterministic scan is the fallback for a world with
 * almost no open ground.
 * @param {SimulationEngine} engine
 * @param {import('../simulation/random/SeededRandom.js').SeededRandom} random
 */
function passableSpawnPosition(engine, random) {
  const { width, height } = engine.world;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const x = random.float(0, width);
    const y = random.float(0, height);
    if (engine.world.isPassableAt(x, y)) return { x, y };
  }
  for (let cellY = 0; cellY < engine.world.terrain.height; cellY += 1) {
    for (let cellX = 0; cellX < engine.world.terrain.width; cellX += 1) {
      if (engine.world.terrain.isPassable(cellX, cellY)) return { x: cellX + 0.5, y: cellY + 0.5 };
    }
  }
  throw new Error('the world has no passable cell to spawn on');
}

/**
 * A position within `spread` of a cluster anchor, for a founder placed in a
 * herd, pride, clan or roost rather than on its own (`config.cohorts`).
 *
 * The fallback is the anchor itself, which `passableSpawnPosition` already
 * proved passable — so the C1 invariant holds without a second global draw, and
 * a cluster anchored on a lake shore packs tight instead of spinning.
 *
 * @param {SimulationEngine} engine
 * @param {import('../simulation/random/SeededRandom.js').SeededRandom} random
 * @param {{x: number, y: number}} anchor
 * @param {number} spread
 * @param {number} attempts
 */
function positionNear(engine, random, anchor, spread, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    const angle = random.float(0, TWO_PI);
    // √u, not u: sampling the radius uniformly would pile the cluster onto its
    // own centre, because a disc has more area further out.
    const radius = spread * Math.sqrt(random.float(0, 1));
    const x = engine.world.clampX(anchor.x + Math.cos(angle) * radius);
    const y = engine.world.clampY(anchor.y + Math.sin(angle) * radius);
    if (engine.world.isPassableAt(x, y)) return { x, y };
  }
  return { x: anchor.x, y: anchor.y };
}

/**
 * An anchor for a cluster, pushed away from this species' earlier anchors
 * (PREDATOR-PLAN P2).
 *
 * ⚠⚠ **One draw when it is off, and that is the whole of why the off arm is
 * byte-identical rather than merely equivalent.** With no separation asked for,
 * or with no earlier anchor to be far from, this is exactly the
 * `passableSpawnPosition` call it replaced and the `worldgen` stream sees the
 * same sequence.
 *
 * ⚠ **The fallback is the furthest candidate, not the first one.** The constraint
 * can be unsatisfiable — a small map, many clusters, or a separation larger than
 * the world — and a bounded rejection loop has to end somewhere. Ending on the
 * *first* draw would throw away the work; ending on the best of `attempts` still
 * spreads the clusters as far as the map allows and degrades smoothly instead of
 * falling off a cliff. ⚠ It costs a fixed `attempts` draws once the constraint
 * starts binding, which is why `cohorts.placementAttempts` bounds it.
 *
 * @param {SimulationEngine} engine
 * @param {import('../simulation/random/SeededRandom.js').SeededRandom} random
 * @param {{x: number, y: number}[]} previous this species' earlier anchors
 * @param {number} separation how far apart two of this species' clusters should be
 * @param {number} attempts rejection budget
 */
function separatedAnchor(engine, random, previous, separation, attempts) {
  const first = passableSpawnPosition(engine, random);
  if (!(separation > 0) || previous.length === 0) return first;
  const gapFrom = (point) => {
    let nearest = Infinity;
    for (const other of previous) nearest = Math.min(nearest, Math.hypot(point.x - other.x, point.y - other.y));
    return nearest;
  };
  let best = first;
  let bestGap = gapFrom(first);
  for (let i = 1; i < attempts && bestGap < separation; i += 1) {
    const candidate = passableSpawnPosition(engine, random);
    const gap = gapFrom(candidate);
    if (gap > bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * How this species' founders are arranged on the ground: its own `cohort` block
 * over `config.cohorts`, in the same direction every other per-species field
 * resolves (DOCS §8 — the species value wins, the config is the fallback).
 *
 * ⚠ `clustered` and `separated` are read from the config only and are never
 * taken from a species, because a species block beats the config and an "off" arm
 * living in one could not switch anything off.
 *
 * ⚠⚠ **`groupSize` may be *derived from the roster* rather than stated**
 * (PREDATOR-PLAN P2). A species that declares `preferredGroupSize` and `maxGroups`
 * gets its cluster size solved for the founder count instead:
 *
 *     clusters  = clamp(round(count / preferredGroupSize), 1, maxGroups)
 *     groupSize = ceil(count / clusters)
 *
 * which is the brief's rule exactly — **optimize for group size until the group
 * cap is reached, then optimize for group count.** At the hyena's 10 / 5 that is
 * 20 founders ⇒ 2 clans of 10, 30 ⇒ 3 of 10, 60 ⇒ 5 of 12, 100 ⇒ 5 of 20.
 *
 * ⚠ **A derived size can exceed the species' `groups.maxMembers`, and the
 * degradation is deliberate rather than clamped.** At 100 founders the rule asks
 * for clusters of 20 against a cap of 16; the registry enrols 16 and the surplus
 * founds records of its own, so the clan *count* rises past `maxGroups` at very
 * large rosters. Clamping the size instead would silently break the "3–5 clans"
 * half of the brief, and this way the failure is more clans rather than a crowd
 * of unattached animals. It binds on no roster this world ships.
 *
 * @param {object} species
 * @param {object} cohorts `config.cohorts`
 * @param {number} count how many founders of this species there are
 */
export function cohortShapeFor(species, cohorts, count = 1) {
  if (!cohorts?.clustered) return { groupSize: 1, spread: 0, attempts: 0, separation: 0 };
  const cohort = species.cohort ?? null;
  const preferred = cohort?.preferredGroupSize ?? null;
  let groupSize;
  if (preferred > 0) {
    const cap = Math.max(1, Math.floor(cohort?.maxGroups ?? 1));
    const clusters = Math.min(cap, Math.max(1, Math.round(count / preferred)));
    groupSize = Math.ceil(count / clusters);
  } else {
    groupSize = cohort?.groupSize ?? cohorts.groupSize ?? 1;
  }
  return {
    groupSize: Math.max(1, Math.floor(groupSize)),
    spread: Math.max(0, cohort?.spread ?? cohorts.spread ?? 0),
    attempts: Math.max(1, Math.floor(cohorts.placementAttempts ?? 1)),
    // ⚠ The switch is checked here rather than at the call site so that "off"
    // reaches `separatedAnchor` as a 0 and takes its single-draw path — one place
    // decides, and the off arm cannot drift from the on arm (D11).
    separation: cohorts.separated ? Math.max(0, cohort?.separation ?? cohorts.minClusterSeparation ?? 0) : 0,
  };
}

/**
 * Queue one founding cohort of a species. Every founder is an individual
 * (Step 14): its own adult size, speed, and temperament, resolved from the
 * species mean at creation.
 * @param {SimulationEngine} engine
 * @param {object} species
 * @param {number} count
 * @param {{position: Function, age: Function, genome: Function}} draw
 */
function spawnCohort(engine, species, count, draw) {
  for (let i = 0; i < count; i += 1) {
    const { x, y, heading, energyFraction } = draw.position();
    // Ages are spread across juvenile→adult so no cohort is synchronized;
    // body mass follows the growth curve toward this individual's adult size.
    const age = draw.age();
    // Founders have no parents, so their genome is sampled rather than
    // inherited (Step 20); every later generation descends from these.
    const genome = draw.genome();
    const traits = expressGenome(genome);
    const adultMass = species.bodyMass * traits.size;
    engine.world.entities.queueSpawn({
      kind: species.kind,
      speciesId: species.id,
      x,
      y,
      heading,
      age,
      genome,
      traits,
      // Founding sexes alternate rather than being drawn (Step 22). A founding
      // cohort is scenario setup, not biology — the same judgement that spreads
      // founder ages across life stages so no cohort is synchronized. Drawing
      // them would put an 8-strong predator cohort one unlucky seed away from a
      // sex ratio that cannot breed, which would be a measurement artifact and
      // not an ecological finding. Everything born in-world draws its sex.
      sex: i % 2 === 0 ? Sexes.FEMALE : Sexes.MALE,
      adultMass,
      // The species' own growth curve and life stages (Step 29). This used to
      // read the global `config.aging`, which is precisely how a stalker cub
      // came to be born at the grazer's birth mass (§1.4 A17).
      bodyMass: bodyMassForAge(age, { birthMass: species.aging.birthMass, adultMass, maturityAge: species.aging.maturityAge }),
      lifeStage: lifeStageForAge(age, species.aging),
      speed: species.baseSpeed * traits.speed,
      maxEnergy: species.maxEnergy,
      energy: species.maxEnergy * energyFraction,
      maxHealth: species.maxHealth,
      health: species.maxHealth,
      maxHydration: species.maxHydration,
      hydration: species.maxHydration, // start fully hydrated (no extra draw)
      maxStamina: species.maxStamina,
      stamina: species.maxStamina,
    });
  }
}

/**
 * Queue and flush the founding population, so the world exists at tick 0.
 *
 * ⚠ Where founders are put is not cosmetic: it is the *only* input the two
 * social mechanisms get before the first tick, and both read proximity.
 * `SocialSystem` recomputes each animal's herd label from neighbours within
 * `social.groupRadius`, and `GroupSystem` founds a persistent record from two
 * unattached conspecifics within `groups.joinRadius`. So a clustered cohort
 * (`config.cohorts`) is a herd on tick 1 and, for a species declaring
 * `groups.forms`, a real pride, clan or band on tick 1 — none of which this
 * file writes, or could write, itself.
 *
 * @param {SimulationEngine} engine
 */
function populateDemoWorld(engine) {
  const random = engine.randomStream('worldgen');
  // Initial ages and genomes come from their own streams, so adding either
  // never shifts the worldgen positions (which draw in a fixed order).
  const ageRandom = engine.randomStream('demogen.age');
  const geneRandom = engine.randomStream('genetics');

  const draw = (species, count) => {
    // Cluster state for *this* cohort, which is why it lives in the closure
    // `spawnCohort` is handed rather than beside the streams: a herd is a run of
    // consecutive founders sharing one anchor, and the run resets per species.
    const shape = cohortShapeFor(species, engine.config.cohorts, count);
    let anchor = null;
    let placed = 0;
    // ⚠ This species' anchors so far, so a new cluster can be pushed away from
    // them (P2). Per-species by construction — the closure is rebuilt for each
    // roster entry — which is the "same species only" half of the rule, obtained
    // from where the state already lived rather than from a filter.
    const anchors = [];
    return {
      position: () => {
        if (anchor === null || placed >= shape.groupSize) {
          anchor = separatedAnchor(engine, random, anchors, shape.separation, shape.attempts);
          anchors.push(anchor);
          placed = 0;
        }
        placed += 1;
        // ⚠ A cluster of one *is* its anchor, with no offset draw. So a species
        // that declares no `cohort` block is placed identically whether
        // clustering is on or off — which makes the leopard a null control
        // inside the on arm (§16 D40) rather than merely an untuned species.
        const { x, y } = shape.groupSize <= 1 ? anchor : positionNear(engine, random, anchor, shape.spread, shape.attempts);
        return {
          x,
          y,
          heading: random.float(0, TWO_PI),
          energyFraction: random.float(species.initialEnergyFraction.min, species.initialEnergyFraction.max),
        };
      },
      age: () => Math.floor(ageRandom.float(0, 1500)),
      // Per-species trait spread (Step 29, §1.4 A13): how widely individuals of
      // *this* species vary, rather than one spread applied to every animal in
      // the world.
      genome: () => sampleGenome(geneRandom, species.traits.spread),
    };
  };

  // The founding roster is scenario data, not code: a list of
  // `{ speciesId, count }` walked in order. Adding a species to the world is
  // therefore a config edit — which is the whole claim of this step, and is
  // what `test/species-schema.test.js` asserts by adding one.
  for (const { speciesId, count } of engine.config.demo.founding) {
    if (!(count > 0)) continue;
    const species = engine.species.require(speciesId);
    spawnCohort(engine, species, count, draw(species, count));
  }
  // Flush so the initial population exists at tick 0, with entity.created events.
  engine.applyDeferredEntityChanges(0);

  // Seed the outbreak (Step 25). One incubating animal is enough — the point is
  // that a disease *spreads*, not that it is handed out. Chosen by a dedicated
  // stream so adding it never shifted any other sequence, and deterministically
  // from the living population rather than by id, so it works whatever the
  // founding counts are.
  const { initialInfected, incubationTicks } = engine.config.disease;
  if (initialInfected > 0) {
    const patientRandom = engine.randomStream('disease.seed');
    const candidates = [...engine.world.entities.all()].filter((e) => e.kind === 'animal' && e.alive);
    for (let i = 0; i < initialInfected && candidates.length > 0; i += 1) {
      const index = Math.floor(patientRandom.float(0, candidates.length));
      const [patientZero] = candidates.splice(Math.min(index, candidates.length - 1), 1);
      infect(patientZero, 0, incubationTicks);
    }
  }
}

/**
 * ⚠ **Retired at protocol v29.** This used to be the bridge between a UI that
 * spoke in roles (`herbivores`, `predators`, `scavengers`) and a config keyed by
 * species id — a bijection that was only ever true by coincidence and that the
 * African roster breaks outright, since a hyena is both predator and scavenger.
 * The restart command now carries a `founding` roster and the host publishes its
 * species list, so nothing has to guess.
 *
 * What survives is the **alias map**, imported from the protocol where the
 * deprecated fields are defined, kept for exactly one version so a client still
 * sending v28 role counts is translated rather than broken. Delete both at v30.
 */

/**
 * Terrain-prevalence mapping. The restart panel offers `rocks` and `thickets` as
 * an abstract 0..MAX_TERRAIN_PREVALENCE level (DEFAULT_TERRAIN_PREVALENCE is the
 * demo's terrain); the generator wants a formation count. This is the one place
 * the two meet — the same shape as FOUNDING_ROLE_BY_SPECIES, keeping the UI and
 * protocol in "how much" while the config stays in "how many formations".
 *
 * The map is linear through the default: level DEFAULT_TERRAIN_PREVALENCE lands
 * on the counts below, level 0 clears the terrain, and the top of the scale is
 * several times the default — enough discs that, after they overlap, the type
 * dominates open ground.
 *
 * ⚠⚠ **These were derived from `defaultSimulationConfig.terrain` until
 * 2026-08-07, and they are now frozen literals.** The rule they used to serve was
 * "level 4 reproduces the demo's own terrain", which held by construction because
 * both ends read the same object. That rule is **retired**, and the reason is the
 * other promise this scale makes and the one that turned out to matter more: *a
 * stored preset must keep generating the terrain it was saved with.* Those two are
 * only compatible while the demo's counts move by a single uniform factor — when
 * the demo became `ngorongoro-500-10x` they all doubled, so moving the anchor 2 → 4
 * preserved every stored preset exactly. When the demo became `default-small`
 * (2026-08-07) rock and thicket went ×1.8 and the tree counts ×1.5, and **no single
 * anchor can absorb two factors**. Something had to give, and it is the rule that
 * only ever described the demo — a scale whose units shift under stored files is a
 * scale that does not measure anything.
 *
 * So this is now what its name says: the formation counts at level
 * DEFAULT_TERRAIN_PREVALENCE, fixed. `presets/ngorongoro-*.json` were saved at
 * level 4 against these numbers and still generate exactly this terrain;
 * `presets/default-small.json` was saved at 7/7/6 against them and still generates
 * exactly the 18/18/24/180 the demo now boots with. ⚠ The consequence to know is
 * that the demo's own terrain is **no longer at the default level** of the
 * renderer's dropdowns — booting the demo and then restarting with the dropdowns
 * untouched now yields a sparser world, which is the price of the units holding
 * still. `test/runner.test.js` asserts the fixed mapping in place of the old
 * demo-equality claim.
 *
 * ⚠ **`trees` is one level over two counts** — grove count and lone-tree count —
 * which is why the abstraction is worth having: the UI offers "how wooded", and
 * how that divides between woodland and scattered trees stays a modelling
 * decision the protocol never learns. Both scale together, so the *character* of
 * the woodland is constant across the scale and only its density changes.
 * @type {Record<'ridges'|'thickets'|'treeGroves'|'treeSingles', number>} config key → count at the default level
 */
const FORMATION_COUNT_AT_DEFAULT = Object.freeze({
  ridges: 10,
  thickets: 10,
  treeGroves: 16,
  treeSingles: 120,
});

/**
 * The level the scale is anchored at. Restated here rather than imported from
 * the protocol (fixtures speak the simulation's language, not the protocol's) —
 * it must match the protocol's DEFAULT_TERRAIN_PREVALENCE, which is what the
 * renderer's dropdowns default to.
 *
 * ⚠ 2 until 2026-08-04, when the demo became the denser ngorongoro world and its
 * four formation counts doubled; anchor and counts moved together so that a preset
 * stored at level 4 against the old defaults still generated the terrain it was
 * saved with. ⚠ It has **not** moved since, and as of 2026-08-07 it no longer
 * tracks the demo at all — see FORMATION_COUNT_AT_DEFAULT for why that stopped
 * being possible and what was chosen instead. Moving this number now is a breaking
 * change to every stored preset, which is precisely the property it is meant to
 * have.
 */
const DEFAULT_TERRAIN_PREVALENCE = 4;

/**
 * Translate an abstract prevalence level into a generator formation count,
 * linear through the default level. Rounded to a whole formation count; a level
 * of 0 yields 0 (the type is disabled).
 * @param {number} level 0..MAX_TERRAIN_PREVALENCE
 * @param {number} countAtDefault formation count at DEFAULT_TERRAIN_PREVALENCE
 * @returns {number}
 */
function formationCountForPrevalence(level, countAtDefault) {
  return Math.round((level / DEFAULT_TERRAIN_PREVALENCE) * countAtDefault);
}

/**
 * Translate the optional world-composition fields of a `simulation.restart`
 * command into a config override merged over the demo defaults. Every field is
 * optional: an omitted dimension or role count keeps the default. Bounds are
 * the protocol's responsibility (validated before this runs); this only maps.
 * @param {{width?: number, height?: number, founding?: Array<{speciesId: string, count: number}>,
 *          herbivores?: number, predators?: number, scavengers?: number,
 *          rocks?: number, thickets?: number, trees?: number, roundness?: number}} [options] `founding` is the v29
 *        roster; the three role counts are deprecated aliases (see below).
 * @returns {object} partial config for createDemoSimulation
 */
export function buildDemoConfig(options = {}) {
  const config = {};
  if (options.width !== undefined || options.height !== undefined) {
    config.world = {};
    if (options.width !== undefined) config.world.width = options.width;
    if (options.height !== undefined) config.world.height = options.height;
  }
  // Terrain prevalence maps to generator formation counts. `ridges` is rock's
  // formation count and `thickets` is the thicket count (see TerrainGrid); the
  // partial terrain block merges recursively over the defaults, so the other
  // terrain params are untouched.
  if (
    options.rocks !== undefined ||
    options.thickets !== undefined ||
    options.trees !== undefined ||
    options.roundness !== undefined ||
    options.smallLakes !== undefined ||
    options.streams !== undefined ||
    options.marsh !== undefined
  ) {
    config.terrain = {};
    if (options.rocks !== undefined) {
      config.terrain.ridges = formationCountForPrevalence(options.rocks, FORMATION_COUNT_AT_DEFAULT.ridges);
    }
    if (options.thickets !== undefined) {
      config.terrain.thickets = formationCountForPrevalence(options.thickets, FORMATION_COUNT_AT_DEFAULT.thickets);
    }
    // ⚠ One level, two counts — how a wooded world divides between groves and
    // scattered trees is a modelling decision, and it stays here rather than in
    // the protocol or the UI. Both scale together, so the *character* of the
    // woodland is constant across the scale and only its density changes.
    if (options.trees !== undefined) {
      config.terrain.treeGroves = formationCountForPrevalence(options.trees, FORMATION_COUNT_AT_DEFAULT.treeGroves);
      config.terrain.treeSingles = formationCountForPrevalence(options.trees, FORMATION_COUNT_AT_DEFAULT.treeSingles);
    }
    // ⚠ Passed straight through, *not* mapped. Rock and thicket prevalence are
    // abstractions over a generator count, so they need a translation; roundness
    // is already the setting itself on both sides of the protocol. Running it
    // through `formationCountForPrevalence` would be a translation between a
    // scale and itself.
    if (options.roundness !== undefined) {
      config.terrain.roundness = options.roundness;
    }
    // The v38 water features, passed through for the same reason `roundness` is:
    // a pond count is a pond count. ⚠ The one translation here is `marsh`, which
    // crosses the boundary as a whole **percent** — a dropdown offers percents,
    // and the generator takes a fraction, so the division belongs on this side
    // exactly like the prevalence mapping above it.
    if (options.smallLakes !== undefined) {
      config.terrain.smallLakes = options.smallLakes;
    }
    if (options.streams !== undefined) {
      config.terrain.streams = options.streams;
    }
    if (options.marsh !== undefined) {
      config.terrain.marshFraction = options.marsh / 100;
    }
  }
  // ⚠ **A roster replaces the whole default roster; role aliases patch it.**
  // The two are deliberately different operations. `founding` is what the world
  // should be founded with, full stop — a species omitted from it gets none,
  // because "leave out the wildebeest" has to be expressible. The deprecated
  // role fields cannot mean that: they only ever named three counts, so they
  // override those three counts within the default roster and leave the rest
  // alone, which is exactly what they did at v28.
  if (Array.isArray(options.founding)) {
    config.demo = { founding: options.founding.map(({ speciesId, count }) => ({ speciesId, count: count ?? 0 })) };
    return config;
  }
  const roles = Object.entries(FOUNDING_ROLE_ALIASES).filter(([role]) => options[role] !== undefined);
  if (roles.length > 0) {
    const bySpecies = new Map(roles.map(([role, speciesId]) => [speciesId, options[role]]));
    config.demo = {
      founding: defaultSimulationConfig.demo.founding.map(({ speciesId, count }) => ({
        speciesId,
        // `?? count` (not `|| count`) so an explicit 0 clears a species.
        count: bySpecies.get(speciesId) ?? count,
      })),
    };
  }
  return config;
}

/**
 * Create a fully initialized demo simulation.
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {object} [options.config] overrides merged over defaults
 * @returns {SimulationEngine}
 */
export function createDemoSimulation({ seed = 42, config = {} } = {}) {
  const engine = new SimulationEngine({ seed, config, simulationId: `demo-${seed >>> 0}` });
  registerDemoSystems(engine);
  populateDemoWorld(engine);
  return engine;
}

/**
 * Restore a demo simulation from a save produced by captureSimulationState.
 * @param {object} saved
 * @returns {SimulationEngine}
 */
export function restoreDemoSimulation(saved) {
  return createEngineFromSave(saved, { registerSystems: registerDemoSystems });
}
