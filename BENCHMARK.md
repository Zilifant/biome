# Performance baseline

Baseline established in **PLAN.md Step 1**. Every later step that changes
hot-path behavior should re-run `npm run benchmark` and compare against these
numbers. This is a **reporting baseline, not a CI gate** — timings are
machine-dependent, so tests never assert absolute times (only the amortized
event-bus test uses a deliberately generous bound).

## How to reproduce

```bash
npm run benchmark                 # human-readable table
npm run benchmark -- --json       # machine-readable
npm run benchmark -- --ticks=5000 --seed=7
```

The script (`src/scripts/benchmark.js`) runs the demo world headless (no
server, no renderer, no real-time pacing) across scaled entity counts.
⚠ Since 2026-08-04 `demo-default` takes **both** its dimensions and its roster from
the config, so it tracks the demo without anyone remembering to edit it; the three
scale scenarios still state their own dimensions and rosters, and inherit
`config.terrain`. Each
scenario warms up 50 ticks (JIT steady state) before timing the remainder,
and reports start→end entity counts because populations change over the run
(births, age deaths, carcasses). It also verifies two identical 2000-tick runs
serialize byte-for-byte identically, so a benchmark run doubles as a
determinism check.

## Environment

| | |
| --- | --- |
| Node | v23.4.0 |
| Platform | darwin arm64 (Apple Silicon) |
| Seed | 42 |
| Ticks per scenario | 2000 (50 warmup + 1950 measured) |
| Determinism (2000 ticks) | OK (byte-identical) |

## ⚠ Re-baseline in the same session, and interleave

The single most useful thing learned about this file on 2026-07-28: **a
"before" number taken at a different hour is not a baseline.** The same
unmodified HEAD measured

| when | large-5k |
| --- | ---: |
| 2026-07-28 afternoon | 68.70 / 69.18 / 70.64 / 72.09 ms/tick |
| 2026-07-28 evening | 76.21 / 78.94 ms/tick |

— a ~10% drift with no code change at all. Compare **distributions**, taken
back-to-back in one session, with the runs interleaved:

```bash
npm run benchmark                       # the tree
git stash push -u && npm run benchmark  # HEAD
git stash pop && npm run benchmark      # the tree again
```

Two single readings a few percent apart are not a result. HEAD at 69.2–72.1
against a tree at 78.2–79.4 is one, because the ranges do not overlap — that is
how phase 2's real 12% regression (DOCS §16 D28) was separated from drift.

### Persistent group registry (2026-07-28 evening, PLAN-SPECIES.md phase 3)

| arm | large-5k |
| --- | ---: |
| tree (registry) | 77.70, 78.30 ms/tick |
| HEAD | 76.21, 78.94 ms/tick |

Interleaved, and the ranges overlap completely: **flat**. Expected, and worth
saying why rather than just recording it — `GroupSystem`'s first branch asks
whether any species in the world forms persistent groups, and none does, so the
per-animal loop and its neighbour reads are never reached. Entity counts are
identical to the animal (5733→7780), and the demo serializes byte-identically
across three seeds.

### Predation structure (2026-07-28 late, PLAN-SPECIES.md phase 4)

⚠ The machine drifted again between the phase-3 and phase-4 measurements — the
same HEAD that read 76–79 earlier in the evening reads **84** here — so only the
rows below are comparable to each other.

| arm | large-5k |
| --- | ---: |
| HEAD (phase 3) | 84.55, 83.94 ms/tick |
| tree, **possession off** | 84.73 ms/tick |
| tree, possession on | 85.33, 85.11 ms/tick |

Two conclusions, and the middle row is what separates them:

- **The perception change is free.** Phase 4 put a prey-mass gate inside the
  neighbour loop and changed `#perceive` to take the whole species record instead
  of its `perception` block — the exact shape of code D28 charged 12% for. With
  possession switched off the tree lands at 84.73 against HEAD's 83.94–84.55,
  with **identical entity counts** (5733→7780), so the gate and the extra
  property loads cost nothing measurable.
- **Possession costs ~0.5–1.5%**, and that is real work rather than a
  regression: holder lookups, dominance comparisons, and contests that HEAD does
  not perform. ⚠ It is also at the edge of what whole-simulation timings can
  resolve at all (D24: run-to-run spread is ±10%, and ~1% is not a result), which
  is precisely why the isolating middle row exists rather than a bare before/after
  pair.

### Batch 1: the hyena joins every scenario (2026-07-29, PLAN-SPECIES.md phase 7)

⚠ **The scenario roster changed, so every figure above this line describes a
different world.** Phase 7 added `scavenger.hyena` to all four scenarios at the
demo's own 120:8:10:6 ratio, which is ~4% more animals — and it is the first
species that makes `GroupSystem` do real work, because until now nothing formed
persistent groups and the system early-returned every tick.

Full run, all four scenarios, on the new roster:

| Scenario | World | Start→end entities | ms/tick | ticks/sec |
| --- | --- | ---: | ---: | ---: |
| demo-default | 128×128 | 144→187 | 1.2458 | 803 |
| small-100 | 256×256 | 120→155 | 0.8357 | 1197 |
| medium-1k | 512×512 | 1197→1518 | 10.8334 | 92 |
| large-5k | 1024×1024 | 5983→7633 | **75.725** | 13 |

⚠ **Do not read 75.7 against the 68.75 above as a 10% regression.** They are
different populations. To separate the species' cost from both the extra animals
and machine drift, medium-1k was run **interleaved in one process**, alternating
the two rosters three times each:

| arm | medium-1k (3 runs) | mean | animals alive |
| --- | --- | ---: | ---: |
| without hyena | 8.05, 8.33, 8.86 | 8.41 | 1165 |
| with hyena | 8.56, 8.77, 8.93 | 8.75 | 1193 |

**+4.0% total for +2.4% more animals — so ~+1.6% per animal**, which is the
group registry finally doing work: founding, joining, dissolution, and the
membership reads that HEAD skipped entirely at its first branch.

⚠ **The within-arm spread is larger than the between-arm difference** (8.05→8.86
against a 0.34 ms gap), so the means alone would prove nothing. What makes this a
result is that the hyena arm is slower in **all three rounds**, each measured
seconds after its own control. That is the whole argument for interleaving, and
it is why this table has three rounds rather than one reading each.

### The hidden-fawn stage (2026-07-29, PLAN-SPECIES.md phase 8)

Interleaved medium-1k, three rounds alternating `parenting.concealment` off and
on — the same roster and the same seed, so only the mechanism differs:

