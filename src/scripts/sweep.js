/**
 * biome sweep — the species measurement gate (PLAN-SPECIES.md §9).
 *
 * Runs the demo world across many seeds and reports, per seed and in aggregate:
 * **population by species at checkpoints, deaths by cause by species, and the
 * tick each species went extinct.** That is the evidence a species batch is
 * gated on, and until now it was assembled by hand for each measurement.
 *
 * It is deliberately *not* the ethologist. That tool answers "did any individual
 * animal behave absurdly"; this one answers "does this world still work". Both
 * read authoritative state only and neither mutates the engine.
 *
 * **The A/B is the point.** A population number on its own says almost nothing —
 * the demo is a knife edge and DOCS §1.4 D14 records that five seeds cannot
 * resolve a one-seed difference in the founding counts. So `--control=` runs a
 * second founding roster over the *same seeds* and prints both arms side by
 * side, which is the scenario-11 pattern (DOCS §14) applied to a species: the
 * claim is never "the new species survived", it is "the new species survived and
 * the control's species are no worse off than without it".
 *
 * Usage:
 *   npm run sweep                                    # 10 seeds x 15000 ticks, demo defaults
 *   npm run sweep -- --seedCount=10 --ticks=15000
 *   npm run sweep -- --founding=herbivore.gazelle:120,predator.stalker:8,scavenger.vulture:10,scavenger.hyena:6 \
 *                    --control=herbivore.gazelle:120,predator.stalker:8,scavenger.vulture:10
 *   npm run sweep -- --seeds=1,2,3 --ticks=5000 --json
 *   npm run sweep -- --set=forage.enabled=true --controlSet=forage.enabled=false
 *
 * Flags: --seeds=a,b,c | --seedCount=N (from --seedBase, default 1);
 *   --ticks, --checkpoints=5000,10000,15000, --founding=, --control=,
 *   --set=section.key=value,…, --controlSet=…,
 *   --width, --height, --rocks, --thickets, --json, --quiet.
 *
 * ⚠ `--set` / `--controlSet` are the **config** A/B, added at phase 9 (see
 * `parseConfigOverrides`). Before them a config change had to be measured as two
 * separate invocations compared by hand; a roster change could be one command and a
 * weight change could not, for no reason other than that nobody had written the
 * flag.
 *
 * ⚠ A sweep is a *reading taken on a date*, like every number in this project
 * (DOCS "How to read this document"). Record the date and the world beside the
 * figure; never inherit one.
 */
import { createDemoSimulation, buildDemoConfig } from '../fixtures/createDemoSimulation.js';
import { defaultSimulationConfig } from '../simulation/config/defaultSimulationConfig.js';

const DEFAULT_TICKS = 15000;
const DEFAULT_SEED_COUNT = 10;

function fail(message) {
  console.error(message);
  console.error(
    'usage: sweep.js [--seeds=a,b,c | --seedCount=N] [--ticks=N] [--checkpoints=a,b,c]\n' +
      '                [--founding=id:count,...] [--control=id:count,...]\n' +
      '                [--set=section.key=value,...] [--controlSet=section.key=value,...]\n' +
      '                [--width=N] [--height=N] [--rocks=N] [--thickets=N] [--json] [--quiet]',
  );
  process.exit(1);
}

/**
 * `forage.enabled=false,habitat.biasWeight=0.2` → a config override object.
 *
 * ⚠ **Added at phase 9 because the harness could not measure that phase.** A
 * sweep's `--control=` compares two *rosters* in one process; PLAN-SPECIES §9 says
 * plainly that "a config change (a mass, a weight) still needs two runs", and
 * phases 4, 7, and 8 each paid that by hand-comparing two invocations. Since a
 * sweep is deterministic, a config arm is exactly as comparable as a roster arm —
 * there was no reason for one to be a flag and the other a chore. `--set=` is the
 * arm and `--controlSet=` the control, so the phase-9 gate (mechanism on against
 * mechanism off, same seeds) is one command.
 *
 * Dotted paths are two levels deep, which is what a config section is. Values are
 * parsed as JSON when they can be (`false`, `0.2`, `null`) and kept as strings
 * otherwise, so `--set=forage.enabled=false` is a boolean rather than the string
 * "false" — a distinction that would otherwise turn an "off" arm silently on,
 * which is exactly the class of mistake phase 8 lost an afternoon to.
 */
