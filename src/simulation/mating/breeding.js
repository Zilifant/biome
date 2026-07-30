/**
 * Seasonal breeding windows (PLAN-SPECIES.md §3.11, phase 12) — a species that
 * only conceives at one time of year.
 *
 * Every animal in this world has bred year-round, gated on energy and a
 * refractory period and nothing else. That is honest for a gazelle, which breeds
 * close enough to continuously that phase 7 needed nothing for it, and wrong for
 * the wildebeest arriving in batch 3: a compressed rut and a calving season are
 * that animal's defining life-history fact, and the predator-swamping it produces
 * — a year's calves born within a few hundred ticks of each other, more than the
 * predators can eat in the time they stay vulnerable — is one of the strongest
 * ecological effects available anywhere in this document for the price.
 *
 * ⚠ **The price is one config field, and everything else already exists.** The
 * year is `environment.ticksPerYear` (8000, compressed exactly as lifespan is),
 * `yearProgress` is a pure function of the tick that `WeatherSystem` already
 * publishes on `world.environment` every tick, and `reproduction` has been a
 * species block since Step 29. So a window is:
 *
 * ```js
 * reproduction: Object.freeze({ breedingWindow: { startFraction: 0.15, endFraction: 0.45 } })
 * ```
 *
 * ⚠⚠ **Birth synchrony then needs nothing at all** — no second mechanism, no
 * synchronizing term, no shared clock. A compressed conception window plus a
 * roughly constant `gestationTicks` *is* a compressed calving window, offset by
 * the gestation. That is the whole feature, and it is why this is the cheapest
 * item in §3 by a wide margin.
 *
 * **What it gates, and what it deliberately does not:**
 *
 *   - ✅ **The chooser's readiness.** `isReproductivelyReady` is the single shared
 *     rule (see `systems/ReproductionSystem.js`), read by the reproduction system
 *     when it pairs animals and by the decision system when it decides whether to
 *     go looking — so gating it there gates both halves at once and they cannot
 *     drift. Out of season a female is not receptive, `mateSearchSince` resets,
 *     and she therefore enters her next window at **full choosiness** rather than
 *     at whatever standard a year of waiting had eroded. That falls out; it was
 *     not built.
 *   - ❌ **Not the suitor.** A rut is a fact about both sexes, but conception is
 *     what a window is *for*, and the chooser is what gates a pregnancy (DOCS §9
 *     Reproduction). Gating the seeking sex as well would change nothing about
 *     when calves are born and would stop males competing for the females who are
 *     about to become receptive, which is the interesting half of a rut. Stated as
 *     a limit rather than left to be discovered: **males are ready year-round**.
 *   - ❌ **Not gestation, birth, or parenting.** A pregnancy carried across the
 *     window's end is delivered normally. A window that could abort one would be
 *     a different and much worse mechanism.
 *
 * ⚠ **Watch the interaction with a knife-edge founding population**, which is the
 * one warning §3.11 gives and it is a real one: a species that misses a window
 * loses a *year* of recruitment, and at 8000 ticks to the year a 15 000-tick sweep
 * contains only two windows. Start wide and narrow it under measurement — a
 * window is not a parameter to guess at with a ten-seed gate riding on it.
 *
 * ⚠ **Inert until a species declares one**, and inert as the exact identity: the
 * config default is `null`, which skips the comparison entirely rather than
 * computing a window that happens to cover the year (D16, the same discipline as
 * `predation`'s null ratios). No species declares one in phase 12; the wildebeest
 * arrives in phase 13 and is what this was built for.
 *
 * The world-level off switch is `config.breeding.enabled`, in a global section
 * rather than inside the `reproduction` block that holds the window — a species
 * block beats the config (DOCS §8), so a switch inside one is not a switch. Same
 * shape as `cooperation` and `mobbing`, whose weights likewise live in blocks.
 */

/**
 * World-level breeding-season parameters — the off switch, and nothing else.
 * The window itself is per-species biology and lives in `reproduction`.
 */
export const DEFAULT_BREEDING = Object.freeze({ enabled: true });

/**
 * A species' breeding window, or null when it breeds year-round.
 *
 * ⚠ **A degenerate window is null, not a sterile species.** A window whose ends
 * are equal, or whose fractions are not finite numbers, is treated as no window at
 * all rather than as a zero-width one. The alternative reading — "breeds on
 * exactly one instant of the year" — is a config typo that quietly extinguishes a
 * species over ten seeds and looks like an ecological result. The identity is the
 * safe failure; being unable to breed is not.
 *
 * ⚠ **It returns the species' own frozen object, never a normalized copy**, and
 * that is a performance requirement rather than a style choice: this is reached
 * from `isReproductivelyReady`, which the decision system calls once per animal per
 * tick. Building a two-field object there would be a per-tick allocation in a hot
 * loop the moment one species declares a window — the thing the species schema
 * exists to avoid. Folding a fraction into the year therefore happens on *read*,
 * in `inBreedingWindow`, where it is two modulos and no garbage.
 *
 * @param {{breedingWindow?: {startFraction?: number, endFraction?: number}|null}} [reproduction]
 *   the resolved `reproduction` block
 * @returns {{startFraction: number, endFraction: number} | null}
 */
export function breedingWindowOf(reproduction) {
  // ⚠ Not named `window`, here or anywhere below. The engine's source scan
  // forbids `window.` outright (`test/engine.test.js`) because it cannot tell a
  // local from the browser global — and it should not have to.
  const declared = reproduction?.breedingWindow;
  if (!declared || typeof declared !== 'object') return null;
  const { startFraction, endFraction } = declared;
  if (!Number.isFinite(startFraction) || !Number.isFinite(endFraction)) return null;
  return wrapFraction(startFraction) === wrapFraction(endFraction) ? null : declared;
}

/**
 * Whether a point in the year falls inside a window.
 *
 * ⚠ **A window may wrap the year boundary**, and it has to: a rut running from
 * late autumn into early spring is `{ startFraction: 0.8, endFraction: 0.1 }`, and
 * a mechanism that could not express it would push every species' breeding season
 * away from the boundary for a reason that is purely about arithmetic. So
 * `start < end` reads as one interval and `start > end` as the complement.
 *
 * Half-open at the end, like every other range in this engine.
 *
 * @param {number} progress fraction of the year elapsed, in [0, 1)
 * @param {{startFraction: number, endFraction: number} | null} breedingWindow
 * @returns {boolean} true for a species with no window — year-round is the identity
 */
export function inBreedingWindow(progress, breedingWindow) {
  if (breedingWindow === null) return true;
  const start = wrapFraction(breedingWindow.startFraction);
  const end = wrapFraction(breedingWindow.endFraction);
  return start < end ? progress >= start && progress < end : progress >= start || progress < end;
}

/** Fold a fraction into [0, 1), so a window may be written 1.2 or −0.3 and mean it. */
function wrapFraction(fraction) {
  return ((fraction % 1) + 1) % 1;
}
