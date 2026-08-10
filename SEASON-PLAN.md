# Wet / dry seasons — plan

**Status: D0, D1 and D2 are implemented and green. D3 onward is still plan.**
Written 2026-08-09 against `main` @ `eff9148`; §9 records the decisions taken and
§7 the phase-by-phase state.

Convert the four-season temperate year (`spring / summer / autumn / winter`)
into a two-season tropical one (`wet / dry`), where the dry season physically
drains the map: the stream dries, the ponds shrink, the lake shrinks to its
core, the marsh mostly dries, and grass only grows where the water used to be.

**The goal of this work is that the wet/dry mechanics function**, not that the
world stays balanced. Population balance is a follow-up pass with
`npm run ethologist` (§8).

---

## 0. Lead with the surprise: requirement 5 needs no new mechanism

The vegetation rule — _"near where water was, grow at a normal rate; far from
it, don't grow at all"_ — sounded like the hard part. It is already built. Two
knobs added on 2026-08-09 do exactly this, and the dry season is just a second
value for each:

| knob (`config.vegetation`) | wet season | dry season | what it does |
| --- | ---: | ---: | --- |
| `wetCapacityBonus` | `0.6` | **`0`** | ceiling beside water is `1 + bonus × wetness` × the dry ceiling. At 0, riparian grass grows to the *normal* height — "not the boosted rate" |
| `dryGrowthScale` | `0.75` | **`0`** | regrowth rate is `dryGrowthScale + (1 − dryGrowthScale) × wetness`. At 0 the rate **is** the wetness — full beside the old channel, exactly zero out on the plain |

`VegetationGrid` already precomputes both into per-cell arrays
(`#capacityPerCell`, `#growthScalePerCell`) at construction, and `grow()` already
reads them as one array index per cell. So the dry season costs **one extra
Float32Array pair and a pointer swap**, not a branch in the largest cell loop in
the engine. See §5.

⚠ The mask must be the **wet-season** wetness field ("where water *was*"), not a
field rebuilt from the drained map. Both are precomputed; §5 says which consumer
reads which.

⚠ A second consequence of this shape: **the dry season's vegetation effect is
entirely per-cell.** The global seasonal scalars (`SEASON_GROWTH`,
`SEASON_CAPACITY`) stay at `1.0` through both dry phases — they are the wrong
tool, because they cannot say "here but not there".

---

## 1. What is there now

Facts that constrain every option below. All verified by reading the code, not
recalled.

**The season is a pure function of the tick.** `seasonAt(tick, ticksPerYear)`
in `world/Environment.js` divides the year into `SEASONS.length` equal parts.
Nothing is stored, which is what makes the cycle survive a save/load and a
restart at the same seed.

**The weather is separate and stochastic.** `rollWeather` draws one value from
the `weather` stream every `spellTicks: 400`, with per-season odds. The two
clocks are deliberately not the same clock.

**Spring and summer do differ**, so the wet season does need splitting (the
original conditional resolves to _yes_):

| | spring | summer | autumn | winter |
| --- | ---: | ---: | ---: | ---: |
| `SEASON_GROWTH` | 1.35 | 1.0 | 0.6 | 0.15 |
| `SEASON_CAPACITY` | 0.9 | 1.0 | 0.6 | 0.3 |
| rain odds | 0.42 | 0.15 | 0.45 | 0.15 |
| drought odds | 0.03 | **0.25** | 0.05 | 0 |
| snow odds | 0 | 0 | 0 | **0.4** |

**⚠⚠ Terrain is static, unsaved, and nothing may mutate it.** This is the
constraint the whole feature runs into. DOCS §7:

> Terrain is derived and unsaved, so nothing may mutate it. Both the disturbance
> layer and the feature layer exist because of this constraint: an edit to
> terrain would silently vanish the first time anyone reloaded a save.

`TerrainGrid` is a `Uint8Array` generated once from `terrainSeed` +
`config.terrain` and regenerated on load. Three derived structures are built
from it once and cached:

| derived from terrain | where | built | saved? |
| --- | --- | --- | --- |
| `world.wetness` (distance-to-water, `Float32Array`) | `world/wetness.js` | at construction, exact EDT, 2 linear passes | no |
| `world._waterField` (bearing to nearest drinkable cell) | `World.js` `buildWaterField` | lazily, one BFS | no |
| `VegetationGrid` capacity + growth-scale arrays | `VegetationGrid.#seed` | at construction, **2 RNG draws per cell** | capacity no, biomass yes |

**Terrain reaches the renderer once.** `SimulationEngine.#terrainProjection` is
memoized ("terrain is static"), full snapshots embed it, and
`buildDeltaSnapshot` deliberately never carries it. A connected client that
saw the wet map keeps drawing the wet map forever.

**The finished grid does not know which water is which.** After `#generate`
runs, a `WATER` cell from the stream, a marsh pool, a pond and the lake's shallow
ring are the same byte. The drying rules are per-feature, so this is the real
structural work — see §4.2.

**Water is 5.4% of the playable map — measured, and about half what the geometry
suggests** (D0, run 2026-08-09: `default-small` 230×180, roundness 4, 32 520
playable cells, 5 seeds `[4, 1, 2, 3, 5]`):

| feature | mean cells | [min..max] | note |
| --- | ---: | --- | --- |
| lake shallow ring | 699 | [13..984] | ⚠ enormous spread — see §1.1 |
| lake deep core | 295 | [0..429] | impassable |
| pond | 131 | [0..241] | ⚠ zero on one of five seeds |
| stream | 438 | [382..493] | **the most dependable water on the map** |
| marsh pools | 483 | [475..499] | **the second most dependable** |
| **drinkable total** | **1 751** | [1 227..1 994] | everything except the deep core |

