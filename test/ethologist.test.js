/**
 * The ethologist's **family-4 detectors** — corruption, and runaway commitments.
 *
 * ⚠⚠ **This suite exists because the tool it tests was twice cited as evidence it
 * could not provide.** The herbivore-behaviour plan named four risks for
 * `npm run ethologist` to catch — "an animal locked on one bearing, a band
 * collapsed to a point, a buffalo sprinting until it dies, an entity at NaN" — and
 * two phases then recorded "reports no new anomaly kind" as reassurance. The tool
 * could not have reported any of them: nothing read a position for finiteness,
 * nothing read `stamina` at all, and `defend`/`chase` are deliberately excluded
 * from both the seek and circling detectors. A clean report from a detector that
 * cannot see the mechanism is not evidence about the mechanism (the same shape as
 * D40's null arm and D31's tautological fixture).
 *
 * So every test here is a **proof that a detector fires**, driven off hand-built
 * animals rather than a seeded world. That is deliberate and it is D43: a guard
 * nobody has watched fail is a guard nobody has tested. ⚠ Each test also pins the
 * *negative* — a healthy animal of the same shape scoring nothing — because a
 * detector that fires on everything is as useless as one that never fires, and the
 * `circling-in-need` history (146 flags per healthy world, DOCS §14) is this
 * tool's own precedent for that failure.
 *
 * ⚠ These are unit tests on exported functions, not a sweep. The tool's *own*
 * calibration against a live world is not testable in CI at any sane cost — a
 * default run is six worlds and a couple of minutes — which is exactly why the
 * detectors are pure functions of one animal plus a context.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nonFiniteState,
  commitmentPastCeiling,
  commitmentCeilingsOf,
  accumulateHold,
  accumulateBand,
  accumulateBlocked,
  accumulateHuntGate,
  deniedHunt,
  autopsy,
  speciesFactsOf,
  lifeReview,
  D,
  HOLD_ACTIONS,
  SEARCH_ACTIONS,
} from '../src/scripts/ethologist.js';
import { SimulationEngine } from '../src/simulation/engine/SimulationEngine.js';

/** The real shipped config, so no ceiling in this file is a literal. */
const CONFIG = new SimulationEngine().config;

/**
 * The world-level ceilings, **derived by the code under test** rather than
 * restated here.
 *
 * ⚠⚠ This was a hardcoded `consensusCeiling: 65` for about an hour, and a
 * mutation that deleted the `+ updateInterval` from the derivation **passed the
 * whole suite** — the fixture was asserting against itself. That is D31, written
 * into a file whose own header cites D31. Nothing here may restate an engine
 * number.
 */
const CTX = Object.freeze({
  ...commitmentCeilingsOf(CONFIG),
  breedingEnabled: true,
  facts: new Map([
    [
      'test.charger',
      {
        id: 'test.charger',
        chargeWeight: 0.9,
        pursuitTicks: 20,
        consensusWeight: 0.6,
        formsGroups: false,
        crypsis: 0,
        breedingWindow: null,
      },
    ],
    [
      'test.plain',
      {
        id: 'test.plain',
        chargeWeight: 0,
        pursuitTicks: 0,
        consensusWeight: 0,
        formsGroups: false,
        crypsis: 0,
        breedingWindow: null,
      },
    ],
  ]),
});

/** A healthy adult carrying every field the detectors read. */
function animal(overrides = {}) {
  return {
    id: 1,
    speciesId: 'test.charger',
    kind: 'animal',
    alive: true,
    x: 20,
    y: 30,
    heading: 0.5,
    energy: 90,
    maxEnergy: 100,
    hydration: 80,
    maxHydration: 100,
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    bodyMass: 600,
    lifeStage: 'adult',
    action: 'wander',
    migrationHeading: 0.2,
    migrationStrength: 0.1,
    herdHeading: 1.1,
    herdStrength: 0.05,
    herdCommitUntil: 1050,
    rallyHeading: null,
    rallyStrength: 0,
    trailHeading: null,
    trailStrength: 0,
    defendUntil: null,
    defendThreatX: null,
    defendThreatY: null,
    utilityBreakdown: { defend: 0, flee: 0, herd: 0.19, wander: 0.35 },
    ...overrides,
  };
}

/**
 * A tracker with the family-4 fields at their fresh values.
 *
 * ⚠ **These defaults must match `newTracker`'s**, and not for tidiness: an
 * *absent* `holdRunSpent` makes `holdRunSpent / holdRunMax` be `NaN`, `NaN >= 0.5`
 * is false, and every "does not fire" test would pass **vacuously** while the
 * detector was silently broken. The same NaN-loses-every-comparison mechanic the
 * detector under test exists to catch, one layer up in the fixture.
 */
function tracker(overrides = {}) {
  return {
    corrupted: false,
    overrunReported: false,
    holdRun: 0,
    holdSpent: 0,
    holdRunMax: 0,
    holdRunSpent: 0,
    holdRunAction: null,
    sprintExhaustedTicks: 0,
    // ⚠ And these two caught the very hazard the comment above describes, one
    // edit after it was written: without them `undefined + 1` is `NaN`, the
    // accumulator test failed loudly, and every *detector* test would have passed
    // vacuously. Left as the worked example.
    inRecordTicks: 0,
    withBandmateTicks: 0,
    adultTicks: 5000,
    inWindowAdultTicks: 5000,
    everSawMate: true,
    groupChanges: 0,
    bbox: () => 'x[0..1] y[0..1]',
    // Detector 4e's counters. ⚠ Present here for exactly the reason the two above
    // are: a tracker missing a counter makes every arithmetic detector fire on
    // `NaN`-flavoured nonsense or, worse, pass vacuously.
    committedTicks: 0,
    blockedTicks: 0,
    blockedRun: 0,
    blockedRunMax: 0,
    crowdLockedTicks: 0,
    // Detector 1d's counters (2026-08-10), here for the same reason — a missing
    // `preyInSightTicks` makes the detector's `denied / seen` be `NaN`, every
    // comparison against it false, and every "does not fire" test below pass
    // while the detector is broken.
    preyInSightTicks: 0,
    huntDeniedTicks: 0,
    huntAllowedTicks: 0,
    ...overrides,
  };
}

