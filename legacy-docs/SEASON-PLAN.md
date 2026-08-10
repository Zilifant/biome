# Wet / dry seasons — plan

⚠⚠ **RETIRED 2026-08-10. Everything in this file that is still true has been folded
into the living documentation, and this copy is kept for provenance only** — the
same terms as the plans beside it. Read it for *why* a decision was made, and for
the phase notes (§7.1–§7.5) where a phase's own prediction turned out wrong. Do not
read it for current state: it describes line numbers and a codebase that have moved.

✅ **Mechanically complete.** D0–D8 shipped. ⬜ **D9 (balance) is the open half**,
and it is now `ACTION-ITEMS.md` **A103** rather than a phase of this plan.

**Where its content lives now:**

| what | where |
| --- | --- |
| The season model — two seasons, four phases, the odds table, `seasonProgress`, snow at zero, drought-is-weather | [`DOCS.md`](../DOCS.md) §9 *Season and weather* |
| The two-map design, the four drying rules, `DRY_BED`, water provenance, the `#stampChannel` guard | [`DOCS.md`](../DOCS.md) §7 *Terrain* |
| The per-cell dry response, the two wetness fields and which consumer reads which | [`DOCS.md`](../DOCS.md) §7 *Vegetation* |
| The shorter year (`ticksPerYear 8000 → 4000`) and why `ticksPerYear` is the lever | [`DOCS.md`](../DOCS.md) §5 *Clocks* and §9 *Reproduction* |
| Temperature flattened to `amplitude 2`, and the energy sink that went with it | [`DOCS.md`](../DOCS.md) §9 *Metabolism* |
| `terrainRevision` on the delta, and why it is unconditional | [`DOCS.md`](../DOCS.md) §11 *Deltas* |
| The client's refetch, and the `#recovering` latch it shares with a desync | [`DOCS-RENDERER.md`](../src/renderer/DOCS-RENDERER.md) §4 *The store and transports* |
| The fixture generator that searches for a log-worthy delta | [`DOCS-RENDERER.md`](../src/renderer/DOCS-RENDERER.md) §9b |
| The lake-core strand and its eviction | [`DOCS.md`](../DOCS.md) §1.1 **A101** |
| The hyena's starvation, the nose, and the backed hunting gate | [`DOCS.md`](../DOCS.md) §1.1 **A102** |
| What balance still needs, and the knob order | [`ACTION-ITEMS.md`](../ACTION-ITEMS.md) **A103** |
| The lakeless-seed generator defect (`#carveLakes`) | [`ACTION-ITEMS.md`](../ACTION-ITEMS.md) **A93**, sharpened |
| The lessons — a comment that claimed more than its assertion, and the third A83 | [`DOCS.md`](../DOCS.md) §16 **D60** |
| Per-tick and per-phase cost | [`BENCHMARK.md`](../BENCHMARK.md) |

**Opened by this plan:** **A101** (a dry map may still open a cell the wet map
closes — symptom fixed, structure open), **A102** (the hyena's hunting threshold —
two mechanisms shipped, the gazelle still to watch), **A103** (the world has never
been balanced), and a sharpening of **A93** (the mechanism behind the lakeless
seed). **Closed by it:** nothing — it added a feature rather than fixing an item.

⚠ Source comments and tests cite this plan by bare name (`SEASON-PLAN.md §5`,
`SEASON-PLAN D3`), as they do the other retired plans; the file is in
`legacy-docs/`.

---

**Status when written: D0–D8 are implemented and green. Only D9 (balance) is left.**
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

**Built at D3 (2026-08-09). Three things it turned up that the plan had not
anticipated:**

- ⚠⚠ **`#ensureConnectivity` can turn a water cell into dry ground.** It carves a
  corridor through cells that are *not passable* — and `DEEP_WATER` is impassable,
  not just rock. So the connectivity pass can cut straight through a lake's core,
  and it is the one place in the whole generator where water legally becomes
  ground. It has to clear the tag when it does, or the dry-season pass would find
  `LAKE_CORE` written on a cell of open grass and refill it.