function parseConfigOverrides(value) {
  const config = {};
  for (const pair of value.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) fail(`--set entries must be section.key=value, got "${pair}"`);
    const path = pair.slice(0, eq).split('.');
    if (path.length !== 2 || path.some((part) => part.length === 0)) {
      fail(`--set paths are section.key (two levels), got "${pair.slice(0, eq)}"`);
    }
    const raw = pair.slice(eq + 1);
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* a bare string, e.g. a species id — keep it as written */
    }
    const [section, key] = path;
    config[section] = { ...(config[section] ?? {}), [key]: parsed };
  }
  return config;
}

/** `herbivore.gazelle:120,predator.stalker:8` → `[{ speciesId, count }]`. */
function parseFoundingRoster(value) {
  return value.split(',').map((pair) => {
    const [speciesId, count] = pair.split(':');
    if (!speciesId || !/^\d+$/.test(count ?? '')) fail(`--founding entries must be speciesId:count, got "${pair}"`);
    return { speciesId, count: Number(count) };
  });
}

function parseArgs(argv) {
  const opts = {
    seeds: null,
    seedBase: 1,
    seedCount: null,
    ticks: DEFAULT_TICKS,
    checkpoints: null,
    json: false,
    quiet: false,
    founding: null,
    control: null,
    set: null,
    controlSet: null,
    world: {},
  };
  const worldKeys = new Set(['width', 'height', 'rocks', 'thickets']);
  for (const arg of argv) {
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--quiet') { opts.quiet = true; continue; }
    const m = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (!m) fail(`unknown argument: ${arg}`);
    const [, key, value] = m;
    if (key === 'founding') opts.founding = parseFoundingRoster(value);
    else if (key === 'control') opts.control = parseFoundingRoster(value);
    else if (key === 'set') opts.set = parseConfigOverrides(value);
    else if (key === 'controlSet') opts.controlSet = parseConfigOverrides(value);
    else if (key === 'seeds') opts.seeds = value.split(',').map(Number);
    else if (key === 'seedBase') opts.seedBase = Number(value);
    else if (key === 'seedCount') opts.seedCount = Number(value);
    else if (key === 'ticks') opts.ticks = Number(value);
    else if (key === 'checkpoints') opts.checkpoints = value.split(',').map(Number);
    else if (worldKeys.has(key)) opts.world[key] = Number(value);
    else fail(`unknown argument: ${arg}`);
  }
  if (!opts.seeds) {
    const count = opts.seedCount ?? DEFAULT_SEED_COUNT;
    opts.seeds = Array.from({ length: count }, (_, i) => opts.seedBase + i);
  }
  // Thirds of the run, so `--ticks` alone still gives an early/mid/late reading.
  opts.checkpoints ??= [opts.ticks / 3, (opts.ticks * 2) / 3, opts.ticks].map((t) => Math.round(t));
  return opts;
}

/**
 * Run one seed of one arm and return its record.
 *
 * Everything is counted from state the engine already publishes: a death is a
 * carcass whose `diedTick` is this tick (the same read the ethologist uses, and
 * cheaper than draining the event outbox), carrion feeding is an `entity.fed`
 * carrying a `carcassId`, and the group registry reports its own size.
 *
 * @param {number} seed
 * @param {object} config config overrides for this arm
 * @param {number} ticks
 * @param {number[]} checkpoints ascending tick numbers to sample populations at
 */
