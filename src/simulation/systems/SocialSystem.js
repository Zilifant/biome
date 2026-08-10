/**
 * Sociality (Step 23) — herds, and the alarm that runs through one.
 *
 * Two jobs, both done from a single grid-local neighbour query per animal, and
 * neither of them building anything per-*pair* (invariant 17 and the risk
 * register's "quadratic neighbour searches" row both forbid it):
 *
 *   1. **Group membership.** Animals in sight of each other converge on a
 *      shared `groupId` by local label propagation: adopt the smallest group id
 *      among your conspecific neighbours, or found one on your own id if nobody
 *      near you has one. Nothing anywhere holds a roster — a group is just a
 *      label that spreads, which is why this stays O(neighbours) and why groups
 *      can form, merge, and dissolve without a single structural operation.
 *
 *      Every label also carries its **distance in hops from the animal whose id
 *      it is** — its root — and is only accepted within `maxGroupHops`. That is
 *      not a size limit (`maxGroupSize` is); it is what makes a herd able to
 *      *split*. Plain "take the smallest label you can see" only ever moves
 *      labels downward, so when a herd tears in half the piece without the root
 *      keeps the old label forever and two herds on opposite sides of the map
 *      stay nominally one. With hop counts, the orphaned half has no route back
 *      to a root, its hop counts climb by one a tick until they exceed the cap,
 *      and it re-founds on its own. Merging still works because a real root is
 *      reachable from both sides. It is the same trick as the alarm below, and
 *      for the same reason: a local mechanism needs a bound to stay local.
 *
 *   2. **Alarm.** An animal that can actually see a predator panics on its own
 *      (that is the decision system's `flee`). This propagates that panic to
 *      the ones that *cannot* see it: a neighbour of a fleeing or alarmed
 *      animal becomes alarmed too, and carries the direction the threat was in.
 *      Because it moves one neighbour-hop per tick, a wave visibly crosses a
 *      herd over several ticks instead of the whole population reacting at
 *      once.
 *
 *      Each alarm carries the **number of hops** it has travelled from whoever
 *      actually saw something, and stops at `maxAlarmHops`. That counter is not
 *      decoration — without it the thing is a chain reaction rather than a
 *      wave: alarmed animals re-alarm the neighbours who alarmed them, the
 *      panic never runs out of fuel, and it spreads to the whole population and
 *      stays there. It did, on the first cut — 106 of 119 grazers permanently
 *      fleeing. A bounded hop count makes "local" a property of the mechanism
 *      rather than a hope about population density, and it is exactly what the
 *      demonstration scenario pins.
 *
 * The group *summary* each animal gets — how many groupmates are in range, how
 * many are adults, where their centre of mass is, which way they are heading —
 * is transient, rebuilt every tick into `world.social`, exactly like
 * `world.perception`. Nothing about a group is stored except the label.
 *
 * ⚠ **Both jobs gained a heterospecific half on 2026-07-30** (PLAN-SPECIES.md
 * §3.16, phase 12), and it is deliberately confined to the two places above where
 * a *position* or a *warning* is read — never to the label. A species that
 * declares an `association` builds its centre of mass from the animals it stands
 * with rather than from its own kind alone, and hears their alarms; its `groupId`,
 * its groupmate counts, and everything downstream that reads them stay
 * conspecific. See `social/association.js` for why that line is where it is, and
 * for the measured claim that a world with no declaring species is arithmetically
 * unchanged.
 *
 * ⚠⚠ **There are two radii as of BEHAVIOR-PLAN P1, and confusing them is the way
 * to break this file.** `config.social.groupRadius` is what it always was — who
 * counts as a **groupmate**, and therefore as an adult, a defender and a mobber,
 * and how far a **label** carries in one hop. A species' `behavior.herdRadius` is
 * new and moves exactly one thing: who contributes to the **centre of mass**. The
 * two are gated independently in the neighbour loop below, and the reasoning for
 * widening only the second — that `adults` feeds collective vigilance, so widening
 * it would make the large grazers harder to kill as a side effect of a cohesion
 * change — is in `social/herding.js`. The world-level switch is
 * `config.social.perSpeciesRadius`.
 *
 * ⚠⚠ **Three exchange rates now meet in one expression, and they are three
 * different questions about the same slot.** The neighbour loop asks "how much of
 * a body is this animal worth when my centre of mass is worked out", and the
 * answer is composed of: `association.js` — is it my *species*; `banding.js` — is
 * it in my *band* (P2, the group record's first mover); and `calves.js` — can it
 * *look after itself* (P4). The first two are alternatives, since a body is either
 * my kind or not; the third **multiplies onto whichever won**, because dependency
 * is an independent fact about the same animal. Each is spent inside the centroid
 * exactly once, which is the line A61 was written to
 * defend: a weight that is also charged against the pull is charged twice.
 * `groupmates`, `adults` and `nearestDistance` are headcounts and stay headcounts,
 * because collective vigilance and `mobbing.minMobbers` read them and a cohesion
 * knob must not become a predation knob.
 *
 * ⚠⚠ **`pullScale` (P3) is a fourth number and it is deliberately not one of
 * them.** It answers a different question — "how hard do I hold to a centre made
 * of *that* company" — and it therefore rides its own accumulator and is spent
 * somewhere else entirely: the decision system divides `behavior.herdDistance` by
 * it. Multiplying it into `worth` instead would be exactly the double charge the
 * paragraph above refuses, and A61 records that being built and measured inert. It
 * is the mean pull of the bodies actually behind the centre, weighted by their own
 * contributions, so an all-conspecific group comes out at exactly 1.
 *
 * Runs in the `decision` phase at priority -10, ahead of the decision system
 * (priority 0) which consumes the summary to score `herd` and `defend`, and
 * ahead of anything that reads alarm state. Ownership: writes `groupId`,
 * `alarmedUntil`, `alarmSource`, and `world.social`; reads positions, headings,
 * life stages, species, and the perception summary. No randomness.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { isSymptomatic } from '../disease/disease.js';
import {
  CONSPECIFIC_PULL,
  CONSPECIFIC_WEIGHT,
  DEFAULT_ASSOCIATION,
  associationPullFor,
  associationPullsIn,
  associationWeightFor,
  associationsIn,
} from '../social/association.js';
import { herdRadiiIn } from '../social/herding.js';
import { bandAffinitiesIn, bandWorthFor } from '../social/banding.js';
import { calfWeightOf, isDependentCalf, keepsStationOnCalves } from '../social/calves.js';

export class SocialSystem extends SimulationSystem {
  /**
   * The species registry the association map was built from, so the map is
   * rebuilt rather than silently describing the wrong roster if one system
   * instance is ever reused across worlds. Same guard as `GroupSystem`'s.
   * @type {object|null}
   */
  #associationsFrom = null;
  /** @type {Map<string, Record<string, number>>} */
  #associations = new Map();
  /**
   * Per-species herd radii (BEHAVIOR-PLAN P1), on the same registry guard and
   * resolved in the same place, since both answer "what does this species say
   * about standing with others" and both are empty for a roster that says nothing.
   * @type {Map<string, number>}
   */
  #herdRadii = new Map();
  /**
   * Per-species band affinities (BEHAVIOR-PLAN P2) — the exchange rate between a
   * bandmate's body and a stranger's. Same registry guard, same early-out.
   * @type {Map<string, {same: number, other: number}>}
   */
  #bandAffinities = new Map();
  /**
   * Per-species association pulls (BEHAVIOR-PLAN P3) — how hard this species holds
   * to a centre of mass made of somebody else's bodies. The fourth map on the same
   * registry guard, and the only one that is not spent inside the centroid.
   * @type {Map<string, Record<string, number>>}
   */
  #associationPulls = new Map();

  /**
   * @param {object} [options]
   * @param {number} [options.groupRadius] how far conspecifics recognize each other as groupmates
   * @param {number} [options.maxGroupSize] hard cap on a herd, so one label cannot swallow the world
   * @param {number} [options.alarmRadius] how far panic carries per hop
   * @param {number} [options.alarmTicks] how long an animal stays alarmed after being told
   * @param {number} [options.maxGroupHops] neighbour-hops a herd label survives from its root
   * @param {number} [options.maxAlarmHops] neighbour-hops a warning survives from the sighting
   * @param {number} [options.minGroupSize] neighbours needed before founding a group
   * @param {boolean} [options.associationEnabled] heterospecific association at all (§3.16)
   * @param {boolean} [options.associationSharesAlarm] whether an associate's warning carries
   * @param {boolean} [options.associationScalesPull] whether a declared pull reaches the herd distance (P3)
   * @param {number} [options.calfWeight] what a dependent calf's body is worth in the centroid (P4)
   * @param {number} [options.updateInterval]
   */
  constructor({
    groupRadius = 6,
    maxGroupSize = 12,
    maxGroupHops = 3,
    alarmRadius = 6,
    alarmTicks = 25,
    maxAlarmHops = 2,
    minGroupSize = 2,
    // Heterospecific association (phase 12, PLAN-SPECIES.md §3.16). ⚠ Wired from
    // `config.association`, a global section — *not* from a species block, which a
    // species overrides, so a switch inside one could not switch anything off
    // (DOCS §8). The biology (which species, how strongly) is the per-species
    // `association` field; these two are the machinery.
    associationEnabled = DEFAULT_ASSOCIATION.enabled,
    associationSharesAlarm = DEFAULT_ASSOCIATION.sharesAlarm,
    // The third cell of the same 2×2 (BEHAVIOR-PLAN P3, closing A61): whether a
    // declared `associationPull` reaches the *distance* an animal tolerates from
    // mixed company. False publishes `pullScale: 1` for everybody — byte-identical
    // to the pre-P3 world, because `herdDistance / 1` is `herdDistance` for every
    // finite double. Wired from `config.association`, the global section, for the
    // third time and the same reason.
    associationScalesPull = DEFAULT_ASSOCIATION.scalesPull,
    // Per-species herd radius (BEHAVIOR-PLAN P1). ⚠ Wired from `config.social`, a
    // global section, for the same reason as the two above: a species block beats
    // the config, so a switch inside `behavior` could not switch anything off.
    // False makes every species herd at `groupRadius` again — the reproducible
    // control, and byte-identical to the pre-P1 world.
    perSpeciesRadius = true,
    // Band affinity (BEHAVIOR-PLAN P2). ⚠ From `config.social`, the global section,
    // for the third time and the same reason: a species block beats the config, so
    // the off arm has to live outside one. False makes every conspecific worth
    // exactly one body again — byte-identical to the pre-P2 world, because the
    // weights multiply into the sums as `× 1`.
    bandAffinity = true,
    // Calf weight (BEHAVIOR-PLAN P4). ⚠ Unlike the three above this is the switch
    // *and* the number — there is no per-species half, because "young cannot fend
    // for themselves" is not a fact that varies by species, and a config default
    // beside a species override would be two homes for one number (D11). 1 is the
    // identity and the reproducible control: `x * 1` is `x` for every finite
    // double, so the off arm is byte-identical rather than merely close.
    calfWeight = 1,
    updateInterval = 1,
  } = {}) {
    super({ id: 'social', phase: 'decision', priority: -10, updateInterval });
    this.groupRadius = groupRadius;
    this.maxGroupSize = maxGroupSize;
    this.maxGroupHops = maxGroupHops;
    this.alarmRadius = alarmRadius;
    this.alarmTicks = alarmTicks;
    this.maxAlarmHops = maxAlarmHops;
    this.minGroupSize = minGroupSize;
    this.associationEnabled = associationEnabled;
    this.associationSharesAlarm = associationSharesAlarm;
    this.associationScalesPull = associationScalesPull;
    this.perSpeciesRadius = perSpeciesRadius;
    this.bandAffinity = bandAffinity;
    // Resolved once, here rather than per tick: a nonsense or parity declaration
    // becomes the identity and the loop below never asks again. See
    // `social/calves.js` for why anything at or below zero is refused.
    this.calfWeight = calfWeightOf(calfWeight);
  }

  update(world, context) {
    const social = world.social;
    social.clear();

    // One O(N) tally of how big each label currently is, so the size cap can be
    // enforced without anyone holding a membership list. A running count keyed
    // by label is not a pairwise structure — it is one integer per group.
    /** @type {Map<number, number>} */
    const groupSizes = new Map();
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive || entity.groupId === null) continue;
      groupSizes.set(entity.groupId, (groupSizes.get(entity.groupId) ?? 0) + 1);
    }

    // Alarm is read from the state at the *start* of the tick and written into
    // a staging map, so panic spreads exactly one hop per tick regardless of
    // entity iteration order. Writing straight to the entity would let an alarm
    // race down the id ordering and cross the whole herd in a single tick,
    // which is precisely the global effect this is supposed not to have.
    /** @type {Map<number, {x: number, y: number, sourceId: number|null, hops: number}>} */
    const raised = new Map();

    // Heterospecific association (§3.16), in one `size` comparison when no species
    // in this world declares one — which is every world today, and is what makes
    // the loop below the loop it has always been.
    const associations = this.#associationsFor(world);
    const associating = associations.size > 0;
    // Per-species herd radii (BEHAVIOR-PLAN P1), on the same one-comparison
    // early-out. Empty when the switch is off or nobody declares one, and then
    // every `herdRadius` below is `this.groupRadius` and every gate is the gate it
    // has been since Step 23.
    const herdRadii = this.#herdRadiiFor(world);
    const herding = herdRadii.size > 0;
    // Band affinity (BEHAVIOR-PLAN P2), on the same one-comparison early-out as the
    // other two. Empty when the switch is off or no species declares one, and then
    // every conspecific below is worth exactly `CONSPECIFIC_WEIGHT` and every
    // multiplication is `× 1` — which is why the off arm is byte-identical rather
    // than merely equivalent.
    const bandAffinities = this.#bandAffinitiesFor(world);
    const banding = bandAffinities.size > 0;
    // Association pull (BEHAVIOR-PLAN P3), the fourth map and the fourth one-
    // comparison early-out. Empty when the switch is off or no species declares a
    // pull, and then `pullScale` below is the literal `CONSPECIFIC_PULL` for every
    // animal in the world and nothing accumulates it — which is what keeps the off
    // arm byte-identical rather than merely equal to within a rounding error.
    const associationPulls = this.#associationPullsFor(world);
    const scalingPull = associationPulls.size > 0;
    // Calf weight (BEHAVIOR-PLAN P4), on the same one-comparison early-out as the
    // three maps above — one comparison per *world*, since there is no per-species
    // map here to be empty. At the identity every `worth` below is untouched.
    const calfWeight = this.calfWeight;
    const weightingCalves = calfWeight !== CONSPECIFIC_WEIGHT;

    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      // ⚠⚠ **Two radii now, and which job each does is the whole of P1.**
      // `herdRadius` decides who is in the **centre of mass**; `this.groupRadius`
      // decides who is a **groupmate** — and therefore an adult, a defender, a
      // mobber — and how far a **label** carries in one hop. See
      // `social/herding.js` for why widening only the first is deliberate: the
      // other two would turn a cohesion knob into a predation knob and a metrics
      // change. They are gated independently below rather than one clamped
      // against the other, so a species that declared a *narrower* herd than its
      // label would get exactly that.
      const herdRadius = herding ? (herdRadii.get(entity.speciesId) ?? this.groupRadius) : this.groupRadius;
      const radius = Math.max(herdRadius, this.groupRadius, this.alarmRadius);
      let groupmates = 0;
      let adults = 0;
      let sumX = 0;
      let sumY = 0;
      let sumSin = 0;
      let sumCos = 0;
      let nearestMate = Infinity;
      // The heterospecific half of the same sums. Kept in its own accumulator
      // rather than folded into the conspecific one so that arithmetic is
      // untouched — `conspecificWeight + 0` is exactly `conspecificWeight`, which
      // is what makes a world with no association bit-identical rather than
      // merely equivalent.
      let associates = 0;
      let associateWeight = 0;
      // ⚠⚠ **The centroid's denominator, and it may no longer be `groupmates`.**
      // Until P1 every conspecific contributed exactly `1` to `sumX` and lived
      // inside the same gate as `groupmates`, so a headcount *was* the total
      // weight behind the mean. Both halves of that stopped being true: a
      // conspecific inside `herdRadius` but outside `groupRadius` contributes a
      // position without being a groupmate. Divide a weighted numerator by a
      // headcount denominator and the mean is not a mean — it is a point scaled
      // away from the origin, silently, by however far the two disagree. So the
      // weight is accumulated rather than counted. ⚠ With one radius and no
      // associates this is *exactly* `groupmates`: summing `1.0` n times is the
      // integer n in IEEE-754, so the division below is the division it was.
      let conspecificWeight = 0;
      // ⚠ **A headcount of the animal's own *band* inside the herd radius**
      // (BEHAVIOR-PLAN P7). Not an exchange rate and not weighted by anything: it
      // answers one yes/no question for `GroupSystem`'s rally drift — "is anybody
      // from my record contributing to the centre I am steering at?" — and a rally
      // fires exactly when the answer is no. Deriving that from this summary rather
      // than from a second distance test is the D11 rule: one question, one rule.
      //
      // ⚠ It is counted whatever the species declares, unlike the band *affinity*
      // beside it. A buffalo declares a record and no affinity, so a count that
      // rode on the affinity would be zero for exactly the species P7 is for.
      let bandmates = 0;
      // ⚠⚠ **The pull is a fourth number and it must not join the chain above**
      // (BEHAVIOR-PLAN P3). `worth` is composed of at most one exchange rate — the
      // heterospecific weight *or* the band affinity, never both — and every one of
      // them is spent inside the centroid. This one is spent on the *distance* the
      // decision system tolerates instead, so it rides its own accumulator: a
      // second rate multiplied into `worth` would be a body counted twice, which is
      // the charge A61 exists to refuse. It sums the same contributions in the same
      // order, each scaled by how hard this animal holds to that kind of body.
      let pullSum = 0;
      const association = associating ? (associations.get(entity.speciesId) ?? null) : null;
      // This animal's own pull declaration, read once per animal. Null for every
      // species that declares none, and then the accumulator above is never touched.
      const pulls = scalingPull ? (associationPulls.get(entity.speciesId) ?? null) : null;
      // This animal's own declaration, read once per animal rather than per
      // neighbour. Directional exactly as an association is: a zebra prefers its
      // own band without any other zebra having an opinion about that.
      const bandAffinity = banding ? (bandAffinities.get(entity.speciesId) ?? null) : null;
      // ⚠⚠ **The observer half of the calf weight (P4), hoisted here on purpose.**
      // An animal's own life stage cannot change while it counts its neighbours, so
      // this is one test per animal rather than one per neighbour (D28's warning
      // about per-neighbour cost, and the same hoisting the two lines above do).
      //
      // ⚠⚠ **And it is the gate without which the mechanism inverts.** A dependent
      // calf runs this identical loop: ungated, calves would weight each other up
      // and the adults down, and a crèche would drift off the herd under its own
      // pull. See `social/calves.js`.
      const keepsStationOnYoung = weightingCalves && keepsStationOnCalves(entity);
      // This animal's own record, hoisted for the same reason as the two lines
      // above. Null for every animal of a species that forms no persistent groups
      // — which is most of the world — and then the bandmate count below is one
      // null comparison per animal rather than anything per neighbour.
      const myBand = entity.groupRecordId;
      // Every animal can always found a herd on its own id, at zero hops from
      // itself. Seeding from the *id* rather than from the label it happens to
      // be carrying is what lets an orphaned half of a split herd escape the
      // old label instead of inheriting it forever.
      let label = entity.id;
      let labelHops = 0;
      /** @type {{x: number, y: number, sourceId: number|null, hops: number} | null} */
      let alarmFrom = null;

      // The perception system walked this exact neighbourhood a moment ago —
      // it runs in the `perception` phase and nothing moves between there and
      // here — so reuse its result rather than walking the grid a second time
      // (Step 30, §1.4 C6: this second walk cost +26 ms/tick at large-5k when
      // it landed). Two conditions have to hold, and both are checked rather
      // than assumed: the neighbourhood must have been built *this* tick (the
      // perception system supports `updateInterval`), and its radius must reach
      // at least as far as ours, since a shorter list would silently drop
      // neighbours. A *longer* list is safe: everything past `radius` fails
      // both distance gates below, exactly as it would have been excluded from
      // the query.
      const neighbours = this.#neighboursOf(world, context, entity, radius);
      for (let i = 0; i < neighbours.length; i += 2) {
        const otherId = neighbours[i];
        const other = world.entities.get(otherId);
        if (!other || other.kind !== 'animal' || !other.alive) continue;
        // ⚠ The species test that has ended this iteration since Step 23 now has
        // a second half, and the order matters: an animal of another species is
        // still dropped on the first comparison unless *this* species declares an
        // association, so the common path pays one null check and nothing else.
        const conspecific = other.speciesId === entity.speciesId;
        let worth = CONSPECIFIC_WEIGHT;
        if (!conspecific) {
          if (association === null) continue;
          worth = associationWeightFor(association, other.speciesId);
          if (worth === 0) continue;
        } else if (bandAffinity !== null) {
          // ⚠⚠ **Band affinity (P2), and it belongs on exactly this line** — the
          // same slot the heterospecific weight occupies, because it answers the
          // same question about a different pair of animals: how much of a body is
          // this one worth when my herd's centre is worked out. Spent inside the
          // centroid and nowhere else. See `social/banding.js` for why it is
          // conspecific-only, why a negative weight is refused rather than clamped,
          // and why "separation between bands" is differential attraction rather
          // than the repulsion it sounds like.
          //
          // ⚠ It reads *last tick's* membership: `GroupSystem` writes
          // `groupRecordId` at priority −8 and this runs at −10.
          worth = bandWorthFor(bandAffinity, entity.groupRecordId, other.groupRecordId);
        }
        // ⚠⚠ **The calf weight (P4), and it *multiplies* rather than replacing.**
        // Every branch above answers "who is this animal to me" — my species, my
        // band — and this answers something independent of all of them: "can it
        // look after itself". Two facts about one body, each spent once inside the
        // centroid, so a bandmate's calf is worth `sameBandWeight × calfWeight`.
        // That is composition, not the double charge D34 forbids, which is one
        // fact charged in two places.
        //
        // ⚠ Conspecifics only: an associate's body is already worth exactly what
        // this species declared it to be worth, and that declaration is the one
        // place a heterospecific rate may be spent (`social/association.js`).
        if (conspecific && keepsStationOnYoung && isDependentCalf(other)) worth *= calfWeight;
        const distance = neighbours[i + 1];

        // Social avoidance of illness (Step 25), done *without* a new movement
        // action. A visibly sick animal is simply not counted in the herd's
        // centre of mass, so the group's pull leads away from it and it is left
        // behind — which looks exactly like shunning and costs nothing, whereas
        // a `shun` action would have had to compete with foraging (the Step 24
        // lesson). Note it only works on *symptomatic* animals: an incubating
        // one looks fine and is embraced, which is how the outbreak spreads.
        const inHerd = distance <= herdRadius;
        const inGroup = distance <= this.groupRadius;
        if ((inHerd || inGroup) && !isSymptomatic(other)) {
          // ⚠ An associate contributes a *position* and nothing else: it is not a
          // groupmate, not an adult of this herd, and never a label. Everything
          // downstream that counts bodies — mobbing's `minMobbers`, the hunting
          // system's collective vigilance — reads the conspecific counts, and a
          // mob of the wrong species defends nobody (see social/association.js).
          if (!conspecific) {
            if (inHerd) {
              associates += 1;
              associateWeight += worth;
              // ⚠ The declared pull of *that* species, weighted by the same
              // contribution its body is making — so `pullScale` below is the mean
              // pull of the company actually behind the centre, not of the species
              // list. One wildebeest among six gazelle barely moves it; six
              // wildebeest and no gazelle move it all the way.
              if (pulls !== null) pullSum += worth * associationPullFor(pulls, other.speciesId);
              sumX += other.x * worth;
              sumY += other.y * worth;
              sumSin += Math.sin(other.heading) * worth;
              sumCos += Math.cos(other.heading) * worth;
            }
          } else {
            if (inHerd) {
              // ⚠ Weighted since P2, and numerator and denominator move together
              // or the mean is not a mean — see `conspecificWeight`'s own note
              // above for what dividing a weighted sum by a headcount does.
              // ⚠ With no declared affinity `worth` is exactly `1`, and `x * 1` is
              // `x` for every finite double, so this is bit-for-bit the arithmetic
              // it was before P2.
              conspecificWeight += worth;
              // ⚠ `× CONSPECIFIC_PULL`, written as the bare addition it is: your own
              // kind pulls at the unit by definition, which is what makes an
              // all-conspecific group come out at exactly 1.0 rather than at
              // 0.999… — the numerator is then the same additions in the same order
              // as the denominator's conspecific half, and `a + 0` is `a`.
              if (pulls !== null) pullSum += worth;
              // ⚠ Inside the `inHerd` gate on purpose: "contributing to my centre
              // of mass" is what the rally asks about, so this has to be counted
              // over exactly the animals that contributed. It reads *last tick's*
              // membership, like the band affinity above and for the same reason.
              if (myBand !== null && other.groupRecordId === myBand) bandmates += 1;
              sumX += other.x * worth;
              sumY += other.y * worth;
              // ✅ Alignment comes free: the mean *heading* is band-weighted by the
              // same number, so the `herd` intent's alignment half follows its
              // cohesion half without a second mechanism.
              sumSin += Math.sin(other.heading) * worth;
              sumCos += Math.cos(other.heading) * worth;
            }
            // ⚠ Everything from here to the end of the branch is **groupmate**
            // arithmetic, on `groupRadius` rather than on `herdRadius`, and it is
            // the half P1 deliberately left where it was: `adults` feeds
            // collective vigilance and mobbing, and the label feeds every herd
            // metric there is.
            if (inGroup) {
              groupmates += 1;
              if (other.lifeStage === 'adult' || other.lifeStage === 'senescent') adults += 1;
              if (distance < nearestMate) nearestMate = distance;
              // Label propagation: the smallest id in sight wins, which makes merges
              // symmetric — both herds reach the same answer without negotiating.
              // A label is only worth taking if its root is still reachable within
              // `maxGroupHops`; that is the check a split fails. The size cap is
              // checked against a *live* tally (see below), so a rush of animals
              // joining in one tick cannot collectively overshoot it.
              //
              // ⚠ Inside the conspecific branch on purpose (§3.16): a label that
              // crossed species would merge two species into one herd and make every
              // per-species herd metric meaningless. Association is an attraction,
              // never a membership.
              if (other.groupId !== null) {
                const hops = (other.groupHops ?? 0) + 1;
                const better = other.groupId < label || (other.groupId === label && hops < labelHops);
                if (hops <= this.maxGroupHops && better) {
                  const size = groupSizes.get(other.groupId) ?? 0;
                  if (size < this.maxGroupSize || other.groupId === entity.groupId) {
                    label = other.groupId;
                    labelHops = hops;
                  }
                }
              }
            }
          }
        }

        // Panic carries from anyone already running or already frightened — but
        // always by the *shortest* route back to whoever actually saw the
        // threat, so the hop count measures real distance from the sighting
        // rather than however the warning happened to arrive.
        //
        // ⚠ An associate's warning carries too, and that is the half of §3.16
        // that pays for the other one: "more eyes" is the reason a gazelle stands
        // with wildebeest, and it is worth nothing if their alarm stops at the
        // species boundary. It rides the existing wave unchanged — same hops, same
        // `maxAlarmHops` cap — because that cap is what keeps the mechanism local,
        // and crossing species does not weaken the argument for it. The
        // conspecific test comes first, so a world with no association never reads
        // the switch.
        if (distance <= this.alarmRadius && (conspecific || this.associationSharesAlarm)) {
          const perceived = world.perception.get(otherId);
          const theirThreat = perceived?.nearestThreat ?? null;
          let candidate = null;
          if (theirThreat) {
            // It can see the predator itself: this is a first-hand report.
            candidate = { x: theirThreat.x, y: theirThreat.y, sourceId: other.id, hops: 1 };
          } else if (other.alarmedUntil !== null && context.tick < other.alarmedUntil && other.alarmSource) {
            const hops = (other.alarmSource.hops ?? 0) + 1;
            if (hops <= this.maxAlarmHops) {
              candidate = { x: other.alarmSource.x, y: other.alarmSource.y, sourceId: other.id, hops };
            }
          }
          if (candidate && (alarmFrom === null || candidate.hops < alarmFrom.hops)) alarmFrom = candidate;
        }
      }

      // An animal that can see the predator itself does not need telling, and
      // its own sighting is better information than a neighbour's.
      const ownThreat = world.perception.get(entity.id)?.nearestThreat ?? null;
      if (ownThreat) {
        raised.set(entity.id, { x: ownThreat.x, y: ownThreat.y, sourceId: null, hops: 0 });
      } else if (alarmFrom) {
        raised.set(entity.id, alarmFrom);
      }

      // Found a label only when there is actually a group to be in; a lone
      // animal is not a herd of one.
      const groupId = groupmates < this.minGroupSize ? null : label;
      entity.groupHops = groupId === null ? null : labelHops;
      // Keep the tally live as labels change, so the cap holds within the tick
      // as well as across ticks. The first cut checked a snapshot taken before
      // the loop and let a herd of 23 form against a cap of 12, because a dozen
      // animals all joined the same under-cap group in the same pass.
      if (groupId !== entity.groupId) {
        if (entity.groupId !== null) {
          const previous = (groupSizes.get(entity.groupId) ?? 1) - 1;
          if (previous > 0) groupSizes.set(entity.groupId, previous);
          else groupSizes.delete(entity.groupId);
        }
        if (groupId !== null) groupSizes.set(groupId, (groupSizes.get(groupId) ?? 0) + 1);
      }
      entity.groupId = groupId;

      // Total weight behind the centre of mass: one per conspecific inside the
      // *herd* radius, its declared worth per associate. ⚠ With no associates and
      // no declared herd radius this is *exactly* `groupmates` — an integer-valued
      // float added to zero — so every division below is the division it was
      // before phase 12, bit for bit. ⚠⚠ It is `conspecificWeight` rather than
      // `groupmates` because those two stopped being the same number in P1; see
      // the accumulator's own note above for what dividing by the wrong one does.
      const weight = conspecificWeight + associateWeight;
      // How hard to hold to that centre, relative to one made of this animal's own
      // kind (BEHAVIOR-PLAN P3). ⚠⚠ **The `weight === 0` arm is not defensive
      // tidiness.** `0 / 0` is `NaN`, `NaN` propagates into `utilities.herd`, and
      // `argmaxUtility` compares with `>` — so `NaN > x` is false, `herd` is
      // silently *never chosen* for the rest of the animal's life, nothing throws,
      // and the inspector reports `null`. An animal standing alone has nobody to
      // hold to, and the honest value for that is the unit.
      const pullScale = pulls === null || weight === 0 ? CONSPECIFIC_PULL : pullSum / weight;
      // ⚠ The one field of this summary that outlives the tick, so it is written
      // to the animal before the summary is published (A99). Everything else here
      // is rebuilt from scratch every tick and is read within it.
      entity.bandmates = bandmates;
      world.social.set(entity.id, {
        groupId,
        groupmates,
        adults,
        // Heterospecific company (§3.16). Counted separately from `groupmates`
        // and never merged into it: these animals are why the centre of mass is
        // where it is, and they are not this animal's herd.
        associates,
        // The local centre of mass and mean heading — the two signals herding
        // needs. Null when alone, so the decision system has nothing to steer at.
        // ⚠ Gated on the *weight* rather than on `groupmates`, which is what gives
        // a lone gazelle standing in a wildebeest herd something to steer at.
        centroid: weight > 0 ? { x: sumX / weight, y: sumY / weight } : null,
        heading: weight > 0 ? Math.atan2(sumSin / weight, sumCos / weight) : null,
        // ⚠⚠ **How many bodies are behind that centre** (2026-08-06), and the one
        // number the herd's *packing floor* needs. `herdPackingFloor` turns it into
        // the closest a herd this size may be asked to stand, because a cohesion
        // target tighter than the occupancy cap allows is a request the movement
        // system refuses every tick forever — see `social/herding.js`.
        //
        // ⚠ It is the same `weight` the centroid is divided by, published rather
        // than recomputed: a headcount here and a weighted sum there would be two
        // answers to one question, which is the mistake the accumulator's own note
        // above records P1 making. A lone animal's is 0, matching `centroid: null`.
        centroidWeight: weight,
        nearestDistance: groupmates > 0 ? nearestMate : null,
        // How many of this animal's own **band** are in the centre it steers at
        // (P7). 0 for every animal that belongs to no record, which is most of
        // them, and the one number `GroupSystem`'s rally drift gates on.
        //
        // ⚠⚠ **Read back off the entity, which is now this number's one home**
        // (2026-08-09, A99). It had to be persisted — `predation/groupBackingFor`
        // reads it from the `perception` phase, a phase *before* this system runs,
        // so after a load the transient map is empty and every hunter's prey
        // ceiling silently collapses for a tick. Publishing `entity.bandmates`
        // rather than the local keeps one computation and one store (D11), so this
        // summary and the protocol projection both keep working unchanged.
        bandmates: entity.bandmates,
        // ⚠ **The one number here that is not spent inside the centroid.** The
        // decision system divides `behavior.herdDistance` by it, so a species that
        // holds loosely to another's herd tolerates proportionally more drift from
        // it — and exactly 1 leaves the distance bit-for-bit what it was. See
        // `social/association.js` for why the pull is a second declaration rather
        // than a reuse of the centroid weight, and why it is spent on the distance
        // rather than on the utility.
        pullScale,
      });
    }

    this.#applyAlarms(world, context, raised);
  }

  /**
   * The association weights of every species in this world that declares any,
   * keyed by species id — empty when the mechanism is off or nobody declares one.
   *
   * Built once per registry rather than per animal per tick, and checked for
   * emptiness before the entity walk, so a world with no associating species
   * (which is every world today) pays one `Map.size` comparison for the whole
   * mechanism. Same guard as `GroupSystem`'s forming-species set, and for the same
   * reason: the registry is per-world, so a system instance reused across worlds
   * must not keep describing the first one.
   *
   * @param {import('../world/World.js').World} world
   * @returns {Map<string, Record<string, number>>}
   */
  #associationsFor(world) {
    const registry = world.species ?? null;
    if (this.#associationsFrom !== registry) {
      this.#associationsFrom = registry;
      this.#associations = this.associationEnabled ? associationsIn(registry) : new Map();
      this.#herdRadii = this.perSpeciesRadius ? herdRadiiIn(registry) : new Map();
      this.#bandAffinities = this.bandAffinity ? bandAffinitiesIn(registry) : new Map();
      this.#associationPulls = this.associationScalesPull ? associationPullsIn(registry) : new Map();
    }
    return this.#associations;
  }

  /**
   * The association pull of every species in this world that declares one (P3),
   * keyed by id — empty when the switch is off or nobody declares one. Resolved by
   * `#associationsFor` off the same registry check, so the four maps can never
   * describe different rosters.
   *
   * @param {import('../world/World.js').World} world
   * @returns {Map<string, Record<string, number>>}
   */
  #associationPullsFor(world) {
    this.#associationsFor(world);
    return this.#associationPulls;
  }

  /**
   * The band affinity of every species in this world that declares one (P2), keyed
   * by id — empty when the switch is off or nobody declares one. Resolved by
   * `#associationsFor` off the same registry check, so the three maps can never
   * describe different rosters.
   *
   * @param {import('../world/World.js').World} world
   * @returns {Map<string, {same: number, other: number}>}
   */
  #bandAffinitiesFor(world) {
    this.#associationsFor(world);
    return this.#bandAffinities;
  }

  /**
   * The herd radius of every species in this world that declares one (P1), keyed
   * by id — empty when the switch is off or nobody declares one, which is the one
   * `Map.size` comparison the whole mechanism costs such a world.
   *
   * ⚠ Resolved by `#associationsFor`, off the same registry check, so the two maps
   * can never describe different rosters. Split into its own reader only because
   * the caller wants them as two values.
   *
   * @param {import('../world/World.js').World} world
   * @returns {Map<string, number>}
   */
  #herdRadiiFor(world) {
    this.#associationsFor(world);
    return this.#herdRadii;
  }

  /**
   * The neighbours of `entity` within `radius`, as a flat `[id, distance, …]`
   * array in ascending-id order — from the perception system's walk when that
   * is usable, and from our own grid query when it is not.
   *
   * The fallback is not dead code: it is what keeps this system correct if
   * perception is ever staggered, disabled, or given a radius shorter than the
   * social one, and it produces a list indistinguishable from the shared one.
   * Ascending id matters — the alarm below keeps the *first* candidate on a
   * hop-count tie, and the centroid sums floats in list order.
   *
   * @returns {number[]}
   */
  #neighboursOf(world, context, entity, radius) {
    if (world.neighbourhoodTick === context.tick) {
      const shared = world.neighbourhood.get(entity.id);
      // ⚠ The **neighbour** radius, not the perception radius (BEHAVIOR-PLAN P0).
      // Those were the same number until the walk was allowed to reach past the
      // senses, and reading the wrong one here would drop back to a second grid
      // walk for exactly the species the widening was built for.
      if (shared !== undefined && (world.neighbourhoodRadius.get(entity.id) ?? 0) >= radius) {
        return shared;
      }
    }
    const ids = world.grid.queryRadius(entity.x, entity.y, radius);
    const neighbours = [];
    for (const otherId of ids) {
      if (otherId === entity.id) continue;
      const other = world.entities.get(otherId);
      if (!other || other.kind !== 'animal' || !other.alive) continue;
      neighbours.push(otherId, Math.hypot(other.x - entity.x, other.y - entity.y));
    }
    return neighbours;
  }

  /**
   * Commit the staged alarms. Emitting only on the *transition* into alarm
   * keeps a herd of twenty from producing twenty events a tick for as long as
   * the predator is in view — the same discipline Step 22's courtship events
   * needed (§1.4 C3).
   */
  #applyAlarms(world, context, raised) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      const alarm = raised.get(entity.id);
      if (!alarm) {
        if (entity.alarmedUntil !== null && context.tick >= entity.alarmedUntil) {
          entity.alarmedUntil = null;
          entity.alarmSource = null;
        }
        continue;
      }
      const wasAlarmed = entity.alarmedUntil !== null && context.tick < entity.alarmedUntil;
      entity.alarmedUntil = context.tick + this.alarmTicks;
      entity.alarmSource = { x: alarm.x, y: alarm.y, hops: alarm.hops };
      if (!wasAlarmed) {
        context.emit(EventTypes.ENTITY_ALARMED, {
          entityId: entity.id,
          // null ⇒ it saw the threat itself rather than being told.
          sourceId: alarm.sourceId,
          hops: alarm.hops,
          x: alarm.x,
          y: alarm.y,
        });
      }
    }
  }
}