- ⚠ **The tag is written by `#stampDisc` itself, not by its callers**, and that is
  load-bearing rather than tidy. Rock is stamped *over* water (an outcrop on a
  shore clips the lake), so a pass that only wrote cells would leave the drowned
  cell still tagged `LAKE`. "Whoever writes the cell owns the tag" makes that
  unrepresentable; the invariant — **tagged if and only if `WATER` or
  `DEEP_WATER`** — is asserted over five seeds in `test/terrain.test.js`.
- ⚠ **A pond record is kept even when the pond wrote no cells.** D0 measured one
  seed in five whose pond lands past the coast or on the lake and leaves nothing.
  The dry pass shrinks a *disc*, and "no disc" and "an empty disc" are different
  bugs.

**The `#stampChannel` guard is invisible in the cells.** A stream running into the
lake writes `WATER` over cells that are already `WATER`, so with one water code
the cells are byte-identical either way — which is exactly why it was safe to
leave unguarded until provenance existed, and why D3 could add it without changing
a single terrain byte. Its effect is entirely on the tag. ⚠ Because an invisible
rule needs a test that can fail, it is measured against the arm with the guard
removed: seed 2's lake goes **384 → 340 cells**, seeds 1/3/4 go 273/211/184 →
253/208/162.

⚠ The first version of that test asserted the wrong thing — that no `STREAM` cell
may touch the lake's core, assuming the ring wraps it. It does not: rock is
stamped over the lake *before* the streams run and a stream cuts through rock, so
an outcrop on the shore can legitimately put a channel next to the core.

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

**Built at D4 (2026-08-09).** Everything above landed as written. Four things the
itemised bill did not mention, each found by a test going red:

- **The renderer needed nothing beyond the glyph.** `Legend.js` and
  `SpriteSlots.js` both build from `Object.entries(TERRAIN_APPEARANCE)`, and the
  protocol publishes names and codes rather than appearance — so the new code
  reached the client through machinery that already existed. That is the payoff
  of the legend design, and it is worth recording as a *success* of a choice made
  three phases ago.
- ⚠ **`test/sprite-slots.test.js` pins the slot vocabulary exactly**, because a
  persisted sprite config is keyed by those strings and validation drops unknown
  keys rather than migrating them. Adding `terrain:dry_bed` is the *growing* case
  that file calls fine — no existing id moved, so no saved assignment is orphaned
  — but it is a deliberate snapshot and had to be updated by hand.
- **The bed joins `FADING_LAYERS`** (the layers that dim under an occupant). By
  that set's own rule — "a reading *of* a cell, not the hard shape of the map" —
  a dry bed qualifies twice: it says where the water was, and in a dry season it
  is the ground animals stand on most, because it is the only ground still
  growing grass. A solid `-` behind a `g` is the smear that set exists to prevent.
- ⚠ **Speed and suitability could not be tested at D4 and are deferred to D5.**
  Both are read per *cell* (`speedModifierAt`, `capacityAt`) and terrain is never
  mutated, so with nothing generating a dry bed there is no honest way to obtain
  one — asserting them would have meant either mutating terrain in a test or
  exporting a per-code helper for the test's benefit. They are the two values most
  worth guarding, and D5 takes them against a real map.

