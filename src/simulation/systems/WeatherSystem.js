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
 * Ownership: writes `world.environment` and nothing else. Emits
 * `environment.changed` when the season, the **phase** or the weather turns
 * over — not every tick, since temperature drifts continuously and would flood
 * the log.
 */
import { SimulationSystem } from './SimulationSystem.js';
import { EventTypes } from '../events/EventTypes.js';
import { describeEnvironment, rollWeather, phaseAt, DEFAULT_ENVIRONMENT_PARAMS } from '../world/Environment.js';

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
