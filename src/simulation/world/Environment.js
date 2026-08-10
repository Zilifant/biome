/**
 * Season and weather (Step 19; **wet/dry** since SEASON-PLAN.md D1) — the first
 * state that is *global* rather than per-entity or per-cell.
 *
 * Two clocks drive it, deliberately separated:
 *
 *   - The **season** is a pure function of the tick. Given a tick and a year
 *     length you can compute the season and the baseline temperature without
 *     any history, which is what makes the cycle reproducible across a save,
 *     a restore, or a fresh run at the same seed.
 *   - The **weather** is stochastic and *stateful*: it is drawn from the
 *     `weather` stream, holds for a spell, and then re-rolls with
 *     phase-dependent odds. Rain mostly in the wet season, drought mostly in
 *     the dry one.
 *
 * Everything downstream reads one small record: vegetation growth scales by
 * `growthModifier`, animals pay to thermoregulate away from `temperature`, and
 * the renderer puts the season in the status bar.
 *
 * The year is compressed for the demo exactly as lifespan is (PLAN.md §3): a
 * tick is ~1 in-world minute, so a literal year would be 525,600 ticks and no
 * demo run would ever see the dry season. `ticksPerYear` is the knob, and it is
 * **4000** — one season is 2000 ticks and one phase 1000.
 *
 * ⚠⚠ **Two seasons, four phases, and the four is what keeps this file small.**
 * A wet/dry year is what the world models, but the wet season is not uniform —
 * the flush at its start grows more grass than its settled middle does, which is
 * exactly the distinction the old `spring`/`summer` split carried. So the year
 * is still cut into quarters (`PHASES`), every per-quarter table is still keyed
 * by one, and a **season is a pair of phases**. `yearProgress` and the quarter
 * arithmetic are untouched code from the four-season version; only the names and
 * the grouping changed.
 *
 * ⚠ **The dry season does almost nothing here, and that is deliberate.** Its
 * vegetation effect is *per-cell* — grass keeps growing where the water was and
 * stops where it was not — which a global scalar cannot express. That lives in
 * `VegetationGrid` (DOCS.md §7 *Vegetation*), so `PHASE_GROWTH` and `PHASE_CAPACITY`
 * are neutral through both dry phases rather than carrying a season's worth of
 * meaning they would have to say wrongly.
 */

import { temperatureShiftAt } from '../disturbance/disturbances.js';
import { defaultSimulationConfig } from '../config/defaultSimulationConfig.js';

/**
 * The year/temperature parameters used when a caller supplies none — the
 * fallback for a `World` built without a configured `environment` block, which
 * the sandbox tests do constantly.
 *
 * ⚠ **This is the config's environment block re-exported, not a second copy**,
 * exactly as `DEFAULT_TERRAIN_PARAMS` is. It was a hand-maintained duplicate in
 * `World.js` until SEASON-PLAN.md D1, and it had already drifted: it carried
 * `temperatureAmplitude: 14` against the config's 9, so every sandbox world ran a
 * climate no configured world had used since 2026-08-01. Same failure the terrain
 * params had on 2026-08-02, same fix.
 */
export const DEFAULT_ENVIRONMENT_PARAMS = defaultSimulationConfig.environment;

/**
 * The four phases of the year in cycle order, starting at the year boundary.
 * ⚠ This is what the year is *divided* by; `SEASONS` is what those divisions are
 * *grouped* into. Everything keyed per-quarter — weather odds, growth, capacity —
 * is keyed by one of these.
 */
export const PHASES = Object.freeze(['wetEarly', 'wetLate', 'dryEarly', 'dryLate']);

/** The two seasons, in cycle order. Each covers two consecutive phases. */
export const SEASONS = Object.freeze(['wet', 'dry']);

/** Which season a phase belongs to. */
const SEASON_BY_PHASE = Object.freeze({
  wetEarly: 'wet',
  wetLate: 'wet',
  dryEarly: 'dry',
  dryLate: 'dry',
});