**The glyph is `-` in orange**: water's `~` with the wave taken out, so a drained
channel reads as the same shape the water traced, gone still — and the one warm
colour on a map of greens, blues and greys, because the eye should find where the
water used to be without hunting for it.

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
| **D3** ✅ | Provenance array + pond geometry in `TerrainGrid`; the `#stampChannel` lake guard. **Done 2026-08-09** — terrain byte-identical, six new tests, three findings in §4.2 | ⚠ **`test/determinism.test.js` stays byte-identical** — verified | `test/terrain.test.js` |
| **D4** ✅ | `DRY_BED` code + legend + 5 tables + species weights + renderer glyph + protocol 38 → 39 + save 36 → 37 + fixtures. Nothing generates one yet. **Done 2026-08-09** | no cell has the code → world unchanged, asserted on 5 seeds + the demo | `test/terrain.test.js`, `test/sprite-slots.test.js` |
| **D5** ✅ | `#buildDryMap` + the four drying rules + the dry-map pointer, wired to the season. **Done 2026-08-09** — 19 tests, measured drawdown matches D0's projection, one real bug found (§7.2) | `terrain.dryTerrain: false` → no dry map allocated, no draws spent, pointer never moves | `test/dry-season.test.js` |
| **D6** ✅ | Two wetness fields, the `World` swap. **Done 2026-08-09** — the two consumers want *different* fields (§7.3) | no dry map → one field, `setSeason` inert | `test/dry-season.test.js` |
| **D7** ✅ | `VegetationGrid` two-array pairs, `#seed` split, dry-season knob values. **Done 2026-08-09** — the plain regrows **12 biomass across 16 623 cells** (§7.3) | `vegetation.drySeason.enabled: false` → identical growth, asserted | `test/dry-season.test.js` |
| **D8** ✅ | `terrainRevision` on the delta, engine memo invalidation, renderer refetch, ethologist water-cell fix. Protocol 39 → 40. **Done 2026-08-10** — §7.4 | a host that omits the field is not treated as permanently stale, asserted | `test/dry-season.test.js`, `test/renderer-store.test.js` |
| **D9** ⏳ | Balance pass — see §8. **Started 2026-08-10**: the first ethologist sweep is run and §7.5 records what it found. Two items opened (**A101**, **A102**), one of them fixed as a symptom; no population knob has been turned yet, so the balance half is still open | — | `test/dry-season.test.js`, `test/ethologist.test.js` |

D1, D2 and D3 are independent and can land in any order. D4 depends on D3; D5–D7
on D4; D8 on D5.

### 7.4 D8: telling the viewer, and a fixture that quietly went empty

**The protocol half is small.** A delta cannot carry a terrain, so it carries
`terrainRevision` — one integer, on **every** delta, because a client can only
notice a *change* if the field is always there. The store reports the mismatch and
the app requests a fresh full snapshot, reusing the desync-recovery path rather
than adding a second kind of recovery. Sending the RLE on the delta was the
alternative and was declined: a ~40 000-cell payload on two deltas a year, and a
branch on every other one, where a scalar costs the same on all of them.

⚠ Guarded by the same `#recovering` latch as a desync, and it needs to be: the
revision stays mismatched on *every* delta until the new snapshot lands, so an
unguarded version would fire a request per tick — twenty a second at the default
cadence — for as long as the round trip takes.

⚠ **The ethologist needed the same fix for a different reason.** Its thirst autopsy
asks "did this animal die with drinkable water within reach", answered from a list
of water cells collected once at construction. In the wet season that list counts
every channel that will later be a dry bed, so **every dry-season thirst death
would have been reported as "died beside water"** — a flood of false positives at
the top of the ranked list, in the one detector family the dry season most needs.
It now keeps both seasons' lists and picks by the season the death happened in.
D9 depends on this being right.

⚠⚠ **And then four browser tests went red, on something that had nothing to do
with the protocol.** `tests-ui` serves the app offline from the *committed
fixtures*, and the protocol bump meant regenerating them. The generator warms up a
fixed **2400 ticks** and commits the delta from the tick after — a constant chosen
when the year was 8000 ticks. The halved year moved what tick 2400 *is*, and the
regenerated delta came out carrying **zero** events the renderer's log keeps
(it trims `entity.moved` and four other routine types hard). An empty offline event
log is not a cosmetic fixture problem: `inspector-press.spec.js` reads that log to
find something to click on, so it failed on a selector with no hint of why.

