## Generic African vulture

This model represents a large, soaring, obligate scavenger—roughly a white-backed or Rüppell’s vulture—rather than every African vulture species. Nesting habitat and feeding dominance vary considerably among species.

### Model now

Use a large scavenging bird with:

- Carrion-only diet and no normal hunting
- Very long perception range _(⚠ from 2026-08-04 this is true only **in the air** —
  9 on the ground, 13.95 flying; see "Aerial movement" below)_
- Strong attraction to carcasses and feeding vultures
- Low movement-energy cost while searching
- High feeding competition and dominance
- Large daily search area
- Communal feeding and roosting _(⚠ communal feeding yes; **roosting is inert** —
  see "Roosts and nests" below)_
- Slow reproduction
- One offspring per breeding attempt
- Long parental dependency
- Strong nest-site fidelity

The existing carnivore feeding system can already create a non-hunting scavenger by leaving `preySpeciesIds` empty, as demonstrated by the corvid species. Vultures commonly congregate at carcasses, while some species breed and roost colonially.

### Required additions

> ⚠ **Phase labels below (T1, T3, F1, F2, V1) belong to the
> [retired trees/flight/vulture plan](legacy-docs/TREES-FLIGHT-VULTURE-PLAN.md).**
> What each one shipped is documented in [`DOCS.md`](DOCS.md) — §7 Terrain for trees,
> the elevation flag and kill caching, §9 Movement for flight — and what is still
> open is in [`ACTION-ITEMS.md`](ACTION-ITEMS.md) as A73–A79.

#### Aerial movement — ✅ **partly built, 2026-08-04** (phases F1/F2)

The current ground-based locomotion system cannot represent:

- Flight
- Thermal soaring
- High-altitude searching
- Rapid travel across large distances
- Terrain-independent movement

Add a generalized flight mode with altitude state, cheap soaring, costly takeoff and flapping, and reduced movement during poor thermal conditions.

**What shipped, and what was declined.** `entity.flying` is a **pace on the
intent** rather than a state machine (see `locomotion/flight.js`): while the
vulture is doing a travelling action it moves at 1.5× its own speed with the
terrain modifier bypassed, sees 1.55× as far, and pays 0.6 of the normal cost per
unit travelled. So **rapid travel, terrain independence, and cheap searching are
built**, and measured: +54% distance covered per 1000 ticks and −17% time from a
carcass appearing to the first vulture at it.

⚠ **Altitude state, thermal soaring, takeoff and flapping costs, and
poor-thermal-conditions modulation were all declined**, deliberately, and the
reasoning is worth keeping because it will come up again for any bird. Each of
them needs a *stored* state or a second axis, and this engine's standing rule is
that a new movement behaviour must not compete with foraging for the animal's
attention (DOCS §9 Decision) — an altitude state gives it something to manage
rather than something it simply is. What is left is four numbers at four
chokepoints that already existed, which is why the whole mechanism is inert for
every species that does not declare it. ⚠ **"High-altitude searching" is
therefore a flat multiplier rather than a height**: a soaring bird and a low glide
are the same state, and there is no altitude anywhere in the world's geometry
(engine item **A74**).

⚠ The cost was paid on the ground rather than in the air: the vulture's ground
perception radius dropped **14 → 9** so that flying restores the 14 it always had
— because the perception cell scan is (2r+1)² and widening the world's already
widest radius is quadratic. A grounded vulture now sees less while it feeds,
drinks, courts and rests, which turned out to be an ecological brake as well as a
performance one.

#### Carcass discovery network — ⚠ **designed, not built** (engine item **A77**)

Vultures should find food through:

- Direct visual detection
- Watching other vultures descend
- Following circling or converging scavengers

This should create rapid, cascading congregation at newly discovered carcasses rather than requiring every bird to detect the carcass independently.

**Direct visual detection is built** (and F2 widened it on the wing). The other two
are one mechanism, and the design is settled: it is the engine's existing
`#joinedHunt` **with a different noun** — a scavenger with no carcass of its own in
sight adopts the carcass a nearby conspecific has already committed to, filling
`seekFood`'s existing target. No new action, no draw, no extra neighbour walk, and
because it is gated on having nothing of its own it can only ever *add* a bird to a
body. ⚠ It is not built because it takes carrion off a scavenger guild that three
consecutive phases have already reshuffled while this bird grew to 45% of the world's
carrion — see engine items **A73** and **A76**.

#### Feeding hierarchy — ✅ **already expressed; the beak-strength term is declined**

Different vultures specialize in opening carcasses or consuming different tissues. A generic version could use:

- Body size
- Dominance
- Beak strength
- Carcass accessibility
- Feeding position

Smaller vultures may have to wait until larger scavengers open or abandon a carcass.

**Three of the five already exist and produce exactly that sentence.** Carcass
possession, derived dominance, `possessionShare` and the possession contest are
"smaller birds wait until larger scavengers open or abandon a carcass" — the 6 kg
vulture against the 60 kg hyena is the pair the possession numbers were reasoned
about in the first place. ⚠ **A beak-strength or tissue-specialization term is
declined**: it would be a second expression of a hierarchy the engine already
resolves on mass and dominance, and this roster has **one** vulture species, so there
are no two beaks to differentiate. Carcass accessibility now has a real meaning it
did not have before — a kill cached in a tree (engine phase T3) is reachable by this
bird and not by the clan.

#### Roosts and nests — ⚠ **attempted 2026-08-04 (phase V1) and inert by construction**

