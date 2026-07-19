/**
 * Season and weather (Step 19) — the first state that is *global* rather than
 * per-entity or per-cell.
 *
 * Two clocks drive it, deliberately separated:
 *
 *   - The **season** is a pure function of the tick. Given a tick and a year
 *     length you can compute the season and the baseline temperature without
 *     any history, which is what makes the cycle reproducible across a save,
 *     a restore, or a fresh run at the same seed.
 *   - The **weather** is stochastic and *stateful*: it is drawn from the
 *     `weather` stream, holds for a spell, and then re-rolls with
 *     season-dependent odds. Snow in midwinter, drought in high summer, rain
 *     mostly at the shoulders.
 *
 * Everything downstream reads one small record: vegetation growth scales by
 * `growthModifier`, animals pay to thermoregulate away from `temperature`, and
 * the renderer puts the season in the status bar.
 *
 * The year is compressed for the demo exactly as lifespan is (PLAN.md §3): a
 * tick is ~1 in-world minute, so a literal year would be 525,600 ticks and no
 * demo run would ever see winter. `ticksPerYear` is the knob.
 */

import { SPECIES } from '../config/species/index.js';

/** Seasons in cycle order, starting at the year boundary. */
export const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);

/** Weather states. `clear` is the fallback for an unknown one. */
export const WEATHER = Object.freeze(['clear', 'rain', 'drought', 'snow']);

/**
 * Per-season weather odds, in `WEATHER` order. Each row sums to 1. These
 * encode the season's character: droughts only really happen in summer, snow
 * only in winter, and the shoulder seasons are the wet ones.
 */
const WEATHER_ODDS = Object.freeze({
  spring: Object.freeze([0.55, 0.42, 0.03, 0.0]),
  summer: Object.freeze([0.6, 0.15, 0.25, 0.0]),
  autumn: Object.freeze([0.5, 0.45, 0.05, 0.0]),
  winter: Object.freeze([0.45, 0.15, 0.0, 0.4]),
});

/** How each weather state shifts temperature (°C) and vegetation growth. */
const WEATHER_EFFECT = Object.freeze({
  clear: Object.freeze({ temperatureShift: 0, growthScale: 1 }),
  rain: Object.freeze({ temperatureShift: -2, growthScale: 1.6 }),
  drought: Object.freeze({ temperatureShift: 5, growthScale: 0.25 }),
  snow: Object.freeze({ temperatureShift: -6, growthScale: 0 }),
});

/** Vegetation growth scale by season, before weather is applied. */
const SEASON_GROWTH = Object.freeze({ spring: 1.35, summer: 1.0, autumn: 0.6, winter: 0.15 });

/**
 * Fraction of full carrying capacity the land can hold in each season. This is
 * what actually makes winter look like winter — see `VegetationGrid.grow`.
 */
const SEASON_CAPACITY = Object.freeze({ spring: 0.9, summer: 1.0, autumn: 0.6, winter: 0.3 });

/**
 * Fraction of the year elapsed, in [0, 1).
 * @param {number} tick @param {number} ticksPerYear
 */
export function yearProgress(tick, ticksPerYear) {
  if (!(ticksPerYear > 0)) return 0;
  return ((tick % ticksPerYear) + ticksPerYear) % ticksPerYear / ticksPerYear;
}

/**
 * Season for a tick — a pure function, so it needs no stored state.
 * @param {number} tick @param {number} ticksPerYear
 */
export function seasonAt(tick, ticksPerYear) {
  const index = Math.floor(yearProgress(tick, ticksPerYear) * SEASONS.length);
  return SEASONS[Math.min(index, SEASONS.length - 1)];
}

/**
 * Baseline temperature for a tick, before weather. A sinusoid phase-shifted so
 * the peak lands in midsummer and the trough in midwinter.
 * @param {number} tick
 * @param {object} params
 */
export function baseTemperatureAt(tick, { ticksPerYear, meanTemperature, temperatureAmplitude }) {
  // sin peaks a quarter-cycle after the shift, so a shift of 0.125 puts the
  // peak at yearProgress 0.375 — the middle of summer — and the trough at
  // 0.875, the middle of winter.
  const phase = (yearProgress(tick, ticksPerYear) - 0.125) * Math.PI * 2;
  return meanTemperature + temperatureAmplitude * Math.sin(phase);
}

/**
 * Pick a weather state for a season from one draw. Always consumes exactly one
 * value, whatever it returns.
 * @param {string} season
 * @param {import('../random/SeededRandom.js').SeededRandom} random
 */
export function rollWeather(season, random) {
  const odds = WEATHER_ODDS[season] ?? WEATHER_ODDS.spring;
  const roll = random.next();
  let cumulative = 0;
  for (let i = 0; i < WEATHER.length; i += 1) {
    cumulative += odds[i];
    if (roll < cumulative) return WEATHER[i];
  }
  return WEATHER[0];
}

/**
 * Build the full environment record for a tick and a weather state.
 * @param {number} tick
 * @param {string} weather
 * @param {object} params season/temperature parameters
 */
export function describeEnvironment(tick, weather, params) {
  const season = seasonAt(tick, params.ticksPerYear);
  const effect = WEATHER_EFFECT[weather] ?? WEATHER_EFFECT.clear;
  const progress = yearProgress(tick, params.ticksPerYear);
  return {
    season,
    weather,
    // Position within the current season, 0…1 — useful for a status bar and
    // for asserting "late winter" in a test without knowing the tick maths.
    seasonProgress: (progress * SEASONS.length) % 1,
    yearProgress: progress,
    temperature: baseTemperatureAt(tick, params) + effect.temperatureShift,
    growthModifier: (SEASON_GROWTH[season] ?? 1) * effect.growthScale,
    // A drought does not just slow growth, it shrinks what the land can hold.
    capacityModifier: (SEASON_CAPACITY[season] ?? 1) * (weather === 'drought' ? 0.6 : 1),
  };
}

/**
 * How far outside its comfort range an animal currently is, in °C, after any
 * shelter it is standing in. The single definition of "the weather is biting",
 * shared by the metabolism system (which charges for it) and the decision
 * system (which decides whether to walk out of it) so the two cannot drift.
 *
 * @param {import('./World.js').World} world
 * @param {object} entity
 * @param {number} shelterRelief fraction of the stress cover removes
 * @returns {number} degrees of stress, 0 when comfortable
 */
export function thermalStress(world, entity, shelterRelief) {
  const environment = world.environment;
  if (!environment) return 0;
  const species = SPECIES[entity.speciesId];
  const min = species?.comfortMin;
  const max = species?.comfortMax;
  const temperature = environment.temperature;
  let stress = 0;
  if (min !== undefined && temperature < min) stress = min - temperature;
  else if (max !== undefined && temperature > max) stress = temperature - max;
  if (stress > 0 && world.isShelteredAt(entity.x, entity.y)) stress *= 1 - shelterRelief;
  return stress;
}

/** The environment a world starts with, before the first weather roll. */
export function initialEnvironment(params) {
  return describeEnvironment(0, 'clear', params);
}