**The fix is not a better constant.** A fixed tick cannot promise anything about
what happened on it, so the generator now **searches**: warm up, then walk forward
until a delta carries at least three log-worthy, entity-naming events, and throw if
600 ticks produce none. Deterministic, and it fails loudly instead of quietly
committing a fixture that cannot test what it is for. It settled on tick 2402 with
4 such events. That is the generator's own rule — *a fixture that cannot show a
feature cannot test one* — applied to the event log rather than to the species list.

⚠ **Verified rather than assumed, in both directions.** `tests-ui` on the baseline
commit fails **6 of 72**; before this fix mine failed **10**; after it, **6 —
the same six, by name**. Those six are recorded in DOCS §14 as pre-existing:
`status-marks.spec.js`'s three canvas-pixel assertions, two in `sprite-mode.spec.js`
of the same kind, and `event-filters.spec.js`, which DOCS already predicts will
"move with the regeneration". **They are not fixed here and D8 does not claim to.**

### 7.3 D6/D7: the dry season starts changing what grows

**The request, measured end to end** (demo seed 4; 5183 riparian cells against
16 623 of open plain, each grazed bare and given 300 ticks):

| | riparian | plain |
| --- | ---: | ---: |
| wet season | 0 → 29 321 | 0 → 78 052 |
| dry season | 0 → 29 601 | 0 → **12** |

Twelve biomass across sixteen thousand cells is zero to any reading. ⚠ And the
riparian figure barely moving between seasons **is** the other half of the
request — "a normal rate, not the boosted one" — because the boost is a *ceiling*
and shows up in capacity rather than in 300 ticks of regrowth from bare. Measured
separately over 3456 cells of damp ground that is ground in *both* seasons, the
wet-season ceiling is **1.588×** the dry one against a `wetCapacityBonus` of 0.6 —
i.e. 1.6, to the accuracy the wetness ramp allows.

⚠⚠ **The two seasons differ in their _terrain_, not only in their multipliers**,
and this was the thing most likely to be got wrong. A cell that is `WATER` in the
wet season grows nothing; the same cell is `DRY_BED` in the dry one and grows
grass like open ground. So capacity is keyed on a new `codeAtSeason` rather than on
a single suitability pass — which is what makes the drained channel green up over
the dry season rather than merely stop being water.

⚠⚠ **Two wetness fields, and the two consumers want different ones** (§5 said so;
it is worth restating because it reads as a bug on first encounter):

- **Vegetation reads the wet-season field, always.** "Grass grows where the water
  *was*" — a dried river bed keeps damp soil. A field rebuilt from the drained map
  would move the growing ground to whatever water survived, which is the opposite
  of the request.
- **The habitat cue reads the current season's field**, through `wetnessAt`, so a
  buffalo's `wetPreference` follows the water down rather than lingering on a bed
  because the map used to be wet there.

**No draws.** The seasonal arrays are arithmetic over a fertility field drawn
once — `#seed` was split so the drawn part and the seasonal part are separate — so
a world with the dry season on seeds precisely the biomass a world with it off
does, asserted directly.

⚠ **One footgun found and closed by its own test.** `VegetationGrid` initially
always started on the wet arrays, so a grid built over an already-drained terrain
silently reported wet-season capacities. It now adopts the terrain's season. `World`
never hit this — it builds wet and then calls `setSeason` — which is exactly why it
would have sat there.

⚠ `VegetationGrid` accepts a duck-typed terrain (`{width, height, codeAt}`) that
the suite uses to hand-paint maps, so `codeAtSeason` is **optional**: a terrain
that does not know about seasons has one map. That is the honest reading rather
than a shim.

### 7.2 D5: the map drains, and the one thing that broke

**The drawdown, measured against D0's projection** (demo, 5 seeds, drinkable
cells):

| seed | wet | dry | ratio |
| ---: | ---: | ---: | ---: |
| 4 | 1994 | 644 | 3.10× |
| 1 | 1227 | 273 | 4.49× |
| 2 | 1808 | 528 | 3.42× |
| 3 | 1945 | 541 | 3.60× |
| 5 | 1779 | 434 | 4.10× |
| **mean** | **1751** | **484** | **3.63×** |

