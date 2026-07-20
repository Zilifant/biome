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
 * Two drives feed those two numbers, and they are strictly ordered:
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
 *      own grazing; migration only reads the result.
 *
 * Runs in the `decision` phase at priority −5: after sociality (−10), so a herd
 * summary is current, and before the decision system (0), which is the only
 * consumer. Ownership: writes `migrationHeading`, `migrationStrength`, and the
 * `settledX`/`settledY` relocation marks; reads positions, energy, the
 * vegetation field, and the species' `migration` block. Emits `entity.migrated`.
 *
 * Randomness: **none.** Not one draw on any stream (see migration.js).
 *
 * Cost: `SAMPLE_DIRECTIONS × 2` O(1) vegetation reads per animal per evaluation,
 * divided by `updateInterval`. No spatial query — §1.4 C6 already owes Step 30
 * the folding of perception and sociality, and this step deliberately does not
 * add a third neighbour walk.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { forageGradient, isDispersing, migrationOf } from '../migration/migration.js';
import { territoryOf } from './TerritorySystem.js';

export class MigrationSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.cueReference] biomass difference that reads as a full-strength signal
   * @param {number} [options.biasWeight] cap on how hard the forage gradient steers a wander
   * @param {number} [options.dispersalWeight] how hard a disperser holds its outward heading
   * @param {number} [options.updateInterval] habitat evaluation cadence (staggered)
   */
  constructor({ cueReference = 4, biasWeight = 0.5, dispersalWeight = 0.9, updateInterval = 10 } = {}) {
    super({ id: 'migration', phase: 'decision', priority: -5, updateInterval });
    this.cueReference = cueReference;
    this.biasWeight = biasWeight;
    this.dispersalWeight = dispersalWeight;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      const species = migrationOf(entity.speciesId);
      if (!species) {
        entity.migrationHeading = null;
        entity.migrationStrength = 0;
        continue;
      }

      if (isDispersing(entity, context.tick)) {
        entity.migrationHeading = entity.dispersalHeading;
        entity.migrationStrength = this.dispersalWeight;
      } else {
        const gradient = species.tracksForage
          ? forageGradient(world, entity, { cueRadius: species.cueRadius, reference: this.cueReference })
          : null;
        if (gradient === null) {
          entity.migrationHeading = null;
          entity.migrationStrength = 0;
        } else {
          // Hunger is the throttle, and it is the honest one: an animal with a
          // full stomach standing on adequate ground is not going anywhere,
          // whatever the compass says. It also means the pull cannot fight
          // `seekFood`, which scales the same way — the two never contend,
          // because seekFood only fires when there is food in sight and this
          // only steers a wander when there is not.
          const hunger = entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0;
          entity.migrationHeading = gradient.heading;
          entity.migrationStrength = gradient.strength * this.biasWeight * Math.max(0, hunger);
        }
      }

      this.#trackRelocation(entity, context);
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
  #trackRelocation(entity, context) {
    const range = entity.homeRange;
    if (range === null) return;

    if (entity.settledX === null || entity.settledY === null) {
      entity.settledX = range.x;
      entity.settledY = range.y;
      return;
    }

    const threshold = territoryOf(entity.speciesId)?.rangeRadius ?? 0;
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
