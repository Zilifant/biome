/**
 * Local disturbances (Step 27) — igniting them, running them, ending them.
 *
 * See disturbance/disturbances.js for the model and for why a disturbance is a
 * record whose effects are derived rather than written into the world. This
 * system owns the lifecycle and the two things that genuinely have to *happen*
 * at an instant rather than being read off the record:
 *
 *   1. **Vegetation is consumed once, at ignition.** Burnt grass should not
 *      reappear when the fire goes out; it should grow back. Step 3's logistic
 *      regrowth already does that, so recovery needs no code here at all — the
 *      only thing this step adds to recovery is the damage it recovers from.
 *   2. **Animals caught inside are hurt each tick**, through the shared
 *      `applyInjury` helper. This closes the *hazard* half of §1.4 A19: fights
 *      became an injury source in Step 23, but until now nothing in the
 *      environment could hurt an animal, and "failed captures are the only
 *      writer" has been carried since Step 17.
 *
 * **No behaviour is added.** Nothing here makes an animal flee — §1.4 A34 and
 * D14 both say a new action competes with foraging and loses. Displacement is
 * Step 26's forage drift carrying animals off ground that just stopped being
 * worth anything, plus a `danger` memory (Step 15) at the fire's centre that
 * animals already avoid. Both mechanisms existed; this step gives them a reason.
 *
 * Runs in the `environment` phase at priority 10 — after weather (−10), which
 * owns the season this reads, and before vegetation growth (0), so a fire burns
 * the field *before* the same tick regrows it rather than after.
 *
 * Ownership: writes `world.disturbances`, vegetation biomass inside a new
 * disturbance, and injuries/health/memories of animals caught inside. Emits
 * `environment.disturbed` and `environment.settled`.
 *
 * Randomness: a **fixed five draws** on the `disturbance` stream per ignition
 * check, whatever happens — including when the active list is full, when the
 * chosen ground is unsuitable, and when nothing ignites at all. Nothing else in
 * the system draws.
 *
 * Cost: one pass over the active list (capped in single digits) plus, only when
 * something is running, one pass over the animals. A bounded region iteration at
 * ignition, which is πr² cell writes *once* per disturbance. No spatial query —
 * §1.4 C6 still owes Step 30 exactly two neighbour walks.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { killAnimal } from './death.js';
import { applyInjury, InjuryKinds } from '../injury/injuries.js';
import { recordMemory, MemoryKinds } from '../memory/memories.js';
import {
  DISTURBANCE_KIND_ORDER,
  covers,
  effectsFor,
  isActive,
} from '../disturbance/disturbances.js';

/** Draws consumed per ignition check, whatever the outcome. */
export const IGNITION_DRAWS = 5;

