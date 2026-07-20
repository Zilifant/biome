/**
 * Ecosystem engineering (Step 28) — the ground remembers what animals do to it.
 *
 * See engineering/features.js for the model. This system owns the loop that
 * turns behaviour into ground, and it is deliberately small, because everything
 * that *reads* a feature reads it through a chokepoint that already existed:
 *
 *   1. **Wear from what animals are already doing.** An animal that moved wears
 *      the cell it moved through; an animal that rested digs the cell it rested
 *      on. Both are read off state the animal already carries
 *      (`lastMoveDistance`, `action`), so nothing had to be added to any other
 *      system, and no behaviour was invented to drive this.
 *   2. **Decay, staggered and rate-compensated**, over the *worn* cells rather
 *      than the world. A map nobody has walked on costs nothing at all.
 *   3. **A trail drift**, written onto the entity for the decision system to
 *      fold into a wander — the same channel Step 26 built for the forage
 *      gradient. Not an action (§1.4 A34), and staggered, because which way the
 *      nearest trail lies does not change tick to tick.
 *
 * The lifecycle has no clock anywhere in it. A feature exists while wear arrives
 * faster than decay removes it, so "maintained" is not a mechanism — it is what
 * *not* fading looks like. That is the one real difference from Step 27's
 * disturbances, which expire on a schedule.
 *
 * ⚠ Runs in the `interaction` phase at priority 40, **not** `environment` as the
 * step spec suggested, and the reason is worth recording because the spec's
 * assumption is quietly false. `lastMoveDistance` is a per-tick accumulator that
 * the metabolism system *consumes and zeroes* in `physiology`, so by the time
 * any `environment` system runs it is always 0 — the first cut of this system
 * sat there and wore **nothing at all**, silently, while burrows (which read
 * `action` instead) worked fine. Running after `movement` and before
 * `physiology` means this reads the distance the animal actually just covered,
 * at the cell it actually just arrived at. That is the same placement and the
 * same reasoning as the territory system, which marks where an animal *ended*
 * the tick.
 *
 * Ownership: writes `world.features` and the per-entity `trailHeading` /
 * `trailStrength`. Emits `environment.feature`.
 *
 * Randomness: **none.** Wear is a function of what animals did; there is nothing
 * to roll.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { FeatureKinds, trailGradient } from '../engineering/features.js';

export class EngineeringSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {boolean} [options.enabled] master switch (false = the Step 27 world)
   * @param {number} [options.threshold] wear at which a cell becomes a feature
   * @param {number} [options.trailWearPerUnit] wear per unit of distance travelled
   * @param {number} [options.demoteFraction] fraction of `threshold` a feature falls to before it is lost
   * @param {number} [options.burrowWearPerRest] wear one resting tick digs
   * @param {number} [options.maxWear] most wear a cell may hold
   * @param {number} [options.decayPerTick]
   * @param {number} [options.decayInterval] staggered; the rate is compensated
   * @param {number} [options.floor] wear below which a cell is forgotten
   * @param {number} [options.trailPullRadius] how far an animal feels a trail
   * @param {number} [options.trailPullWeight] cap on how hard it bends a wander
   * @param {number} [options.driftInterval] how often the trail drift is recomputed
   * @param {number} [options.minRestTicksToDig] a passing nap digs nothing
   */
  constructor({
    enabled = true,
    threshold = 0.5,
    trailWearPerUnit = 0.035,
    demoteFraction = 0.7,
    burrowWearPerRest = 0.02,
    maxWear = 1,
    decayPerTick = 0.0016,
    decayInterval = 20,
    floor = 0.02,
    trailPullRadius = 4,
    trailPullWeight = 0.35,
    driftInterval = 10,
    updateInterval = 1,
  } = {}) {
    super({ id: 'engineering', phase: 'interaction', priority: 40, updateInterval });
    this.enabled = enabled;
    this.threshold = threshold;
    this.trailWearPerUnit = trailWearPerUnit;
    this.demoteFraction = demoteFraction;
    this.burrowWearPerRest = burrowWearPerRest;
    this.maxWear = maxWear;
    this.decayPerTick = decayPerTick;
    this.decayInterval = decayInterval;
    this.floor = floor;
    this.trailPullRadius = trailPullRadius;
    this.trailPullWeight = trailPullWeight;
    this.driftInterval = driftInterval;
  }

  update(world, context) {
    if (!this.enabled) return;

    // Decay first and staggered, with the elapsed ticks folded in so the
    // interval changes the cost and not the rate.
    if (context.tick % this.decayInterval === 0) {
      const lost = world.features.decay(
        this.decayPerTick * this.decayInterval,
        this.threshold * this.demoteFraction,
        this.floor,
      );
      for (const cell of lost) {
        context.emit(EventTypes.ENVIRONMENT_FEATURE, {
          cellX: cell.cellX,
          cellY: cell.cellY,
          kind: cell.kind,
          state: 'lost',
        });
      }
    }

    const drifting = context.tick % this.driftInterval === 0;
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;

      const { cellX, cellY } = world.cellOf(entity.x, entity.y);
      // Traffic wears ground; resting digs it. Both read what the animal
      // already did rather than asking it to do something new.
      //
      // ⚠ Wear is per **unit of distance**, not per tick. An animal crossing a
      // cell may spend several ticks in it (a step is around one cell, less
      // through cover), and charging a flat amount each tick meant one slow pass
      // wore the ground as much as three fast ones — which paved 7% of the map.
      // Scaling by distance makes a trail a measure of traffic rather than of
      // dawdling, and it costs one multiply.
      if (entity.lastMoveDistance > 0) {
        this.#wear(world, context, cellX, cellY, FeatureKinds.TRAIL, this.trailWearPerUnit * entity.lastMoveDistance);
      } else if (entity.action === 'rest') {
        this.#wear(world, context, cellX, cellY, FeatureKinds.BURROW, this.burrowWearPerRest);
      }

      if (drifting) {
        const gradient = trailGradient(world.features, entity.x, entity.y, {
          radius: this.trailPullRadius,
          threshold: this.threshold,
        });
        entity.trailHeading = gradient === null ? null : gradient.heading;
        entity.trailStrength = gradient === null ? 0 : gradient.strength * this.trailPullWeight;
      }
    }
  }

  /** Add wear, announcing the tick a cell first becomes something. */
  #wear(world, context, cellX, cellY, kind, amount) {
    const result = world.features.wear(cellX, cellY, kind, amount, this.threshold, this.maxWear);
    if (result !== 'promoted') return;
    // Emitted on the *transition* only — a trail being walked on is not news
    // every tick, and this layer is written by every moving animal (§1.4 C3).
    context.emit(EventTypes.ENVIRONMENT_FEATURE, { cellX, cellY, kind, state: 'formed' });
  }
}