function runSeed(seed, config, ticks, checkpoints) {
  const engine = createDemoSimulation({ seed, config });
  const world = engine.world;
  const speciesIds = [...world.species.ids()].sort();

  /** @type {Record<string, Record<string, number>>} species → cause → count */
  const deaths = {};
  /** @type {Record<string, {feeds: number, mass: number}>} */
  const carrion = {};
  /** @type {Record<string, number>} species → tick it was last seen alive */
  const lastAlive = {};
  /** @type {Record<string, Record<string, number>>} checkpoint → species → living */
  const populations = {};
  let peakGroups = 0;
  let groupsFounded = 0;
  let groupsDissolved = 0;
  let lastEventSeq = 0;

  const remaining = [...checkpoints].sort((a, b) => a - b);
  const census = () => {
    const living = {};
    for (const id of speciesIds) living[id] = 0;
    for (const entity of world.entities.all()) {
      if (entity.kind === 'animal' && entity.alive) living[entity.speciesId] = (living[entity.speciesId] ?? 0) + 1;
    }
    return living;
  };

  for (let t = 1; t <= ticks; t += 1) {
    engine.step(1);
    const tick = engine.tick;

    for (const entity of world.entities.all()) {
      if (entity.kind === 'carcass' && entity.diedTick === tick) {
        const bySpecies = (deaths[entity.speciesId] ??= {});
        bySpecies[entity.deathCause] = (bySpecies[entity.deathCause] ?? 0) + 1;
      } else if (entity.kind === 'animal' && entity.alive) {
        lastAlive[entity.speciesId] = tick;
      }
    }

    // Events are drained every tick, so the bounded outbox can never trim a
    // window out from under the tally.
    for (const event of engine.events.since(lastEventSeq)) {
      lastEventSeq = Math.max(lastEventSeq, event.seq);
      if (event.type === 'entity.fed' && event.carcassId !== undefined) {
        const eater = world.entities.get(event.entityId);
        if (!eater) continue;
        const entry = (carrion[eater.speciesId] ??= { feeds: 0, mass: 0 });
        entry.feeds += 1;
        entry.mass += event.amount ?? 0;
      } else if (event.type === 'entity.grouped' && event.founded) groupsFounded += 1;
      else if (event.type === 'entity.ungrouped' && event.dissolved) groupsDissolved += 1;
    }
    if (world.groups) peakGroups = Math.max(peakGroups, world.groups.size);

    while (remaining.length > 0 && tick >= remaining[0]) {
      populations[remaining.shift()] = census();
    }
  }

  // A species that never lived is `null` rather than 0: "founded none" and
  // "founded some and lost them all at tick 0" are different facts.
  const extinctAt = {};
  for (const id of speciesIds) {
    const finalLiving = populations[checkpoints.at(-1)]?.[id] ?? 0;
    extinctAt[id] = finalLiving > 0 ? null : (lastAlive[id] ?? null);
  }

  return { seed, populations, deaths, carrion, extinctAt, peakGroups, groupsFounded, groupsDissolved };
}