export class DisturbanceSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {boolean} [options.enabled] master switch (false = the Step 26 world)
   * @param {number} [options.ignitionChance] odds of one starting per check
   * @param {number} [options.maxActive] hard cap on simultaneous disturbances
   * @param {number} [options.minRadius]
   * @param {number} [options.maxRadius]
   * @param {number} [options.minDurationTicks]
   * @param {number} [options.maxDurationTicks]
   * @param {number} [options.edibleMassFraction] carcass mass for anything it kills
   * @param {number} [options.maxMemories] cap passed through to the memory helper
   * @param {number} [options.updateInterval] how often ignition is checked
   */
  constructor({
    enabled = true,
    kinds = DISTURBANCE_KIND_ORDER,
    maxMemories = undefined,
    burnInterval = 25,
    ignitionChance = 0.35,
    maxActive = 3,
    minRadius = 6,
    maxRadius = 16,
    minDurationTicks = 200,
    maxDurationTicks = 700,
    edibleMassFraction = 0.5,
    updateInterval = 100,
  } = {}) {
    super({ id: 'disturbance', phase: 'environment', priority: 10, updateInterval: 1 });
    this.enabled = enabled;
    this.ignitionChance = ignitionChance;
    this.maxActive = maxActive;
    this.minRadius = minRadius;
    this.maxRadius = maxRadius;
    this.minDurationTicks = minDurationTicks;
    this.maxDurationTicks = maxDurationTicks;
    this.edibleMassFraction = edibleMassFraction;
    this.maxMemories = maxMemories;
    this.burnInterval = burnInterval;
    // Which kinds this world has at all. A list rather than a boolean per kind
    // because it also fixes the draw→kind mapping, and because "this world has
    // no floods" is a statement about the world, not a disabled feature. It is
    // what made the per-kind attribution below possible.
    this.kinds = kinds;
    // The ignition *check* is staggered, but the system itself runs every tick:
    // an active fire has to hurt what is standing in it on the tick it is
    // standing there, and an expiry has to land on its own tick rather than up
    // to `checkInterval` late. Keeping the two cadences separate is the point.
    this.checkInterval = updateInterval;
  }

  update(world, context) {
    if (!this.enabled) return;

    this.#expire(world, context);
    if (context.tick % this.checkInterval === 0) this.#maybeIgnite(world, context);
    if (world.disturbances.length > 0) this.#afflict(world, context);
  }

  /** Drop finished disturbances, announcing each once. */
  #expire(world, context) {
    if (world.disturbances.length === 0) return;
    const surviving = [];
    for (const disturbance of world.disturbances) {
      if (isActive(disturbance, context.tick)) {
        surviving.push(disturbance);
        continue;
      }
      context.emit(EventTypes.ENVIRONMENT_SETTLED, {
        disturbanceId: disturbance.id,
        kind: disturbance.kind,
        x: disturbance.x,
        y: disturbance.y,
        radius: disturbance.radius,
        // How long it actually lasted, which is the fact an observer cannot
        // reconstruct once the record is gone.
        durationTicks: context.tick - disturbance.startedTick,
      });
    }
    world.disturbances = surviving;
  }

  /**
   * Consider starting one. Consumes `IGNITION_DRAWS` values every time it is
   * called, and returns early *after* drawing rather than before — a budget that
   * depended on whether the list was full would make the stream depend on the
   * world's history, which is precisely what the convention forbids.
   */
  #maybeIgnite(world, context) {
    const random = context.random('disturbance');
    const roll = random.next();
    const kindRoll = random.next();
    const xRoll = random.next();
    const yRoll = random.next();
    const scale = random.next();

    if (roll >= this.ignitionChance) return;
    if (world.disturbances.length >= this.maxActive) return;

    const kinds = this.kinds;
    if (kinds.length === 0) return;
    const kind = kinds[Math.min(kinds.length - 1, Math.floor(kindRoll * kinds.length))];
    const effects = effectsFor(kind);
    if (!effects) return;

    const x = xRoll * world.width;
    const y = yRoll * world.height;
    // Nothing starts on rock or open water. Rejected rather than resampled: a
    // rejection loop would consume a variable number of draws, so an unlucky
    // position simply means no disturbance this time.
    if (!world.isPassableAt(x, y)) return;

    const radius = this.minRadius + scale * (this.maxRadius - this.minRadius);
    // One draw doing double duty, and it is physically sensible: a bigger
    // disturbance lasts longer. The kind's `durationScale` then separates a
    // flash fire from a flood that takes days to drain.
    const duration = (this.minDurationTicks + scale * (this.maxDurationTicks - this.minDurationTicks)) * effects.durationScale;

    // The id counter lives on the world, not on the system, so it survives a
    // save: a fresh system instance restarting at 1 would hand a new fire the
    // id of one still burning.
    const disturbance = {
      id: world.nextDisturbanceId++,
      kind,
      x,
      y,
      radius,
      startedTick: context.tick,
      until: context.tick + Math.round(duration),
    };
    world.disturbances.push(disturbance);
    this.#scour(world, disturbance, effects);

    context.emit(EventTypes.ENVIRONMENT_DISTURBED, {
      disturbanceId: disturbance.id,
      kind,
      x: disturbance.x,
      y: disturbance.y,
      radius: disturbance.radius,
      until: disturbance.until,
    });
  }

  /**
   * Take the standing crop inside a new disturbance, once.
   *
   * Bounded region iteration — the step's whole performance story. It walks the
   * square that contains the circle and skips the corners, so the cost is πr²
   * cell writes for a radius capped at `maxRadius`, paid once at ignition and
   * never again.
   */
  #scour(world, disturbance, effects) {
    if (!(effects.vegetationLoss > 0)) return;
    const minX = Math.max(0, Math.floor(disturbance.x - disturbance.radius));
    const maxX = Math.min(world.vegetation.width - 1, Math.ceil(disturbance.x + disturbance.radius));
    const minY = Math.max(0, Math.floor(disturbance.y - disturbance.radius));
    const maxY = Math.min(world.vegetation.height - 1, Math.ceil(disturbance.y + disturbance.radius));
    for (let cellY = minY; cellY <= maxY; cellY += 1) {
      for (let cellX = minX; cellX <= maxX; cellX += 1) {
        if (!covers(disturbance, cellX + 0.5, cellY + 0.5)) continue;
        const standing = world.vegetation.biomassAt(cellX, cellY);
        if (standing > 0) world.vegetation.consumeAt(cellX, cellY, standing * effects.vegetationLoss);
      }
    }
  }

  /**
   * Hurt whatever is standing in an active disturbance, and teach it the place
   * is dangerous.
   *
   * Only runs when something is actually happening (the caller checks), so the
   * demo pays nothing for this between events. O(animals × active) with the
   * active list capped in single digits, and no spatial query — a grid search
   * would be a third neighbour walk, and §1.4 C6 does not need another.
   */
  #afflict(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive) continue;
      let caught = null;
      for (const disturbance of world.disturbances) {
        if (covers(disturbance, entity.x, entity.y)) {
          caught = disturbance;
          break;
        }
      }
      if (caught === null) continue;

      const effects = effectsFor(caught.kind);
      if (!effects) continue;

      // A place that burned is a place worth remembering. This is the whole of
      // the avoidance behaviour: `danger` memories already stop an animal
      // resting nearby and already poison food recall within `dangerRadius`
      // (Step 15), so no new action is needed and none is added.
      if (effects.danger) {
        const { cellX, cellY } = world.cellOf(caught.x, caught.y);
        recordMemory(entity, MemoryKinds.DANGER, cellX, cellY, context.tick, this.maxMemories);
      }

      // A wound on an interval rather than a per-tick drip — see the effect
      // table for why that is a correctness requirement and not a preference.
      // The interval also bounds the event volume: an animal in a fire reports
      // being burned once every `burnInterval` ticks rather than 350 times
      // (§1.4 C3).
      if (effects.burnSeverity > 0 && context.tick % this.burnInterval === 0) {
        const injury = applyInjury(entity, InjuryKinds.BURN, effects.burnSeverity, context.tick);
        if (injury) {
          context.emit(EventTypes.ENTITY_INJURED, {
            entityId: entity.id,
            injury: InjuryKinds.BURN,
            severity: entity.impairment,
            // Nobody did this to it. `null` is the honest answer and matches
            // `entity.infected`'s environmental case.
            sourceId: null,
          });
        }
      }
      if (effects.healthPerTick > 0) {
        entity.health -= effects.healthPerTick;
        if (entity.health <= 0) {
          entity.health = 0;
          // `killAnimal` records the closing life-history entry itself, so this
          // does not — a second `recordLifeEvent` here would put `died` in the
          // bounded list twice and push a real event off the end of it.
          killAnimal(entity, 'disturbance', entity.bodyMass * this.edibleMassFraction, context.emit, context.tick);
        }
      }
    }
  }
}