/**
 * Weather states. `clear` is the fallback for an unknown one.
 *
 * ⚠ **`snow` is retained at zero odds rather than removed.** A wet/dry world
 * never snows, but the string stays in the enum so an older save loads, the
 * renderer's tone table keeps its key, and no protocol enum shrinks. Deleting it
 * is a separate cleanup that buys nothing.
 */
export const WEATHER = Object.freeze(['clear', 'rain', 'drought', 'snow']);

/**
 * Per-phase weather odds, in `WEATHER` order. Each row sums to 1.
 *
 * ⚠⚠ **A drought is weather, not the season, and the two must not be merged.**
 * The season is a pure function of the tick; the weather is a draw that holds for
 * a spell. Making the dry season *be* a drought spell would make it start at a
 * different tick on every seed and stop being derivable from the clock on load —
 * which is the one split this whole file rests on. So the dry season is the
 * **floor**, and a drought spell is a bad patch within it: the odds below put
 * droughts almost entirely in the dry phases, and they compose with an
 * already-dry map rather than being the only dryness in the world.
 *
 * ⚠ Rain in the dry season does **not** refill the map. Water is on the season's
 * clock, not the weather's — a deliberate simplification, stated here so nobody
 * goes looking for the bug.
 */
const WEATHER_ODDS = Object.freeze({
  wetEarly: Object.freeze([0.45, 0.55, 0.0, 0.0]),
  wetLate: Object.freeze([0.55, 0.42, 0.03, 0.0]),
  dryEarly: Object.freeze([0.6, 0.1, 0.3, 0.0]),
  dryLate: Object.freeze([0.45, 0.05, 0.5, 0.0]),
});

/** How each weather state shifts temperature (°C) and vegetation growth. */
const WEATHER_EFFECT = Object.freeze({
  clear: Object.freeze({ temperatureShift: 0, growthScale: 1 }),
  rain: Object.freeze({ temperatureShift: -2, growthScale: 1.6 }),
  drought: Object.freeze({ temperatureShift: 5, growthScale: 0.25 }),
  snow: Object.freeze({ temperatureShift: -6, growthScale: 0 }),
});

/**
 * Vegetation growth scale by phase, before weather is applied. The wet season's
 * first half is the flush; everything after it is ordinary.
 */
const PHASE_GROWTH = Object.freeze({ wetEarly: 1.35, wetLate: 1.0, dryEarly: 1.0, dryLate: 1.0 });

/**
 * Fraction of full carrying capacity the land can hold in each phase.
 *
 * ⚠ **Neutral through the dry season, on purpose.** Lowering this would brown the
 * whole map off uniformly, which is the four-season behaviour and the wrong one
 * here: the dry season is supposed to leave the riparian strip alone and stop the
 * open plain regrowing, and a single scalar cannot say "here but not there".
 * Grass on the plain therefore does not die back — it simply never recovers from
 * being eaten. See `VegetationGrid` and DOCS.md §7 *Vegetation*.
 */
const PHASE_CAPACITY = Object.freeze({ wetEarly: 0.9, wetLate: 1.0, dryEarly: 1.0, dryLate: 1.0 });

/**
 * Fraction of the year elapsed, in [0, 1).
 * @param {number} tick @param {number} ticksPerYear
 */
export function yearProgress(tick, ticksPerYear) {
  if (!(ticksPerYear > 0)) return 0;
  return ((tick % ticksPerYear) + ticksPerYear) % ticksPerYear / ticksPerYear;
}

/**
 * Phase of the year for a tick — a pure function, so it needs no stored state.
 * @param {number} tick @param {number} ticksPerYear
 */
export function phaseAt(tick, ticksPerYear) {
  const index = Math.floor(yearProgress(tick, ticksPerYear) * PHASES.length);
  return PHASES[Math.min(index, PHASES.length - 1)];
}

/**
 * Season for a tick — the phase's half of the year.
 * @param {number} tick @param {number} ticksPerYear
 */