describe('ethologist: non-finite state is the corruption nothing else could see', () => {
  test('a healthy animal scores nothing', () => {
    assert.equal(nonFiniteState(animal(), { pullScale: 1 }, tracker(), 1000), null);
  });

  test('⚠ a NaN position fires — the failure that leaves an animal alive and outside every spatial query', () => {
    const found = nonFiniteState(animal({ x: NaN }), null, tracker(), 1000);
    assert.ok(found, 'a NaN x is reported');
    assert.equal(found.kind, 'non-finite-state');
    assert.match(found.detail, /x=NaN/);
    // Above every judgement-kind ceiling: this is state that can no longer mean
    // anything, not behaviour that looks odd.
    assert.ok(found.severity > 13, `severity ${found.severity} outranks every other kind`);
  });

  test('⚠⚠ a NaN utility fires — the quieter half, where an action is silently never chosen again', () => {
    // `NaN > x` is false, so `argmaxUtility` never picks it, nothing throws, and
    // the inspector reports null. This is the shape of all four of the behaviour
    // plan's near-misses.
    const found = nonFiniteState(animal({ utilityBreakdown: { herd: NaN, wander: 0.35 } }), null, tracker(), 1000);
    assert.ok(found, 'a NaN utility is reported');
    assert.match(found.detail, /utility\.herd=NaN/);
  });

  test('each of the three steering channels the plan added is watched', () => {
    // ⚠ Named individually rather than asserted as a group: this is the list a
    // future steering field has to be added to, and a test that only checked one
    // would not notice the others being dropped.
    for (const field of ['herdHeading', 'herdStrength', 'rallyHeading', 'rallyStrength', 'defendUntil']) {
      const found = nonFiniteState(animal({ [field]: NaN }), null, tracker(), 1000);
      assert.ok(found, `a NaN ${field} is reported`);
      assert.match(found.detail, new RegExp(`${field}=NaN`));
    }
  });

  test('null is not NaN — a nullable drift at rest is not an anomaly', () => {
    // The overwhelming majority of animals carry null in every one of these, so a
    // detector that could not tell null from NaN would flag the whole world.
    const resting = animal({
      herdHeading: null, herdStrength: 0, herdCommitUntil: null,
      rallyHeading: null, defendUntil: null, defendThreatX: null,
      migrationHeading: null,
    });
    assert.equal(nonFiniteState(resting, null, tracker(), 1000), null);
  });

  test('⚠⚠ pullScale is a divisor, so zero is as fatal as NaN and does not look it', () => {
    // `DecisionSystem` computes `herdDistance / pullScale`. At 0 that is Infinity,
    // so the animal is always already "close enough" and `herd` never fires as a
    // closing action; at NaN the utility loses every comparison instead. Both read
    // as "herding stopped working" with nothing thrown, and the value lives on the
    // social summary rather than on the entity — which is why it needs its own arm.
    assert.equal(nonFiniteState(animal(), { pullScale: 1 }, tracker(), 1000), null, 'the unit is healthy');
    assert.equal(nonFiniteState(animal(), { pullScale: 0.55 }, tracker(), 1000), null, 'a declared pull is healthy');

    const zero = nonFiniteState(animal(), { pullScale: 0 }, tracker(), 1000);
    assert.ok(zero, 'a zero divisor is reported');
    assert.match(zero.detail, /pullScale=0 .*Infinity/);

    const nan = nonFiniteState(animal(), { pullScale: NaN }, tracker(), 1000);
    assert.ok(nan, 'a NaN pull is reported');
    assert.match(nan.detail, /pullScale=NaN/);

    const negative = nonFiniteState(animal(), { pullScale: -0.5 }, tracker(), 1000);
    assert.ok(negative, 'a negative pull is reported');
  });

  test('a missing social summary is not an anomaly', () => {
    // Sociality is staggered and an animal can simply have no summary this tick.
    // A detector that could not tell "absent" from "broken" would flag the world.
    assert.equal(nonFiniteState(animal(), null, tracker(), 1000), null);
    assert.equal(nonFiniteState(animal(), {}, tracker(), 1000), null, 'nor a summary without the field');
  });

  test('it fires at most once per animal, because corruption persists', () => {
    const tr = tracker();
    const broken = animal({ y: Infinity });
    assert.ok(nonFiniteState(broken, null, tr, 1000), 'the first tick reports');
    assert.equal(nonFiniteState(broken, null, tr, 1001), null, 'later ticks do not');
    assert.equal(tr.corrupted, true);
  });
});