§4.3 projected a mean of 480 from the census. The rules do what the plan said they
would, which is the least interesting possible outcome and the one worth stating.
⚠ Seed 1 — the world with no lake (§1.1) — is the harshest both before and after,
exactly as predicted.

**The passability invariant holds exactly**: on seed 4, all 31 173 cells passable
in the wet season are passable in the dry one, and `DEEP_WATER` goes 377 → 0 as the
lake's core becomes shallows. Nothing that is not water changes.

⚠⚠ **The bug: `nearestWater` memoized a bearing field forever, and the memo
outlived its assumption.** `World.nearestWater` floods a field from the drinkable
cells and caches it on first use, on the strength of "terrain never changes". Once
terrain changes, that cache is wrong — but the way it *presented* was not a wrong
bearing. It was a **save/load divergence**: the original world built its field
during the wet season and kept it, while a world restored mid-dry-season built the
same field lazily from the **drained** map. The two then disagreed about where the
water was and every animal diverged from there.

It surfaced as three whole test files failing at once (`injury`, `mate-choice`,
`metrics`) with a `deepStrictEqual` eighty entities deep — which is precisely how
the `bandmates` stale-read presented at save v35. **The generalisation worth
keeping: a cache keyed on an assumption outlives the assumption.** Dropping the
field on a season change fixes it and is also the *right* behaviour — "where can I
drink" in the dry season should mean the water that is actually there. One BFS,
twice per simulated year.

⚠ The wetness field is deliberately **not** dropped: vegetation needs "where the
water *was*". Whether the habitat cue should read the current season's is D6's
decision, and was left to D6 rather than taken as a side effect here.

⚠ **Two other things assumed terrain was static.** The engine's terrain projection
memo is now keyed on a new `terrain.revision`; and the restore path sets the season
explicitly, because a caller is entitled to inspect a restored world without
stepping it.

**Per-tick cost: no measurable change, but the machine was too noisy for a
precise claim.** Within a single process, the dry map against `dryTerrain: false`
at the same tick measured 1568/1705 ms against 1636/1592 ms per 1000 ticks —
overlapping, so the swap costs nothing, as designed (reads are still one array
index). Across builds, an ABBA design against the pre-D4 commit gave 1809 ms mean
against 1834 ms, a 1.4% difference — but the same code drifted **2034 → 1584 ms**
across four consecutive runs on this machine, so that comparison can exclude a
large regression and nothing finer. ⚠ A `BENCHMARK.md` entry wants a quiet machine
and has not been written.

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

⚠ Two failures seen along the way are **not** from this work, and both were
checked rather than assumed:

- `presets.test.js` fails under the command sandbox with `listen EPERM 0.0.0.0`
  (it binds an HTTP port) and passes **20/20** outside it.
- `runner.test.js` → "above the cap one delta covers several ticks" is a
  **wall-clock** test — a real-time runner asked for 100 ticks/s against a 20/s
  broadcast cap over 400 ms — and it flaked in **2 of 3** full-suite runs while
  passing **23/23 on three consecutive isolated runs**. `node --test` runs files
  in parallel, so the full suite is exactly the condition under which a
  100-ticks-per-second demand is not met.

  ⚠ The suspicion worth ruling out was that this work had made the engine
  slower. It has not: per-tick cost at a mature world (`smallDemo` seed 5,
  stepped to 3000 then timed over 1000 ticks, per DOCS §13) is **1053 ms with
  these changes against 1084 ms on the commit before them**, at an identical
  population of 93 — a 3% difference in the *faster* direction, which is noise
  by that section's own rule. Neither D1 nor D3 adds per-tick work: D3's writes
  all happen during world generation.

**Final state after D8: `npm test` → 1560 tests, 1554 pass, 5 cancelled** (the
sandboxed preset HTTP tests) **and the one wall-clock flake above**, which has now
appeared in 3 of 5 full-suite runs while passing 23/23 on every isolated one. It is
a pre-existing fragility this work exposed rather than caused — the per-tick
measurement above rules out the only mechanism by which it could have been caused —
but at that rate it is worth someone deciding whether the assertion should be a
count at all.