| arm | medium-1k (3 rounds) | mean | animals alive |
| --- | --- | ---: | ---: |
| concealment off | 8.82, 8.65, 8.71 | 8.73 | 1193 |
| concealment on | 8.56, 8.71, 8.66 | 8.64 | 1190 |

**Flat** (−1.0%, ranges overlapping completely). ⚠ And note the difference from
the hyena measurement above: there the arm was slower in **all three** rounds,
which is what a real cost looks like; here the "on" arm is faster in two rounds
and slower in one, which is what **no effect** looks like. The ordering across
interleaved rounds is the signal — not the means.

Expected, and worth saying why rather than only recording it: the per-animal work
is one `hiddenUntilFor` read that returns 0 for every species but the gazelle, and
`#hiddenWard` early-outs on that same read before it ever touches the `offspring`
list. The two new utility slots are in the object every animal already builds.

### Forage guilds and habitat preference (2026-07-29, PLAN-SPECIES.md phase 9)

Interleaved medium-1k, three rounds alternating both switches
(`forage.enabled` + `habitat.enabled`) off and on — same roster, same seed:

| arm | medium-1k (3 rounds) | mean | entities alive |
| --- | --- | ---: | ---: |
| preference off | 9.68, 9.58, 9.74 | 9.664 | 1167 |
| preference on | 9.67, 9.78, 9.62 | 9.693 | 1167 |

**Flat** (+0.3%): the "on" arm is slower in **1 of 3 rounds**, which by the rule
above is what no effect looks like. ⚠ Note the entity counts are **identical at this
horizon**, so the comparison is not quietly measuring a population difference — worth
checking whenever a behavioural change is benchmarked, because a mechanism that
changes how many animals are alive changes ms/tick for a reason that has nothing to
do with its own cost.

Expected, and the reason is a design choice rather than luck: **maturity is the
standing crop**, so scoring the forage ring reads nothing it was not already reading
(one multiply per sample), and the habitat cue is a second ring of *terrain* reads
paid every ten ticks by the one species that declares a preference. A first design
scored maturity as `biomass / capacity`, which would have added a second grid read per
sample; it was rejected for ecological reasons (DOCS §9 Feeding) and would have cost
here too.

### Cooperative action (2026-07-30, PLAN-SPECIES.md phase 10)

Interleaved medium-1k, three rounds alternating all three phase-10 switches
(`cooperation.enabled` + `mobbing.enabled` + `decision.defendTargeted`) off and
on — same roster, same seed, 400 ticks per run:

| arm | medium-1k (3 rounds) | mean | entities alive |
| --- | --- | ---: | ---: |
| phase 10 off | 9.143, 9.561, 8.982 | 9.229 | 1147 |
| phase 10 on | 9.206, 9.142, 9.221 | 9.190 | 1147 |

**Flat** (−0.4%, and the "on" arm is slower in **2 of 3** rounds with the ranges
overlapping completely — the ordering says no effect either way). Entity counts are
**identical**, so this is not quietly measuring a population difference.

Expected, and by construction rather than by luck: **every shipped species leaves
`hunting.cooperationWeight` and `behavior.mobWeight` at 0**, and both mechanisms ask
that question first — so a hunt pays one property read before skipping the
co-attacker count, a prey animal pays one before skipping the mob query, and neither
ever reaches a grid query. The only work that actually runs in this world is
`defendTargeted`'s single `huntTargetId` lookup, taken by an adult that has both a
perceived threat and living young — measured at **0.8–1.5%** of adult-ticks having a
threat at all, before the offspring test.

### Batch 2: the lion and buffalo join every scenario (2026-07-30, phase 11)

⚠ **The scenario roster changed again, so every figure above this line describes a
different world.** Phase 11 added `herbivore.buffalo` and `predator.lion` to all
four scenarios at the demo's own 120:35:8:8:10:6 ratio — **~30% more animals**,
and animals that weigh 600 kg.

Full run, all four scenarios, on the new roster:

| Scenario | World | Start→end entities | ms/tick | ticks/sec |
| --- | --- | ---: | ---: | ---: |
| demo-default | 128×128 | 187→222 | 1.8209 | 549 |
| small-100 | 256×256 | 156→190 | 1.1487 | 871 |
| medium-1k | 512×512 | 1556→1868 | 15.4633 | 65 |
| large-5k | 1024×1024 | 7774→9305 | **106.5133** | 9 |

To separate the two species' cost from the extra animals and from machine drift,
medium-1k was run **interleaved in one process**, alternating the two rosters
three times each:

| arm | medium-1k (3 rounds) | mean | entities alive |
| --- | --- | ---: | ---: |
| batch 1 roster | 8.881, 8.892, 8.609 | 8.794 | 1147 |
| batch 2 roster | 12.237, 12.302, 11.964 | 12.168 | 1501 |

**+38% total for +31% more animals — so ~+5.7% per animal** (7.667 → 8.106 µs),
and the batch-2 arm is slower in **all three** rounds, which by this file's rule is
what a real cost looks like rather than noise.

⚠ **The cost is not the new mechanisms.** Cooperation and mobbing both ask a
per-species weight first and never reach a grid query for a species that declares
none, and both fire only at a capture attempt. What actually moved is the
**long-range cue**: the buffalo is the second species in the world to carry a
`migration.cueRadius`, and it carries *two* rings — forage and habitat — so 292
buffalo do per-animal gradient work that the batch-1 roster only ever paid for
gazelle. A species with `cueRadius: 0` is close to free; one with a cue is not.

**Standing figure with phase 10 in place:** large-5k **80.86 ms/tick**
(2026-07-30, 5983→7546 entities; demo-default 1.3337, small-100 0.8825, medium-1k
11.1659). ⚠ Not comparable to phase 9's 79.06 either — the interleaved A/B above
measured phase 10 **flat**, and this reading is a different session on a machine
known to drift ~10% on identical code.

**Standing figure with phase 9 in place:** large-5k **79.06 ms/tick**
(2026-07-29, 5983→7579 entities). ⚠ **Do not read that against phase 7's 75.7 as a
regression.** It is a different session — the machine drifted ~10% across a single day
on identical code, which is why this file's rule is to interleave — and phase 9
changes the population trajectory, so the end-entity counts differ. The interleaved
A/B above is the measurement; this is only the dated reading.

### Batch-3 prerequisites (2026-07-30, PLAN-SPECIES.md phase 12)

Heterospecific association (§3.16) and seasonal breeding windows (§3.11), both
inert — no species declares either — so this is a measurement of what a mechanism
nobody uses costs to have in the tree.

