/**
 * Parental care and dispersal (Step 13) — the last link in the herbivore life
 * cycle: born → cared for → weaned → dispersed → mature → reproduce → die.
 *
 * A newborn is bonded to the parent that carried it (`guardianId`, set in the
 * spawn definition by the reproduction system). While that bond holds, this
 * system runs one coherent parenting strategy:
 *
 *   - **Provisioning** — an unweaned juvenile standing near its guardian is
 *     fed energy from the guardian's own reserves, at a transfer loss. The
 *     guardian never provisions itself below `parentMinEnergyFraction`, so
 *     care is costly but never suicidal.
 *   - **Weaning** — at `weaningAge` provisioning stops; the juvenile must
 *     graze for itself. The bond (and the following behaviour) persists.
 *   - **Dispersal** — when the juvenile outgrows the juvenile stage the bond
 *     is cleared and it goes its own way.
 *   - **Orphaning** — if the guardian dies first, the bond is cleared early.
 *
 * Following the parent is *not* implemented here: it is a `followParent`
 * action scored by the decision system, so all action selection stays in one
 * place and this system never competes for `action` / `moveIntent`.
 *
 * Runs in the `interaction` phase at priority 20 — after feeding (0) and
 * reproduction (10), so a guardian provisions from what it actually has after
 * eating, and a newborn's bond is honoured from the tick after its birth.
 *
 * Ownership: writes `guardianId`, `weaned`, and `lifeEvents`; transfers
 * `energy` between a guardian and its dependent (energy is a shared
 * accumulator, like feeding's gain and metabolism's spend). Emits
 * `entity.provisioned` and `entity.lifeEvent`. No randomness — care is fully
 * determined by the bond, ages, and distance. No global scans: each animal is
 * visited once and resolves its guardian by an O(1) id lookup.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { recordLifeEvent, LifeEventTypes } from './lifeEvents.js';
import { beginDispersal, migrationOf } from '../migration/migration.js';

export class ParentingSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.weaningAge] age at which provisioning ends
   * @param {number} [options.provisionRange] guardian must be this close
   * @param {number} [options.provisionRate] energy drawn from the guardian per tick
   * @param {number} [options.provisionEfficiency] fraction that reaches the juvenile
   * @param {number} [options.parentMinEnergyFraction] guardian floor, below which it stops giving
   * @param {number} [options.juvenileMaxEnergyFraction] juvenile ceiling, above which it stops taking
   * @param {boolean} [options.disperses] whether dispersal is also spatial (Step 26)
   * @param {number} [options.updateInterval]
   */
  constructor({
    weaningAge = 250,
    provisionRange = 2.0,
    provisionRate = 0.5,
    provisionEfficiency = 0.8,
    parentMinEnergyFraction = 0.35,
    juvenileMaxEnergyFraction = 0.85,
    disperses = true,
    updateInterval = 1,
  } = {}) {
    super({ id: 'parenting', phase: 'interaction', priority: 20, updateInterval });
    this.weaningAge = weaningAge;
    this.disperses = disperses;
    this.provisionRange = provisionRange;
    this.provisionRate = provisionRate;
    this.provisionEfficiency = provisionEfficiency;
    this.parentMinEnergyFraction = parentMinEnergyFraction;
    this.juvenileMaxEnergyFraction = juvenileMaxEnergyFraction;
  }

  update(world, context) {
    for (const entity of world.entities.all()) {
      if (entity.kind !== 'animal' || !entity.alive || entity.guardianId === null) continue;

      const guardian = world.entities.get(entity.guardianId);
      if (!guardian || !guardian.alive || guardian.kind !== 'animal') {
        this.#endBond(entity, LifeEventTypes.ORPHANED, context);
        continue;
      }
      if (entity.lifeStage !== 'juvenile') {
        this.#endBond(entity, LifeEventTypes.DISPERSED, context);
        continue;
      }
      if (!entity.weaned && entity.age >= this.weaningAge) {
        entity.weaned = true;
        recordLifeEvent(entity, context.tick, LifeEventTypes.WEANED);
        context.emit(EventTypes.ENTITY_LIFE_EVENT, {
          entityId: entity.id,
          event: LifeEventTypes.WEANED,
          guardianId: guardian.id,
        });
      }
      if (!entity.weaned) this.#provision(guardian, entity, context);
    }
  }

  /**
   * Clear the parent bond, recording why.
   *
   * Dispersal is the one reason that is also a *spatial* event (Step 26): an
   * animal that has outgrown its guardian leaves, rather than merely stopping
   * being provisioned. `beginDispersal` is a shared mutation helper in the
   * established pattern — the same shape as `killAnimal` and `infect` — because
   * leaving home happens at one instant that this system already owns, and the
   * migration system has no business scanning for it. It draws no randomness:
   * the outward heading is geometry (straight out from the natal centre), which
   * is what lets this system keep its "no randomness" guarantee intact.
   *
   * Orphaning deliberately does *not* disperse. An orphan is weaned on the spot
   * and has enough problems (§1.4 A12); sending it walking as well would move
   * two variables at once.
   */
  #endBond(entity, reason, context) {
    const guardianId = entity.guardianId;
    entity.guardianId = null;
    entity.weaned = true;

    let natal = null;
    if (this.disperses && reason === LifeEventTypes.DISPERSED) {
      const migration = migrationOf(entity.speciesId);
      natal = migration ? beginDispersal(entity, context.tick, migration.dispersalTicks) : null;
    }
    // The natal centre rides in the life event rather than on the entity: it is
    // a fact about one moment, the life history is already bounded and already
    // inspected, and a second copy on the entity would be state that can drift.
    const data = natal ? { guardianId, x: natal.x, y: natal.y } : { guardianId };
    recordLifeEvent(entity, context.tick, reason, data);
    context.emit(EventTypes.ENTITY_LIFE_EVENT, { entityId: entity.id, event: reason, ...data });
  }

  /**
   * Transfer energy from guardian to dependent, if both are willing and close
   * enough. Bounded by the guardian's reserve floor and the juvenile's deficit,
   * so a full juvenile costs its parent nothing.
   */
  #provision(guardian, juvenile, context) {
    if (Math.hypot(guardian.x - juvenile.x, guardian.y - juvenile.y) > this.provisionRange) return;

    const guardianFloor = this.parentMinEnergyFraction * guardian.maxEnergy;
    const spendable = guardian.energy - guardianFloor;
    if (spendable <= 0) return;

    const juvenileCeiling = this.juvenileMaxEnergyFraction * juvenile.maxEnergy;
    const deficit = juvenileCeiling - juvenile.energy;
    if (deficit <= 0) return;

    // Charge the guardian for what the juvenile can actually absorb; the rest
    // of the draw would be wasted, so it is never taken. A heavily investing
    // parent (Step 14) feeds its young faster, and pays for it.
    const rate = this.provisionRate * guardian.traits.reproductiveInvestment;
    const given = Math.min(rate, spendable, deficit / this.provisionEfficiency);
    if (given <= 0) return;

    guardian.energy -= given;
    juvenile.energy = Math.min(juvenile.maxEnergy, juvenile.energy + given * this.provisionEfficiency);
    context.emit(EventTypes.ENTITY_PROVISIONED, {
      entityId: juvenile.id,
      guardianId: guardian.id,
      amount: given * this.provisionEfficiency,
    });
  }
}