describe('ethologist: a commitment past its own ceiling', () => {
  test('⚠⚠ the ceilings come from the config, and the consensus one carries the cadence slack', () => {
    // The assertion the hardcoded fixture could not make. `commitTicks` alone
    // would report the mechanism: a label re-decides only on a tick the consensus
    // system runs, so a commitment legitimately quantizes up to `updateInterval`.
    const derived = commitmentCeilingsOf(CONFIG);
    assert.equal(derived.pursuitCeiling, CONFIG.charge.maxPursuitTicks);
    assert.equal(
      derived.consensusCeiling,
      CONFIG.consensus.commitTicks + CONFIG.consensus.updateInterval,
      'the ceiling is commitTicks + updateInterval, not commitTicks',
    );
    assert.ok(
      derived.consensusCeiling > CONFIG.consensus.commitTicks,
      'and the slack is strictly positive, or the detector reports the design',
    );
    // Retuning the config retunes the detector — the point of deriving at all.
    const tighter = commitmentCeilingsOf({ charge: { maxPursuitTicks: 7 }, consensus: { commitTicks: 11, updateInterval: 3 } });
    assert.equal(tighter.pursuitCeiling, 7);
    assert.equal(tighter.consensusCeiling, 14);
  });

  test('a commitment inside its ceiling scores nothing', () => {
    const ok = animal({ defendUntil: 1000 + CTX.pursuitCeiling, herdCommitUntil: 1000 + CTX.consensusCeiling });
    assert.equal(commitmentPastCeiling(ok, tracker(), 1000, CTX), null);
  });

  test('⚠ a pursuit ttl beyond config.charge.maxPursuitTicks fires', () => {
    const out = CTX.pursuitCeiling * 5;
    const found = commitmentPastCeiling(animal({ defendUntil: 1000 + out }), tracker(), 1000, CTX);
    assert.ok(found, `a ${out}-tick pursuit against a ${CTX.pursuitCeiling}-tick ceiling is reported`);
    assert.equal(found.kind, 'commitment-past-ceiling');
    assert.ok(found.detail.includes(`defendUntil is ${out} ticks out`), found.detail);
    assert.ok(found.detail.includes(`maxPursuitTicks of ${CTX.pursuitCeiling}`), found.detail);
  });

  test('⚠ a consensus ttl beyond commitTicks + updateInterval fires', () => {
    const out = CTX.consensusCeiling * 3;
    const found = commitmentPastCeiling(animal({ herdCommitUntil: 1000 + out }), tracker(), 1000, CTX);
    assert.ok(found, `a ${out}-tick commitment against a ${CTX.consensusCeiling}-tick ceiling is reported`);
    assert.ok(found.detail.includes(`herdCommitUntil is ${out} ticks out`), found.detail);
  });

  test('⚠⚠ the updateInterval slack is not reported, because it is the mechanism', () => {
    // A label re-decides only on a tick the consensus system runs, so a
    // commitment legitimately quantizes up to the cadence (DOCS §15). A detector
    // that used `commitTicks` alone would report the design as a defect on every
    // committed wildebeest in the world.
    const atSlack = animal({ herdCommitUntil: 1000 + CTX.consensusCeiling });
    assert.equal(commitmentPastCeiling(atSlack, tracker(), 1000, CTX), null);
    const overSlack = animal({ herdCommitUntil: 1001 + CTX.consensusCeiling });
    assert.ok(commitmentPastCeiling(overSlack, tracker(), 1000, CTX), 'one tick past the slack does report');
  });

  test('a leaked commitment on a switched-off mechanism is reported, and says so', () => {
    // With the mechanism off the field should be null, so a value in it is a leak
    // rather than a control arm — the one case where firing on a disabled
    // mechanism is correct.
    const off = { ...CTX, chargeEnabled: false };
    const found = commitmentPastCeiling(animal({ defendUntil: 1000 + CTX.pursuitCeiling * 5 }), tracker(), 1000, off);
    assert.ok(found);
    assert.match(found.detail, /charge\.enabled is false, so it should be null/);
  });
});

describe('ethologist: a member of a band it never meets', () => {
  /** The same fixture species, but one that actually forms records. */
  const BANDED = new Map(CTX.facts);
  BANDED.set('test.charger', { ...CTX.facts.get('test.charger'), formsGroups: true });
  const banded = { ...CTX, facts: BANDED };

  test('⚠ a long membership with no bandmate ever seen fires — P7 s premise', () => {
    const hit = lifeReview(
      animal(),
      tracker({ inRecordTicks: D.adultTicksForReview * 3, withBandmateTicks: 0 }),
      5000,
      banded,
    ).find((f) => f.kind === 'lost-from-its-band');
    assert.ok(hit, 'a member that never met its band is reported');
    assert.match(hit.detail, /never once had a bandmate/);
  });

  test('one tick of contact in a whole life is enough to clear it', () => {
    // Deliberately the weakest possible negative: the claim is "never", not
    // "rarely", because a rally that works at all produces contact eventually and
    // a frequency threshold here would be a tuning knob with nothing behind it.
    const found = lifeReview(
      animal(),
      tracker({ inRecordTicks: D.adultTicksForReview * 3, withBandmateTicks: 1 }),
      5000,
      banded,
    );
    assert.equal(found.find((f) => f.kind === 'lost-from-its-band'), undefined);
  });

  test('a species that forms no records never accrues it', () => {
    // `formsGroups` is false for most of the roster, and an animal with no record
    // has no band to be lost from — the same gate `group-flapping` uses.
    const found = lifeReview(
      animal(),
      tracker({ inRecordTicks: D.adultTicksForReview * 3, withBandmateTicks: 0 }),
      5000,
      CTX,
    );
    assert.equal(found.find((f) => f.kind === 'lost-from-its-band'), undefined);
  });

  test('⚠⚠ the accumulator that feeds it actually counts — the mutation that survived again', () => {
    // Second instance of the same gap: with this inline in `analyzeRun`, deleting
    // the contact increment left the suite green. Here the failure is the *loud*
    // direction — an accumulator that never counts makes the detector fire on every
    // long-standing member — and it is just as invisible from a clean report,
    // because a report full of findings and a report with none are both "not what
    // I expected" until somebody checks.
    const tr = tracker();
    const member = animal({ groupRecordId: 7 });

    accumulateBand(tr, member, { bandmates: 0 });
    assert.equal(tr.inRecordTicks, 1, 'membership is counted');
    assert.equal(tr.withBandmateTicks, 0, 'with nobody in range');

    accumulateBand(tr, member, { bandmates: 3 });
    assert.equal(tr.inRecordTicks, 2);
    assert.equal(tr.withBandmateTicks, 1, 'and contact is counted when it happens');

    // No membership: neither number moves, so a species that forms no records can
    // never reach the detector at all.
    accumulateBand(tr, animal({ groupRecordId: null }), { bandmates: 9 });
    assert.equal(tr.inRecordTicks, 2, 'an unattached animal accrues nothing');
    assert.equal(tr.withBandmateTicks, 1);

    // A missing summary is "no contact", not a crash — sociality is staggered.
    accumulateBand(tr, member, null);
    assert.equal(tr.inRecordTicks, 3);
    assert.equal(tr.withBandmateTicks, 1);
  });

  test('a brief membership is not evidence', () => {
    const found = lifeReview(
      animal(),
      tracker({ inRecordTicks: D.adultTicksForReview - 1, withBandmateTicks: 0 }),
      5000,
      banded,
    );
    assert.equal(found.find((f) => f.kind === 'lost-from-its-band'), undefined);
  });
});