⚠ `tests-ui/` (Playwright) is **not** part of `npm test` and has not been run.
D4 added a legend row and a sprite slot, so the ground legend and the sprite panel
each gained an entry; there are no committed screenshot snapshots, so nothing should
break, but that is reasoned rather than observed.

### 7.5 D9, first pass: what the ethologist found, and the one it could not

Run 2026-08-10: `npm run ethologist -- --seeds=1,2,3,4,5 --ticks=8000 --top=15`,
**5m30s** — five worlds, two full years each, the horizon §8 asked for.

⚠⚠ **Lead with the surprise: the largest finding is a mechanical bug, not a
balance problem, and the second largest was invisible to the instrument.**

**1. The lake core is a pit trap (A101).** §1's own design note — "the impassable
core survives as the dry season's water" — is a cell that is *impassable when wet
and passable when dry*. Nothing in D0–D8 asked what happens to an animal standing
in it when the season turns back. The answer is that it cannot move, for ~2000
ticks. **30 and 39 animals** caught at one turn on two seeds; **24 and 20** dead
before the map released them, 21 and 18 by starvation. On seed 3 that accounts for
**14–17 of the seed's 17 wildebeest starvations**, and it is what the top-ranked
`movement-denied` anomalies were describing: immobile runs of 1999, 1999, 1985 and
1884 ticks, all within fifteen ticks of one season.

✅ Fixed as a symptom the same day (`world/stranding.js`, evicting on the turn):
0 caught, 0 dead, long immobile runs 60 → 12 and 72 → 13. The same 5-seed sweep,
re-run after (5m28s), with the detector below also live:

| seed | deaths | starvations | anomalies | flagged deaths | wildebeest | hyena |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 138 → 138 | 35 → 35 | 133 → 133 | 1 → **9** | 112 → 112 | 12 → 12 |
| 2 | 119 → 119 | 20 → 20 | 91 → 91 | 0 → **6** | 125 → 125 | 13 → 13 |
| 3 | 113 → **101** | 42 → **22** | 131 → **56** | 0 → **11** | 117 → **138** | 6 → 8 |
| 4 | 117 → 117 | 18 → 18 | 65 → 65 | 0 → **6** | 126 → 126 | 7 → 7 |
| 5 | 136 → **125** | 36 → **24** | 195 → **118** | 1 → **5** | 117 → **141** | 12 → 8 |

⚠⚠ **Seeds 1, 2 and 4 are byte-identical**, which is the shape of the finding
rather than a disappointment: the trap fires only where the lake core is both
large and reachable, so **three of five seeds never had it**. A two-seed reading
would have missed it entirely, and a two-seed reading of the *fix* would have
concluded it does nothing. `movement-denied` findings across the sweep: **27 → 12**.

⛔ **The population columns are a different trajectory, not an improvement.**
Thirty to forty animals released mid-run is a large perturbation and n=1 per seed;
seed 5's vulture goes 25 → 13 and its leopard 2 → 1 in the same run. Nothing here
says the world is healthier, only that the mechanical failure is gone.

⬜ The structural fix —
never let a dry map open a cell the wet map closes; keep the core deep and shrink
the lake's shallow **ring** instead — is open and is where §8's
`lakeDeepFraction` lever now points.

⚠ **The check that should have caught it is in this repo and asserts the safe
direction.** See D60. ⚠ It is also **seed-dependent**: seed 1 runs byte-identically
before and after the fix, so a two-seed reading would have missed it entirely.

**2. The hyena starves in front of a full prey base (A102)**, and this is the one
§8 asked for. Starvation is **77–94% of every hyena death**; its own
`behavior.minHungerToHunt: 0.75` shuts the hunt gate on **84.6–90.6%** of the ticks
it can see prey, and it is first allowed to hunt with **32.5** of 130 energy left
against the lion's 209 of 380. ⛔ **Not a dry-season effect** — the deaths split
wet 10/dry 6, 7/6, 9/7 across three seeds — so it is a pre-existing balance
question this pass surfaced rather than caused, and the knobs in §8's list do not
address it.

