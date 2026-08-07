/**
 * Species definition — biology only. No glyphs, colors, or UI labels: those
 * are the renderer's business (invariant 20). A species definition is plain,
 * JSON-serializable data describing how members of the species work, not how
 * they look.
 *
 * The first real herbivore, and the animal every global default in the config
 * was tuned around — so it overrides almost nothing. Read this file as "the
 * baseline"; the interesting reading is what the *other* species change about it
 * (see `config/species/schema.js` for how the blocks fall back to the config).
 *
 * ⚠ **Was `herbivore.grazer` until 2026-07-29** (PLAN-SPECIES.md phase 7). The
 * conversion was deliberately a **rename and nothing else** — every number below
 * is the grazer's, unchanged, and the demo is byte-identical across seeds to the
 * tree before it. That was the point: the plan put the gazelle rather than the
 * wildebeest in the first batch precisely because a 30 kg generic grazer already
 * *is* a gazelle, so batch 1 could prove "nothing changed" instead of
 * re-deriving every measured number in the demo at 6.7× the mass.
 *
 * Three things follow from keeping `bodyMass: 30`:
 *
 * - `metabolism.referenceMass: 30` stays honest — the reference animal still
 *   exists in the world, as it has since Step 4.
 * - The mass audit (PLAN-SPECIES §4) does not fire on the herbivore side.
 * - Every dated measurement taken against "the grazer" still describes this
 *   animal. A reading is not invalidated by the animal being renamed.
 *
 * What a real gazelle additionally wants is scheduled rather than missing: the
 * hidden-fawn stage arrived at phase 8 (`aging.hiddenUntil`) and **short-grass
 * preference plus open-plain habitat at phase 9** (`forage` and `habitat` below,
 * which make this the first species to state either);
 * male rut territory waits for sex-restricted territory (phase 15). ✅
 * Heterospecific association arrived with the second and third herbivores (phase
 * 12–13) and gained its pull at BEHAVIOR-PLAN P3 — both are below. The rest
 * of the model — loose fission–fusion herds, alarm propagation, forage-tracking
 * migration, mother–calf attachment, fast juvenile development, heavy predation
 * pressure, and male competition through mate contests — is already here and
 * already tuned.
 */
