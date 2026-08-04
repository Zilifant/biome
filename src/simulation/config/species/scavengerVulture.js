/**
 * An obligate scavenger (Step 29) — and the proof that the species schema does
 * what it claims, because **this file is the entire implementation**.
 *
 * Not one line of engine code was written or changed to add this animal. It is
 * a carnivore, so the feeding system already lets it eat carrion. It declares
 * **no `preySpeciesIds`**, so the perception system finds it nothing to hunt,
 * the hunting system never fires for it, and — read in the other direction —
 * nothing fears it. That single omission is the whole niche: a carnivore that
 * cannot hunt must live on what is already dead.
 *
 * That is also why the empty case in `SpeciesRegistry.hunts` is a niche rather
 * than an oversight. The predator/prey relation was always data; nobody had
 * asked what happens when the data is empty.
 *
 * It closes §1.4 A21, open since Step 18: "no dedicated scavenger guild —
 * predators are the scavengers, since a third species is its own scope." A
 * third species was indeed its own scope, and this is that step.
 *
 * Ecologically it is a small, fast, cheap-to-run animal that finds bodies from a
 * long way off and breeds quickly — the classic carrion strategy, where the food
 * is rich but rare and unpredictable, so the winning move is to search widely and
 * take what you find. It competes with the stalker for carcasses without
 * competing with the gazelle for grass, which is deliberate: a third species that
 * fought the existing two head-on would only tell us the demo is a knife edge,
 * which §1.4 D14 already established.
 *
 * ⚠ **Was `scavenger.corvid` until 2026-07-29** (PLAN-SPECIES.md phase 7). The
 * rename carried no biology with it — the id changed and nothing else, proved
 * byte-identical across seeds.
 *
 * ⚠ **The hyena does not replace it.** A hyena hunts *and* scavenges; this
 * animal cannot hunt at all, which is a different niche the engine expresses
 * differently (an empty `preySpeciesIds` against a full one). Batch 1 is the
 * first world where the two contend, and carcass possession (§3.9) is what is
 * supposed to leave this species a living: arrive first, eat, and leave when the
 * big animals come.
 *
 * ⚠⚠ **Three phases in two days have made this bird better at the clan's expense,
 * and that is worth knowing before a fourth.** F2 gave it flight (its carrion share
 * 33.2% → 35.6%, the hyena's 11.1% → 9.6%), V1 gave it `climbs` and with it access
 * to a leopard's cached kills (its share of leopard-killed meat 8.9% → 12.1%, the
 * hyena's 17.0% → 13.4%), and T3's caching had already moved carrion off the clan
 * before either. Each change passed its own ten-seed gate against its own control;
 * **no gate saw the other two.** Engine item **A73** carries the running total, and
 * the plan's phase V2 — a carcass-discovery network for this same species — takes
 * from the same place a fourth time.
 */