⚠ **The first draft of this plan estimated ~3 100 drinkable cells from the
config's geometry. The real figure is 1 751 — off by 1.8×**, mostly because
every disc is clipped by the roundness-4 coast and by whatever rock was stamped
over it. Nothing downstream depended on the wrong number, but it is why §4.3's
dry-season figures are now measured rather than derived.

### 1.1 ⚠ A pre-existing defect this feature promotes from cosmetic to critical

**On 1 of 10 sampled seeds the world has no lake at all.** `#carveLakes` draws its
centre uniformly over the full rectangle (`random.int(0, width - 1)`) and never
consults the exterior mask, so on a roundness-4 world a centre near a corner is
clipped away entirely by `#stampDisc`'s coast guard.

Seed 1 draws its centre at (27, 172) — outside the ellipse — and gets
**0 deep-water cells and no lake**. The same seed at roundness 0 has a normal
lake (329 deep, 1 885 shallow). Seed 7, centred at (10, 74), loses part of its
core the same way (448 vs 487).

Today this is survivable: the stream and marsh carry those worlds. **The dry
season removes exactly those two and makes the lake's deep core the map's
principal water (§4.3 rule 3) — so on a lakeless seed the dry season leaves
almost nothing.** Measured: seed 1 goes 1 227 → 267 cells with zero contribution
from the lake.

This is not caused by this feature and is **not fixed by it**. It belongs in the
D9 balance pass, where the obvious fix is for `#carveLakes` to draw its centre
inside the playable shape. Recording it here because a dry-season collapse on
seed 1 will otherwise look like a dry-season bug.

---

## 2. The season model

### 2.1 Two seasons, four phases

Keep the year's arithmetic exactly as it is. `SEASONS` stays **length 4**, so
`seasonAt` and `yearProgress` are untouched code. What changes is what the four
quarters are called and which of them are grouped:

```
yearProgress   0.0 ──────── 0.25 ──────── 0.5 ──────── 0.75 ──────── 1.0
phase          wetEarly     wetLate       dryEarly     dryLate
season         └──────── wet ────────┘    └──────── dry ────────┘
old name       spring       summer        autumn       winter
```

`describeEnvironment` changes three fields:

| field | before | after |
| --- | --- | --- |
| `season` | `'spring' \| 'summer' \| 'autumn' \| 'winter'` | `'wet' \| 'dry'` |
| `phase` | — | `'wetEarly' \| 'wetLate' \| 'dryEarly' \| 'dryLate'` |
| `seasonProgress` | position in the quarter (`(progress × 4) % 1`) | **position in the half-year season** (`(progress × 2) % 1`) — Q5 |

Add `phaseProgress: (progress × 4) % 1` if anything later wants the quarter.
⚠ `seasonProgress` has **no consumer anywhere in `src`, `test` or `tests-ui`**
today (grepped), so redefining it is safe — but it is protocol-visible and rides
in every snapshot, so it goes in the version bump either way.

The per-quarter tables stay keyed per-**phase**, so the wet season keeps its
spring/summer distinction for free. **The two dry phases start identical**
(Q6) — the phases exist so they *can* diverge later, not because they do now.

| phase | `SEASON_GROWTH` | `SEASON_CAPACITY` | note |
| --- | ---: | ---: | --- |
| `wetEarly` | 1.35 | 0.9 | the old spring, unchanged |
| `wetLate` | 1.0 | 1.0 | the old summer, unchanged |
| `dryEarly` | **1.0** | **1.0** | neutral — the dry season acts per-cell (§0), and grass **merely stops growing** rather than dying back (Q7) |
| `dryLate` | **1.0** | **1.0** | identical to `dryEarly` (Q6) |

**Why keep four phases rather than a two-entry model?** Every existing table,
test and status string is keyed on a name, and a four-entry table renamed is a
small diff with a provable off state — `SEASONS` order and length are unchanged,
so `seasonAt` returns the same *index* for every tick it ever did. A genuine
two-entry model would change the year's arithmetic, the one thing in that file
that has never needed to change.

### 2.2 A shorter year: `ticksPerYear: 8000 → 4000`

| | 8000 | 4000 |
| --- | ---: | ---: |
| one phase | 2000 ticks | **1000 ticks** |
| one season (wet or dry) | — | **2000 ticks** |
| `maxAge: 13000` (wildebeest) | 1.6 years | **3.25 years** |
| `gestationTicks: 1400` | 0.175 yr | **0.35 yr** |
| `cooldownTicks: 2200` | 0.275 yr | 0.55 yr |
| a 15 000-tick sweep | 1.9 years | **3.75 years** |
| a full year of wall-clock (demo, ~23 s/1000 ticks) | ~3m05s | **~1m32s** |

Two changes come with it, and both are consequences rather than taste:

- **`spellTicks: 400 → 200`.** At 8000/400 a phase saw 5 weather spells; at
  4000/400 it would see 2.5, so the dry season could get two rolls and no
  drought at all. 200 restores 5 per phase. ⚠ This doubles the rate at which the
  `weather` stream is consumed, which changes every seeded world's weather
  sequence — expected and unavoidable, but it means "weather is unchanged" is not
  a claim this phase can make.
- **Everything measured in absolute ticks doubles in year-fractions.** Only one
  thing in the roster is actually calendar-coupled — the wildebeest's breeding
  window — and §2.4 fixes it. Everything else (cooldowns, life stages, decay,
  memory) is unanchored to the year and simply means "half a year's worth" now.