The simulation currently lacks cliffs, tall trees and aerial nesting. Add persistent roost or nest sites that vultures return to after foraging. Rüppell’s vultures commonly nest on cliffs, while other African vultures use trees.

**Tall trees now exist** (phase T1) and the bird can be in one: it declares
`climbs: true` and `habitat: { tree: 1.6 }` with a `migration.cueRadius` of 18, and
the **cue is live** — the weight resolves, there is a radius for it to act through,
and the drift points at trees. ⚠ Whether it changes *where the bird ends up* cannot
be shown: the tree share reads 2.0% → 2.8%, and an arm containing no steering
mechanism at all reads higher (engine items **A72** and **D40**). ⚠⚠ **What
definitely does not work is the roost itself, and the reason is structural rather
than tunable.** Being *in* the canopy requires a tree cell and
one of `rest`/`shelter`/`hide`/`flee`; this bird declares no hidden stage (so `hide`
cannot fire), **nothing hunts it** (so `flee` cannot), `shelter` measures 0.000% of
its animal-ticks and `rest` 0.03–0.11%. Measured time aloft: **0.000–0.022%**.

⚠ **A roost is a place to be still, and this world gives an animal no reason to be
still.** Neither available lever helps: scaling `rest` by the ground underfoot was
declined as born-inert at phase 9 and could not lift a 0.1% action anyway, and a
`roost` **action** would compete with foraging — the engine's most expensive
standing rule. The honest fix is a **diurnal cycle** (engine item A49), because a
roost is a night behaviour; tracked as engine item **A75**.

⚠ **Nest-site fidelity remains declined**, on its own grounds rather than these:
`patrol` measured 0–1 firings per 3000 ticks, so a site with nothing at it is a place
without a purpose (engine item A34). Cliffs are not expressible at all — the vertical
axis is a flag, not a coordinate (**A74**).

**What the climbing flag *did* buy**, unplanned: `climbs` is also the key
`reachesCarcass` tests, so the bird now reaches a leopard's **cached** kill — 8.9% →
12.1% of the meat off leopard-killed bodies, taken mostly from the hyena. A vulture
getting into a leopard's larder while a hyena cannot is a better model of the real
thing than the roost would have been.

⚠⚠ **And the phase moved the bird far more than a fidelity edit should.** Its
ten-seed gate reads the vulture at **416.0 against 295.4** and **45.0% of all carrion
against 35.6%**, with the lion down 16.1 → 12.7 — every species still passing, but
this is no longer a small change. Which of the three lines causes it is **not
established** (engine item **A76**): the per-line arms disagree seed to seed and the
control's own spread is 216–505. The extra meat is mostly *new* rather than stolen —
the carrion pool grows 193 → 221 tonnes — so the loop runs through carcass supply,
which makes the "slow life history" section below overdue and engine item **B7**
(mass-blind `carcass.decayTicks`) at least as good a lever as this animal's breeding
rate.

#### Slow life history — ⚠⚠ **now overdue rather than optional**

Vultures should mature slowly, reproduce infrequently and invest heavily in one chick. Several species form long-term pairs and raise only one or two chicks per breeding season.

The current bird is deliberately the opposite — a boom-and-bust breeder
(`gestationTicks: 400`, `cooldownTicks: 900`, `maxAge: 6000`) — and those numbers are
load-bearing for a demo the docs call a knife edge. ⚠ Flight (F2) and the woodland
preference (V1) have since taken its mean population from ~157 earlier this year to
**416** on the ten-seed gate, at 45% of all the carrion in the world. That is the
counterweight coming due. ⚠ The ceiling on how far this can honestly go is engine item
**A62**: the year is 8000 ticks and lifespans are compressed beside it, so a genuinely
slow life history meets that compression head-on.

### Current best approximation

With configuration alone, the engine can create a terrestrial scavenger that locates carcasses, feeds communally, competes for meat, reproduces slowly and never hunts.

**Config-only realism: 4/10.**

The major missing element is flight. Without aerial searching, soaring, communal roosts and long-range carcass discovery, it would behave more like a large ground scavenger than a convincing vulture.

⚠ **Reassessed 2026-08-04, after phases F2 and V1.** Two of the four named gaps are
now closed and two are not, and the split is not the one this section predicted:

| gap | state |
| --- | --- |
| **Aerial searching** | ✅ built — 1.5× speed, 1.55× sight, 0.6× cost per unit travelled, terrain ignored |
| **Soaring** | ❌ declined — no altitude, no thermals, no takeoff cost; a soaring bird and a low glide are one state (**A74**) |
| **Communal roosts** | ⚠ attempted and **inert by construction** (**A75**) — the bird prefers trees and is in one ~0.01% of the time, because this world gives it no reason to be still |
| **Long-range carcass discovery** | ❌ not built — engine item **A77**, designed but unbuilt, and ⚠ it takes carrion off the same guild three phases have already reshuffled (**A73**) |

**Honest revised score: 6/10** — and the remaining four points are not all buyable by
config. Aerial movement was; soaring and cliff nesting need a vertical coordinate the
engine does not have; a roost needs a diurnal cycle (**A49**). ⚠ The thing this
section got most wrong is the *direction of the risk*: it warned the bird would be
unconvincingly terrestrial, and what actually happened is that flight plus a woodland
preference took it to **45% of all the carrion in the world** with its counterweight
(slow life history) still unbuilt.