/** Aggregate one arm's per-seed records into the figures the gate is stated in. */
function summarize(label, seedRecords, checkpoints) {
  const speciesIds = [
    ...new Set(seedRecords.flatMap((record) => Object.keys(record.populations[checkpoints.at(-1)] ?? {}))),
  ].sort();
  const species = {};
  for (const id of speciesIds) {
    const finals = seedRecords.map((record) => record.populations[checkpoints.at(-1)]?.[id] ?? 0);
    const founded = seedRecords.some((record) =>
      Object.values(record.populations).some((sample) => (sample[id] ?? 0) > 0),
    );
    const causes = {};
    for (const record of seedRecords) {
      for (const [cause, count] of Object.entries(record.deaths[id] ?? {})) {
        causes[cause] = (causes[cause] ?? 0) + count;
      }
    }
    species[id] = {
      founded,
      survivingSeeds: finals.filter((n) => n > 0).length,
      seeds: finals.length,
      final: { min: Math.min(...finals), max: Math.max(...finals), mean: mean(finals) },
      byCheckpoint: Object.fromEntries(
        checkpoints.map((tick) => [tick, mean(seedRecords.map((record) => record.populations[tick]?.[id] ?? 0))]),
      ),
      deathsByCause: causes,
      carrionFeeds: seedRecords.reduce((total, record) => total + (record.carrion[id]?.feeds ?? 0), 0),
      carrionMass: seedRecords.reduce((total, record) => total + (record.carrion[id]?.mass ?? 0), 0),
      extinctSeeds: seedRecords.filter((record) => record.extinctAt[id] !== null).length,
    };
  }
  return {
    label,
    seeds: seedRecords.map((record) => record.seed),
    species,
    groups: {
      peak: Math.max(0, ...seedRecords.map((record) => record.peakGroups)),
      founded: seedRecords.reduce((total, record) => total + record.groupsFounded, 0),
      dissolved: seedRecords.reduce((total, record) => total + record.groupsDissolved, 0),
    },
  };
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function printArm(summary, checkpoints, seedRecords) {
  console.log(`\n── ${summary.label} ${'─'.repeat(Math.max(0, 60 - summary.label.length))}`);
  const pad = (text, width) => String(text).padEnd(width);
  const num = (value, width, digits = 1) => String(typeof value === 'number' ? value.toFixed(digits) : value).padStart(width);
  console.log(`${pad('', 24)}${pad('  mean living per seed', checkpoints.length * 9)}`);
  console.log(
    `${pad('species', 24)}${checkpoints.map((t) => num(`t${t}`, 9)).join('')}${num('seeds', 8)}${num('final range', 12)}`,
  );
  for (const [id, entry] of Object.entries(summary.species)) {
    if (!entry.founded) continue;
    const survival = `${entry.survivingSeeds}/${entry.seeds}`;
    console.log(
      pad(id, 24) +
        checkpoints.map((t) => num(entry.byCheckpoint[t], 9)).join('') +
        num(survival, 8, 0) +
        num(`${entry.final.min}–${entry.final.max}`, 12, 0),
    );
  }

  console.log('\ndeaths by cause (all seeds):');
  for (const [id, entry] of Object.entries(summary.species)) {
    if (!entry.founded) continue;
    const causes = Object.entries(entry.deathsByCause).sort((a, b) => b[1] - a[1]);
    const total = causes.reduce((sum, [, count]) => sum + count, 0);
    console.log(`  ${pad(id, 22)} ${String(total).padStart(5)}  ${causes.map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  }

  const scavengers = Object.entries(summary.species).filter(([, entry]) => entry.carrionFeeds > 0);
  if (scavengers.length > 0) {
    console.log('\ncarrion (all seeds):');
    const totalMass = scavengers.reduce((sum, [, entry]) => sum + entry.carrionMass, 0);
    for (const [id, entry] of scavengers) {
      const share = totalMass > 0 ? ((entry.carrionMass / totalMass) * 100).toFixed(1) : '0.0';
      console.log(`  ${pad(id, 22)} ${String(entry.carrionFeeds).padStart(7)} feeds  ${entry.carrionMass.toFixed(0).padStart(8)} kg  ${share.padStart(5)}% of taken`);
    }
  }

  if (summary.groups.peak > 0 || summary.groups.founded > 0) {
    console.log(
      `\npersistent groups: peak ${summary.groups.peak} concurrent · ${summary.groups.founded} founded · ${summary.groups.dissolved} dissolved`,
    );
  }

  const extinctions = seedRecords.flatMap((record) =>
    Object.entries(record.extinctAt)
      .filter(([, tick]) => tick !== null)
      .map(([id, tick]) => `seed ${record.seed}: ${id} last seen t${tick}`),
  );
  if (extinctions.length > 0) console.log(`\n⚠ extinctions:\n  ${extinctions.join('\n  ')}`);
}

/** The one line that says whether the arm passes, and against what. */
function printVerdict(arm, control, checkpoints) {
  console.log(`\n── verdict ${'─'.repeat(54)}`);
  const gateSeeds = (entry) => Math.ceil(entry.seeds * 0.6);
  for (const [id, entry] of Object.entries(arm.species)) {
    if (!entry.founded) continue;
    const passes = entry.survivingSeeds >= gateSeeds(entry);
    const baseline = control?.species[id];
    const delta = baseline
      ? ` · control ${baseline.survivingSeeds}/${baseline.seeds} seeds, mean ${baseline.final.mean.toFixed(1)} (${
          entry.final.mean >= baseline.final.mean ? '+' : ''
        }${(entry.final.mean - baseline.final.mean).toFixed(1)})`
      : '';
    console.log(
      `  ${passes ? 'PASS' : '⚠ FAIL'}  ${id.padEnd(22)} ${entry.survivingSeeds}/${entry.seeds} seeds alive at t${checkpoints.at(-1)}, mean ${entry.final.mean.toFixed(1)}${delta}`,
    );
  }
  console.log(
    '\n  Gate (PLAN-SPECIES §9): every species alive at the final checkpoint on ≥6/10 seeds,\n' +
      '  and the control\'s species not materially worse. ⚠ The verdict above checks the first\n' +
      '  half mechanically; "materially worse" is a judgement and stays yours.',
  );
}

/**
 * Merge config overrides over a partial config, one section deep — the same shape
 * `mergeConfig` uses, kept local because this merges two *partials* rather than a
 * partial over the defaults.
 * @param {object} base @param {object|null} overrides
 */
function mergeSections(base, overrides) {
  if (!overrides) return base;
  const merged = { ...base };
  for (const [section, values] of Object.entries(overrides)) {
    merged[section] = { ...(merged[section] ?? {}), ...values };
  }
  return merged;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const hasControl = opts.control !== null || opts.controlSet !== null;
  const arms = [
    { label: opts.founding || opts.set ? 'arm' : 'demo defaults', founding: opts.founding, set: opts.set },
    // ⚠ A control arm inherits the *arm's* roster unless it states its own, so
    // `--set=… --controlSet=…` compares two configs over one roster and
    // `--founding=… --control=…` compares two rosters over one config. Defaulting
    // the roster the other way round would make a config A/B silently also be a
    // roster A/B, which is two changes in one measurement.
    ...(hasControl ? [{ label: 'control', founding: opts.control ?? opts.founding, set: opts.controlSet }] : []),
  ];

  const results = [];
  for (const arm of arms) {
    const config = mergeSections(
      buildDemoConfig({ ...opts.world, ...(arm.founding ? { founding: arm.founding } : {}) }),
      arm.set,
    );
    const roster = arm.founding ?? defaultSimulationConfig.demo.founding;
    const overrides = arm.set
      ? ` · ${Object.entries(arm.set)
          .flatMap(([section, keys]) => Object.entries(keys).map(([key, value]) => `${section}.${key}=${JSON.stringify(value)}`))
          .join(' ')}`
      : '';
    const label = `${arm.label}: ${roster.map((entry) => `${entry.speciesId}:${entry.count}`).join(' ')}${overrides}`;
    if (!opts.json && !opts.quiet) console.error(`running ${label} over ${opts.seeds.length} seeds × ${opts.ticks} ticks…`);
    const seedRecords = opts.seeds.map((seed) => {
      const record = runSeed(seed, config, opts.ticks, opts.checkpoints);
      if (!opts.json && !opts.quiet) console.error(`  seed ${seed} done`);
      return record;
    });
    results.push({ arm, label, seedRecords, summary: summarize(label, seedRecords, opts.checkpoints) });
  }

  if (opts.json) {
    console.log(JSON.stringify({ ticks: opts.ticks, checkpoints: opts.checkpoints, arms: results.map((r) => ({ ...r.summary, seedRecords: r.seedRecords })) }, null, 2));
    return;
  }

  console.log(`\nbiome sweep — ${opts.seeds.length} seeds × ${opts.ticks} ticks · seeds ${opts.seeds.join(',')}`);
  for (const result of results) printArm(result.summary, opts.checkpoints, result.seedRecords);
  printVerdict(results[0].summary, results[1]?.summary, opts.checkpoints);
}

main();
