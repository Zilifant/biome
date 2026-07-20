/**
 * Default simulation configuration. Configuration must stay plain,
 * JSON-serializable data — it is stored verbatim in save files.
 *
 * `demo` holds tuning for the temporary scaffolding systems and fixture; it
 * will be replaced by species/environment definitions as real systems land.
 */
export const defaultSimulationConfig = Object.freeze({
  world: Object.freeze({
    width: 128,
    height: 128,
    cellSize: 8,
  }),
  // Time model (see PLAN.md §3). The engine holds no timer; these values only
  // document the intended interpretation of a tick and never affect tick math.
  // One authoritative tick represents ~1 in-world minute, so a day is ~1440
  // ticks. The real-time runner ticks once per `runnerTickMs` at speed 1.
  time: Object.freeze({
    tickMinutes: 1,
    runnerTickMs: 1000,
  }),
  // Seeded terrain generation parameters (see world/TerrainGrid.js). Terrain
  // is derived deterministically from the engine seed + these params, so it is
  // regenerated on load rather than stored.
  terrain: Object.freeze({
    lakes: 1,
    lakeRadiusFraction: 0.14,
    ridges: 1,
    ridgeThickness: 2,
    coverPatchDensity: 1.5,
    coverPatchRadius: 3,
  }),
  // Cell-level vegetation biomass (see world/VegetationGrid.js). Seeded from
  // the engine seed; grows logistically toward terrain-derived capacity.
  vegetation: Object.freeze({
    capacity: 8,
    growthRate: 0.08,
    seedFloor: 0.08,
    initialFraction: 0.5,
    minFertility: 0.55,
    coverSuitability: 1.35,
    quantizeLevels: 4,
    // How fast biomass above the season's ceiling falls back to it (Step 19).
    // Scaling growth alone cannot brown off a field already at capacity.
    diebackRate: 0.04,
    updateInterval: 5, // regrowth runs every N ticks (staggered)
  }),
  events: Object.freeze({
    maxBufferedEvents: 5000,
  }),
  // Metabolism / bioenergetics (see systems/MetabolismSystem.js). Costs are in
  // energy units per tick; mass scaling normalizes by `referenceMass` so a
  // reference-mass animal at rest pays exactly `basalRate`. Global for now;
  // Step 29 can move these per-species alongside the species schema.
  metabolism: Object.freeze({
    basalRate: 0.04, // resting energy cost per tick for a reference-mass animal
    moveCostFactor: 0.02, // energy per unit distance for a reference-mass animal
    referenceMass: 30, // kg; massFactor = (bodyMass/referenceMass) ** massScalingExponent
    massScalingExponent: 0.75,
    lowEnergyFraction: 0.25, // energyFraction below this sets the low-energy flag
    edibleMassFraction: 0.6, // carcass edible mass = bodyMass × this
  }),
  // Local perception (see systems/PerceptionSystem.js). Animals sense within a
  // species radius (falling back to defaultRadius). `foodMinLevel` is the
  // quantized vegetation level that counts as food. `updateInterval` staggers
  // the (per-cell) scan for performance.
  perception: Object.freeze({
    defaultRadius: 5,
    foodMinLevel: 1,
    maxMateCandidates: 6, // bounded set of possible mates sensed (Step 22)
    updateInterval: 1,
  }),
  // Reproduction and mate choice (see systems/ReproductionSystem.js and
  // mating/mateChoice.js). A receptive female assesses the eligible males
  // within `matingRange` and takes the best one that clears the standard she is
  // currently holding; she gestates and gives birth after `gestationTicks`.
  // Nothing guarantees a replacement rate — births emerge from encounters,
  // choice, energy, and lifespan.
  reproduction: Object.freeze({
    matingRange: 2.0, // distance within which a female assesses the males present
    // Reproduction is deliberately expensive and slow: ~37 energy per offspring
    // and a ~2600-tick inter-birth interval against a ~5000-tick adult life.
    // These are cost parameters, not a population cap — with food abundant and
    // no predators yet (Step 16), the herbivore population still grows; cheaper
    // settings made it explode exponentially.
    minEnergyFraction: 0.8, // the gestating sex must be at least this full
    matingEnergyCost: 12, // energy each parent spends at mating
    gestationTicks: 800, // delay from mating to birth
    birthEnergyCost: 25, // extra energy the gestating parent spends at birth
    offspringEnergyFraction: 0.6, // newborn energy as a fraction of its max
    cooldownTicks: 1800, // ticks before the gestating sex may mate again
    // The seeking sex clears a much lower bar and recovers quickly, because it
    // pays for one mating rather than a pregnancy (Step 22). This asymmetry is
    // the whole basis of mate choice: it keeps most males available and most
    // females not, so it is females that males effectively compete for. Note
    // that it leaves the *birth rate* roughly where it was — the old rule
    // consumed both partners for a full cooldown to make one pregnancy, this
    // one consumes only the female.
    suitorMinEnergyFraction: 0.45,
    suitorCooldownTicks: 200,
    // Mate choice (see mating/mateChoice.js). A chooser insists on quality
    // `acceptanceThreshold × her choosiness`, declining linearly to zero over
    // `choosinessPatienceTicks`. 0.72 sits inside the band that healthy adults
    // actually score (roughly 0.6–0.8), which is what makes it discriminate
    // rather than accept or reject everyone; the decline is what makes
    // choosiness cost time instead of risking a population that never breeds.
    //
    // Both numbers are measured, over 15k ticks on five seeds, against a
    // control with choice switched off (`acceptanceThreshold: 0`):
    //
    //   choice off      5/5 seeds alive, grazers 138–247, mean size genotype
    //                   0.997 → 1.012, selection differential on size +0.004
    //                   among males and −0.001 among females
    //   patience 700    4/5 seeds alive, grazers  17–326, size → 1.035, S +0.012 / −0.002
    //   patience 400    5/5 seeds alive, grazers  75–351, size → 1.040, S +0.012 / −0.002
    //
    // So 400 is not a compromise — it selects just as hard as 700 (the trait
    // moves three times as far as the control either way) while leaving both
    // species alive in every seed rather than four of five. Being choosy for
    // longer bought nothing except a thinner margin. Note the signature in that
    // last column: the differential is positive among males and flat among
    // females, which is what sexual selection looks like when only one sex is
    // being chosen — natural selection would move both together.
    acceptanceThreshold: 0.72,
    choosinessPatienceTicks: 400, // ~22% of the female cooldown
    // Male–male competition (Step 23) — the other half of sexual selection.
    // Rivals in range of the same female contest for access; the stronger one
    // wins (dominance decides it, there is no roll), and the loser keeps away
    // for `contestCooldownTicks`. Escalation into an actual *fight* is the only
    // stochastic part, and is likeliest between evenly matched animals: a rival
    // twice your size is not worth bleeding for. Fights are the second source
    // of injuries after failed hunts (§1.4 A19).
    contestEscalationChance: 0.35,
    contestCooldownTicks: 60,
    fightInjurySeverity: 0.22, // milder than a predator's bite (0.35)
    fightWinnerInjuryFraction: 0.4, // winning a fight is not the same as being unhurt
    birthOffset: 1.0, // how far behind the parent the newborn appears
  }),
  // Territories and home ranges (see systems/TerritorySystem.js and
  // world/ScentGrid.js). Nothing here draws a boundary. A home range is a
  // running summary of where an animal has actually been (four numbers, no
  // occupancy history — the step's performance note rules that out), and a
  // territory is whatever ground it has marked most recently and most
  // strongly. Avoidance, conflict, territory loss, and the occupation of
  // vacated ground all fall out of that pair of mechanisms rather than being
  // modelled separately. Which species *defends* ground is species data
  // (`config/species/*`): grazers have ranges, stalkers hold territories.
  territory: Object.freeze({
    cellSize: 4, // world cells per claim cell — a territory is coarse-grained
    markInterval: 20, // ticks between an animal's marks
    markStrength: 0.35, // strength one mark writes (≈3 marks to hold a cell)
    decayPerTick: 0.0025, // ≈400 ticks for an unrenewed claim to fade out
    decayInterval: 10, // decay is staggered; the rate is compensated, not changed
    claimFloor: 0.05,
    disputeRange: 8, // how close an owner must be to answer an intruder
    disputeCooldownTicks: 120,
    // Fights over ground are milder than fights over mates: a resident that
    // yields loses its whole claim, which is punishment enough.
    contestEscalationChance: 0.3,
    fightInjurySeverity: 0.2,
    fightWinnerInjuryFraction: 0.4,
  }),
  // Disease (see disease/disease.js and systems/DiseaseSystem.js). A
  // compartmental model — susceptible → incubating → symptomatic → recovered —
  // whose one load-bearing choice is that **an incubating animal is infectious
  // and looks healthy**. If only visibly sick animals could transmit, the herd
  // would shun the one obvious case and an outbreak would be a non-event;
  // because the disease runs ahead of its own symptoms, avoidance is late by
  // construction and density is a real cost of the sociality Step 23 added.
  // Immunity wanes so outbreaks can recur instead of burning through once.
  disease: Object.freeze({
    transmissionRadius: 2.5, // contact range — tighter than perception
    transmissionChance: 0.02, // per susceptible contact per tick
    incubationTicks: 250, // infectious and invisible
    // Visibly ill: slow, feeding badly, infertile, shunned. This duration and
    // `feedPenalty` are the two numbers that decide what disease costs the
    // demo, and it is worth being clear that the cost is almost entirely
    // **sublethal** — measured over 15k ticks on five seeds, a run has 300+
    // infections and only 1–5 deaths *from* disease. What suppresses the
    // population is 200 ticks per case of feeding badly and not breeding.
    //
    //   disease off (control)          4/5 seeds alive, grazers 52–165
    //   400 ticks, feedPenalty 0.4     3/5, grazers 1–83   (too harsh)
    //   200 ticks, feedPenalty 0.3     4/5, grazers 7–75   (adopted)
    //
    // Adopted because it matches the control's 4/5 while still visibly
    // suppressing the population — a density-dependent pressure that bites
    // without breaking the demo, which is what the step asks for.
    symptomaticTicks: 200,
    immunityTicks: 3000, // then back into the susceptible pool
    mortalityPerTick: 0.0004, // chance a symptomatic animal simply dies
    sickHealthDrain: 0.03, // health lost per symptomatic tick (the usual route)
    // Baseline condition recovery (§1.4 A20). Wounds healed from Step 17 but
    // health lost to thirst never came back, so a once-thirsty animal carried
    // the damage for life while a mauled one mended. A step about recovering
    // from illness is the right home for the general case: a healthy, well-fed
    // animal now slowly regains health from *any* source of damage. Gated on
    // energy like injury healing, because mending is work.
    healthRecoveryPerTick: 0.02,
    recoveryEnergyFraction: 0.5,
    speedPenalty: 0.45, // speed lost while symptomatic (stacks with injury)
    feedPenalty: 0.3, // intake lost while symptomatic
    edibleMassFraction: 0.6,
    // How many animals start the demo already incubating. One is enough: the
    // point is that an outbreak *spreads*, not that it is seeded broadly.
    initialInfected: 1,
    // A fresh case from outside the population, roughly once every ~2900 ticks.
    // Without it the pathogen goes extinct with its last carrier: the seeded
    // outbreak peaked at 68 symptomatic around tick 1500, burned through by
    // 2500, and by 5500 every survivor's immunity had lapsed with nothing left
    // to catch — one epidemic in the demo's entire history. A standing
    // reservoir is what makes disease a recurring pressure, which is what the
    // step asks it to be.
    spilloverChance: 0.00035,
  }),
  // Sociality (see systems/SocialSystem.js and social/dominance.js). Herds are
  // a *label* propagated between neighbours, never a stored roster: animals in
  // sight of each other converge on the smallest group id around, so herds
  // merge and split without any structural operation. Alarm spreads one
  // neighbour-hop per tick, which is what makes a wave of panic cross a herd
  // visibly instead of the whole population reacting at once.
  //
  // Measured over 15k ticks on five seeds against a control with the social
  // *behaviours* switched off (`herdWeight` 0, `defendWeight` 0,
  // `hunting.defenderWeight` 0, `maxAlarmHops` 0):
  //
  //   sociality off   3/5 seeds with both species alive, grazers  0–320
  //                   (one seed lost the grazers outright), stalkers 4–23
  //   sociality on    5/5 seeds with both species alive, grazers 34–135,
  //                   stalkers 4–19
  //
  // The direction was not what I expected going in: herding gathers prey into
  // clusters a predator can find, which ought to *raise* predation. The net
  // measured effect is the opposite — sociality **stabilises** the system,
  // trading a much lower peak grazer population for never losing them. Both
  // halves of that are worth having; a demo that oscillates 0–320 is one bad
  // seed from an empty world.
  social: Object.freeze({
    groupRadius: 6, // how far conspecifics count each other as groupmates
    maxGroupSize: 12, // cap, so one label cannot swallow the population
    // Hops a label survives from its root. Not a size limit — it is what lets a
    // herd *split*: plain min-id propagation only moves labels downward, so the
    // half of a torn herd without the root would keep the old label forever.
    maxGroupHops: 3,
    minGroupSize: 2, // a lone animal is not a herd of one
    alarmRadius: 6, // how far panic carries per hop
    alarmTicks: 25, // how long an animal keeps running after being told
    // Hops a warning survives from whoever actually saw the predator. This is
    // the load-bearing number: without a cap, alarmed animals re-alarm the
    // neighbours who alarmed them and the panic becomes self-sustaining — the
    // first cut left 106 of 119 grazers permanently fleeing. At 2 hops the wave
    // reaches ~3 herd-radii from the sighting and then dies.
    maxAlarmHops: 2,
  }),
  // Season and weather (see world/Environment.js and systems/WeatherSystem.js).
  // The year is compressed exactly as lifespan is: a tick is ~1 in-world minute,
  // so a literal year would be 525,600 ticks and no demo run would ever reach
  // winter. At 8000 ticks a year, each season is 2000 ticks and an animal lives
  // roughly 1.5 years against the compressed `aging.maxAge`.
  environment: Object.freeze({
    ticksPerYear: 8000,
    spellTicks: 400, // how long one weather state holds before re-rolling
    meanTemperature: 14, // °C, annual mean
    // °C: summer peaks ~25, winter troughs ~3. Measured — at an amplitude of 14
    // the bare seasons alone pushed animals outside their comfort band all
    // winter and predators died out in 3 of 5 seeds; at 11 both species survive
    // in 4 of 5. It also models better: the *weather* is what bites (snow at
    // −6, drought at +5 on top of the season), rather than winter being
    // uniformly lethal.
    temperatureAmplitude: 11,
  }),
  // Carcasses and decay (see systems/CarcassSystem.js). A body is a resource on
  // a clock: it passes through decay stages, its flesh is worth less at each
  // one, and it leaves the world when it is either eaten clean or fully rotted.
  // Whatever mass is left when it goes returns to the cell as biomass, closing
  // the death→nutrient loop opened in Step 6.
  carcass: Object.freeze({
    decayTicks: 3000, // death to fully rotted (~2 in-world days)
    nutrientReturn: 0.5, // biomass returned per unit of remaining edible mass
    updateInterval: 5, // decay stages are coarse; no need to check every tick
  }),
  // Lineage across removal (see world/lineage.js). Carcasses are the first
  // things ever removed from the world, so parent/offspring references can now
  // point at something that is gone. The world remembers the recently dead so
  // a family tree stays readable, and says "forgotten" rather than failing
  // silently once a tombstone is evicted.
  lineage: Object.freeze({
    maxTombstones: 256,
  }),
  // Injury and healing (see injury/injuries.js and systems/InjurySystem.js).
  // A failed capture usually leaves the prey wounded rather than untouched, and
  // occasionally hurts the predator. A wound halves nothing on its own — it
  // scales speed and feeding by its severity — but because the hunting system
  // reads prey condition, being injured also makes an animal easier to catch.
  // Healing is slow and paid for in energy, and an animal too hungry to spare
  // it does not heal at all.
  injury: Object.freeze({
    healRatePerTick: 0.0015, // severity closed per tick (~230 ticks for a 0.35 wound)
    healEnergyCost: 20, // energy per unit of severity closed
    healEnergyFloor: 0.3, // below this energy fraction, no healing happens
    healthPerSeverity: 60, // health regained per unit of severity closed
    speedPenalty: 0.5, // speed lost at full impairment
    feedPenalty: 0.5, // intake lost at full impairment
    edibleMassFraction: 0.6,
    // Applied by the hunting system when a capture attempt fails.
    preyInjuryChance: 0.55,
    preyInjurySeverity: 0.35,
    predatorInjuryChance: 0.08, // scaled by how heavy the prey is
    predatorInjurySeverity: 0.25,
    healthDamage: 60, // health lost per unit of severity when the wound lands
  }),
  // Predation (see systems/HuntingSystem.js). A hunt is resolved in stages —
  // detect, evaluate, stalk, chase, capture-or-escape, feed, recover — and the
  // capture probability comes from the two animals' relative speed, remaining
  // sprint, and the prey's condition, never from a flat roll. The floor and
  // ceiling exist so nothing is ever untouchable or ever certain prey.
  hunting: Object.freeze({
    captureRange: 1.2, // distance at which the predator lunges
    baseCaptureChance: 0.28, // chance between two evenly matched, fresh animals
    minCaptureChance: 0.02,
    maxCaptureChance: 0.9,
    staminaWeight: 0.6, // how much the remaining sprint budget tilts the odds
    vulnerabilityWeight: 0.8, // how much a wounded or half-grown prey tilts them
    failedHuntEnergyCost: 4, // a miss is expensive; hunting is a gamble
    captureStaminaCost: 12, // the lunge itself, win or lose
    edibleMassFraction: 0.6, // carcass edible mass from a kill
    // Cooperative defense (Step 23). Adult groupmates standing around the prey
    // shave the odds with diminishing returns, capped so a large herd is never
    // untouchable; a parent actively interposing counts double and makes the
    // attempt genuinely dangerous for the predator.
    defenderWeight: 0.12,
    maxDefenders: 4,
    defenderInjuryBonus: 2.5, // how much likelier a guarded kill is to hurt the hunter
  }),
  // Sprinting (see systems/MovementSystem.js and MetabolismSystem.js). Chases
  // and escapes trade stamina for speed; stamina recovers whenever an animal is
  // not sprinting, which is what makes a failed chase cost a predator time as
  // well as energy.
  locomotion: Object.freeze({
    sprintMultiplier: 1.6, // speed while sprinting
    sprintStaminaCost: 2.5, // stamina per sprinting tick (~40 ticks from full)
    staminaRecoveryPerTick: 0.6, // regained per non-sprinting tick (~165 to refill)
    // Thermoregulation (Step 19). Charged as energy, so a cold snap kills by
    // burning an animal out — which is what hypothermia is. Cover halves it.
    thermalCostFactor: 0.06, // energy per °C outside the species' comfort band
    shelterRelief: 0.55, // fraction of that stress cover removes
    exposureStressThreshold: 0.35, // stress at which an energy death reads as `exposure`
    shelterWeight: 0.9, // how strongly the weather pulls an animal toward cover
    shelterStressThreshold: 2, // °C of stress before moving is worth it
    shelterStressSpan: 10, // °C at which that pull is at full strength
  }),
  // Bounded, decaying spatial memory (see memory/memories.js and
  // systems/MemorySystem.js). Animals remember where they ate, drank, searched
  // in vain, and met danger. Decay rates are per kind and deliberately unequal:
  // a lake stays put, a grass patch may already be grazed out, and "nothing
  // here" expires fastest because vegetation regrows.
  memory: Object.freeze({
    maxMemories: 8, // hard cap per animal (also enforced in memory/memories.js)
    forgetBelow: 0.05, // strength at which a memory is dropped entirely
    updateInterval: 5, // decay runs every N ticks, scaled so the rate is unchanged
    decay: Object.freeze({
      food: 0.004, //   ~250 ticks
      water: 0.0008, // ~1250 ticks
      barren: 0.006, // ~170 ticks
      danger: 0.001, // ~1000 ticks
    }),
  }),
  // Population metrics (see metrics/metrics.js and systems/MetricsSystem.js).
  // Pure observation: aggregates the population into distributions, rates, and
  // selection differentials, and writes no organism state. Staggered, because
  // a full aggregate is an O(N) pass and a summary view needs nothing like
  // tick resolution.
  metrics: Object.freeze({
    windowTicks: 500, // how far back births and deaths are counted
    historyLength: 120, // bounded time-series samples kept (≈ 6000 ticks)
    updateInterval: 50,
  }),
  // Heredity (see traits/genetics.js). Founders sample a genome; every animal
  // born in-world inherits one allele per locus from each parent, with a chance
  // of mutation. Expression charges antagonistic traits against each other
  // (bigger costs speed, faster costs efficiency, bolder costs caution) —
  // without that, selection would ratchet every trait toward its maximum.
  genetics: Object.freeze({
    mutationRate: 0.08, // chance an inherited allele is perturbed
    mutationStep: 0.12, // largest single perturbation
  }),
  // Individual variation (see traits/traits.js). Each animal's traits are
  // sampled once at birth as multipliers around the species mean; `spread` is
  // the half-width of each trait's triangular distribution, so 0.15 means
  // roughly ±15% at the extremes and most individuals much nearer average.
  // Behavioural traits vary more widely than physiological ones — a herd's
  // temperaments differ more visibly than its body plans. Since Step 20 this
  // spread seeds the *founding* genomes; everything after inherits.
  traits: Object.freeze({
    spread: Object.freeze({
      size: 0.18,
      speed: 0.15,
      metabolicEfficiency: 0.12,
      boldness: 0.3,
      caution: 0.3,
      exploration: 0.4,
      reproductiveInvestment: 0.2,
      // Mate choice (Step 22). Behavioural, so it varies widely like the other
      // temperaments — and it needs real variance for choosiness itself to be
      // selectable rather than a constant wearing a trait's clothes.
      choosiness: 0.3,
    }),
  }),
  // Parental care (see systems/ParentingSystem.js). A newborn depends on the
  // parent that carried it: it is provisioned with that parent's energy while
  // it stays close, is weaned at `weaningAge`, and disperses when it outgrows
  // the juvenile stage (`aging.juvenileUntil`, so the two never drift apart).
  // Care is a real cost to the parent — the transfer is lossy and the parent
  // stops giving at its own reserve floor.
  parenting: Object.freeze({
    weaningAge: 250, // ticks; provisioning ends here (well before independence)
    provisionRange: 2.0, // guardian must be this close to feed the juvenile
    provisionRate: 0.5, // energy drawn from the guardian per tick
    provisionEfficiency: 0.8, // fraction of it that reaches the juvenile
    parentMinEnergyFraction: 0.35, // guardian never provisions below this
    juvenileMaxEnergyFraction: 0.85, // juvenile stops taking above this
  }),
  // Aging, growth, life stages (see systems/AgingSystem.js). Ages are in
  // ticks; the demo lifespan is deliberately compressed so growth, stage
  // transitions, and age death are observable (a realistic lifespan under the
  // tick ≈ 1-minute convention would be far larger — reachable via the speed
  // multiplier). `adultMass` is supplied from the species at registration.
  aging: Object.freeze({
    birthMass: 5, // kg at birth
    maturityAge: 1000, // reaches adult mass by this age
    juvenileUntil: 400,
    subadultUntil: 1000,
    adultUntil: 6000, // adult until here, then senescent
    senescentMortalityPerTick: 0.001, // base death prob at senescence onset
    mortalityRamp: 8, // prob grows to base×(1+ramp) by maxAge
    maxAge: 12000, // death certain by here
    edibleMassFraction: 0.6,
  }),
  // Hydration / thirst (see systems/HydrationSystem.js). Animals dehydrate
  // each tick and drink at water cells; sustained dehydration damages health
  // and can kill. Water is terrain-bound (one or more lakes), so seeking water
  // is a spatially distinct behaviour from grazing.
  hydration: Object.freeze({
    // Re-tuned in Step 15, once animals could remember where they drank. Memory
    // helps but does not make thirst free: measured over 15k ticks on five
    // seeds, raising this from 0.02 to 0.035 roughly tripled visible
    // water-seeking behaviour (2.9k → 8.6k action-ticks) for a modest cost in
    // population (58 → 46 survivors, 26 → 31 dehydration deaths). 0.04 and
    // above bought little extra behaviour for markedly worse survival.
    dehydrationRate: 0.035, // hydration lost per tick
    drinkRate: 5, // hydration restored per tick while drinking
    drinkRange: 1.5, // within this distance of water → can drink
    dehydrationDamage: 0.5, // health lost per tick while hydration is 0
    edibleMassFraction: 0.6, // carcass edible mass on a dehydration death
  }),
  // Herbivory (see systems/FeedingSystem.js). An animal choosing to eat
  // removes up to `intakeRate` biomass from its cell each tick and assimilates
  // it to energy at `energyPerBiomass × efficiency`. Multiple eaters on a cell
  // contend deterministically in ascending entity-id order.
  feeding: Object.freeze({
    intakeRate: 0.6, // biomass units eaten per tick per animal
    energyPerBiomass: 10, // energy units per biomass unit
    efficiency: 0.6, // fraction of food energy assimilated (≤ 1)
    // Carnivore feeding (Step 16): flesh is far denser than grass and is
    // assimilated more efficiently, so a predator eats rarely and in bulk.
    fleshIntakeRate: 1.5, // edible mass eaten per tick
    energyPerMass: 12, // energy units per unit of edible mass
    carnivoreEfficiency: 0.75,
    carcassRange: 1.5, // how far a carnivore reaches for a carcass
  }),
  // Utility-based action selection (see systems/DecisionSystem.js). Weights
  // score candidate actions from hunger and perception; `explorationRate` is
  // the chance to wander regardless (explore). Wander commitment mirrors the
  // former movement wander so paths stay coherent.
  decision: Object.freeze({
    hungerWeight: 1.0,
    thirstWeight: 1.0, // thirst competes with hunger; whichever need is greater wins
    eatBias: 0.2, // bonus to eat when standing on food (so eat beats seek there)
    drinkBias: 0.2, // bonus to drink when at water
    restBias: 0.3, // rest attractiveness, scaled by fullness
    wanderBias: 0.35, // baseline exploration utility
    mateWeight: 0.55, // seeking a mate when reproductively ready
    // Mate choice (Step 22): quality forfeited per unit of distance when the
    // choosing sex picks which perceived candidate to walk toward. Small, so a
    // slightly better mate a few cells further off is worth the walk and a
    // marginally better one at the edge of perception is not.
    mateDistanceWeight: 0.04,
    followWeight: 0.7, // a dependent juvenile keeping up with its guardian
    followDistance: 1.5, // inside this distance there is nothing to close
    // Predation (Step 16). Fleeing outranks everything — a grazing animal that
    // spots a predator stops grazing — and grows more urgent the closer the
    // threat. Hunting is gated on real hunger and a usable sprint budget, so a
    // fed or exhausted predator leaves prey alone.
    fleeWeight: 2.0,
    // Sociality (Step 23). Herding is deliberately weak — it ranks below every
    // real need, so a hungry animal grazes its way out of the group and a fed
    // one drifts back in, which is what makes a herd loose and living rather
    // than a rigid formation. Defending young outranks even fleeing, because an
    // adult that has decided to stand over its juvenile has decided not to run.
    herdWeight: 0.6,
    herdDistance: 2.0, // inside this there is nothing to close
    defendWeight: 2.6,
    defendRange: 5.0, // how far an adult will go to interpose
    // Territory (Step 24). Patrolling is what an animal does *instead of*
    // wandering aimlessly, so it sits just above wander and below everything
    // else; retreating off a rival's ground beats settling down on it but never
    // beats eating, drinking, or running.
    patrolWeight: 0.55, // must clear `wanderBias` (0.35) — patrol replaces wander
    // How many range radii the pull ramps over before reaching full strength,
    // and the most consequential number in this step. **Patrolling competes
    // with wandering**, and wandering is how an animal finds the next patch of
    // food once it has eaten this one — so an animal that keeps going home
    // keeps not finding food. Measured over 15k ticks on five seeds:
    //
    //   patrol effectively off (or ramped over 6 radii)  4/5 seeds alive,
    //                                                    grazers 52–165
    //   ramped over 1.5 radii                            2/5, grazers  6–162
    //   ramped over 3 radii                              2/5, grazers 13–148
    //
    // (For reference, with the whole territory layer inert the demo is 5/5, so
    // marking and disputes cost about one seed and routine patrolling cost two
    // more.) At 6 the behaviour still exists — an animal that ends up six range
    // radii from home does turn round — but it never fires in normal foraging,
    // which is the only setting this two-species demo can afford. The mechanism
    // is exercised at a tighter ramp in test/territory.test.js.
    patrolSpanFactor: 6,
    retreatWeight: 0.7,
    // Must sit **below** `territory.markStrength` (0.35): a cell holding a
    // single fresh mark is exactly at that value and starts decaying
    // immediately, so a threshold equal to it meant newly marked ground did not
    // read as occupied at all.
    intrusionThreshold: 0.2,
    huntWeight: 1.4,
    stalkDiscount: 0.8, // stalking is worth slightly less than committing
    chaseRange: 4.0, // inside this, stalking becomes a sprint
    minHungerToHunt: 0.25,
    minHuntStamina: 15,
    huntCooldownTicks: 60, // recovery pause after a capture attempt
    carcassRange: 1.5, // how close a carnivore must be to eat (matches feeding)
    // Memory (Step 15) is a fallback for what the animal cannot see, so it is
    // weighted below the senses: a remembered patch may already be grazed out.
    recallWeight: 0.8, // remembered need vs. the same need in plain sight
    recallRange: 60, // furthest a remembered place is worth walking to
    recallDistanceWeight: 0.15, // how sharply distance discounts a memory
    dangerRadius: 6, // how wide a berth to give somewhere remembered as dangerous
    explorationRate: 0.05, // chance to wander regardless of utilities
    drinkRange: 1.5, // within this distance of water → can drink (matches hydration)
    minCommitTicks: 8,
    commitTickSpan: 16,
    wanderJitter: 0.5,
  }),
  // Demo *scenario* selection only (how many to spawn, which species). All
  // biology moved to species definitions (config/species/*); no per-animal
  // tuning lives here anymore.
  demo: Object.freeze({
    animalCount: 120,
    speciesId: 'herbivore.grazer',
    // Predators (Step 16, re-tuned in Step 18). These counts are measured, not
    // guessed. Step 18 changed the economics fundamentally: before carcasses
    // decayed, the ever-growing pile of bodies was a free larder that kept
    // predators fed without hunting, and the old 60/4 balance quietly depended
    // on it. With decay on, predators must actually hunt, and at those small
    // numbers the system is bistable — 1–3 predators starve out, 4 wipe the
    // grazers out. Scaling both cohorts up is what restores a real cycle:
    // measured over 15k ticks on five seeds, 120/8 leaves both species alive in
    // all five (roughly 74–255 grazers against 4–13 predators). Nothing
    // enforces that balance — it emerges from encounter rates, capture odds,
    // carcass availability, and lifespan.
    predatorCount: 8,
    predatorSpeciesId: 'predator.stalker',
  }),
});

/**
 * Merge configuration overrides over a base config, one level deep per
 * section. Returns a new plain (unfrozen, serializable) object.
 * @param {object} base
 * @param {object} [overrides]
 */
export function mergeConfig(base, overrides = {}) {
  const merged = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  for (const key of keys) {
    const baseValue = base[key];
    const overrideValue = overrides?.[key];
    const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isObject(baseValue) || isObject(overrideValue)) {
      merged[key] = { ...(baseValue ?? {}), ...(overrideValue ?? {}) };
    } else {
      merged[key] = overrideValue ?? baseValue;
    }
  }
  return merged;
}