describe('ethologist: sprinting on a budget nobody is keeping', () => {
  const ceiling = CTX.pursuitCeiling * D.runawayCommitFactor; // 160

  test('defend and chase are the actions watched, and nothing else is', () => {
    // ⚠ This is the hole being filled, pinned as a fact: both are deliberately
    // absent from SEARCH_ACTIONS and PURSUIT_ACTIONS, so before family 4 nothing
    // in the tool watched either.
    assert.ok(HOLD_ACTIONS.has('defend'));
    assert.ok(HOLD_ACTIONS.has('chase'));
    assert.ok(!HOLD_ACTIONS.has('wander'), 'a wanderer is not holding anything');
    assert.ok(!HOLD_ACTIONS.has('herd'));
  });

  /** A long over-ceiling hold, with `fraction` of it spent on an empty tank. */
  const longHold = (fraction, extra = {}) => {
    const holdRunMax = ceiling + 100;
    return tracker({
      holdRunMax,
      holdRunSpent: Math.round(holdRunMax * fraction),
      holdRunAction: 'defend',
      sprintExhaustedTicks: 500,
      ...extra,
    });
  };

  test('⚠ a long hold spent on an empty tank fires — the named risk', () => {
    const hit = lifeReview(animal(), longHold(0.9), 5000, CTX).find((f) => f.kind === 'sprint-to-exhaustion');
    assert.ok(hit, 'a buffalo sprinting until it drops is reported');
    assert.ok(hit.detail.includes(`held defend for ${ceiling + 100} consecutive ticks`), hit.detail);
    assert.match(hit.detail, /chargeWeight 0\.9/, 'and it names the weight to go and check');
  });

  test('⚠⚠ the stamina term is scoped to the episode, because a lifetime count is always true', () => {
    // **This is the correction that measurement forced.** A healthy 7000-tick demo
    // spends 64 128 action-ticks sprinting at ≤5% stamina — ~1.5% of all
    // animal-ticks, ~100 per animal — so a *lifetime* threshold would sit below
    // typical, the conjunction would collapse to its hold-run half, and deleting
    // the stamina test would change nothing. D43, in a detector written to catch
    // D43. So a huge lifetime count with a clean episode must NOT fire.
    const cleanEpisode = longHold(0.1, { sprintExhaustedTicks: 100000 });
    assert.equal(
      lifeReview(animal(), cleanEpisode, 5000, CTX).find((f) => f.kind === 'sprint-to-exhaustion'),
      undefined,
      'a lifetime of empty-tank sprinting does not by itself convict a long hold',
    );
  });

  test('⚠⚠ it is a conjunction, and each half alone is ordinary', () => {
    // A long hold alone is a mob standing its ground; an empty tank alone is any
    // animal that has just run for its life. Either arm firing on its own would
    // make this a false-positive machine, which is `circling-in-need`'s recorded
    // history in this same tool.
    assert.equal(
      lifeReview(animal(), longHold(0), 5000, CTX).find((f) => f.kind === 'sprint-to-exhaustion'),
      undefined,
      'a long stand with stamina in hand is not flagged',
    );
    const shortHold = tracker({ holdRunMax: 10, holdRunSpent: 10, holdRunAction: 'chase' });
    assert.equal(
      lifeReview(animal(), shortHold, 5000, CTX).find((f) => f.kind === 'sprint-to-exhaustion'),
      undefined,
      'a brief chase on an empty tank is not flagged',
    );
  });

  test('⚠⚠ the accumulator that feeds it actually counts — the mutation that survived once', () => {
    // With this inline in `analyzeRun`, deleting the per-episode increment left the
    // whole suite green: the detector tests drive hand-built trackers and never run
    // the code that fills one. A broken accumulator reports nothing and looks
    // exactly like a healthy world (D19).
    const tr = tracker();
    const holding = (action, staminaFraction) =>
      animal({ action, stamina: 100 * staminaFraction, moveIntent: { moving: true, sprint: true } });

    for (let i = 0; i < 5; i += 1) accumulateHold(tr, holding('defend', 0.01));
    assert.equal(tr.holdRun, 5, 'five consecutive defend ticks counted');
    assert.equal(tr.holdSpent, 5, 'all five were on an empty tank');
    assert.equal(tr.holdRunMax, 5);
    assert.equal(tr.holdRunSpent, 5, 'and the episode carries its own spent count');
    assert.equal(tr.holdRunAction, 'defend');

    // A non-hold action ends the episode, and the maxima survive it.
    accumulateHold(tr, holding('wander', 0.01));
    assert.equal(tr.holdRun, 0, 'the run resets');
    assert.equal(tr.holdSpent, 0, 'and so does its spent counter');
    assert.equal(tr.holdRunMax, 5, 'while the max is remembered');

    // ⚠ A longer episode with a *full* tank must overwrite the spent count, not
    // inherit the previous episode's — the cross-episode borrowing this pairing
    // exists to prevent.
    for (let i = 0; i < 9; i += 1) accumulateHold(tr, holding('chase', 1));
    assert.equal(tr.holdRunMax, 9);
    assert.equal(tr.holdRunSpent, 0, 'the new episode spent nothing, and does not borrow');
    assert.equal(tr.holdRunAction, 'chase');

    // Sprinting with stamina in hand is not "spent", and not sprinting at all is
    // not either — both are the gate, and both are ordinary.
    const fresh = tracker();
    accumulateHold(fresh, holding('defend', 1));
    assert.equal(fresh.holdSpent, 0, 'a full tank is not spent');
    accumulateHold(fresh, animal({ action: 'defend', stamina: 0, moveIntent: { moving: true, sprint: false } }));
    assert.equal(fresh.holdSpent, 0, 'an empty tank without a sprint is not spending');
    assert.equal(fresh.holdRun, 2, 'though both ticks were still a hold');
  });

  test('the threshold sits above the healthy demo maximum, which was measured', () => {
    // Measured on seed 42 × 7000 ticks: the longest unbroken defend/chase run in a
    // healthy world is 31 ticks. A detector that triggered below that would flag
    // ordinary predation; one at 5× it would be unreachable. Both drafts happened.
    const HEALTHY_MAX = 31;
    assert.ok(ceiling > HEALTHY_MAX, `trigger ${ceiling} is above the healthy maximum ${HEALTHY_MAX}`);
    assert.ok(ceiling < HEALTHY_MAX * 4, `trigger ${ceiling} is not so far above it as to be unreachable`);
  });

  test('the threshold is a multiple of the engine ceiling, not a constant', () => {
    // Halve the world's ceiling and the same animal becomes reportable — which is
    // what makes this a question about the bound rather than a second opinion
    // about what the bound should be (D11).
    const tr = () =>
      tracker({
        holdRunMax: ceiling - 5,
        holdRunSpent: ceiling - 5,
        holdRunAction: 'chase',
      });
    assert.equal(
      lifeReview(animal(), tr(), 5000, CTX).find((f) => f.kind === 'sprint-to-exhaustion'),
      undefined,
      `inside the ceiling at maxPursuitTicks ${CTX.pursuitCeiling}`,
    );
    const tighter = { ...CTX, pursuitCeiling: Math.floor(CTX.pursuitCeiling / 2) };
    assert.ok(
      lifeReview(animal(), tr(), 5000, tighter).find((f) => f.kind === 'sprint-to-exhaustion'),
      `and outside it at maxPursuitTicks ${tighter.pursuitCeiling}`,
    );
  });

  test('a species declaring no chargeWeight is reported differently, not exempted', () => {
    // `defend` exists for every species (the interposing parent), so a long hold
    // by a non-charger is still worth surfacing — it just is not a charge, and the
    // detail has to say so rather than send the reader to the wrong config.
    const found = lifeReview(
      animal({ speciesId: 'test.plain' }),
      tracker({
        holdRunMax: ceiling + 50,
        holdRunSpent: ceiling + 50,
        holdRunAction: 'defend',
      }),
      5000,
      CTX,
    );
    const hit = found.find((f) => f.kind === 'sprint-to-exhaustion');
    assert.ok(hit);
    assert.match(hit.detail, /declares no chargeWeight, so the sprint is not a charge/);
  });

  test('a life too short to review is not reviewed', () => {
    // The whole family-3 precondition, and it applies here too: a juvenile that
    // died is not evidence about a commitment bound.
    const found = lifeReview(
      animal(),
      tracker({
        adultTicks: D.adultTicksForReview - 1,
        holdRunMax: ceiling + 500,
        holdRunSpent: ceiling + 500,
      }),
      5000,
      CTX,
    );
    assert.deepEqual(found, []);
  });
});