export const scavengerVulture = Object.freeze({
  id: 'scavenger.vulture',
  kind: 'animal',
  // A carnivore that hunts nothing. Both halves matter, and both are data.
  diet: 'carnivore',
  preySpeciesIds: Object.freeze([]),
  // ⚠ **4 → 6 kg on 2026-07-29**, and taken as its own measured change rather
  // than riding along with the rename, for the A12 reason two changes are never
  // made at once. 6 kg is a vulture rather than a corvid, and it is the number
  // every §3.9 possession figure was reasoned about ("the 60 kg hyena and the
  // 6 kg vulture the mechanism was designed for") — so it lands *before* the
  // hyena, not with it.
  bodyMass: 6, // kg — an order of magnitude below the others
  baseSpeed: 1.5, // quick, and cheap to be quick at this mass
  maxEnergy: 60, // a small tank: it eats often and cannot store much
  maxHealth: 60,
  maxHydration: 100,
  maxStamina: 100,
  // Finds food by looking, over a wide area — the furthest-seeing animal in the
  // world, because a scavenger's whole living is spotting a body before someone
  // else does.
  //
  // ⚠⚠ **14 → 9 on 2026-08-04, and the drop is the *point* of the flight edit
  // rather than a cost of it** (phase F2). The cell scan in `PerceptionSystem` is
  // (2r+1)², so widening the world's already-widest radius is quadratic in the
  // widening: 14 taken to 22 would be ~2.5× the hottest loop in the engine, for
  // the most numerous animal in the world. The mitigation is to **move the number,
  // not add one** — 9 × `flight.visionMultiplier` 1.55 = 13.95, so a *flying*
  // vulture sees almost exactly the 14 it always saw and the world's maximum
  // radius does not move at all.
  //
  // What genuinely changes is what a **grounded** vulture sees: 9 rather than 14,
  // while it is feeding, drinking, resting, courting or standing in a crowd at a
  // carcass. That is a real loss and it is the honest reading of the mechanism —
  // a bird on the ground has its head down.
  //
  // ⚠ 9 is above the social radius (6, `max(groupRadius, alarmRadius)`), which
  // matters mechanically: `SocialSystem` reuses perception's neighbour walk only
  // when that radius reaches at least as far as its own, so a narrower number here
  // would have silently added a second grid walk per vulture per tick — the exact
  // cost §1.4 C6 removed. Do not take this below 6.
  perception: Object.freeze({ radius: 9 }),
  // ⚠⚠ **Aerial movement** (phase F2, `vulture.md` §Aerial movement, and the
  // largest ecological change in TREES-FLIGHT-VULTURE-PLAN.md).
  //
  // A **movement mode, not a simulation of flight**: no altitude, no thermals, no
  // takeoff cost, no flapping economics. `vulture.md` asks for all four and the
  // plan declines all four — what is left is the part that does ecological work,
  // which is that a scavenger crosses ground fast, looks over a wide area, and
  // pays little for either. The classic carrion strategy, stated as three numbers.
  //
  // Each is a multiplier applied only while airborne, and airborne means "doing a
  // travelling action" (see `locomotion/flight.js`). So the bird gets none of this
  // while it eats, drinks, rests or courts — which is what keeps flight from being
  // a general improvement to the world's most numerous animal.
  flight: Object.freeze({
    // 1.5 × baseSpeed 1.5 = 2.25 world units per tick on the wing, against the
    // zebra's 1.25 at a walk. Comfortably the fastest thing in the world while
    // travelling and back to ordinary the moment it lands.
    speedMultiplier: 1.5,
    // 9 → 13.95, i.e. the radius it had before this edit, and not a unit more.
    // ⚠ The world's widest perception radius is deliberately unchanged by the
    // whole phase; see the note on `perception` above.
    visionMultiplier: 1.55,
    // Gliding is cheap. 0.6 of the walking cost per unit travelled, on top of a
    // `moveCostFactor` already the lowest in the roster. With `speedMultiplier`
    // that is **1.5× the ground covered for 0.9× the energy** — the carrion
    // strategy as arithmetic: search widely, because the food is rich, rare and
    // unpredictable. ⚠ Basal cost is untouched: nothing charges for being in the
    // air, only for crossing it.
    moveCostFactor: 0.6,
  }),
  // Small and feathered: tolerates cold poorly, heat well.
  comfortMin: 5,
  comfortMax: 32,
  aging: Object.freeze({
    birthMass: 0.8,
    maturityAge: 500, // fast to grow
    juvenileUntil: 200,
    subadultUntil: 500,
    adultUntil: 3500, // and short-lived
    maxAge: 6000,
    senescentMortalityPerTick: 0.0015,
  }),
  // Light bodies are cheap to run and cheap to move, which is what makes
  // covering a lot of ground on an unreliable food supply survivable.
  metabolism: Object.freeze({ basalRate: 0.03, moveCostFactor: 0.012 }),
  hydration: Object.freeze({ dehydrationRate: 0.03 }),
  // Breeds fast and cheap — the other half of the boom-and-bust carrion
  // strategy, and the opposite end of the spectrum from the stalker.
  reproduction: Object.freeze({
    minEnergyFraction: 0.65,
    matingEnergyCost: 6,
    gestationTicks: 400,
    birthEnergyCost: 12,
    cooldownTicks: 900,
  }),
  // Nothing to display and nothing to fight over: it reads plain condition in a
  // mate rather than an ornament, which the mate-choice code already supports by
  // weighting condition against a trait signal.
  matePreference: Object.freeze({ trait: 'speed', span: 0.35, conditionWeight: 0.8 }),
  // Holds no ground at all — it goes where the bodies are, and a carcass is
  // somewhere else every time. A home range it never defends, and a wide one.
  territory: Object.freeze({ defends: false, rangeRadius: 30, settleTicks: 600 }),
  // Persistent social groups (PLAN-SPECIES.md §3.8). No: it gathers wherever a
  // body is and scatters when the body is gone, which is an aggregation rather
  // than a membership — the herd label already says everything true about it.
  // ⚠ This is the contrast the hyena is measured against: same trophic level,
  // same carcasses, opposite answer to "who do I belong to".
  groups: Object.freeze({ forms: false }),
  // Two roosts of five (`config.cohorts`), and the tightest spread in the roster
  // because a roost is a place rather than a formation.
  // ⚠ It is the shortest-lived grouping in the world and that is honest: this
  // bird flies, ranges wide, and follows carrion through perception, so a roost
  // is where the day starts and not where it is spent. Placement can say the
  // first; only A77's discovery network could say the second.
  cohort: Object.freeze({ groupSize: 5, spread: 3 }),
  // Does not track forage (grass is not food) but disperses like everything
  // else. What it follows is carrion, through perception — the same pipeline
  // the stalker uses to follow prey. It **does** track water, for the same
  // reason the stalker does: it gets most of its water from carrion and rarely
  // needs the lake, but a thirsty scavenger far from it needs a long-range steer
  // rather than to circle its patch until it dies. The cue only bends a wander
  // and only while thirsty.
  //
  // ⚠ `cueRadius: 0 → 18` on 2026-08-04 (phase V1), and it is what the `habitat`
  // block below acts through — the leopard needed exactly this fix at phase 14,
  // and a habitat preference with no cue radius has nowhere to act at all
  // (`habitat/habitat.js` says so rather than leaving it to be discovered).
  //
  // ⚠ **18 rather than the leopard's 8, because the cue's whole modelling
  // assumption is that it reaches *beyond* what the animal can see.** This bird
  // perceives 9 on the ground and 13.95 on the wing (see `flight` above), so
  // anything at or under ~14 would be a "coarse long-range sense" of ground the
  // animal is already looking at. 18 is also what the three grazers use, so it is
  // not a novel number — and the widest-ranging animal in the world is the last
  // one that should have the shortest cue.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 18, dispersalTicks: 500 }),
  // ⚠⚠ **Woodland preference — and the honest name for what phase V1 delivered**
  // (`vulture.md` asks for communal roosting and nest-site fidelity).
  //
  // One weight and nothing else. Every other terrain stays exactly neutral, which
  // makes this a single attributable claim — *this bird would rather be in trees* —
  // and sidesteps the artifact T1 measured, where a species that names `ground`
  // has its preferred habitat quietly shrunk by every new terrain code. ⚠ A
  // thicket discount would be a second claim in the same edit (A12), so it is not
  // here.
  //
  // 1.6 is comfortably enough rather than finely tuned: `habitatCueReference` is
  // 0.3, so a single tree among a ray's two samples already yields a weight
  // difference of 0.3 and therefore the *full* habitat pull. Anything above ~1.3
  // behaves identically; the number is chosen to read as "strongly prefers" beside
  // the leopard's `cover: 1.6`.
  habitat: Object.freeze({ tree: 1.6 }),
  // ⚠⚠ **`climbs: true` is what phase V1 is *for*, and roosting is not what it
  // does.** Two consequences, and only the second one is measurable:
  //
  //   - **Roosting is inert by construction, not by tuning**, and this is stated
  //     up front because the plan expected "a small effect". Being in the canopy is
  //     `elevationFor`'s conjunction of a tree cell and one of four actions —
  //     `rest`, `shelter`, `hide`, `flee` — and for *this species* two of the four
  //     are structurally impossible (it declares no `aging.hiddenUntil`, so `hide`
  //     cannot fire; **nothing hunts it**, so `flee` cannot either — the leopard's
  //     phase-T3 situation exactly), `shelter` measured at **0.000%** of its
  //     animal-ticks, and `rest` at **0.03–0.11%**. Against a ~2% tree share the
  //     product is one animal-tick in ~100 000. ⚠ The fix is *not* available at
  //     this layer: making `rest` prefer liked ground was declined as born-inert at
  //     phase 9 (DOCS §9 Habitat) and a `roost` action would compete with foraging,
  //     which is DOCS §9 Decision's most expensive rule. Recorded as **A75**.
  //   - ⚠⚠ **The real effect is that this bird can reach a *cached* kill**, because
  //     `climbs` is the same flag `predation/possession.js` tests in
  //     `reachesCarcass`. That is ecologically right — a vulture gets into a
  //     leopard's larder and a hyena does not — and it partly reverses phase T3,
  //     whose measurable half was that caching moved carrion off *both* the clan
  //     and the birds. T3's stated claim survives intact, though, because it was
  //     always about the clan: *"this leopard cannot protect a kill from the hyena
  //     clan."* It still can. It simply cannot protect one from the air.
  climbs: true,
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