⚠ **`World.js:158` carries a second, hardcoded copy of the environment
defaults** (`{ ticksPerYear: 8000, meanTemperature: 14, temperatureAmplitude: 14 }`)
used when `config.environment` is absent — and its amplitude of 14 is already
stale against the config's 9. It must be updated with the rest or it will hand
sandbox worlds a different year. This is the same duplicate-defaults hazard
`DEFAULT_TERRAIN_PARAMS` was fixed for on 2026-08-02.

### 2.3 Temperature: flatten it (Q4)

Temperature is not the interesting axis here, so take it out of play:
**`temperatureAmplitude: 9 → 2`.** The bare year becomes 12…16 °C, comfortably
inside every species' comfort band (their intersection is 5…24 °C), so **no
animal is ever thermally stressed by the season alone.**

Three things follow:

- The sinusoid's phase shift (`0.125`) stops mattering, so it needs no change.
  Q4 answers itself.
- Weather still bites a little and still reads on the status bar: drought is
  +5 → 21 °C, rain is −2 → 10 °C, a storm is −10 on top. All still comfortable,
  which is the point.
- ⚠ **This removes an energy sink that was measured as large.** DOCS §1.1 A67
  records thermoregulation at **40.1% of the leopard's entire energy budget** at
  amplitude 11, which is why it was cut to 9. At 2 it is near zero. Every animal
  in the world gets materially cheaper to run — which happens to offset some of
  the dry season's harshness, and is a change nobody should later mistake for the
  seasons working.

### 2.4 ⚠ The wildebeest's calendar is wrong, and was already wrong

**Checked, as asked. It does not fall at an appropriate time, and there is a
pre-existing discrepancy worth reporting on its own.**

`herbivoreWildebeest.js:101` declares
`breedingWindow: { startFraction: 0.85, endFraction: 0.5 }`. That window
**wraps**, so its length is `(1 − 0.85) + 0.5 =` **0.65 of the year**. The
comment three lines above it says the window is "0.30 of the year… 2400 ticks"
and runs "from early spring to the start of summer" — which describes
`{ 0.0, 0.30 }`, not what is declared. The declared value is **2.2× wider than
its own documentation**, and a rut covering two-thirds of the year is barely
compressed at all — which quietly undercuts the predator-swamping claim the file
is built around, since birth synchrony is supposed to *emerge* from a compressed
window.

Under wet/dry at 4000 ticks/year, gestation is 0.35 of a year, so the current
window puts births at `0.85…0.5 + 0.35` = **0.20 → 0.85**: calves arriving
continuously through the late wet, all of the early dry, and most of the late
dry. That is the worst possible placement.

Target: **calves born at the start of the wet season** (`yearProgress 0.0`, the
start of `wetEarly` — the old "start of spring"). Two ways to get there:

| | `gestationTicks` | conception window | births land | rut sits in |
| --- | ---: | --- | --- | --- |
| A (minimal) | 1400 (0.35 yr) | `{ 0.65, 0.90 }` | 0.00 → 0.25 | mid-to-late **dry** |
| **B — chosen** | **1400 → 2400** (0.60 yr) | **`{ 0.40, 0.60 }`** | 0.00 → 0.20 | the **wet→dry turn** |

**B is chosen**, and the reason is mechanical rather than aesthetic:
`isReproductivelyReady` gates on `entity.energy >= minEnergyFraction × maxEnergy`
with `minEnergyFraction: 0.8` — an 80%-full bar. Option A puts the rut in the
middle of a dry season in which grass has stopped growing everywhere except the
old channels, so the rut may **simply never fire** and the species would lose
every year's recruitment for a reason invisible in the config. Option B ruts
while the animals are still fat off the wet season.

B also happens to match the real animal — Serengeti wildebeest rut at the end of
the wet season and calve at the start of the next one — and 2400/4000 = 0.6 of a
year ≈ 7 months against a real 8.5.

⚠ **Cost of B, stated:** gestation `1400 → 2400` lengthens generation time. At
`maxAge: 13000` (3.25 years) an adult female still gets ~5 breeding attempts, so
it is not obviously fatal, but it is a real reduction in recruitment and it is
exactly the kind of thing the ethologist pass in §8 exists to catch.

⚠ Both options widen or move a window whose own comment warns that "a species
that misses one window loses a year of recruitment". Whichever is chosen, **the
comment block at `herbivoreWildebeest.js:90–101` must be rewritten** — it
currently describes seasons that will not exist and a width that is not declared.

### 2.5 Snow

A wet/dry world has no snow. **Set its odds to 0 in all four phases but leave the
string in `WEATHER`** — the state stays loadable from old saves, the renderer's
`WEATHER_TONE` keeps its key, and no protocol enum shrinks. Removing it is a
separate, optional cleanup.

---

## 3. Drought: keep it, do not merge it

The original request offered to repurpose `drought` as the dry season.
**Recommend not merging them**, and the reason is the one architectural split in
`Environment.js`: the season is a pure function of the tick, the weather is a
draw. Making the dry season *be* a drought spell would make it stochastic — it
would start at a different tick on every seed, hold for 200 ticks at a time, and
stop being derivable from the clock on load.

Instead, wire the odds so drought becomes the dry season's characteristic
weather:

| phase | clear | rain | drought | snow |
| --- | ---: | ---: | ---: | ---: |
| `wetEarly` (was spring 0.55 / 0.42 / 0.03 / 0) | 0.45 | **0.55** | 0 | 0 |
| `wetLate` (was summer 0.60 / 0.15 / 0.25 / 0) | 0.55 | **0.42** | 0.03 | 0 |
| `dryEarly` (was autumn 0.50 / 0.45 / 0.05 / 0) | 0.60 | 0.10 | **0.30** | 0 |
| `dryLate` (was winter 0.45 / 0.15 / 0 / 0.40) | 0.45 | 0.05 | **0.50** | 0 |