/**
 * Detector 4e — `movement-denied` (2026-08-06).
 *
 * ⚠⚠ **The detector this tool needed one phase before it had it.** A cohesion
 * change packed the two largest grazers tighter than
 * `locomotion.maxOccupantsPerCell` allows; 37.5% of wildebeest steps were refused
 * against 4.7% before it, they starved standing on forage, and the population fell
 * 57%. This tool reported the deaths (`starved with 122 biomass within 2c`) and one
 * buffalo with `294 refused steps` — the lead was in the output and no detector was
 * triggering on it. Same shape as A83, arriving immediately after A83.
 */
describe('ethologist: an animal that keeps asking to move and keeps not moving', () => {
  test('⚠ a healthy refusal rate is not a finding — the calibration, as an assertion', () => {
    // 3–5% is what every species on the demo measures (seed 2, t2000–4200),
    // including at rocks=6 thickets=8 where terrain does the blocking. A detector
    // that fires here is the `circling-in-need` history repeating.
    const found = lifeReview(animal(), tracker({ committedTicks: 4000, blockedTicks: 200 }), 5000, CTX);
    assert.equal(found.find((f) => f.kind === 'movement-denied'), undefined, '5% is a working world');
  });

  test('the regression that caused it fires, and says the rate out loud', () => {
    const hit = lifeReview(
      animal(),
      // The measured wildebeest numbers: 37.5% of committed steps going nowhere.
      tracker({ committedTicks: 4000, blockedTicks: 1500, blockedRunMax: 88, crowdLockedTicks: 900 }),
      5000,
      CTX,
    ).find((f) => f.kind === 'movement-denied');
    assert.ok(hit, 'a world an animal cannot walk in is reported');
    assert.match(hit.detail, /38%/, 'the rate is in the detail, not just the severity');
    assert.match(hit.detail, /against 3–5% in a healthy world/, 'and so is what healthy looks like');
  });

  test('⚠⚠ it names bodies or terrain, because the fix for each is a different file', () => {
    const crowd = lifeReview(
      animal(),
      tracker({ committedTicks: 1000, blockedTicks: 500, crowdLockedTicks: 400 }),
      5000,
      CTX,
    ).find((f) => f.kind === 'movement-denied');
    assert.match(crowd.detail, /other animals/, 'crowding points at the cohesion target');
    assert.match(crowd.detail, /herdPackingSlack/, 'and names the bound that governs it');

    const terrain = lifeReview(
      animal(),
      tracker({ committedTicks: 1000, blockedTicks: 500, crowdLockedTicks: 0 }),
      5000,
      CTX,
    ).find((f) => f.kind === 'movement-denied');
    assert.match(terrain.detail, /terrain \(A66\)/, 'and with no crowd-lock it is the known terrain residual');
  });

  test('⚠ it fires on the mechanism rather than on crowding, so it cannot be fixed into silence', () => {
    // Deliberate: a detector keyed on crowding would go quiet the moment somebody
    // fixed crowding, leaving the next cause of the same failure unwatched.
    const hit = lifeReview(
      animal(),
      tracker({ committedTicks: 1000, blockedTicks: 500, crowdLockedTicks: 0 }),
      5000,
      CTX,
    ).find((f) => f.kind === 'movement-denied');
    assert.ok(hit, 'no crowd-lock at all still fires on the rate');
  });

  test('a short life is not evidence', () => {
    const found = lifeReview(
      animal(),
      tracker({ committedTicks: D.blockedMinCommitted - 1, blockedTicks: D.blockedMinCommitted - 1 }),
      5000,
      CTX,
    );
    assert.equal(found.find((f) => f.kind === 'movement-denied'), undefined, 'forty ticks behind a rock is not a finding');
  });

  test('an animal that never asked to move cannot be denied', () => {
    // The zero denominator, and it must not be a divide-by-zero or a 0/0 severity.
    const found = lifeReview(animal(), tracker({ committedTicks: 0, blockedTicks: 0 }), 5000, CTX);
    assert.equal(found.find((f) => f.kind === 'movement-denied'), undefined);
  });

  test('severity rises with the rate and saturates, so it cannot take over the shortlist', () => {
    const at = (blocked) =>
      lifeReview(animal(), tracker({ committedTicks: 1000, blockedTicks: blocked }), 5000, CTX)
        .find((f) => f.kind === 'movement-denied').severity;
    assert.ok(at(300) < at(600), 'a worse rate is a worse finding');
    assert.ok(at(600) < at(1000));
    assert.ok(at(1000) <= 12, 'and the ceiling holds at total denial — the lesson of the 152-point lion');
  });

  describe('the accumulator that feeds it', () => {
    const moving = (extra = {}) => animal({ moveIntent: { moving: true, ...extra } });

    test('a step that went nowhere is blocked; one that moved is not', () => {
      const tr = tracker();
      accumulateBlocked(tr, moving(), 0, false);
      assert.deepEqual(
        [tr.committedTicks, tr.blockedTicks, tr.blockedRunMax],
        [1, 1, 1],
        'committed and went nowhere',
      );
      accumulateBlocked(tr, moving(), 5, false);
      assert.deepEqual([tr.committedTicks, tr.blockedTicks, tr.blockedRun], [2, 1, 0], 'and the run resets on travel');
    });

    test('⚠ a stationary action is not a refusal — eating is not being stuck', () => {
      const tr = tracker();
      accumulateBlocked(tr, moving(), 0, true);
      assert.equal(tr.blockedTicks, 0, 'standing still on purpose is not being denied');
      assert.equal(tr.committedTicks, 1, 'though it did hold an intent');
    });

    test('an animal with no intent at all touches neither counter', () => {
      const tr = tracker();
      accumulateBlocked(tr, animal({ moveIntent: null }), 0, false);
      assert.deepEqual([tr.committedTicks, tr.blockedTicks], [0, 0]);
    });

    test('⚠⚠ a crowd-locked tick reaches BOTH counters, or the fix hides the symptom', () => {
      // The single most important assertion in this block. The engine's crowd-lock
      // branch reports `moving: false`, so the naive reading drops the tick from
      // the denominator *and* the numerator — and a world jamming harder would
      // report a **falling** refusal rate. The fix hiding the symptom from the
      // instrument added to watch for it.
      const tr = tracker();
      accumulateBlocked(tr, animal({ moveIntent: { moving: false, crowdLocked: true } }), 0, false);
      assert.equal(tr.committedTicks, 1, 'it asked to go somewhere');
      assert.equal(tr.blockedTicks, 1, 'and it did not get there');
      assert.equal(tr.crowdLockedTicks, 1, 'and the cause is attributed');
      assert.equal(tr.blockedRunMax, 1);
    });

    test('⚠ a crowd-locked tick counts even though the action is stationary', () => {
      // The stationary exemption is about *choosing* to stand still. A crowd-locked
      // animal did not choose it, and the two must not be confused — this is the
      // one path where the exemption would silently swallow the finding.
      const tr = tracker();
      accumulateBlocked(tr, animal({ moveIntent: { moving: false, crowdLocked: true } }), 0, true);
      assert.equal(tr.blockedTicks, 1, 'being hemmed in is not resting');
    });

    test('the longest run is the longest run, not the last one', () => {
      const tr = tracker();
      for (let i = 0; i < 5; i += 1) accumulateBlocked(tr, moving(), 0, false);
      accumulateBlocked(tr, moving(), 9, false); // breaks it
      for (let i = 0; i < 2; i += 1) accumulateBlocked(tr, moving(), 0, false);
      assert.equal(tr.blockedRunMax, 5, 'a later shorter run does not overwrite it');
      assert.equal(tr.blockedRun, 2, 'while the live run is the live one');
      assert.equal(tr.blockedTicks, 7, 'and the total is every blocked tick');
    });
  });
});