export const herbivoreGazelle = Object.freeze({
  id: 'herbivore.gazelle',
  kind: 'animal',
  diet: 'herbivore',
  bodyMass: 30, // kg (adult) — between a Thomson's and a Grant's gazelle
  baseSpeed: 1.2, // world units per tick
  maxEnergy: 100, // energy units
  maxHealth: 100, // health units
  maxHydration: 100, // hydration units
  maxStamina: 100, // sprint budget, spent fleeing (Step 16)
  // Perception (Step 29, closing §1.4 B4). Was a bare `perceptionRadius`
  // scalar — a *third* config pattern beside the global sections and the
  // per-species blocks. Now a block like every other.
  perception: Object.freeze({ radius: 6 }),
  // ⚠ **The hidden-fawn stage** (2026-07-29, PLAN-SPECIES.md §3.14, phase 8), and
  // the one block this species overrides that is not simply inherited. A gazelle
  // fawn does not follow its mother from birth: it lies hidden while she forages
  // nearby and comes back to nurse it, and only then begins to follow and join
  // the herd. `hiddenUntil` is where that stage ends.
  //
  // 120 ticks against `parenting.weaningAge: 250` and `aging.juvenileUntil: 400`
  // — so a fawn hides for roughly the first half of its nursing period and then
  // spends the rest of it following, which is the real progression (hidden →
  // nursed → following → herd → weaned) expressed in the one number the engine
  // needs to know.
  //
  // ⚠ Every other species leaves this at the config's 0 and is completely
  // unaffected. This is the only species in the world with a hidden stage, and it
  // is the animal the mechanism was built for.
  aging: Object.freeze({ hiddenUntil: 120 }),
  // Thermal comfort band (Step 19), °C. Outside it the animal pays energy to
  // hold its body temperature; cover takes the edge off.
  comfortMin: 2,
  comfortMax: 27,
  // Mate choice (Step 22). Females gestate and therefore choose; what they read
  // is this species fact, how hard they weigh it is the individual's heritable
  // `choosiness`. Gazelle display **size** — deliberately a trait natural
  // selection pushes the other way, since a bigger animal is slower (the
  // size→speed tradeoff) and burns more energy at rest. Preferring it therefore
  // makes sexual and natural selection pull against each other, which is what
  // lets the metrics tell them apart. `span` is the trait deviation that
  // saturates the signal; `conditionWeight` is how much plain body condition
  // counts beside it (see mating/mateChoice.js). This is also exactly the "size,
  // condition, and display traits" a gazelle's male competition runs on, which
  // is why phase 7 needed to add nothing for it.
  matePreference: Object.freeze({ trait: 'size', span: 0.3, conditionWeight: 0.4 }),
  // Territory (Step 24). A **home range but no defense** — a herd animal whose
  // range overlaps its neighbours' freely, so `defends: false` buys site
  // fidelity (an animal returns to familiar ground instead of wandering off
  // forever) without exclusivity. That is the honest split: every animal lives
  // somewhere, not every animal owns it.
  // ⚠ A real gazelle buck holds a rut territory that females and juveniles walk
  // straight through, which `territory.defends` cannot express (it is a
  // species-wide boolean). Until it can (phase 15), male competition runs
  // entirely through mate contests — which is both what the source analysis
  // recommends and exactly what this animal already did as the grazer.
  territory: Object.freeze({ defends: false, rangeRadius: 14, settleTicks: 900 }),
  // Persistent social groups (PLAN-SPECIES.md §3.8). ⚠ **No**, and stating it is
  // the point: this is the species that shows the *other* sociality mechanism
  // working. Gazelle herds are fission–fusion — they form on contact, merge, and
  // tear in half, and every one of those is a `groupId` label propagating
  // between neighbours with nothing anywhere holding a roster. A group *record*
  // models the opposite thing, an identity that survives separation (a pride, a
  // clan, a family), which a loosely-aggregating gazelle simply does not have.
  // The two mechanisms run side by side in one world from batch 1 — the hyena
  // clan on the record, the gazelle herd on the label — and this species is the
  // control that proves the label half still works untouched.
  groups: Object.freeze({ forms: false }),
  // How the founders are arranged on the ground (`config.cohorts`): packed into
  // clusters of this size in roster order, rather than scattered singly. On
  // `default-small`'s 30 gazelle that is one herd of twenty and one of ten
  // (2026-08-07; the line read "six herds of twenty out of a roster of 120" until
  // then, which described the 222-animal world — the gazelle has since gone from
  // the demo's dominant herbivore to its smallest cohort).
  // ⚠ This is *placement*, not membership: nothing here writes a group. It puts
  // bodies inside `social.groupRadius` of each other, and the herd label the
  // block above declines to make persistent then falls out on tick 1.
  // The spread is the loosest in the roster — this is an aggregation, and a
  // gazelle herd should start already fraying at its edges.
  cohort: Object.freeze({ groupSize: 20, spread: 6 }),
  // Migration (Step 26). It follows the grass, so it tracks the forage
  // gradient. `cueRadius` is 18 against a perception radius of 6 — deliberately
  // beyond what the animal can see, standing in for the coarse long-range cues
  // this world does not simulate; see migration/migration.js, where that
  // assumption is stated rather than buried. `dispersalTicks` is how long a
  // juvenile holds its outward heading after leaving its guardian.
  // `tracksWater` gives a thirsty animal the same long-range steer toward the
  // lake that `tracksForage` gives it toward grass — it drinks, and the single
  // lake is otherwise unreachable knowledge from most of the map (see
  // world/World.js `nearestWater` and the migration system's thirst cue).
  migration: Object.freeze({ tracksForage: true, tracksWater: true, cueRadius: 18, dispersalTicks: 400 }),
  // ⚠ **Forage guild — the short green flush** (2026-07-29, PLAN-SPECIES.md §3.3,
  // phase 9), and the first species in the world to state a maturity preference.
  // `preferredBiomass` is standing crop, in the same biomass units as
  // `feeding.intakeRate`, and it is the *tallest* grass this animal still does well
  // on: at or below 3 the forage is ideal, and quality grades down to the floor 4
  // units above that (see `habitat/forage.js` — the falloff is one-sided, because
  // scarcity below is already modelled by there being less to eat).
  //
  // That makes this the bottom tier of the Serengeti grazing succession: zebra open
  // the tall coarse sward, wildebeest take the regrowth, gazelle maintain the flush
  // behind them. The other two arrive in batch 3, and the succession only exists
  // once all three do — until then this is one species with a taste.
  //
  // The numbers are measured, on seed 42 with the mechanism off: this animal stands
  // on 4.4–6.4 biomass and feeds at 3.2–5.5 (median 4.4) against a per-cell ceiling
  // whose median is 6.2. So 3 sits just under where it already grazes and 7 (=3+4)
  // is the ungrazed sward — the preference bites on rank growth and leaves the
  // cropped halo it actually lives in untouched.
  //
  // ⚠ Expect this to be **re-tuned in batch 3** and treat that as planned work:
  // it is the only herbivore in the world, so nothing yet constrains where its
  // preference sits relative to anybody else's.
  forage: Object.freeze({ preferredBiomass: 3, span: 4 }),
  // ⚠ **Habitat — an open-plain animal** (DOCS A49, PLAN-SPECIES.md §3.4, phase
  // 9). One weight per terrain, 1 neutral. It acts through the long-range cue
  // (`habitat/habitat.js`), which this species has because it already carries a
  // `cueRadius` for forage; a species with `cueRadius: 0` would state a preference
  // that has nowhere to act, which is why no other species declares one yet.
  //
  // Measured before this shipped (3000 ticks): gazelle spent 6.9% of their time on
  // cover on seed 42 and 9.2% on seed 1, against cover's 2.8% of the map — two to
  // three times its availability, because cover grows 1.35× the biomass of open
  // ground and the forage cue could see nothing else about it. A gazelle is not a
  // cover animal, and the weights say so mildly rather than sharply: cover is
  // still worth using, thicket is not (which the movement and `leaveThicket`
  // rules already say in their own way), and open ground is home.
  //
  // ⚠ There is a real tension here and it is recorded rather than dodged: A57
  // wants gazelle *mothers* near cover, because a fawn is only concealed if it is
  // born on sheltering ground. Preferring the open makes that rarer. The named fix
  // is birth-site selection — a female near term wanting cover — which is a
  // preference that changes with state, and this field cannot express one.
  habitat: Object.freeze({ ground: 1.15, cover: 0.8, water: 0.9, thicket: 0.3 }),
  // ⚠ **Heterospecific association** (§3.16, phase 12), and the first declaration
  // of it in this world — the mechanism shipped inert one phase ago waiting for
  // exactly these two species. A gazelle stands with wildebeest and zebra for
  // three reasons this engine can express: more eyes on the plain (their alarms
  // now carry to it), more bodies for a lion to choose between (which falls out of
  // A58 with no term at all), and the short flush the bigger grazers leave behind
  // it (§3.3 — the succession this batch completes).
  //
  // ⚠ **Directional, and only this species declares it.** The wildebeest and zebra
  // say nothing about the gazelle: the small animal is the one that benefits, and
  // mutual association would be two declarations rather than one.
  //
  // ⚠ The weight is an **exchange rate between bodies** in the herd's centre of
  // mass — 0.5 means two wildebeest pull like one gazelle — and it does nothing at
  // all when no gazelle is nearby (DOCS A61). Slightly higher for the zebra, whose
  // perception radius is the sharpest among the grazers and so is genuinely the
  // better animal to stand beside.
  association: Object.freeze({ 'herbivore.wildebeest': 0.5, 'herbivore.zebra': 0.6 }),
  // ⚠⚠ **How hard it holds to them, which is a different question from how much
  // of a body one of them is worth** (BEHAVIOR-PLAN P3, closing A61). The weights
  // above are an exchange rate *between bodies*, so they decide whose centre wins
  // in mixed company and cancel out of the mean entirely when only the other kind
  // is standing there: until now a gazelle alone in a wildebeest herd stuck to it
  // exactly as hard as to its own. This is the second number that says otherwise.
  //
  // ⚠ It is spent on the **distance** the animal tolerates, not on `herdWeight`:
  // `herdDistance / pull`, so 0.55 turns this species' 2.0 into 3.6 units of
  // allowed drift from a herd of wildebeest and leaves it at 2.0 among gazelle.
  // Loose company, not a weaker preference for company — which is what standing
  // with another species actually looks like, and is the shape A61 asked for after
  // measuring the discount-the-weight version inert.
  //
  // ⚠ Deliberately **near but not equal** to the association weights beside them.
  // They are independent declarations by design (A61: "a *separate* weight for the
  // pull rather than a reuse of this one"); the ordering is shared because it comes
  // from the same fact — the zebra's perception is the sharpest among the grazers,
  // so it is both the better body to weight and the better animal to stay close to.
  associationPull: Object.freeze({ 'herbivore.wildebeest': 0.55, 'herbivore.zebra': 0.65 }),
  initialEnergyFraction: Object.freeze({ min: 0.6, max: 1.0 }),
});