_(Starting values, not tuned. Each row must sum to 1 — `rollWeather` walks a
cumulative sum and falls through to `clear`.)_

The sentence to hold onto: **the dry season is the floor, a drought spell is a
bad patch within it.** Drought keeps its existing `growthScale: 0.25` and
`capacityModifier × 0.6`, which now compose with an already-dry map instead of
being the only dryness in the world.

⚠ Rain in the dry season does **not** refill the map. Water is on the season's
clock, not the weather's. That is a deliberate simplification and worth a line in
the docs so nobody looks for the bug.

---

## 4. Draining the map

### 4.1 The shape of the change: two maps, one pointer

`TerrainGrid` keeps its generated grid as the **wet-season base**, and gains a
second `Uint8Array` for the dry season, built once at construction as a pure
deterministic function of the base. Reads (`codeAt`, `isPassable`,
`speedModifierAt`, `concealmentAt`, `blocksSightAt`) index whichever array is
current. Switching season is a pointer assignment.

Why this shape and not the alternatives:

| option | verdict |
| --- | --- |
| **two precomputed grids, swap on transition** (chosen) | Hot-loop cost is **exactly unchanged** — still one array index, no second grid consulted. DOCS §9 Perception records that one `sheltersAt` call in the cell scan cost **+56% of a tick**, and A68's shelter cue cost **+62%**; "nothing in the cell scan may consult a second grid" is a standing rule. Memory is 41 KB per copy on `default-small`. Save-safe: the dry map is derived, so it regenerates on load like everything else terrain-derived |
| mutate the grid in place each transition | Breaks "terrain is never mutated" for real: the mutation is recoverable only if you also know the phase, and the wet base is destroyed |
| a sparse overlay like `FeatureGrid` | Wrong shape. Trails and burrows are a scatter of cells; a dried stream is ~1 000 contiguous cells, i.e. most of a dense grid stored as a `Map` |
| a per-cell "water present" bit read beside terrain | The second grid read the rule above forbids |

**The invariant to state and test:** every cell passable in the wet map is
passable in the dry map. Shallow water → dry bed (passable → passable), deep
water → shallow water (**impassable → passable**). Drying only ever *adds*
connectivity, so `#ensureConnectivity`'s guarantee holds on the dry map without
re-running it, and no animal can be stranded by a season change.

### 4.2 Provenance: the missing information

The drying rules are per-feature and the finished grid has forgotten which water
came from where. Add a parallel `Uint8Array` written by each generation pass:

| value | source | written in |
| ---: | --- | --- |
| 0 | not water | — |
| 1 | lake, shallow ring | `#carveLakes` |
| 2 | lake, deep core | `#carveLakes` |
| 3 | pond | `#carveSmallLakes` |
| 4 | stream channel | `#stampChannel` |
| 5 | marsh pool | `#growMarsh` |

⚠ Later passes overwrite earlier ones exactly as the cells do, so the tag always
describes what the cell *finally* is. Also record each pond's drawn
`(cx, cy, r)` — the shrink rule needs the centre and the radius, and recovering
them from the finished grid by connected components is guesswork the generator
already knows the answer to.

**Cost:** one `Uint8Array` (41 KB), one store per stamped cell, **zero extra RNG
draws**. It is derived and unsaved like the grid itself.

### 4.3 The rules

Applied in a **new terminal generation pass**, `#buildDryMap`, running *after*
`#growMarsh` and drawing from the existing `water` stream.

⚠⚠ **Placing it last is what makes it free.** `TerrainGrid.#generate` documents
that only the last pass in the pipeline can promise to change nothing else —
that promise currently belongs to the marsh, and a pass after it inherits it. A
new pass at the end can spend as many draws as it likes and **every existing
seed still generates precisely the map it does today**, which is DOCS §4's fixed
draw budget honoured rather than argued with.

| # | rule | source tag | becomes |
| --- | --- | --- | --- |
| 1 | **The stream dries completely** | 4 | `DRY_BED` |
| 2 | **Ponds shrink to 75% of their *area*** — `dryPondAreaScale: 0.75`, so the recorded radius is multiplied by `√0.75 ≈ 0.866`. Cells inside the shrunk disc stay wet; the annulus outside it dries | 3 | inner `WATER`, outer `DRY_BED` |
| 3 | **The lake inverts** — the shallow ring dries and the impassable core becomes drinkable shallow water | 1 → `DRY_BED`<br>2 → `WATER` | the lake shrinks to its core, and that core becomes the map's main water |
| 4 | **The marsh mostly dries** — keep `marshDryRetention: 0.18` of its pools, drawn per cell | 5 | mostly `DRY_BED`, some `WATER` |

Rule 3 is the ecological heart of it: the lake's impassable middle — currently
the one place in the world an animal cannot reach — becomes the one place it
*can* drink.

**Drinkable water, wet → dry** — projected from D0's measured counts (5 seeds):

| | wet (mean) | dry (mean) |
| --- | ---: | ---: |
| lake | 699 | 295 (the old core) |
| pond | 131 | 98 |
| stream | 438 | 0 |
| marsh | 483 | 87 |
| **total** | **1 751** | **480** |
| share of playable | 5.38% | **1.48%** |

**A 3.65× reduction** (per-seed 3.11×–4.59×, n=5).