/**
 * `circling-in-need` and the action it should never have counted (2026-08-06).
 *
 * The detector's whole job is to tell "stuck" apart from "doing its job in a home
 * range", and the 2026-07-31 recalibration added the search-fraction term to do
 * it. That term then included `wander` \u2014 the action an animal takes when it has
 * no other drive at all \u2014 so it was satisfied by the resting state of every
 * predator and scavenger in the world and by almost nothing a grazer does.
 */
describe('ethologist: what counts as searching', () => {
  test('\u26a0\u26a0 wander is not a search \u2014 it is the absence of one', () => {
    // The one-line change, asserted directly because the whole regression was a
    // single set membership. Measured share of ticks spent wandering: leopard
    // 94.5%, hyena 73.8%, vulture 64.8%, lion 55.9% \u2014 so with `wander` in this
    // set, `searchFraction >= 0.6` was those species' baseline and the detector
    // flagged 53\u2013100% of every one of them in every world.
    assert.equal(SEARCH_ACTIONS.has('wander'), false, 'an animal with nothing to do is not searching');
  });

  test('a directed search for food or water still counts', () => {
    // The negative half: emptying the set would also silence the detector, and
    // would look identical from a clean report.
    for (const action of ['seekFood', 'seekWater', 'recallFood', 'recallWater']) {
      assert.equal(SEARCH_ACTIONS.has(action), true, `${action} is an animal looking for something`);
    }
  });

  test('\u26a0 and the actions that mean "staying put on purpose" are still excluded', () => {
    // `patrol`, `herd` and `tend` are an animal in its home range; `stalk`,
    // `chase` and `defend` have targets that move evasively, which is why A83
    // records them as deliberately outside every seek and circling detector.
    for (const action of ['patrol', 'herd', 'tend', 'rest', 'stalk', 'chase', 'defend', 'eat', 'drink']) {
      assert.equal(SEARCH_ACTIONS.has(action), false, `${action} is not a search`);
    }
  });
});