export function seasonAt(tick, ticksPerYear) {
  return SEASON_BY_PHASE[phaseAt(tick, ticksPerYear)];
}

/**
 * Baseline temperature for a tick, before weather. A sinusoid phase-shifted so
 * the peak lands in the middle of the wet season's second half.
 *
 * ⚠⚠ **The amplitude is 2, and temperature is deliberately no longer a
 * mechanism.** A wet/dry world's pressure is water and grass, not cold, so the
 * bare year runs 12…16 °C — inside every species' comfort band, whose
 * intersection is 5…24 °C. Nothing is ever thermally stressed by the *season*.
 * The weather still moves it a little (drought +5 → 21, rain −2 → 10, both still
 * comfortable); only a **storm**, at −10 on top, can push an animal out of band.
 *
 * ⚠ That is a large change to an energy sink, not a cosmetic one: DOCS §1.1 A67
 * measured thermoregulation at **40.1% of the leopard's entire energy budget** at
 * amplitude 11, which is why it was cut to 9. At 2 it is near zero and every
 * animal in the world is materially cheaper to run. Nobody should later mistake
 * the survival that buys for the seasons working.
 *
 * The phase shift is left at 0.125 because at this amplitude it no longer
 * matters where the 4 °C swing lands.
 *
 * @param {number} tick
 * @param {object} params
 */
export function baseTemperatureAt(tick, { ticksPerYear, meanTemperature, temperatureAmplitude }) {
  // sin peaks a quarter-cycle after the shift, so a shift of 0.125 puts the
  // peak at yearProgress 0.375 — the middle of `wetLate` — and the trough at
  // 0.875, the middle of `dryLate`.
  const phase = (yearProgress(tick, ticksPerYear) - 0.125) * Math.PI * 2;
  return meanTemperature + temperatureAmplitude * Math.sin(phase);
}

/**
 * Pick a weather state for a phase of the year from one draw. Always consumes
 * exactly one value, whatever it returns.
 * @param {string} phase one of `PHASES`
 * @param {import('../random/SeededRandom.js').SeededRandom} random
 */
export function rollWeather(phase, random) {
  const odds = WEATHER_ODDS[phase] ?? WEATHER_ODDS.wetEarly;
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
  const phase = phaseAt(tick, params.ticksPerYear);
  const season = SEASON_BY_PHASE[phase];
  const effect = WEATHER_EFFECT[weather] ?? WEATHER_EFFECT.clear;
  const progress = yearProgress(tick, params.ticksPerYear);
  return {
    season,
    phase,
    weather,
    // Position within the current **season**, 0…1 — so "late dry" is 0.8 of a
    // half-year rather than 0.8 of a quarter. ⚠ This changed meaning with the
    // wet/dry conversion (it used to be position within the quarter); the
    // quarter is now `phaseProgress` beside it.
    seasonProgress: (progress * SEASONS.length) % 1,
    phaseProgress: (progress * PHASES.length) % 1,
    yearProgress: progress,
    temperature: baseTemperatureAt(tick, params) + effect.temperatureShift,
    growthModifier: (PHASE_GROWTH[phase] ?? 1) * effect.growthScale,
    // A drought does not just slow growth, it shrinks what the land can hold.
    capacityModifier: (PHASE_CAPACITY[phase] ?? 1) * (weather === 'drought' ? 0.6 : 1),
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
  // `?.` because this helper is also called with hand-built minimal worlds
  // in tests; a world with no registry simply has no comfort band.
  const species = world.species?.get(entity.speciesId);
  const min = species?.comfortMin;
  const max = species?.comfortMax;
  // A storm (Step 27) is a *local* shift on the global temperature, applied
  // here so its whole bite lands on machinery that already exists: the
  // metabolism system charges for the stress, and the decision system reads the
  // same number when deciding to walk to cover. That is why a storm needed no
  // behaviour of its own — being cold is already something animals respond to.
  const temperature = environment.temperature + temperatureShiftAt(world.disturbances ?? [], entity.x, entity.y);
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
