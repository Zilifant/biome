/**
 * Migration and dispersal (Step 26).
 *
 * This system decides *where an animal is drifting*, and nothing else. It never
 * writes `action`, never touches the utility table, and never competes with
 * foraging — see migration/migration.js for why that shape was chosen and what
 * §1.4 A34 cost the demo when Step 24 chose the other one. All it does is keep
 * two numbers current on each animal, `migrationHeading` and
 * `migrationStrength`, which the decision system folds into the heading it
 * picks when an animal has nothing better to do than wander.
 *
 * Three drives feed those two numbers (the third arrived with phase 9), and the
 * first of them is strictly ordered above the rest:
 *
 *   1. **Natal dispersal wins outright.** A juvenile that has just left its
 *      guardian holds an outward heading for a bounded spell regardless of what
 *      the forage says. That override is the biology: dispersal is leaving, not
 *      foraging, and an animal that turned back the moment it passed good grass
 *      would never leave at all.
 *   2. **The forage gradient otherwise**, scaled by how hungry the animal
 *      actually is. A fed animal has no reason to be going anywhere, so it does
 *      not — which is what keeps this inert in a green spring and makes it bite
 *      in a grazed-out winter, with no seasonal branch anywhere in the file.
 *      The season acts through the vegetation ceiling (Step 19) and the herd's
 *      own grazing; migration only reads the result. ⚠ Since phase 9 the gradient
 *      is scored through the species' **grass-maturity preference** rather than
 *      raw biomass (PLAN-SPECIES.md §3.3), because a forage cue that always
 *      steers toward *more* grass would fight a species that wants short grass.
 *   3. **Habitat preference alongside** (phase 9, DOCS A49) — a lean toward the
 *      terrain this species prefers. The one cue *not* scaled by a need, since
 *      where an animal would rather be is what it acts on when nothing is urgent;
 *      and the one that **bends** another cue's heading rather than replacing it,
 *      so the pull toward food keeps exactly the strength it had.
 *
 * Runs in the `decision` phase at priority −5: after sociality (−10), so a herd
 * summary is current, and before the decision system (0), which is the only
 * consumer. Ownership: writes `migrationHeading`, `migrationStrength`, and the
 * `settledX`/`settledY` relocation marks; reads positions, energy, the
 * vegetation field, terrain, and the species' `migration`, `forage`, and `habitat`
 * fields. Emits `entity.migrated`.
 *
 * Randomness: **none.** Not one draw on any stream (see migration.js).
 *
 * Cost: `SAMPLE_DIRECTIONS × 2` O(1) vegetation reads per animal per evaluation,
 * divided by `updateInterval` — ⚠ **unchanged by the maturity preference**, which
 * reads nothing the ring was not already reading (standing crop is the axis), and
 * plus a second ring of *terrain* reads for a species with a habitat preference.
 * Nothing at all for a species with neither, which is the whole roster bar the
 * gazelle. No spatial query — §1.4 C6 already owes Step 30 the folding of
 * perception and sociality, and this step deliberately does not add a third
 * neighbour walk.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { blendHeadings, forageGradient, habitatGradient, isDispersing, migrationOf } from '../migration/migration.js';
import { territoryOf } from './TerritorySystem.js';
import { forageOf } from '../habitat/forage.js';
import { NEUTRAL_WEIGHT, habitatOf, wetPreferenceOf } from '../habitat/habitat.js';

export class MigrationSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.cueReference] biomass difference that reads as a full-strength signal
   * @param {number} [options.biasWeight] cap on how hard the forage gradient steers a wander
   * @param {number} [options.dispersalWeight] how hard a disperser holds its outward heading
   * @param {number} [options.updateInterval] habitat evaluation cadence (staggered)
   */
  constructor({
    cueReference = 4,
    biasWeight = 0.5,
    waterBiasWeight = 0.5,
    dispersalWeight = 0.9,
    // Grass maturity and habitat (phase 9). ⚠ All four are wired from
    // `config.forage` and `config.habitat`, their one home each, and both
    // `*Enabled` flags are the world-level controls this phase was measured
    // against — they cannot live in a species block, because a species block beats
    // the config (DOCS §8, and phase 8's `aging.hiddenUntil` trap).
    foragePreference = true,
    forageQualityFloor = 0.55,
    habitatPreference = true,
    habitatBiasWeight = 0.35,
    habitatCueReference = 0.3,
    // Wet-versus-dry ground (2026-08-09), the second axis of the same cue and its
    // own world-level switch, for the same reason the two above have one: the
    // measurable control for "the roster now splits across the wetland" is a run
    // with `wetness.enabled: false`, and that switch cannot live in a species block.
    wetnessPreference = true,
    updateInterval = 10,
  } = {}) {
    super({ id: 'migration', phase: 'decision', priority: -5, updateInterval });
    this.cueReference = cueReference;
    this.biasWeight = biasWeight;
    this.waterBiasWeight = waterBiasWeight;
    this.dispersalWeight = dispersalWeight;
    this.foragePreference = foragePreference;
    this.forageQualityFloor = forageQualityFloor;
    this.habitatPreference = habitatPreference;
    this.habitatBiasWeight = habitatBiasWeight;
    this.habitatCueReference = habitatCueReference;
    this.wetnessPreference = wetnessPreference;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      const resolved = world.species.get(entity.speciesId);
      const species = migrationOf(resolved);
      if (!species) {
        entity.migrationHeading = null;
        entity.migrationStrength = 0;
        continue;
      }

      if (isDispersing(entity, context.tick)) {
        entity.migrationHeading = entity.dispersalHeading;
        entity.migrationStrength = this.dispersalWeight;
      } else {
        // Two long-range drives, each a bias on the wander heading and each
        // throttled by how much the animal actually needs it, so a satisfied
        // animal drifts nowhere. Whichever need is more urgent sets the drift —
        // the same "greater of hunger and thirst wins" the decision utilities
        // already use.
        //
        // Forage gradient (Step 26): a full stomach standing on adequate ground
        // goes nowhere, whatever the compass says, and because it scales with
        // hunger exactly as `seekFood` does the two never contend — seekFood only
        // fires with food in sight, this only steers a wander when there is not.
        //
        // ⚠ **Scored through the species' grass-maturity preference** since phase
        // 9 (PLAN-SPECIES.md §3.3), which is the one place the plan predicted this
        // change would bite: a gradient measured on raw biomass aims a short-grass
        // grazer at the rank sward it is trying to avoid, and it oscillates. ⚠ The
        // preference decides the *direction* only — the strength stays a raw biomass
        // difference, for the reason written up in `forageGradient`. With no
        // preference declared the scoring is arithmetically identical.
        const gradient = species.tracksForage
          ? forageGradient(world, entity, {
              cueRadius: species.cueRadius,
              reference: this.cueReference,
              forage: this.foragePreference ? forageOf(resolved) : null,
              qualityFloor: this.forageQualityFloor,
            })
          : null;
        const hunger = entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0;
        const forageStrength = gradient ? gradient.strength * this.biasWeight * Math.max(0, hunger) : 0;

        // Thirst cue: the long-range analogue of the forage gradient for a point
        // source. Water is one lake, too far to see (perception 6) or even recall
        // (recallRange 60) for much of the map, so without this a thirsty animal
        // beyond that range has no idea which way to go and only finds water by
        // drifting into it. `world.nearestWater` is the coarse "smell of water on
        // the wind": steer toward the nearest shallow ring, harder the thirstier.
        // Like forage, it only bends a wander — once close enough to perceive or
        // recall the lake, seekWater/recallWater take the wheel and this is moot.
        const thirst = entity.maxHydration > 0 ? 1 - entity.hydration / entity.maxHydration : 0;
        const water = species.tracksWater && thirst > 0 ? world.nearestWater(entity.x, entity.y) : null;
        const waterStrength = water ? this.waterBiasWeight * thirst : 0;

        // Habitat preference (phase 9, DOCS A49). A third drive through the same
        // one field, so it needs no new entity state and no save-format change.
        //
        // ⚠ **Not throttled by a need, unlike the two above, and that asymmetry is
        // the biology.** Hunger and thirst silence the forage and water cues for a
        // satisfied animal — and a satisfied animal is exactly the one that acts on
        // where it would rather *be*. So habitat fills the silence rather than
        // competing for it.
        //
        // ⚠ It needs a `cueRadius` to act through, since a coarse long-range sense
        // is what a cue *is*. Three of the four shipped species set it to 0
        // deliberately (they track no forage either), so their habitat preference,
        // if they declared one, would have nowhere to act — stated in
        // `habitat/habitat.js` rather than left to be discovered.
        const weights = this.habitatPreference ? habitatOf(resolved) : null;
        // ⚠ Wet-versus-dry is a *second* axis of the same cue, and it is gated
        // separately: `habitat.enabled: false` still leaves the terrain half off
        // while this one can be off on its own, which is the control the wetland
        // work needs. A species stating neither is skipped entirely, exactly as
        // before — `NEUTRAL_WEIGHT` here means "reads no wetness at all", not
        // "reads it and shrugs".
        const wetPreference = this.wetnessPreference ? wetPreferenceOf(resolved) : NEUTRAL_WEIGHT;
        const habitat =
          weights === null && wetPreference === NEUTRAL_WEIGHT
            ? null
            : habitatGradient(world, entity, {
                cueRadius: species.cueRadius,
                reference: this.habitatCueReference,
                weights,
                wetPreference,
              });
        const habitatStrength = habitat ? habitat.strength * this.habitatBiasWeight : 0;

        // Whichever *need* is more urgent sets the drift, exactly as before.
        const needStrength = Math.max(waterStrength, forageStrength);
        const needHeading = needStrength <= 0 ? null : waterStrength >= forageStrength ? water.heading : gradient.heading;

        if (needStrength <= 0 && habitatStrength <= 0) {
          entity.migrationHeading = null;
          entity.migrationStrength = 0;
        } else if (needHeading === null) {
          // Nothing urgent: go where you would rather be, at habitat's own weight.
          entity.migrationHeading = habitat.heading;
          entity.migrationStrength = habitatStrength;
        } else if (habitatStrength <= 0) {
          // No preference, or nowhere better to be: the phase-8 behaviour exactly.
          entity.migrationHeading = needHeading;
          entity.migrationStrength = needStrength;
        } else {
          // ⚠ **Habitat bends the need's heading rather than competing with it**,
          // and the first cut had them competing on strength — which made habitat
          // near-inert the moment the forage cue was fixed to keep its full
          // strength (cover occupancy moved 6.9% → 6.3%, measured 2026-07-29, when
          // the same weights had moved it to 4.8% while the forage cue was
          // accidentally weakened). Competing was also the A34 mistake in
          // miniature: a preference that has to *beat* foraging either never fires
          // or starves the animal.
          //
          // Blending is the shape the decision system already uses for the trail
          // drift — bend the heading, never touch the magnitude — so the pull toward
          // food is exactly as strong as it was in phase 8 and only its direction
          // leans toward the ground this species prefers.
          entity.migrationHeading = blendHeadings(needHeading, habitat.heading, habitatStrength);
          entity.migrationStrength = needStrength;
        }
      }

      this.#trackRelocation(world, entity, context);
    }
  }

  /**
   * Notice when an animal has actually *moved house* and say so once.
   *
   * The test is deliberately on the **home range**, not on position: an animal
   * that wanders a long way and comes back has not moved anywhere, and Step 24's
   * range — an exponentially weighted centroid — is precisely the summary that
   * already knows the difference. So this emits when the place an animal *lives*
   * has shifted by a full range radius from where it last lived, which is rare
   * by construction and needs no history to detect (§1.4 C3: event volume is a
   * budget, so this fires on the changed verdict, not every tick it holds).
   *
   * A disperser's mark is left at its natal centre by `beginDispersal`, so the
   * first event of its life fires exactly when it has put a range radius between
   * itself and where it was born — which is the acceptance criterion, reported
   * rather than inferred.
   */
  #trackRelocation(world, entity, context) {
    const range = entity.homeRange;
    if (range === null) return;

    if (entity.settledX === null || entity.settledY === null) {
      entity.settledX = range.x;
      entity.settledY = range.y;
      return;
    }

    const threshold = territoryOf(world.species.get(entity.speciesId))?.rangeRadius ?? 0;
    if (!(threshold > 0)) return;
    const moved = Math.hypot(range.x - entity.settledX, range.y - entity.settledY);
    if (moved < threshold) return;

    context.emit(EventTypes.ENTITY_MIGRATED, {
      entityId: entity.id,
      from: { x: entity.settledX, y: entity.settledY },
      to: { x: range.x, y: range.y },
      distance: moved,
      // Why it moved, from the state that actually caused it rather than a
      // guess: it is either still holding a dispersal heading or it is not.
      reason: isDispersing(entity, context.tick) ? 'dispersal' : 'forage',
    });
    entity.settledX = range.x;
    entity.settledY = range.y;
  }
}