/**
 * ⚠⚠ **Detector 1d — starved with prey in sight it was not allowed to chase.**
 *
 * This exists because the tool reported **nothing** about the largest cause of
 * death in a species, five seeds running. A 5 × 8000-tick sweep of the shipped
 * demo killed **13–16 hyenas per seed by starvation — 77–94% of every hyena
 * death** — and produced zero flagged hyena deaths. The carnivore branch of
 * `autopsy` asked two questions, "was there a carcass right here" and "did it
 * ever see food at all", and a hyena that had watched prey walk past for hundreds
 * of ticks answers the second one *yes*. A83's rule for the third time: a clean
 * report from a detector that cannot see the mechanism is not evidence about the
 * mechanism.
 *
 * The mechanism is `behavior.minHungerToHunt`. Measured over the same worlds,
 * every living hyena, every tick: prey was in perception on **13.8–16.5%** of
 * hyena-ticks and the hunger gate was shut on **84.6–90.6%** of those; the hyenas
 * that starved saw prey for **248–366** ticks of a ~2200-tick life and had the
 * gate open for **42–68**.
 *
 * ⚠ Every threshold here is read from `D` or from the shipped species, never
 * restated — D31, and the file header's own warning about a fixture that asserts
 * against itself.
 */
describe('ethologist: starved past its own hunting threshold', () => {
  /** The real resolved roster, so no gate value in this suite is a literal. */
  const FACTS = speciesFactsOf(new SimulationEngine().world);
  const HYENA = FACTS.get('scavenger.hyena');
  const GRAZER = FACTS.get('herbivore.wildebeest');

  /** A carnivore at a stated fraction of its tank. */
  const predator = (energyFraction, overrides = {}) =>
    animal({
      speciesId: HYENA.id,
      maxEnergy: 130,
      energy: 130 * energyFraction,
      bodyMass: HYENA.bodyMass,
      action: 'wander',
      ...overrides,
    });

  const seeingPrey = { nearestPrey: { id: 9, distance: 4 } };

  /** The minimum counters that make `deniedHunt` fire, derived from `D`. */
  const denied = (extra = {}) =>
    tracker({
      preyInSightTicks: D.huntDeniedTicks,
      huntDeniedTicks: D.huntDeniedTicks,
      huntAllowedTicks: 0,
      ...extra,
    });

  test('the shipped hyena really does declare a gate, and it is what the detector reads', () => {
    // If this species ever stops declaring one the detector stands down rather
    // than firing on a default nobody chose — so the premise is worth pinning.
    assert.equal(typeof HYENA.minHungerToHunt, 'number');
    assert.equal(HYENA.huntsAnything, true);
    assert.equal(GRAZER.huntsAnything, false, 'and a grazer cannot reach this detector at all');
  });

  test('the accumulator counts a refused chance apart from a taken one', () => {
    const tr = tracker();
    // Comfortably fed: hunger is below the bar, so this is a chance refused.
    accumulateHuntGate(tr, predator(1 - HYENA.minHungerToHunt / 2), seeingPrey, HYENA);
    assert.deepEqual(
      { seen: tr.preyInSightTicks, denied: tr.huntDeniedTicks, allowed: tr.huntAllowedTicks },
      { seen: 1, denied: 1, allowed: 0 },
    );
    // Hungrier than the bar: the gate is open, and that is not a refusal.
    accumulateHuntGate(tr, predator(1 - HYENA.minHungerToHunt - 0.05), seeingPrey, HYENA);
    assert.deepEqual(
      { seen: tr.preyInSightTicks, denied: tr.huntDeniedTicks, allowed: tr.huntAllowedTicks },
      { seen: 2, denied: 1, allowed: 1 },
    );
  });

  test('⚠ nothing in sight is not a chance, refused or otherwise', () => {
    const tr = tracker();
    accumulateHuntGate(tr, predator(0.9), { nearestPrey: null, nearestCarcass: { id: 4 } }, HYENA);
    accumulateHuntGate(tr, predator(0.9), null, HYENA);
    assert.equal(tr.preyInSightTicks, 0);
    assert.equal(tr.huntDeniedTicks, 0);
  });

  test('a species that hunts nothing never accrues a refusal', () => {
    const tr = tracker();
    accumulateHuntGate(tr, animal({ speciesId: GRAZER.id }), seeingPrey, GRAZER);
    assert.equal(tr.preyInSightTicks, 0, 'a grazer with prey in its perception is not being refused a hunt');
  });

  test('⚠⚠ the gate value comes from the species, not from a constant in the tool', () => {
    // Same animal, same tick, two species-declared bars: one refuses it and the
    // other lets it go. A hardcoded threshold would make these agree.
    const lenient = { ...HYENA, minHungerToHunt: 0.1 };
    const strict = { ...HYENA, minHungerToHunt: 0.9 };
    const half = predator(0.5); // hunger 0.5, between the two
    const a = tracker();
    const b = tracker();
    accumulateHuntGate(a, half, seeingPrey, lenient);
    accumulateHuntGate(b, half, seeingPrey, strict);
    assert.equal(a.huntAllowedTicks, 1);
    assert.equal(b.huntDeniedTicks, 1);
  });

  test('the finding fires on the shape the hyenas died in, and says the numbers out loud', () => {
    const found = deniedHunt(predator(0), denied({ preyInSightTicks: 300, huntDeniedTicks: 270, huntAllowedTicks: 30 }));
    assert.equal(found, null, 'without facts it cannot know what the gate was');

    const real = deniedHunt(
      predator(0),
      denied({ preyInSightTicks: 300, huntDeniedTicks: 270, huntAllowedTicks: 30 }),
      HYENA,
    );
    assert.ok(real);
    assert.ok(real.suspicion > 5);
    assert.match(real.reason, /300 ticks/);
    assert.match(real.reason, /270 of them/);
    assert.match(real.reason, /open for only 30/, 'the "did it get chances" half is reported beside the refusals');
    assert.match(real.reason, new RegExp(String(HYENA.minHungerToHunt)), 'and it names the number to go and change');
  });

  test('⚠⚠ it is a conjunction, and each half alone is ordinary', () => {
    // Half one: plenty of refusals, but they are a small share of what this animal
    // saw. That is a predator that was hunting and failing — a capture-odds
    // finding, not this one.
    const busy = tracker({
      preyInSightTicks: D.huntDeniedTicks * 10,
      huntDeniedTicks: D.huntDeniedTicks,
      huntAllowedTicks: D.huntDeniedTicks * 9,
    });
    assert.equal(deniedHunt(predator(0), busy, HYENA), null);

    // Half two: refused nearly everything, but "everything" was a handful of
    // chances. A predator that saw prey twice is not evidence about a threshold.
    const few = tracker({ preyInSightTicks: 20, huntDeniedTicks: 20, huntAllowedTicks: 0 });
    assert.equal(deniedHunt(predator(0), few, HYENA), null);

    // Both together fire.
    assert.ok(deniedHunt(predator(0), denied(), HYENA));
  });

  test('an animal that never saw prey at all is a different finding', () => {
    assert.equal(deniedHunt(predator(0), tracker(), HYENA), null);
  });

  test('severity rises with the refusals and saturates, so one animal cannot own the shortlist', () => {
    const at = (n) => deniedHunt(predator(0), tracker({ preyInSightTicks: n, huntDeniedTicks: n }), HYENA).suspicion;
    const low = at(D.huntDeniedTicks);
    const mid = at(D.huntDeniedTicks * 3);
    const absurd = at(D.huntDeniedTicks * 500);
    assert.ok(low < mid, 'more refusals is a stronger case');
    assert.ok(absurd <= 9, `capped rather than unbounded (${absurd})`);
    assert.equal(mid, at(D.huntDeniedTicks * 3), 'and it is a pure function of the counters');
  });

  /**
   * `autopsy` needs a world only for its carcass scan. These are the two shapes
   * that scan can return, and nothing else about the world is read on the
   * starvation path.
   */
  const worldWith = (carcass) => ({
    grid: { queryRadius: () => (carcass ? [carcass.id] : []) },
    entities: { get: (id) => (carcass && id === carcass.id ? carcass : null) },
  });
  const CTX_1D = { facts: FACTS, waterCells: [], waterBySeason: { wet: [], dry: [] } };

  test('⚠⚠ the autopsy actually reaches it — the wiring, not just the detector', () => {
    // The detector can be right and never called. This is the path the sweep takes.
    const dead = predator(0, { deathCause: 'starvation', action: 'wander' });
    const verdict = autopsy(worldWith(null), dead, denied(), CTX_1D);
    assert.ok(verdict.suspicion >= D.minFlag);
    assert.match(verdict.reason, /minHungerToHunt/);
  });

  test('⚠ a lifetime of refusals outranks a carcass somebody else was standing on', () => {
    // Kleptoparasitism is documented as "not a bug" and scores 1. A carcass held
    // at the moment of death is a fact about one tick; being refused hunts is a
    // fact about a whole life, and it is the better explanation when both are
    // true. ⚠ The order is load-bearing: below this line the hyena deaths score 1
    // and sink under every other species' findings.
    const dead = predator(0, { deathCause: 'starvation', x: 20, y: 30 });
    const held = { id: 77, kind: 'carcass', x: 20.5, y: 30.5, possessorId: 42 };
    const verdict = autopsy(worldWith(held), dead, denied(), CTX_1D);
    assert.match(verdict.reason, /minHungerToHunt/);
    assert.ok(verdict.suspicion > 1);
  });

  test('⚠ but food it could actually have eaten, two cells away, still outranks it', () => {
    // An unclaimed carcass within reach is the stronger and more local claim: the
    // fix for the thing that killed it was *right there* and needed no hunt.
    const dead = predator(0, { deathCause: 'starvation', x: 20, y: 30 });
    const free = { id: 78, kind: 'carcass', x: 20.5, y: 30.5, possessorId: null };
    const verdict = autopsy(worldWith(free), dead, denied(), CTX_1D);
    assert.match(verdict.reason, /unclaimed carcass/);
  });

  test('a healthy predator that starved with no refusals behind it scores nothing', () => {
    // The negative the file header requires of every detector here: a detector
    // that fires on everything is as useless as one that never fires.
    const dead = predator(0, { deathCause: 'starvation' });
    const ordinary = tracker({ preyInSightTicks: 40, huntDeniedTicks: 10, huntAllowedTicks: 30, everPerceivedFood: true });
    assert.equal(autopsy(worldWith(null), dead, ordinary, CTX_1D).suspicion, 0);
  });
});
