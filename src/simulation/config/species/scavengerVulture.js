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
 * ⚠ **Was `scavenger.vulture` until 2026-07-29** (PLAN-SPECIES.md phase 7). The
 * rename carried no biology with it — the id changed and nothing else, proved
 * byte-identical across seeds.
 *
 * ⚠ **The hyena does not replace it.** A hyena hunts *and* scavenges; this
 * animal cannot hunt at all, which is a different niche the engine expresses
 * differently (an empty `preySpeciesIds` against a full one). Batch 1 is the
 * first world where the two contend, and carcass possession (§3.9) is what is
 * supposed to leave this species a living: arrive first, eat, and leave when the
 * big animals come.
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
  perception: Object.freeze({ radius: 14 }),
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
  // Does not track forage (grass is not food) but disperses like everything
  // else. What it follows is carrion, through perception — the same pipeline
  // the stalker uses to follow prey. It **does** track water, for the same
  // reason the stalker does: it gets most of its water from carrion and rarely
  // needs the lake, but a thirsty scavenger far from it needs a long-range steer
  // rather than to circle its patch until it dies. The cue only bends a wander
  // and only while thirsty.
  migration: Object.freeze({ tracksForage: false, tracksWater: true, cueRadius: 0, dispersalTicks: 500 }),
  initialEnergyFraction: Object.freeze({ min: 0.5, max: 0.9 }),
});