Interleaved against HEAD (phase 11), alternating arms three times each. ⚠ Two
scenarios rather than one, because the change is inside `SocialSystem`'s
**neighbour** loop: cost there scales with how many animals are in range of each
other, which is exactly what large-5k has more of.

| arm | medium-1k (3 rounds) | mean | large-5k (3 rounds) | mean |
| --- | --- | ---: | --- | ---: |
| phase 11 (HEAD) | 14.382, 14.584, 14.201 | 14.389 | 88.696, 90.394, 85.027 | 88.04 |
| phase 12 | 14.665, 14.591, 13.486 | 14.247 | 84.683, 86.452, 85.531 | 85.56 |

**Flat.** At medium-1k phase 12 loses one round, ties one, and wins one; at
large-5k it wins two and loses one. By this file's rule — a real cost is slower in
*every* round — that is noise in both directions, and the nominal 2.8% "win" at
large-5k is drift rather than an improvement.

Free by construction, and each half for its own reason:

- **Association** adds one boolean to the neighbour loop and nothing else, because
  the declaring-species map is empty: the system asks "does any species in this
  world associate?" once per world (the `GroupSystem` early-out, copied) and the
  loop's first comparison still drops every animal of another species.
- **A breeding window** is one `null` check inside `isReproductivelyReady`, which
  is reached once per adult per tick and already does more work than that.

