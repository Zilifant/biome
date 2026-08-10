/**
 * The turning year (Step 19).
 *
 * Advances the one piece of global state in the world: which season it is, how
 * warm it is, and what the weather is doing. Season, phase and baseline
 * temperature are pure functions of the tick (see `world/Environment.js`);
 * weather is drawn from the `weather` stream, holds for a spell, then re-rolls
 * with phase-dependent odds.
 *
 * Runs first in the `environment` phase (priority -10, ahead of vegetation
 * growth) so everything else in the tick sees a settled environment: the
 * vegetation system scales its growth by `growthModifier`, and the metabolism
 * system charges animals to hold their body temperature against
 * `temperature`.
 *
 * Determinism: exactly one draw per re-roll, and re-rolls happen on a fixed
 * schedule (`spellTicks`), so the weather stream advances on a clock rather
 * than in response to anything that happened in the world.
 *
 * Ownership: writes `world.environment`, and — **only on a season turn** —
 * entity positions, through `evictStranded` (see below). Emits
 * `environment.changed` when the season, the **phase** or the weather turns
 * over — not every tick, since temperature drifts continuously and would flood
 * the log.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { describeEnvironment, rollWeather, phaseAt, DEFAULT_ENVIRONMENT_PARAMS } from '../world/Environment.js';
import { evictStranded } from '../world/stranding.js';

export class WeatherSystem extends SimulationSystem {
  /**
   * @param {object} [options]
   * @param {number} [options.ticksPerYear] compressed year length
   * @param {number} [options.spellTicks] how long one weather state holds
   * @param {number} [options.meanTemperature] °C, annual mean
   * @param {number} [options.temperatureAmplitude] °C, summer/winter swing
   * @param {number} [options.updateInterval]
   */
  constructor({
    ticksPerYear = DEFAULT_ENVIRONMENT_PARAMS.ticksPerYear,
    spellTicks = DEFAULT_ENVIRONMENT_PARAMS.spellTicks,
    meanTemperature = DEFAULT_ENVIRONMENT_PARAMS.meanTemperature,
    temperatureAmplitude = DEFAULT_ENVIRONMENT_PARAMS.temperatureAmplitude,
    updateInterval = 1,
  } = {}) {
    super({ id: 'weather', phase: 'environment', priority: -10, updateInterval });
    this.params = { ticksPerYear, meanTemperature, temperatureAmplitude };
    this.spellTicks = spellTicks;
  }

  update(world, context) {
    const previous = world.environment;

    // Re-roll on a fixed cadence so the stream advances predictably. The
    // **phase** is read at the moment of the roll, which is what makes drought a
    // dry-season thing — the odds are keyed per quarter, not per season, so the
    // wet season's flush and its settled half draw differently.
    let weather = previous.weather;
    if (context.tick % this.spellTicks === 0) {
      weather = rollWeather(phaseAt(context.tick, this.params.ticksPerYear), context.random('weather'));
    }

    const next = describeEnvironment(context.tick, weather, this.params);
    world.environment = next;

    // ⚠⚠ **The dry season becomes a fact about the map here**, and it is asserted
    // every tick rather than only on the turn. The season is a pure function of the
    // tick, so `setSeason` is one comparison when nothing changed — and stating it
    // unconditionally means a world that has just been *restored* mid-dry-season
    // gets its map on the first tick without the loader having to know about
    // terrain. ⚠ This system runs at priority −10 of the `environment` phase, which
    // is the first phase, so the map is settled before anything in the tick reads
    // a cell.
    // ⚠⚠ **The wet season refills the lake core with animals still standing in
    // it.** The dry map makes `LAKE_CORE` shallow and walkable — that is the
    // feature — so animals drink there; restoring `DEEP_WATER` then leaves them on
    // an impassable cell with no way off, for the ~2000 ticks until the next dry
    // season. Measured before this line: 30 and 39 animals caught per turn on two
    // demo seeds, 24 and 20 of them dead before the map released them. See
    // `world/stranding.js` for the whole finding and for why the fix is a
    // relocation rather than a rule about where animals may walk.
    //
    // ⚠ Gated on the turn rather than asserted every tick, and that is a
    // performance decision with a stated cost: scanning every animal's passability
    // each tick is a hot-path price for a state that can only be created by a turn.
    // The one thing it misses is a save written by a *pre-fix* engine, which keeps
    // its stranded animals until the following season change frees them anyway.
    //
    // ⚠ It runs here rather than inside `World.setSeason` because the loader calls
    // that with the entities restored and the spatial index not yet rebuilt — an
    // eviction there would query a stale grid. A system runs only on a live world.
    if (world.setSeason(next.season)) evictStranded(world);

    // ⚠ The **phase** turning is announced as well as the season, and it has to
    // be: a season is two phases, so `wetEarly → wetLate` changes what the grass
    // does without changing the season's name. Watching only the season would
    // silently drop half the turnovers in the year.
    if (next.season !== previous.season || next.phase !== previous.phase || next.weather !== previous.weather) {
      context.emit(EventTypes.ENVIRONMENT_CHANGED, {
        season: next.season,
        phase: next.phase,
        weather: next.weather,
        temperature: next.temperature,
        previousSeason: previous.season,
        previousPhase: previous.phase,
        previousWeather: previous.weather,
      });
    }
  }
}