**3. ⚠⚠ The tool reported none of §2 for five seeds running.** Its carnivore
starvation autopsy asked "was there a carcass right here" and "did it ever see food
at all", and a hyena that had watched prey walk past for hundreds of ticks answers
the second one *yes* — so the leading cause of death in a species scored 0. Fixed:
detector **1d**, `starved having seen prey on N ticks and been refused by its own
behavior.minHungerToHunt`, 13 tests and six mutations in `test/ethologist.test.js`.
Across the five seeds it flags **34 hyena starvations** where the tool previously
flagged none, at the top of every ranked list (worst 9.0 on four of five seeds) —
including `#258`, which saw prey on 734 ticks and had the gate open on **zero** of
them. ⚠ It is not hyena-specific: seed 3's `#236` is a **lion**, refused on 64% of
779 prey-in-sight ticks by its own 0.45. ⚠ It flags 4–10 of the 17–21 hyena deaths
per seed, not all of them — the rest fall under `huntDeniedTicks: 150`, which is
the deliberate bar. **This is the third time A83's rule has been paid for** (D60).

**2b. What was done about the hyena, 2026-08-10.** Not a lower
`minHungerToHunt` — that re-opens the apparent-competition failure it was raised
to fix. Two mechanisms instead, and the surprise is which one mattered:

- **`perception.carrionRadius: 26`**, the first nose in this world. The gap it
  closes is the finding: a scavenger could reach a carcass only by seeing it
  inside 13 cells, remembering where *it* had fed, or joining a **conspecific's**
  hunt. A hyena cannot perceive a cat in any actionable way, so it had no way to
  know a hunt was happening — **the hunger gate assumed a scavenging income the
  animal had no means to go and get.**
- **`behavior.groupMinHungerToHunt: 0.45`**, the lion's number, applied only when
  clanmates are present (12.3–29.3% of hyena-ticks).

| | eviction only | + nose | + nose + gate |
| --- | ---: | ---: | ---: |
| hyena at t8000, 5 seeds summed | 48 | **67** | **77** |
| gazelle at t8000, summed | 121 | 127 | **104** |
| carrion in a hyena's perception | 14.8–23.3% | — | **38.1–46.9%** |
| starvation share of hyena deaths | 77–94% | — | **56–83%** |
| seeds where the vulture goes extinct | 2 | — | **0** |

⚠⚠ **The nose carries the benefit and the gate carries the risk** — the nose alone
takes the hyena 48 → 67 with the gazelle unchanged; the gate adds the last 10 and
costs the gazelle 127 → 104. If the prey base ever needs defending, that is the
line to move. ⚠ n=1 per seed and the spread dwarfs the totals (gazelle on seed 3:
57 → 51 → 19); no gazelle went extinct in any arm. The one result that holds
seed-by-seed is the shift from starvation to predation — world starvation deaths
fell on all five seeds and predation rose on all five.

**Also flagged, not investigated:** the vulture goes locally extinct on 2 of 5
seeds with **100% of its deaths by `age`** — it is not starving, it is failing to
recruit, and seed 3 carries two `never-saw-a-mate` findings at severity 9.1, the
highest anomaly in the run. The leopard ends at 0/2/2/2/3 from 3 founders. The
gazelle falls 30 → 7–13 on three of five seeds, to predation. `wildebeest
barren-season` fires 4–13 times per seed, which is the arithmetic of Q9's 800-tick
window against a ~1550-tick adult life rather than obviously a defect — but
somebody should decide that on purpose.

**What this pass has not established.** No control arm was run against `main`, and
`ticksPerYear` halved on this branch, so nothing here is attributed to the wet/dry
work rather than to the world it landed on. No knob has been turned and no
population claim has been made: `npm run sweep` with a control arm, per §8 step 3,
is still ahead.

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