⚠ **The two features the dry season removes most completely are the two that are
reliably there.** D0's spreads are the point: stream [382..493] and marsh
[475..499] barely vary across seeds, while the lake is [13..984] and the pond is
[0..241]. So the dry season deletes the dependable water and keeps the
seed-dependent water — which is why §1.1's lakeless seed goes to 267 cells while
seed 4 keeps 642. Mechanically this is fine; ecologically it is the first thing
D9 will have to look at.

`dryPondAreaScale` and `marshDryRetention` are the knobs. Per the standing
instruction, **they are not tuned before the mechanics work**; §8 says when.

### 4.4 The dry bed: one new terrain code (Q1)

`DRY_BED: 7`, an eighth entry in `TERRAIN_LEGEND`. New codes must be **appended**
— the numeric values are part of the published protocol legend and existing ones
may not move.

DOCS §7 records the marsh's decision to *avoid* a new code, because one costs "a
protocol bump, a branch in all five terrain-keyed tables, a renderer glyph, and
one habitat weight per species". The marsh had an alternative — it is composable
from existing codes. A dry bed is not: it is precisely the thing that is neither
water nor ordinary ground, and without it **the dry season is invisible on the
map** — the stream would not dry up, it would cease to have ever existed.

The bill, itemised:

| table | value | note |
| --- | --- | --- |
| `TERRAIN_LEGEND` | `{ code: 7, name: 'dry_bed', passable: true }` | |
| `CONCEALMENT_BY_CODE` | `0` | ⚠ must stay `< 1` or `SIGHT_BLOCKING_BY_CODE` flips and the raycast changes |
| `SHELTERING_CODES` | not a member | a bed is not shade |
| `SPEED_MODIFIER_BY_CODE` | `1.0` | ⚠ anything under ~0.9 makes the movement system treat its edge as a wall and animals will refuse to cross the old stream — the trap the tree's `0.9` documents |
| `suitabilityFor` (`VegetationGrid`) | **`1`** (Q3) | same as `GROUND`; see §5 for what this produces |
| `habitat` weights | unnamed by all 8 species → neutral `1` | **A79 recurring**, see below |
| renderer | one glyph + colour in `TERRAIN_APPEARANCE` | renderer-owned, invariant 20 |

⚠ **A79 bites here, and is handled in the same phase (Q11).** Five of the eight
species declare a `water` weight (buffalo `1.35`, zebra `1.2`, wildebeest `1.05`,
gazelle `0.9`, leopard `0.9`). When their water turns into `dry_bed`, an unnamed
code would resolve to neutral `1` — so a buffalo standing on a drained lake bed
would be neither attracted nor repelled, silently. Each species therefore gets an
explicit `dry_bed` weight in D4.

⚠ **A dry bed is not a substitute for water, and the weights must not read as if
it were.** A species' `water` weight says "I want to be near drinkable water";
its `dry_bed` weight should say "what do I make of the ground that water left" —
which, given Q3 puts the best remaining grass there, is mildly attractive for a
grazer and neutral-to-negative for the rest. Starting values, to be revisited in
D9:

| species | `water` | `dry_bed` | reasoning |
| --- | ---: | ---: | --- |
| buffalo | 1.35 | 1.15 | a water animal follows the water down; the bed is where it still is |
| zebra | 1.2 | 1.2 | the bed is the best grazing left (Q3) |
| wildebeest | 1.05 | 1.2 | the forage-tracker, so the same |
| gazelle | 0.9 | 1.1 | short-grass feeder; a fresh-grown bed suits it, though `wetPreference: 0.7` still pulls it out |
| leopard | 0.9 | 0.9 | unchanged from its view of water — open ground either way |
| lion, hyena, vulture | (none) | (none) | they name no water weight, so they get no bed weight — silence stays silence |

### 4.5 One generator interaction to fix

`#stampChannel` currently overwrites any cell that is not `DEEP_WATER` or
exterior — including the lake's **shallow ring**. So a stream running into the
lake retags a strip of lake shore as stream. Harmless today (both are `WATER`);
under §4.2 it means that strip dries completely instead of behaving like lake
shore, punching a dry channel through the shore. **Add `LAKE` to the codes
`#stampChannel` refuses to retag**, alongside the existing deep-water guard.

---

## 5. Vegetation

Per §0 the rule is two existing knobs at new values. Mechanically,
`VegetationGrid` builds **two** pairs of arrays at construction and swaps
pointers with the season:

| array | wet season | dry season |
| --- | --- | --- |
| `#capacityPerCell` | `base × (1 + 0.6 × wetness)` | `base` (no bonus) |
| `#growthScalePerCell` | `0.75 + 0.25 × wetness` | `wetness` (0 on the plain) |

⚠ **The recompute must spend no RNG draws.** `#seed` currently makes 2 draws per
cell (`fertility`, `initialBiomass`) *while* computing capacity. Split it: keep
`#baseCapacityPerCell` (suitability × fertility × taper — the drawn part) and
derive both seasonal capacity arrays from it arithmetically. Every seeded world
then spends exactly the sequence it always did, which is the discipline
`wetCapacityBonus` shipped under on 2026-08-09.

**Which wetness field each consumer reads** — the subtle bit:

| consumer | field | why |
| --- | --- | --- |
| vegetation capacity + growth scale | **wet-season** wetness | "near where water *was*" — the riparian strip must keep its grass after the stream has gone |
| `wetPreferenceOf` habitat cue (`habitatGradient`) | **current-season** wetness | a buffalo should follow the water as it retreats, not stand on a dry bed because it used to be wet |
| `World.nearestWater` / `_waterField` | **current-season** | this is "where can I drink", and in the dry season the answer is genuinely different |

Both wetness fields and both water fields are precomputed at construction and
swapped. Build cost is `O(cells)` each, once — the EDT is two linear passes, the
water field is one BFS.