Full run on the final tree: demo-default **1.9067**, small-100 **1.4386**,
medium-1k **16.5913**, large-5k **112.83 ms/tick** (7774→9305 entities, identical
to phase 11's counts). ⚠ **That is not a regression against phase 11's 106.51** —
same roster, same seed, same end population, and the interleaved A/B above says
flat. It is the same machine drift this file exists to warn about: HEAD itself
measured 85–90 ms/tick at large-5k in the interleaved rounds an hour earlier, so a
single dated reading spans ±25% depending on when it is taken. **Interleave, or do
not compare.**

### Batch 3: the wildebeest and zebra join every scenario (2026-07-30, phase 13)

⚠ **The scenario roster changed again, so every figure above this line describes a
different world.** Phase 13 added `herbivore.wildebeest` and `herbivore.zebra` to
all four scenarios at the demo's own 120:30:15:35:8:8:10:6 ratio — **+24% more
animals**, and two more species carrying a `migration.cueRadius`.

Full run on the new roster:

| Scenario | World | Start→end entities | ms/tick | ticks/sec |
| --- | --- | ---: | ---: | ---: |
| demo-default | 128×128 | 232→276 | 2.2178 | 451 |
| small-100 | 256×256 | 194→221 | 1.3564 | 737 |
| medium-1k | 512×512 | 1931→2237 | 18.3212 | 55 |
| large-5k | 1024×1024 | 9649→11195 | **130.2420** | 8 |

To separate the two species' cost from the extra animals and from machine drift,
medium-1k was run **interleaved in one process**, alternating the two rosters three
times each — no `git stash` needed, because a roster is config:

| arm | medium-1k (3 rounds) | mean | entities | per animal |
| --- | --- | ---: | ---: | ---: |
| batch 2 roster | 13.051, 13.092, 12.830 | 12.991 | 1541 | 8.430 µs |
| batch 3 roster | 16.785, 16.647, 16.328 | 16.587 | 1910 | 8.684 µs |

**+27.7% total for +24.0% more animals — so ~+3.0% per animal**, and the batch-3
arm is slower in **all three** rounds, which by this file's rule is a real cost
rather than noise.

⚠ **It is the long-range cue again, and this is now three phases of the same
finding.** Phase 11 measured +5.7% per animal for the buffalo and lion and located
it in `migration.cueRadius` rather than in any of the new mechanisms; batch 3 adds
two more cue-carrying species (both at 20, the widest in the roster) and costs
about half as much per animal, which is what you would expect from two cue rings
and no 600 kg body. **A species with `cueRadius: 0` is close to free; one with a
cue is the expensive kind.** Everything phase 12 built stayed free here — no
species-count term appears in the association early-out, and a breeding window is
one comparison.

### Batch 4: the leopard and cover concealment (2026-07-30, PLAN-SPECIES.md phase 14)

The roster did **not** change size — `predator.stalker` became `predator.leopard`
at the same count — so unlike phases 11 and 13 the figures here are comparable to
phase 13's on population grounds. What is new is a mechanism inside the hottest
loop in the engine, which is what §3.12 warned about.

Concealment on against off, interleaved in one process (it is a config A/B, so no
`git stash` and no drift), medium-1k, three rounds each:

| arm | medium-1k (3 rounds) | mean | entities |
| --- | --- | ---: | ---: |
| concealment off | 16.544, 16.669, 16.737 | 16.650 | 1898 |
| concealment on | 17.094, 17.053, 17.115 | 17.087 | 1905 |

**+2.6%**, slower in all three rounds — a real cost by this file's rule rather than
noise, and a small one.

⚠ **§3.12 called this "possibly the most expensive item in this document per unit
of realism", and it was wrong in the useful direction.** Its fear was that grading
sight would make every ray *accumulate* concealment rather than early-exit on the
first opaque cell. Nothing accumulates. **Opacity became the top of the concealment
scale rather than a second pass over it**: the terrain keeps a derived boolean array
for the raycast, so `hasLineOfSight` does exactly the array read and branch it did
before, and the new work is one cell read per neighbour *that already has line of
sight* — skipped entirely for the seven species that declare no `crypsis`.

Full run on the final tree: demo-default **2.3195**, small-100 **1.3494**, medium-1k
**18.8874**, large-5k **129.0233 ms/tick** (9649→11094 entities). ⚠ Against phase
13's 130.24 at the same roster size that is **flat** — the two readings differ by
0.9% on a machine this file has repeatedly measured drifting ±25%, and the
interleaved A/B above is the actual measurement.

## Re-baseline: the demo becomes the ngorongoro world (2026-08-04)

`config.demo`, `config.world` and `config.terrain` became the
`ngorongoro-500-10x` composition — 332×280, `roundness: 4`, the four terrain
formation counts doubled, ~500 founders. Full run, seed 42, 2000 ticks per
scenario, determinism check OK:

| Scenario | World | Start→end entities | ms/tick | ticks/sec |
| --- | --- | ---: | ---: | ---: |
| demo-default | 332×280 | 500→516 | **5.5224** | ~181 |
| small-100 | 256×256 | 194→226 | 1.6554 | ~604 |
| medium-1k | 512×512 | 1931→2255 | 20.9540 | ~48 |
| large-5k | 1024×1024 | 9649→11173 | **133.7257** | ~7 |

⚠⚠ **`demo-default` is not comparable with anything above it in this file, and
that is the row working correctly.** It reads its roster from
`config.demo.founding` now instead of restating it (before 2026-08-04 the two were
a hand-copied match), so it follows the demo by construction. Its earlier
figures — 1.008 on 2026-07-21, 2.3195 on 2026-08-01 — describe a 160×120 world
holding ~190 animals; this one describes 332×280 holding ~500. Not a regression, a
different world.

⚠ **`large-5k` is comparable, and it is flat: 133.73 against 134.46 on
2026-08-01** (+0.5%, against the ±10% same-HEAD drift documented above). That is
the useful reading here — the change moved numbers in `config` and nothing in the
hot path, and the benchmark agrees. Its end count moved 11094 → 11173 because the
three scale scenarios specify only their dimensions and inherit `config.terrain`,
so they picked up the rim and the doubled formation counts along with the demo.

⚠ Not measured this session: a fresh per-system breakdown. The one below is from
2026-07-21 and the roster has grown twice since.

## Results (post-Step-30)

Measured **2026-07-21**, both columns on the same machine on the same day —
which is the only way these are comparable (see DOCS.md, "How to read this
document").

| Scenario | World | Start→end entities | ms/tick | before Step 30 | ticks/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| demo-default | 128×128 | 138→188 | 1.008 | 1.231 | ~992 |
| small-100 | 256×256 | 115→150 | 0.671 | 0.841 | ~1,491 |
| medium-1k | 512×512 | 1147→1556 | 9.230 | 11.566 | ~108 |
| large-5k | 1024×1024 | 5733→7744 | **68.75** | 86.59 | ~15 |

**Start and end entity counts are unchanged by Step 30, to the animal.** That is
the point: it optimized nothing but the cost of computing the same world. The
same seeds serialize byte-identically before and after.

Since Step 16 each scenario seeds **predators alongside prey** at roughly the
demo's ratio, so these numbers describe a mixed population, not a
herbivore-only world. The `demo-default` row also grew from 8 animals to 64:
a working predator/prey demo needs enough prey density for encounters to
happen at all.

"entities" are animals and carcasses (Step 3 replaced the demo plant entities
with a cell-level vegetation biomass field, so vegetation cost scales with
world size, not entity count). End counts now *exceed* the start because
animals reproduce (Step 12). All scenarios sit far under the one-second
authoritative tick budget.

### Behaviour fixes: obstacle deflection, thermoregulation, the shelter cue (2026-08-01, A65/A67/A68)

Three defect fixes, and one of them found the **most expensive line this project
has ever written into the perception scan**. Everything below is a same-session
re-baseline at `--ticks=1200` (§"Re-baseline in the same session"), so the numbers
are comparable to each other and to nothing above this line.

large-5k, 9649 → ~10 220 entities:

| build | ms/tick | vs baseline |
| --- | ---: | ---: |
| unmodified main, re-baselined today | 130.63 | — |
| **shipped** (all three fixes) | **134.46** | **+2.9%** |
| all three, shelter cue via `sheltersAt` behind a `hasFeatures` guard | 203.22 | +55.6% |
| all three, shelter cue calling `sheltersAt` unconditionally | ~218 | +67% |
| all three, shelter cue left COVER-only (i.e. A68 not fixed) | 133.54 | +2.2% |

⚠⚠ **The lesson, and it is a new one only in its address: nothing in the
`(2r+1)²` cell scan may consult a second grid.** A68's honest fix is "report
anything `isShelteredAt` calls shelter", and `isShelteredAt` counts burrows, which
live on the **feature** grid. One `sheltersAt(features, cx, cy)` per cell cost
**+56% of a whole tick**. The `featureCount === 0` early-out inside it does not
save you: any world with **trails** has features, which is all of them, so the
guard is true and the call runs for essentially every cell of every scan of every
animal. Guarding it at the call site with a hoisted boolean changed nothing for
the same reason.

The shipped cue is therefore **terrain-only**, indexing a `Uint8Array`
(`SHELTERING_BY_CODE`) that `World.isShelteredAt` reads too — so the definition
still has one home, and the hot path is one typed-array load rather than a call.
⚠ Measured behavioural cost of excluding burrows: **none.** The "shelter in range
but not reported" rate is 1.5% either way on seed 1, so the exclusion buys 56% of
a tick for nothing.

The residual **+2.9%** is the rest of the work — the shared step predicate in
movement, the frailty term in metabolism, and the detour check in decision — and
it is recorded rather than absorbed because §13 puts the noise floor at ~1%. The
detour was A/B'd on its own switch and is **not** in it: `detourEnabled: false`
measured 230.44 against 218.32 with it on, i.e. inside the variance of the
then-current (slow) build.

### Trees (2026-08-03, TREES-FLIGHT-VULTURE-PLAN.md phase T1)

**Flat — and the first three readings said +7.1%, which is the reason this
section is worth reading.** Trees add a seventh terrain code and a generation
pass; nothing reads terrain differently, so the expectation was flat and the
first interleave contradicted it.

large-5k at the default `--ticks=2000`, alternating whole `npm run benchmark`
runs between this tree and a clean HEAD checkout:

| pass | tree (trees on) | HEAD (no trees) |
| --- | ---: | ---: |
| set 1 | 145.23, 145.52 | 135.61 |
| set 2 | 140.26, 140.48 | 141.64, 142.67 |

⚠ **Set 1 looked like a real +7.1% by this file's own rule** — slower in both
tree rounds, with the HEAD round taken *between* them, which is supposed to
control for drift. Set 2, run immediately afterwards by the same command, has the
tree **faster than HEAD in both passes**. Pooled, the ranges overlap completely
(tree 140.3–145.5, HEAD 135.6–142.7) and there is no effect to report.

⚠⚠ **Interleaving is not immunity to drift, and that is new.** Every warning in
this file so far has been about comparing numbers taken at different *hours*;
this pair was taken minutes apart, alternating, and still moved 7%. The
distribution has to be built from **several** alternations, not one A/B/A.

The decisive measurement was a different one, and it is the one to copy: trees on
against trees off **in a single process and a single binary**, three interleaved
rounds — `+1.3%, −4.2%, −0.5%`. Mixed direction is what no effect looks like, and
unlike the cross-tree runs it cannot be confounded by anything outside the world
itself. ⚠ It also separates a question the cross-tree benchmark **cannot**: "does
the tree code cost anything" from "does having trees in the world cost anything".

Expected to be flat, and the reason is worth stating: a tree is one more entry in
four tables that were already indexed by terrain code, so every chokepoint does
exactly the array load it did before. The generation pass runs once at
construction, which is outside the timed window. And ⚠ at large-5k trees are
~**0.12%** of a 1024² map anyway — `treeGroves`/`treeSingles` are absolute counts
like `ridges` and `thickets`, so they do not rescale with the world.

### Flight (2026-08-04, TREES-FLIGHT-VULTURE-PLAN.md phases F1/F2)

**Not resolvable at the demo's roster; +47% in a world made of the affected
species.** Both numbers are true, they are about different questions, and the pair
is the most useful thing in this section.

Flight's only per-tick cost is a **wider perception radius while airborne**, which
the plan named as the performance risk of the whole plan. The mitigation was to move
the number rather than add one: the vulture's ground radius went 14 → 9 and
`flight.visionMultiplier` is 1.55, so a *flying* vulture sees 13.95 — the radius it
always had — and the world's maximum radius does not move. What remains is that a
grounded vulture scans 9 and a flying one scans 13.95, which is `(2r+1)²` =
**2.25× the cell scan**, paid on ~76% of a flier's animal-ticks.

In-process A/B (`flight.enabled` on against off, one binary, one process, alternating
the order each round — the form T1 established as decisive):

| scenario | vulture share of animals | rounds | verdict |
| --- | ---: | --- | --- |
| large-5k | 4.2% (founding) | −1.2, +6.2, −19.7, −19.7, +16.8, +5.0, −15.4 % | **mixed — no effect resolvable** |
| demo-default, 2000 ticks | 4.2% (founding) | −9.0, −17.8, −11.2, +8.2 % | **mixed — no effect resolvable** |
| **vultures-only**, 4000 birds | 100% | **+23.4, +43.7, +51.8, +76.9 %** | **a real cost, every round** |

⚠⚠ **The whole-world benchmark did not fail to find the cost; it was asked to
resolve ~2% inside a ±20% spread.** 0.042 of the roster × 2.25× the scan × 0.76 of
their ticks × perception's ~53% share of a tick ≈ **+2% of a tick** — below this
machine's noise on the day and above §13's 1% floor, i.e. exactly the band where a
whole-system timing is worthless. **D24 is the rule that resolves it: benchmark the
thing you changed, at a volume where it dominates.** A vulture-only world makes the
same change ~24× more visible and it appears immediately, in the predicted direction,
in every round.

⚠⚠ **And the benchmark scenarios understate the demo, which nothing in this file
warned about before.** Every scenario here is a **founding** ratio, and the demo's
vulture population *grows*: 4.2% of founders, **~60% of the living population by
t15 000** (295 of ~494 on the ten-seed gate). So the steady-state demo is nearer the
vultures-only row than the large-5k one. When a mechanism's cost scales with one
species' share of the population, a founding-ratio benchmark measures the world at
tick 0, not the world anyone watches.

⚠ **A cross-tree re-baseline was declined rather than forgotten.** T1's section
above established that a cross-tree run cannot separate "the code costs something"
from "the world contains something" — and here the two arms' *populations differ*
(the vulture arm ends with 8.4% more birds), so a cross-tree number would be
measuring the second question while appearing to answer the first.

### The herd radius (2026-08-05, BEHAVIOR-PLAN.md P0/P1)

**P0 is free; P1 costs +9.7% of a demo tick — and the first number this
measurement produced was +21%, which was mostly the *world* rather than the
code.** That mistake, and how it was caught, is the useful part.

P0 split the neighbour walk from the perception radius so a species may herd
wider than it sees; P1 gave the wildebeest and the buffalo `behavior.herdRadius:
11` against a perception radius of 7. Those two are **53% of the demo's founding
animals**, so `grid.queryRadius` runs over `(11/7)²` ≈ 2.5× the cells for half the
roster. This is D24's shape — benchmark the thing you changed, where it dominates
— and the demo happens to be exactly that world.

Interleaved, in one session, three arms, 2000 ticks after a 200-tick warmup:

| arm | demo world | vs control |
| --- | ---: | ---: |
| control (pre-P0) | 6.389 ms/tick | — |
| **P0 only** (`social.perSpeciesRadius: false`) | 6.397 ms/tick | **+0.1%** |
| P0 + P1 (`herdRadius: 11`) | 7.731 ms/tick | +21.0% |

⚠⚠ **The +21% is not the mechanism's cost, and the tell was a non-monotonic
row.** Priced at radius 9 and 10 the same way, radius **10 came out slower than
11** (8.66 against 7.73), which no cost model produces. The arms had diverged: a
2000-tick run of a changed demo is a *different world*, with a different
population doing a different amount of work, and the timing was reporting that
rather than the query. Re-measured over 400 ticks — short enough that the arms
still hold the same animals — with entity counts printed beside each figure so the
confound cannot hide again:

| arm | demo world | entities | vs control |
| --- | ---: | ---: | ---: |
| control (pre-P0) | 4.910 ms/tick | 499 | — |
| P1 @ `herdRadius: 9` | 5.175 ms/tick | 501 | +5.4% |
| P1 @ `herdRadius: 11` | 5.386 ms/tick | 501 | **+9.7%** |

Monotonic in the radius, as a cell-count argument says it must be, and ~10% for
half the roster scanning 2.5× the area is the right order. **11 is kept**: the
wildebeest founds in cohorts of fifteen at `spread: 6`, so a herd is twelve units
across and a radius of 9 would leave an animal on one edge steering at a centre
built from a fraction of its own herd — which is the defect P1 exists to fix.

⚠⚠ **And +9.7% is the tick-400 figure. The settled world costs +48%, and the
reason is the mechanism working.** Measured back-to-back on seed 7, 5000 ticks,
via `test/determinism.test.js`'s wall-clock smoke test:

| arm | 5000 ticks | living animals at t5000 | carcasses |
| --- | ---: | ---: | ---: |
| control (pre-P0) | 42.2 s | 679 | 99 |
| P0 + P1 | 62.6 s | **598** | 145 |

**The tree is 12% *emptier* and 48% slower**, so this cannot be read as "more
animals to simulate" — it is the opposite of that. `grid.queryRadius` costs what
is *inside* the radius, and P1's whole purpose is to make the wildebeest and the
buffalo stand closer together. A tighter herd is more neighbours per query, and
the list is then walked again by `SocialSystem`. So the cost is superlinear in the
clumping the feature exists to produce, and it is invisible at tick 400 because
the herds have not tightened yet.

⚠ **This is the Flight section's lesson arriving from the other direction.** There,
a founding-ratio benchmark understated a mechanism because the species' *share of
the population* grew. Here, a short-window benchmark understates one because the
species' *density* grows. Same defect: the arms were compared in a world neither
of them had shaped yet. When a mechanism changes where animals stand, measure it
after they have stood there.

⚠ P1 also moves the demo's populations on this seed — buffalo 116→74, wildebeest
303→245, gazelle 106→126, carcasses 99→145. **One seed is not a result** (§20: five
cannot resolve a one-seed difference, let alone one), and BEHAVIOR-PLAN defers
balance explicitly, but the direction is worth recording: the two species that
declare a herd radius are the two that fall. The 3-seed exploratory sweep the plan
schedules after P5 is where this gets characterized.

⚠ **P0 being free is a result, not an absence of one.** It widens
`grid.queryRadius` (a bounding-box cell walk) and deliberately **not** the
`(2r+1)²` cell scan or the line-of-sight raycast — those stay on the perception
radius, behind the new `distance > radius` gate. The quadratic loop that owns ~53%
of a tick never moves, which is why half the roster can walk 2.5× the area for
~10% rather than for the ~50% a widened `perception.radius` would have cost.

⚠ **`config.social.perSpeciesRadius` is wired into two systems on purpose.** The
first cut gated only `SocialSystem`, on the sound argument that a wider list is
transient and distance-gated and so cannot change an outcome. It cannot — but the
off arm then still *paid* for the walk, and the middle row above is the whole
reason this section can attribute anything. A control arm that does not restore
the cost cannot answer "what did this cost", which is the same lesson phase 4's
possession-off row taught.

### The association pull (2026-08-05, BEHAVIOR-PLAN.md P3)

**The mechanism is free; the *declaration* costs ~3%, and it stays ~3% in the
settled world — which is the thing the P1 section above says to go and check.**

P3 added a second per-species field, `associationPull`, published as `pullScale` on
the group summary and spent on the herd distance. It also gave the **wildebeest an
association with the zebra**, and that is the half with a price: a species holding a
non-null association map stops dropping heterospecific neighbours on the first
comparison, and the wildebeest is a third of the roster.

Both arms measured on seed 42, 450 ticks (a 50-tick warmup then 400 timed), five
interleaved rounds, round 1 discarded as JIT, **entity counts printed and matched at
501** — D24's shape and the trap the P1 row above fell into:

| arm | demo world | entities |
| --- | ---: | ---: |
| P2 tree (no wildebeest association) | 4.91 ms/tick | 501 |
| **P3 shipped** | 5.08 ms/tick | 501 |
| P3 with `association.scalesPull: false` | 5.26 ms/tick | 501 |

So the wildebeest's association is **+3.5%** and the pull machinery is **not
resolvable** — the third row is *slower* than the second, which cannot be a cost and
is the switch changing behaviour: a loosely-held gazelle herds less often, and a
`herd` action is not free. A control arm that changes what animals do is not a
control for what code costs, and this is what that looks like when it happens to
land the right way round.

⚠ **The settled world, because P1 proved a tick-400 figure can understate one of
these by 5×.** Same method as P1's: seed 7, 5000 ticks, back to back.

| arm | 5000 ticks | living at t5000 | carcasses |
| --- | ---: | ---: | ---: |
| P2 tree | 81.0 s | 491 | 242 |
| **P3 shipped** | 83.4 s | **538** | 205 |

**+3.0%, and the tree is carrying 9.6% *more* animals** — so unlike P1 this does not
grow with settling, and a share of the 3% is simply more bodies. The reason is
structural: P1 widened `grid.queryRadius` and then tightened the herds *inside* that
radius, which is superlinear in the clumping it produces; P3 changes nothing about
the query and only re-weights a list that was already walked.

⚠ One seed is not a result (§20), but the population direction is worth recording
against P1's: P1 cost the two herd-radius species animals, and P3 gives some back.
The 3-seed exploratory sweep BEHAVIOR-PLAN schedules after P5 is where this gets
characterized.

### Where the time goes (large-5k, measured 2026-07-21)

Per-system wall clock, taken by wrapping every registered system's `update`.
The left column is the state Step 30 inherited; the right is after it. Both are
300-tick runs at ~5.7k entities, so they are comparable to each other but not to
the table above (which runs 1950 ticks and ends at 7.7k).

| System | before | after |
| --- | ---: | ---: |
| `PerceptionSystem` | 38.48 | 27.73 |
| `SocialSystem` | 15.30 | **5.03** |
| `DecisionSystem` | 7.80 | 7.53 |
| `MovementSystem` | 3.16 | 2.93 |
| everything else (18 systems) | 5.51 | 5.29 |
| **total** | **70.25** | **48.51** |

Perception and sociality were 77% of a tick and are now 67% of a much cheaper
one. Every other system is under 1 ms/tick and always has been — §1.4's
"everything added since Step 7 is O(1) per animal" held up under measurement.

### History
- **Step 1** (post event-bus fix): demo 0.0035, small 0.025, medium 0.244,
  large 1.63 ms/tick — with 4× the entity load (animals + plant entities).
- **Step 2** (terrain): large-5k 1.52 ms/tick (terrain generation is
  one-time at init; the movement passability guard is negligible).
- **Step 3** (vegetation): large-5k 1.81 ms/tick. Vegetation regrowth is the
  largest cell loop but is staggered (every 5 ticks) and quantized deltas are
  sparse; the snapshot projection is memoized by a revision counter so idle
  ticks pay nothing.
- **Step 4** (herbivore species): large-5k 1.79 ms/tick — four extra scalar
  physiology fields per entity are free.
- **Step 5** (terrain-aware locomotion): large-5k 1.72 ms/tick. Real movement
  (committed intent + terrain speed modifiers + passability) is per-animal
  per-tick with no global scans, so cost is unchanged within noise.
- **Step 6** (energy & metabolism): large-5k 1.81 ms/tick. Per-animal
  bioenergetics arithmetic; starved animals become carcasses that persist
  (decay is Step 18), so end entity counts are now the starting count of
  carcasses rather than 0.
- **Step 7** (local perception): large-5k **14.0 ms/tick** — now the dominant
  cost. Each animal scans its radius neighborhood (O(r²) cells, r=6 → 169
  cells) for nearest food/water/obstacle, plus a spatial-grid neighbor query.
  Still far under the 1 s budget and ~linear in animals (extrapolates to
  ~70 ms at 25k). Staggering via `config.perception.updateInterval` cuts it
  proportionally (measured: interval 3 → ~2.6×, interval 5 → ~3.7× faster);
  the demo keeps interval 1. Ring-search early termination and buffer reuse
  are the Step 30 optimizations if profiling demands them.
- **Step 8** (utility-based decisions): large-5k **18.3 ms/tick** (+4 over
  Step 7). Per-animal action scoring (2 RNG draws + a few utility terms + a
  perception/vegetation lookup); perception is still the dominant cost. ~90 ms
  extrapolated to 25k animals, comfortably under budget.
- **Step 9** (herbivory): large-5k **20.2 ms/tick** (+2). Per-eater biomass
  consumption (`VegetationGrid.consumeAt`) + energy conversion; local, no
  global scans. Animals now survive, so end counts are living animals, not
  carcasses. `entity.fed` events add volume (one per eater per feeding tick),
  bounded by the event buffer and hidden behind the renderer's "show routine"
  toggle.
- **Step 10** (hydration): large-5k **20.9 ms/tick** (+0.7, negligible as
  predicted). One more per-animal scalar update plus reuse of the existing
  perception `nearestWater`; no new scans.
- **Step 11** (aging + life stages): large-5k **~20.9 ms/tick** (no measurable
  change). Per-animal age/mass/stage arithmetic + one `aging`-stream draw, run
  every tick. `AgingSystem` supports `updateInterval` staggering (verified:
  age increments by the interval), but the cost is negligible so the demo runs
  it every tick for exact ages.
- **Step 12** (reproduction): large-5k **35.3 ms/tick**. The per-entity cost is
  essentially unchanged — the rise is because populations now *grow* during the
  benchmark (large-5k ends at ~7.3k entities instead of 5k). Mate search is
  grid-local (`queryRadius`), never a global pairwise scan. Note that scenario
  "end entity" counts now exceed the start.
- **Step 13** (parenting): large-5k **33.4 ms/tick** (within noise of Step 12,
  at the same ~7.3k end population). `ParentingSystem` visits each animal once
  and resolves its guardian by an O(1) id lookup — no scan, no reverse index —
  and only bonded juveniles do any work at all, which is a small fraction of
  the population. The guardian-in-perception check rides along inside the
  spatial-grid neighbor loop perception already ran, so it costs nothing extra.
  Relationships are sparse arrays (a handful of ids per animal) and life
  histories are hard-capped at 12 entries, so neither grows without bound.
- **Step 14** (individual variation): large-5k **33.97 ms/tick** (within noise
  of Step 13's 33.4). Traits are sampled once at creation, never per tick. The
  two values worth precomputing are resolved at spawn — `speed` (species mean ×
  trait) and `adultMass`, which the aging system reads every tick through a
  reused scratch object rather than allocating a growth record per animal per
  tick. The remaining trait effects are a handful of float multiplies inside
  loops that already run, which is invisible next to perception. Cost is in
  memory, not time: each animal now carries a 7-number `traits` object, and
  entities created without traits share one frozen neutral instance.
- **Step 15** (memory): large-5k **33.97 → 37.18 ms/tick** (+3.2). The decay
  pass itself is cheap and staggered (`memory.updateInterval: 5`, with decay
  scaled by the interval so the fade rate is unchanged); most of the rise is
  the per-animal recall lookups in the decision system. Both are bounded by the
  hard cap of 8 memories per animal, so this cost is flat in world size and
  linear in animals — a scan of 8 entries, not a spatial query. Memory is the
  first per-entity *growable* structure in the engine, which is exactly why the
  cap is enforced in the insert helper rather than left to the systems.
- **Step 16** (predation): large-5k **37.18 → 40.13 ms/tick** (+2.9), now with
  333 predators among 5000 prey rather than prey alone. `HuntingSystem` only
  touches predators that are mid-chase and resolves the target by id, so it is
  effectively free; the cost is in perception, which now classifies each
  neighbour as prey/threat/carcass — but that rides inside the spatial-grid
  loop it already ran, so it is a few comparisons per neighbour rather than a
  new query. Sprinting adds one branch and one subtraction to the movement
  loop. The `demo-default` row rose from 0.034 to 0.244 ms/tick purely because
  the demo herd grew 8 → 64.
- **Step 17** (injury and healing): large-5k **40.13 → 42.66 ms/tick** (+2.5).
  `InjurySystem` skips every uninjured animal after one array-length check, and
  injured animals are a small minority. The penalties cost nothing to apply:
  `impairment` is a cached total maintained wherever the injury list changes, so
  the movement and feeding hot loops read one number instead of walking a list.
  Injuries are capped at 4 per animal, so like memories and life events they
  cannot grow without bound.
- **Step 18** (carcasses and decay): large-5k **42.66 → 42.57 ms/tick** (no
  measurable change). `CarcassSystem` is staggered (every 5 ticks) and only
  touches carcasses, whose decay is a pure function of elapsed time — no state
  machine to advance, so a stagger cannot drift it. The one structural change
  is that entities are now *removed*, which shrinks the entity set the other
  systems iterate: before this step carcasses accumulated forever and every
  system paid to skip them. The `demo-default` row rose to 0.63 ms/tick because
  the demo cohorts doubled to 120 prey / 8 predators — see PLAN.md Step 18 for
  why that re-tune was needed.
- **Step 19** (weather and seasons): large-5k **42.57 → 46.11 ms/tick** (+3.5).
  The weather system itself is a handful of global scalars and one RNG draw per
  spell — free. The cost is in the two places the environment is *read* per
  animal per tick: the thermoregulation term in metabolism, and the shelter
  utility in decision. Vegetation pays nothing extra: the seasonal ceiling is
  one more multiply inside the cell loop it already ran, still staggered every
  5 ticks. The `environment` block adds ~7 scalars to each snapshot and delta,
  which is negligible beside the entity array.
- **Step 20** (genetics): large-5k **46.11 → 41.34 ms/tick** (within run-to-run
  noise at this population; genetics does no per-tick work at all). Inheritance
  runs once, at birth: 4 draws per locus and one expression pass, against a
  birth rate measured in tens per thousand ticks. The cost is memory rather than
  time — the genome doubles what Step 14's traits held (two alleles per locus
  instead of one value), still a bounded 7 loci per animal. Every system
  continues to read only the expressed `traits`, exactly as before, so nothing
  in the hot path learned about genetics.
- **Step 25** (disease): large-5k **74.33 → 79.78 ms/tick (+5.5)**. Almost all of
  it is the O(N) progression-and-recovery pass every animal makes each tick;
  **transmission itself costs nothing between outbreaks**, because only
  *infectious* animals query the grid. That was the deliberate choice: the
  obvious shape — every animal looking around for a sick neighbour — would have
  been a third full neighbour walk on top of perception's and sociality's
  (§1.4 C6), and would have cost far more than this. Spillover is two draws per
  tick flat, whatever the population. A test pins the scaling by showing twenty
  animals and four hundred leave the random stream in the same state.

- **Step 24** (territories and home ranges): large-5k **72.01 → 74.33 ms/tick
  (+2.3, within this scenario's noise)** — cheap by construction, and
  deliberately so. The home-range summary is four numbers updated in O(1) per
  animal (the step's own performance note rules out occupancy history); marking
  is one grid write on a 20-tick interval; avoidance is one grid read; and a
  dispute is two id lookups and no spatial query at all. The only O(cells) work
  is claim decay, staggered every 10 ticks with the rate compensated, and the
  whole-territory `transfer` that a resolved dispute triggers. The **coarse**
  claim grid is what keeps both affordable: 4×4 world cells per claim cell means
  1024 cells for the demo world instead of 16 384, and 65 536 at 1024² instead
  of a million.

- **Step 23** (social behaviour): large-5k **46.06 → 72.01 ms/tick (+26)** —
  the largest single jump since perception in Step 7, and the same cause. The
  `SocialSystem` runs a **second** `queryRadius` per animal per tick, over
  radius 6, on top of the one perception already does. Everything else it adds
  is cheap: the group tally is one O(N) pass over labels, dominance is a handful
  of arithmetic derived on read, and contests happen only where two rivals share
  a female.
  
  Still ~14× inside the one-second tick budget, so it is recorded rather than
  optimized — but the fix is obvious and named: **perception and sociality walk
  the same grid neighbourhood**, so the social pass could be folded into
  perception's existing loop for close to nothing. That is Step 30's work
  (measured optimization), and it now joins §1.4 C6 as the second entry in the
  "one neighbour walk too many" column. Note that the demo-default row nearly
  doubled (0.60 → 1.05) because herding *clusters* animals, so each grid query
  returns more neighbours — sociality makes its own neighbourhoods denser.

- **Step 22** (mate choice and sexual selection): large-5k **41.42 → 46.06
  ms/tick**. Within the run-to-run band this scenario has shown all along (it
  has bounced 41–46 since Step 19), and the added work is genuinely small:
  assessment is a handful of arithmetic per receptive female per tick, it runs
  only inside `matingRange` on a grid query reproduction was already making,
  and it consumes no randomness at all. Perception gained a bounded
  (`maxMateCandidates: 6`) candidate list built in the neighbour pass it was
  already walking, so it costs a comparison per neighbour rather than a second
  scan. End entity count rose 7060 → 7233, which accounts for part of it.
  Courtship *events* were the one real cost and were fixed rather than
  absorbed: emitting one per assessment produced ~1.7 events/tick across the
  demo (26k over 15k ticks), so the system now reports only a new candidate or
  a changed verdict — ~1.4k over the same run, a 20× cut.

- **Step 21** (evolutionary observation): large-5k **41.34 → 41.42 ms/tick** (no
  measurable change). Aggregation is a single O(N) pass — no pairwise work —
  staggered to every 50 ticks, so its amortized cost is a fiftieth of one walk
  over the entity list. Everything it produces is bounded: fixed bins per
  histogram, fixed traits per species, and a 120-sample history. Metrics never
  enter the per-tick payload; they are fetched through `GET /api/metrics`,
  which is the reason a full aggregate can afford to be this detailed.

- **Steps 26–29** (migration, disturbances, engineering, species schema): no
  entry here — each is recorded in its PLAN.md completion note instead. The
  short version is that none of them moved large-5k measurably (79.78 → ~80.97
  across all four, while carrying ~7% more entities), which is what §1.4
  predicted: everything since Step 23 is O(1) per animal, and all four
  deliberately declined to add a **third** neighbour walk.

- **Step 30** (measured optimization): large-5k **86.59 → 68.75 ms/tick
  (−20.6%)**, and −18% to −20% on every other scenario. The 86.59 is a fresh
  reading of the *unchanged* code taken the same day, not Step 29's 80.97 —
  re-baselining first is the whole reason the improvement is believable.
  Nothing about the simulation changed: identical entity counts, identical
  serialized state, identical renderer fixtures.

  Two things paid for nearly all of it, and both were named in §1.4 C6 long
  before this step:
  1. **The second neighbour walk is gone** (15.30 → 5.03 ms/tick). Perception
     and sociality walked the same grid neighbourhood separately; perception now
     publishes the list it already built and the social system reads it. The
     social system keeps its own walk as a fallback for when perception is
     staggered or has a shorter radius, and a test runs 400 demo ticks down each
     path and asserts they agree byte for byte.
  2. **The perception cell scan got cheaper per cell** (38.48 → 27.73 ms/tick).
     Row spans come from the circle rather than testing a bounding box; terrain
     is read once per cell instead of twice; the cheap "nearer than the best so
     far" test moved ahead of the grid reads it guards; and the best-so-far is
     held in plain numbers, so a scan allocates nothing. It still visits every
     cell in the radius — a **ring-search early exit was considered and
     rejected**, because ring order is by cell offset while the answer is the
     nearest cell to the animal's *continuous* position, so exiting early would
     change which cell wins. That is a behaviour change, and this step was not
     allowed one.

  The supporting changes are the spatial grid's: packed integer bucket keys
  instead of `"x:y"` strings, and positions stored in the buckets so a candidate
  costs no second hash lookup.

## Step 1 remediation recorded here

The initial baseline exposed a hot-path defect in `DomainEventBus`: it trimmed
the bounded buffer with a front `splice` on **every** emit once full, i.e.
O(maxBufferedEvents) per event. With the demo emitting one move event per
animal per tick, the large-5k scenario measured **58.65 ms/tick**. Measuring
with trimming effectively disabled isolated the cause (74 → 2.8 ms/tick).

The fix makes trimming amortized O(1): the buffer overflows by up to one
`maxBufferedEvents` chunk, then drops the oldest chunk in bulk (retention
floor unchanged at `maxBufferedEvents`, hard ceiling `2 × maxBufferedEvents`).
Result: large-5k improved **58.65 → 1.63 ms/tick (~36×)** with determinism
preserved. Covered by `test/event-bus.test.js`.

## Notes for future baselines

- Record Node version and platform alongside numbers (they dominate absolute
  timings).
- When a step adds a per-entity system, expect ms/tick to rise; keep the
  medium-1k scenario under a few ms/tick and large-5k comfortably under the
  1 s budget.
- If a change regresses large-5k by more than ~2× without a matching feature
  reason, treat it as a hot-path regression and profile before proceeding
  (DOCS.md §17 risk register: "tick-budget overruns").