**Two behaviours that fall out for free, worth naming:**

- `grow()` already zeroes biomass in cells whose capacity is 0 ("cleans up any
  legacy/restored biomass in a cell that is no longer suitable"). So when a dry
  bed refills at the wet transition, whatever grass grew in it is removed with no
  new code.
- Because dry beds get suitability `1` (Q3), **grass grows in the drained channel
  through the dry season** — from `seedFloor`, at the full wet-ground rate, since
  the bed sits at wetness 1 in the wet-season field. The dried river becomes the
  best grazing in the world exactly when everything else stops. That is the most
  interesting single consequence of this feature and it costs nothing.

**⚠ What "should not grow at all" does *not* do (Q7):** a growth rate of 0 leaves
standing grass standing. The plain will not brown off — it will simply never
recover from being eaten. That is the requested mechanism, so
`SEASON_CAPACITY` stays `1.0` through both dry phases and there is no forced
dieback. **Whether 2000 dry ticks is long enough for the herds to actually strip
the plain is unmeasured**, and it is the difference between the dry season being
a real pressure and a cosmetic change to the map. It is the first thing to look
at in §8.

---

## 6. Everything downstream that must move

| what | why | size |
| --- | --- | --- |
| `world/Environment.js` | phases, `season`/`phase` fields, `seasonProgress` redefinition, odds, growth/capacity tables, amplitude | medium |
| `systems/WeatherSystem.js` | emits `environment.changed` on season/weather turnover — must also fire on **phase** turnover, and must be what triggers the terrain/vegetation swap | small |
| `config/defaultSimulationConfig.js` | `ticksPerYear 8000 → 4000`, `spellTicks 400 → 200`, `temperatureAmplitude 9 → 2`, new `terrain.dryPondAreaScale` / `terrain.marshDryRetention`, new dry-season vegetation values | small |
| `world/World.js` | ⚠ the hardcoded env defaults at line 158; two wetness fields; two water fields; a swap that flips terrain + wetness + water + vegetation **together** | medium |
| `world/TerrainGrid.js` | provenance array, pond geometry record, `#buildDryMap`, dry-map pointer, `DRY_BED` in 5 tables, the `#stampChannel` fix | **large** |
| `world/VegetationGrid.js` | split `#seed`, two array pairs, swap, `dry_bed` suitability | medium |
| `config/species/herbivoreWildebeest.js` | breeding window + gestation (§2.4), and the comment block that describes seasons which will not exist | small |
| 5 species files | an explicit `dry_bed` habitat weight (§4.4) — the three that name no `water` weight get none | small |
| `SimulationEngine` | ⚠ `#terrainProjection` is memoized because "terrain is static" — must invalidate on swap | small but easy to miss |
| protocol | terrain rides only on full snapshots, never deltas. Needs a `terrainRevision` scalar on the delta so a connected client knows to re-issue the `terrain` query. **Bump `PROTOCOL_VERSION` 38 → 39** and `SUPPORTED_PROTOCOL_VERSION` with it | medium |
| renderer fixtures | `test/protocol-v29.test.js` enforces that every committed fixture carries the current version — regenerate with `npm run fixtures:renderer` | small |
| `renderer/app/ui/StatusPanel.js` | prints `season · weather · temp`; should print the phase too | small |
| renderer terrain appearance | glyph + colour for `dry_bed` | small |
| persistence | terrain and both maps are derived → **nothing new to save**. But the generator changed, so the save version must bump: DOCS §12, "a terrain generator change is always a save-format change" | small |
| `presets/*.json` (9 files) | they carry `config.terrain` and `config.environment`; `separated-water.json` is a world whose entire premise is where the water is | check each |
| `src/scripts/ethologist.js:1212` | collects water cells with `c === TerrainType.WATER` for its thirst-death autopsy — it will need to know that a dry bed is not water, or it will report every dry-season thirst death as "died beside water" | small, and it is the tool §8 depends on |
| `protocol/commands.js` | terrain prevalence controls are user-facing; the new dry-season params may deserve panel exposure. **Out of scope for the first cut** | deferred |

### ⚠ Water memory goes stale, and that is the design (Q8)

`HydrationSystem` records where an animal drank, with this comment:

> Lakes do not move, so this is the memory an animal can most safely act on long
> after the fact.

**That assumption is exactly what this feature breaks.** In the dry season an
animal will walk a long way to a remembered pool and find a dry bed. Per Q8 this
stays: a herd walking to water that is no longer there *is* the dry season.
`DecisionSystem` already falls back to recall only when nothing is perceived, so
an animal that arrives and sees no water resumes searching. **The comment must be
rewritten** — it is now false, and the next person to read it will trust it.

---

## 7. Phases

Each phase ships with a reproducible off state and its own test, per DOCS §14.

| phase | what | off state | test |
| --- | --- | --- | --- |
| **D0** ✅ | Measure the current world: count water cells by feature across 5 seeds on `default-small`. **Done 2026-08-09** — results in §1 and §4.3; found §1.1 | n/a | ablation script, ~2 s |
| **D1** ✅ | Season model: 4 phases, `wet`/`dry`, `phase` field, `seasonProgress` redefined, new odds, no snow, `ticksPerYear 4000`, `spellTicks 200`, `temperatureAmplitude 2`, the `World.js:158` duplicate. No terrain change. **Done 2026-08-09** | old tables + old constants restored → byte-identical | `test/weather.test.js` |
| **D2** ✅ | Wildebeest breeding window + gestation (§2.4) and its comment block. **Done 2026-08-09** — verified: all 69 calves over 2 demo years land in `wetEarly`, `yearProgress 0.000…0.183` | previous window restored | `test/breeding.test.js`, `test/reproduction.test.js` |
| **D3** | Provenance array + pond geometry in `TerrainGrid`; the `#stampChannel` lake guard. No behaviour change except the guard | ⚠ **`test/determinism.test.js` must stay byte-identical** | `test/terrain.test.js` |
| **D4** | `DRY_BED` code + legend + 5 tables + species weights + renderer glyph + protocol bump + fixtures. Nothing generates one yet | no cell has the code → world unchanged | `test/terrain.test.js`, `test/protocol*.test.js` |
| **D5** | `#buildDryMap` + the four drying rules + the dry-map pointer, wired to the season | `config.season.dryTerrain: false` → the pointer never moves | new `test/dry-season.test.js` |
| **D6** | Two wetness fields, two water fields, the `World` swap. Assert the passability invariant (§4.1) | as D5 | `test/wetness.test.js`, `test/water.test.js` |
| **D7** | `VegetationGrid` two-array pairs, `#seed` split, dry-season knob values | dry values equal to wet values → identical growth | `test/vegetation.test.js` |
| **D8** | `terrainRevision` on the delta, engine memo invalidation, renderer re-query, ethologist water-cell fix | revision never changes today → clients behave as now | `test/protocol.test.js`, `tests-ui/layers.spec.js` |
| **D9** | Balance pass — see §8 | — | — |

D1, D2 and D3 are independent and can land in any order. D4 depends on D3; D5–D7
on D4; D8 on D5.

### 7.1 What D1/D2 actually cost, and the four tests they moved

Shipped: `Environment.js` (the model), `WeatherSystem.js` (phase turnover on the
event), `defaultSimulationConfig.js` (the three constants), `World.js` (the
duplicate env defaults, now `DEFAULT_ENVIRONMENT_PARAMS` re-exported from the
config — it had already drifted to `temperatureAmplitude: 14` against the
config's 9), `herbivoreWildebeest.js`, `events.js`, `StatusPanel.js`, and
`SAVE_FORMAT_VERSION 35 → 36`.

⚠⚠ **Four tests changed because the world changed, and every one of them is a
calibration rather than a mechanism.** Recording them together because "I changed
a test to make it pass" is the sentence that most needs evidence attached:

| test | was | why it moved |
| --- | --- | --- |
| `weather.test.js` — "the land browns off in winter" | seasonal dieback | **Replaced.** A wet/dry year has no global dieback by design (§0). Now measures the wet flush on a *grazed* field, with the horizon justified: the flush is 2.5× ahead at 30 ticks and 10% behind at 120, because a rate loses to a ceiling once the field saturates |
| `weather.test.js` — "the demo puts animals under real thermal stress" | stress > 0 | **Inverted.** `temperatureAmplitude 2` means the season never stresses anything — that is the Q4 decision, so the test now asserts it exactly (peak stress = 0) instead of fishing for a rare event |
| `breeding.test.js` — "its window wraps the year" | `start > end` | **Replaced.** The window no longer wraps. ⚠ And the old assertion was pinning a value that **disagreed with its own comment**: `{0.85, 0.5}` wraps to 0.65 of the year while the prose beside it described 0.30. Now computes the calving season from window + gestation and asserts it lands in `wetEarly` |
| `reproduction.test.js` — "renewing the population" | 3000 ticks | **Horizon extended to 4500.** With a seasonal calver in the roster the population now has a yearly cycle, and 3000 ticks lands in the trough *before* the first calving wave. Measured on seed 42: pop 263 → 259 → 263 → **270 → 288 → 333** at ticks 0/1500/3000/3500/4000/4500 |
| `groups.slow.test.js` — churn control arm | seed 42 | **Seed moved to 7.** Seed 42's *control* arm stopped flapping (worst 136 → 25), so `held.worst × 5 < flapping.worst` reads `25 < 25` and fails by a hair. Seed 7 is unchanged at 141 → 3 (**47×**). The precondition is what selects the seed, which is why this is not result-shopping |
| `cooperation.test.js` — "a hunt it stands against is a worse hunt" | odds comparison | **Odds half removed.** See below |

⚠⚠ **The cooperation change is the one that deserves scrutiny, and it is the one
backed by the most measurement.** The `soloMobbed` cell — a *lone* lion whose
target is being mobbed — needed `n ≥ 3`. It came out at 2. The fix that worked the
previous two times was to add seeds, so that was measured across eight:

```
seeds   42   42,2   42,2,3   +5   +1   +7   +11   +13
n        0     1       2      2    2    2     2     2
```

**Five further seeds — 30 000 demo ticks — added not one sample.** The cell has
stopped responding to sample size, so buying more of it is spending the suite's
budget on a number that will not move. The odds assertion was removed and the
"it happens in the shipped world" assertions kept.

✅ **The claim lost no coverage**, which is why this is defensible:
`cooperation.test.js` → `mobbing: what it costs the hunter` → "a mobbed prey is
harder to take" calls `captureChance` directly against a constructed standoff and
asserts the ordering **deterministically, with no sampling**. A claim about odds
belongs there; what a demo run can honestly add is that the behaviour occurs.

⚠ Two failures seen along the way are **not** from this work: `presets.test.js`
fails under the command sandbox with `listen EPERM 0.0.0.0` (it binds an HTTP
port) and passes 20/20 outside it; and `runner.test.js` → "above the cap one delta
covers several ticks" is a wall-clock test (100 ticks/s over 400 ms) that flaked
once under full-suite CPU load, passes 23/23 alone, and did not recur on a second
full run.

**Final state: `npm test` → 1519 tests, 1514 pass, 0 fail, 5 cancelled** (the
sandboxed preset HTTP tests, 20/20 outside the sandbox).

---

## 8. Measurement, and where balance goes

Per the standing instruction: **the goal is that the mechanics function, not that
the world stays balanced.** So D0–D8 are gated on mechanical claims that are
cheap to check, and the ecological question is deferred whole to D9.

**What D0–D8 must prove** (all sandbox-tier or single-seed, seconds each):

- Terrain: the dry map has the right cell counts per feature; every wet-passable
  cell is dry-passable; a full wet→dry→wet cycle returns the map byte-identically
  to where it started.
- Determinism: `test/determinism.test.js` stays byte-identical after D3, and two
  seeded runs through a season change agree after D5–D7.
- Persistence: save at mid-dry, load, and the terrain, wetness and vegetation
  arrays match the pre-save ones. **This is the claim the whole "keep it derived"
  design exists to make**, and it is the one most likely to fail quietly.
- Vegetation: on the plain, biomass does not increase during the dry season; in
  the old channel, it does.
- Protocol: a client connected across a season boundary ends up drawing the dry
  map.

**Per DOCS §13, D5 and D7 touch the tick's hot path** — terrain reads and the
vegetation loop. The design intends both to be cost-neutral, but this project has
twice been surprised by that exact loop (+56%, +62%), so it needs an interleaved
per-tick reading in `BENCHMARK.md`, measured at a **mature** world (step 3000
first, then time 1000 ticks) — not an argument.

**D9, the balance pass**, after the mechanics work:

1. `npm run ethologist` over several seeds and at least two full years
   (8000+ ticks). Its death-autopsy family is already the right tool — "died of
   thirst with drinkable water a few cells away" is precisely the dry-season
   failure to look for. ⚠ It needs the `TerrainType.WATER` fix from D8 first, or
   it will mis-score every dry-season thirst death.
2. If species are collapsing, the knobs in rough order of bluntness:
   `marshDryRetention` (0.18 →), `dryPondAreaScale` (0.75 →), fixing §1.1's lake clipping, `lakeDeepFraction`
   (how much lake survives as the dry core), then the dry season's
   `SEASON_CAPACITY`.
3. Only then, `npm run sweep` with a control arm for a population claim.

⚠ The shorter year is a real help here: a full year is now **4000 ticks ≈ 1m32s**
of demo wall-clock, and a two-year run ~3m05s per seed. A 5-seed, two-year arm is
~15 minutes rather than ~31.

---

## 9. Decisions taken

| # | question | answer |
| --- | --- | --- |
| Q1 | New `DRY_BED` terrain code, or plain `GROUND`? | **New code** |
| Q2 | What survives in a dried pond? | **The pond shrinks to 75% of its area** (radius × √0.75 ≈ 0.866), rather than leaving isolated spots |
| Q3 | Does grass grow on a dry bed? | **Yes** — suitability `1`, same as ground |
| Q4 | Move the temperature peak into the dry season? | **No — flatten it.** `temperatureAmplitude 9 → 2`, comfortable year-round (§2.3) |
| Q5 | What does `seasonProgress` mean? | **Progress through the half-year season** |
| Q6 | Does the dry season split into two different halves? | **No** — `dryEarly` and `dryLate` start identical |
| Q7 | Does the plain brown off, or merely stop regrowing? | **Merely stop regrowing** — no forced dieback |
| Q8 | Do animals forget where water was? | **No** — walking to a dry bed is the pressure |
| Q9 | Wildebeest: minimal window move (A) or move the gestation too (B)? | **B** — `gestationTicks 1400 → 2400`, window `{0.40, 0.60}` (§2.4) |
| Q10 | Balance | **Not this pass.** Get the mechanics working; `npm run ethologist` and tuning come after (§8) |
| Q11 | `dry_bed` habitat weights per species? | **Yes** — the five species that name `water` get an explicit bed weight in D4 (§4.4) |

---

## 10. What this plan has not established

Stated plainly, because a confident plan that hides its own gaps is the failure
mode CLAUDE.md exists to prevent.

- **Every water-cell count in §1 and §4.3 is arithmetic off the config, not
  counted from a running world.** Radii are drawn with jitter
  (`random.float(0.7, 1.15)`), the stream's length depends on its meander, and
  the marsh's coverage is a walk that expands when it stalls. D0 exists to replace
  these, and they could be off by a large factor — the stream most of all.
- **Whether grazing empties the plain in 2000 dry ticks is unknown**, and Q7's
  "merely stop growing" makes it the whole question. If the herds cannot strip
  the plain in one dry season, the dry season is cosmetic.
- **The wildebeest fix in §2.4 is arithmetic, not a simulation result.** It puts
  births in `wetEarly` on paper. Whether the rut actually fires against an 80%
  energy bar at that point in the year is exactly the sort of thing that needs
  the D9 pass to confirm.
- **Nobody has run this world with ~4× less water**, concentrated into one place.
  The knobs are identified; their working range is not known.
- **The per-tick cost claims in §4.1 and §5 are design intent, not measurement**
  (see §8).
- **`temperatureAmplitude 9 → 2` removes a large energy sink** — 40.1% of the
  leopard's budget at amplitude 11 — and no one has measured what the world does
  when metabolism gets that much cheaper. It will partly mask the dry season's
  cost, and the two changes land in the same phase, so they cannot be told apart
  afterwards. If that matters, D1 should be measured before and after on its own.
- **Whether a client re-fetching a ~41 000-cell RLE terrain twice per simulated
  year is noticeable in the UI is untested** — only the mechanism for signalling
  it is designed.
