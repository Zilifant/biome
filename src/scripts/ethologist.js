/**
 * biome ethologist — a behavioral anomaly finder.
 *
 * Runs the simulation headlessly over one or more seeds/worlds and surfaces a
 * *ranked shortlist* of animals that behaved unrealistically — the kind of edge
 * case that is invisible in aggregate population numbers but obvious once you
 * look at one animal's last few hundred ticks. It does not decide correctness
 * (that judgement is yours); it makes the suspicious cases cheap to find so you
 * can eyeball the top of the list instead of watching the whole world.
 *
 * Two detectors, both calibrated against real bugs already fixed:
 *
 *   1. **Death autopsy against a counterfactual.** Every death is scored by
 *      whether the thing that would have prevented it was *within reach*: an
 *      animal that died of thirst with drinkable water a few cells away, or one
 *      that died of thirst having never once perceived water in a world that has
 *      reachable water; a starvation on forage; an exposure death beside cover.
 *      "Died of X while the fix for X was right there" is the shape both the
 *      thicket-walled-lake deaths and the corner-lake stalker took.
 *   2. **Unresolved intent / circling.** Not every bug ends in death. An animal
 *      stuck in `seekWater` for scores of ticks without ever getting closer (the
 *      thicket-edge pacing), or one milling in a tight area while genuinely
 *      hungry or thirsty (the stalker that "wandered the same spot"), is flagged
 *      from its trajectory and its own stated intent — no death required.
 *
 * Determinism makes this trustworthy: every flagged case is exactly reproducible
 * from its seed + config, so a finding is a lead you can re-run and drill into,
 * never a fluke. Nothing here mutates the engine — it only reads authoritative
 * state (`action`, `utilityBreakdown`, the perception map, memories) the tick it
 * happens.
 *
 * Usage:
 *   npm run ethologist                                  # a small default sweep
 *   npm run ethologist -- --seed=2344255022 --width=180 --height=120 \
 *       --herbivores=120 --predators=8 --scavengers=10 --rocks=5 --thickets=5 --ticks=9200
 *   npm run ethologist -- --seeds=1,2,3,4,5 --ticks=6000 --top=15
 *
 * Flags: --seed=N | --seeds=a,b,c | --seedCount=N (from --seedBase, default 1);
 *   --ticks, --top, --width, --height, --herbivores, --predators, --scavengers,
 *   --rocks, --thickets, --json.
 */
import { createDemoSimulation, buildDemoConfig } from '../fixtures/createDemoSimulation.js';
import { TerrainType } from '../simulation/world/TerrainGrid.js';

// --- Detector thresholds. Deliberately loose: this tool ranks and shortlists,
// it does not gate a build, so it errs toward surfacing a lead over hiding one. --
const D = Object.freeze({
  seekStuckTicks: 40, //     seeking a resource this long...
  seekProgressMin: 1.0, //   ...without getting at least this much closer is "unresolved"
  refusedEps: 0.05, //       a committed step shorter than this counts as refused/blocked
  circleWindowTicks: 300, // trajectory window for "milling in one spot"
  circleSampleEvery: 15, //  positions sampled this often within the window
  circleRatio: 0.2, //       net displacement / path length below this is circling
  circleMinPath: 20, //      ...but only if it actually covered this much ground
  circleNeed: 0.4, //        ...while hunger or thirst is at least this
  closeWaterCells: 6, //     died of thirst with water this near = strongly suspect
  forageRadius: 2, //        forage within this many cells of a starvation = suspect
  shelterScan: 6, //         cover/shelter within this of an exposure death = suspect
  minFlag: 1, //             deaths scoring below this are treated as ecological, not bugs
});

const STATIONARY = new Set(['eat', 'drink', 'rest']);
const SEEK_ACTIONS = new Set(['seekWater', 'recallWater', 'seekFood', 'recallFood']);
const WATER_SEEK = new Set(['seekWater', 'recallWater']);

function parseArgs(argv) {
  const opts = {
    seeds: null,
    seedBase: 1,
    seedCount: null,
    ticks: 6000,
    top: 12,
    json: false,
    composition: {}, // width/height/herbivores/predators/scavengers/rocks/thickets
  };
  const compKeys = new Set(['width', 'height', 'herbivores', 'predators', 'scavengers', 'rocks', 'thickets']);
  for (const arg of argv) {
    if (arg === '--json') { opts.json = true; continue; }
    const m = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (!m) { fail(`unknown argument: ${arg}`); }
    const [, key, value] = m;
    if (key === 'seed') opts.seeds = [Number(value)];
    else if (key === 'seeds') opts.seeds = value.split(',').map(Number);
    else if (key === 'seedBase') opts.seedBase = Number(value);
    else if (key === 'seedCount') opts.seedCount = Number(value);
    else if (key === 'ticks') opts.ticks = Number(value);
    else if (key === 'top') opts.top = Number(value);
    else if (compKeys.has(key)) opts.composition[key] = Number(value);
    else fail(`unknown argument: ${arg}`);
  }
  return opts;
}

function fail(message) {
  console.error(message);
  console.error('usage: ethologist.js [--seed=N | --seeds=a,b,c | --seedCount=N] [--ticks=N] [--top=N]');
  console.error('       [--width --height --herbivores --predators --scavengers --rocks --thickets] [--json]');
  process.exit(1);
}

/** Straight-line distance to the nearest shallow-water cell, ignoring passability. */
function nearestShallowStraight(waterCells, x, y) {
  let best = Infinity;
  for (const [cx, cy] of waterCells) {
    const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
    if (d < best) best = d;
  }
  return best;
}

/** Highest vegetation level within `radius` cells of a position. */
function bestForageNear(world, x, y, radius) {
  const { cellX, cellY } = world.cellOf(x, y);
  let best = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      best = Math.max(best, world.vegetation.levelAt(gx, gy));
    }
  }
  return best;
}

/** Distance (cells) to the nearest sheltered cell, or Infinity within the scan. */
function nearestShelter(world, x, y, radius) {
  const { cellX, cellY } = world.cellOf(x, y);
  let best = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      if (world.isShelteredAt(gx + 0.5, gy + 0.5)) best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best;
}

/** Whether a carcass sits within `radius` of a position (a predator's food). */
function carcassWithin(world, entity, radius) {
  for (const id of world.grid.queryRadius(entity.x, entity.y, radius)) {
    const other = world.entities.get(id);
    if (other && other.kind === 'carcass' && other.id !== entity.id) return true;
  }
  return false;
}

/** Whether a thicket cell sits between the animal and the nearest water (a walled lake). */
function walledByThicket(world, x, y, waterCells) {
  // Cheap check: is any thicket cell within 3 of the death, on the water side?
  const { cellX, cellY } = world.cellOf(x, y);
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const gx = cellX + dx, gy = cellY + dy;
      if (gx < 0 || gy < 0 || gx >= world.terrain.width || gy >= world.terrain.height) continue;
      if (world.terrain.codeAt(gx, gy) === TerrainType.THICKET) return true;
    }
  }
  return false;
}

/**
 * Score a death by how much its cause looks preventable-in-place. Returns a
 * suspicion in roughly [0, 12] and a one-line reason, or suspicion 0 for a
 * death that reads as ordinary ecology (old age, a clean kill, a distant lake).
 */
function autopsy(world, entity, tracker, ctx) {
  const cause = entity.deathCause;
  if (cause === 'dehydration') {
    const straight = nearestShallowStraight(ctx.waterCells, entity.x, entity.y);
    if (straight <= D.closeWaterCells) {
      const walled = walledByThicket(world, entity.x, entity.y, ctx.waterCells);
      return {
        suspicion: 6 + (D.closeWaterCells - straight),
        reason: `died of thirst with water ~${straight.toFixed(1)}c away${walled ? ' (walled by thicket)' : ''}; action=${entity.action}, ${tracker.everDrank ? 'had drunk before' : 'never drank'}`,
      };
    }
    if (!tracker.everPerceivedWater && ctx.waterCells.length > 0) {
      return {
        suspicion: 5,
        reason: `died of thirst having NEVER perceived water (world has reachable water); roamed ${tracker.bbox()}`,
      };
    }
    return { suspicion: 0, reason: '' };
  }
  if (cause === 'starvation') {
    // Diet-aware, or the counterfactual lies: grass is food to a grazer and
    // irrelevant to a stalker, which starves *with grass all around it* and is
    // not being failed by anything. A predator's food is a carcass within reach.
    const carnivore = world.species.get(entity.speciesId)?.diet === 'carnivore';
    if (carnivore) {
      if (carcassWithin(world, entity, D.forageRadius)) {
        return { suspicion: 6, reason: `predator starved with a carcass within ${D.forageRadius}c; action=${entity.action}` };
      }
      if (!tracker.everPerceivedFood) return { suspicion: 2, reason: 'predator starved having never perceived prey or carrion' };
      return { suspicion: 0, reason: '' };
    }
    const forage = bestForageNear(world, entity.x, entity.y, D.forageRadius);
    if (forage >= 1) return { suspicion: 5 + forage, reason: `starved with forage (level ${forage}) within ${D.forageRadius}c; action=${entity.action}` };
    if (!tracker.everPerceivedFood) return { suspicion: 3, reason: 'starved having never perceived food' };
    return { suspicion: 0, reason: '' };
  }
  if (cause === 'exposure') {
    const shelter = nearestShelter(world, entity.x, entity.y, D.shelterScan);
    if (Number.isFinite(shelter)) return { suspicion: 4 + (D.shelterScan - shelter) * 0.4, reason: `froze with shelter ~${shelter.toFixed(1)}c away; action=${entity.action}` };
    return { suspicion: 0, reason: '' };
  }
  // predation / disease / age read as ecology here — recorded in the histogram,
  // never flagged as a behavioral bug.
  return { suspicion: 0, reason: '' };
}

/** Fresh per-animal tracker. */
function newTracker(tick, entity) {
  return {
    bornTick: tick,
    everPerceivedWater: false,
    everPerceivedFood: false,
    everDrank: false,
    everAte: false,
    pathLength: 0,
    minX: entity.x, maxX: entity.x, minY: entity.y, maxY: entity.y,
    refusedSteps: 0,
    ring: [], // [x, y, tick] sampled positions, for circling
    seek: null, // { action, startTick, startDist, minDist }
    seekFlagged: false,
    circleFlagged: false,
    bbox() { return `x[${this.minX.toFixed(0)}..${this.maxX.toFixed(0)}] y[${this.minY.toFixed(0)}..${this.maxY.toFixed(0)}]`; },
  };
}

function needOf(entity) {
  const hunger = entity.maxEnergy > 0 ? 1 - entity.energy / entity.maxEnergy : 0;
  const thirst = entity.maxHydration > 0 ? 1 - entity.hydration / entity.maxHydration : 0;
  return { hunger, thirst, need: Math.max(hunger, thirst) };
}

/** Analyze a single (seed, config) world; returns a report object. */
function analyzeRun({ seed, composition, ticks }) {
  const config = buildDemoConfig(composition);
  const engine = createDemoSimulation({ seed, config });
  const world = engine.world;
  const W = world.terrain.width, H = world.terrain.height;

  // Terrain geography, once.
  const waterCells = [];
  const terrainCounts = {};
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const c = world.terrain.codeAt(x, y);
      terrainCounts[c] = (terrainCounts[c] ?? 0) + 1;
      if (c === TerrainType.WATER) waterCells.push([x, y]);
    }
  }
  const ctx = { waterCells };

  const trackers = new Map();
  const deaths = {}; // cause -> count
  const flaggedDeaths = [];
  const stuckEpisodes = [];

  for (let t = 1; t <= ticks; t += 1) {
    engine.step(1);
    const tick = engine.tick;
    for (const e of world.entities.all()) {
      if (e.kind === 'animal' && e.alive) {
        let tr = trackers.get(e.id);
        if (!tr) { tr = newTracker(tick, e); trackers.set(e.id, tr); }
        // Life-history flags.
        const perc = world.perception.get(e.id);
        if (perc?.nearestWater) tr.everPerceivedWater = true;
        if (perc?.nearestFood || perc?.nearestCarcass) tr.everPerceivedFood = true;
        if (e.action === 'drink') tr.everDrank = true;
        if (e.action === 'eat') tr.everAte = true;
        // Path + bounding box + refused steps.
        const moved = typeof e.lastMoveDistance === 'number' ? e.lastMoveDistance : 0;
        tr.pathLength += moved;
        tr.minX = Math.min(tr.minX, e.x); tr.maxX = Math.max(tr.maxX, e.x);
        tr.minY = Math.min(tr.minY, e.y); tr.maxY = Math.max(tr.maxY, e.y);
        if (e.moveIntent?.moving && moved < D.refusedEps && !STATIONARY.has(e.action)) tr.refusedSteps += 1;

        // Detector 2a — unresolved seek: chasing a resource cell without closing on it.
        if (SEEK_ACTIONS.has(e.action) && e.actionTarget) {
          const tx = e.actionTarget.cellX + 0.5, ty = e.actionTarget.cellY + 0.5;
          const dist = Math.hypot(tx - e.x, ty - e.y);
          if (!tr.seek || tr.seek.action !== e.action) tr.seek = { action: e.action, startTick: tick, startDist: dist, minDist: dist };
          else tr.seek.minDist = Math.min(tr.seek.minDist, dist);
          const dur = tick - tr.seek.startTick;
          if (!tr.seekFlagged && dur >= D.seekStuckTicks && tr.seek.startDist - tr.seek.minDist < D.seekProgressMin) {
            const { need } = needOf(e);
            stuckEpisodes.push({
              kind: 'unresolved-seek', id: e.id, species: e.speciesId, tick,
              severity: (dur / 50) * (1 + need),
              detail: `${e.action} for ${dur} ticks with no progress (dist ${tr.seek.startDist.toFixed(1)}→${tr.seek.minDist.toFixed(1)}), ${tr.refusedSteps} refused steps, at (${e.x.toFixed(0)},${e.y.toFixed(0)})`,
            });
            tr.seekFlagged = true;
          }
        } else {
          tr.seek = null;
          tr.seekFlagged = false;
        }

        // Detector 2b — circling in need: much path, little net displacement.
        if (tick % D.circleSampleEvery === 0) {
          tr.ring.push([e.x, e.y, tick]);
          const maxSamples = Math.ceil(D.circleWindowTicks / D.circleSampleEvery);
          if (tr.ring.length > maxSamples) tr.ring.shift();
          if (tr.ring.length === maxSamples) {
            let path = 0;
            for (let i = 1; i < tr.ring.length; i += 1) path += Math.hypot(tr.ring[i][0] - tr.ring[i - 1][0], tr.ring[i][1] - tr.ring[i - 1][1]);
            const net = Math.hypot(tr.ring.at(-1)[0] - tr.ring[0][0], tr.ring.at(-1)[1] - tr.ring[0][1]);
            const { need } = needOf(e);
            // At most one circling episode per animal, ever — otherwise a grazer
            // trapped by a walled lake re-flags every window and drowns the report.
            // The report is "which animals circled uselessly", not "how many ticks".
            if (!tr.circleFlagged && path >= D.circleMinPath && net / path < D.circleRatio && need >= D.circleNeed) {
              stuckEpisodes.push({
                kind: 'circling-in-need', id: e.id, species: e.speciesId, tick,
                severity: (D.circleWindowTicks / 100) * need * (1 - net / path),
                detail: `covered ${path.toFixed(0)}u over ${D.circleWindowTicks} ticks but drifted only ${net.toFixed(0)}u (net/path ${(net / path).toFixed(2)}), need ${need.toFixed(2)}, around (${e.x.toFixed(0)},${e.y.toFixed(0)})`,
              });
              tr.circleFlagged = true;
            }
          }
        }
      } else if (e.kind === 'carcass' && e.diedTick === tick) {
        deaths[e.deathCause] = (deaths[e.deathCause] ?? 0) + 1;
        const tr = trackers.get(e.id);
        if (tr) {
          const verdict = autopsy(world, e, tr, ctx);
          if (verdict.suspicion >= D.minFlag) {
            flaggedDeaths.push({ id: e.id, species: e.speciesId, cause: e.deathCause, tick, x: e.x, y: e.y, ...verdict });
          }
          trackers.delete(e.id); // bound memory: the animal is gone
        }
      }
    }
  }

  // Final populations.
  const pop = {};
  for (const e of world.entities.all()) {
    if (e.kind === 'animal' && e.alive) pop[e.speciesId] = (pop[e.speciesId] ?? 0) + 1;
  }

  flaggedDeaths.sort((a, b) => b.suspicion - a.suspicion);
  stuckEpisodes.sort((a, b) => b.severity - a.severity);

  const name = (c) => Object.keys(TerrainType).find((k) => TerrainType[k] === c);
  return {
    seed, composition, ticks, world: `${W}x${H}`,
    terrain: Object.fromEntries(Object.entries(terrainCounts).map(([c, n]) => [name(+c), n])),
    waterBbox: waterCells.length ? bbox(waterCells, W, H) : 'no water',
    pop, deaths, flaggedDeaths, stuckEpisodes,
    totalDeaths: Object.values(deaths).reduce((a, b) => a + b, 0),
  };
}

function bbox(cells, W, H) {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  return `x[${Math.min(...xs)}..${Math.max(...xs)}] y[${Math.min(...ys)}..${Math.max(...ys)}] of ${W}x${H}`;
}

function printReport(report, top) {
  const compStr = Object.entries(report.composition).map(([k, v]) => `${k}=${v}`).join(' ') || '(demo defaults)';
  console.log(`\n${'='.repeat(78)}\nseed ${report.seed} — ${report.world} — ${compStr} — ${report.ticks} ticks`);
  console.log(`terrain: ${JSON.stringify(report.terrain)}`);
  console.log(`water: ${report.waterBbox}`);
  console.log(`final population: ${JSON.stringify(report.pop)}`);
  console.log(`deaths (${report.totalDeaths}): ${JSON.stringify(report.deaths)}`);
  console.log(`flagged: ${report.flaggedDeaths.length} suspicious deaths, ${report.stuckEpisodes.length} stuck episodes`);

  if (report.flaggedDeaths.length) {
    console.log(`\n  top ${Math.min(top, report.flaggedDeaths.length)} suspicious deaths (by preventable-in-place score):`);
    for (const d of report.flaggedDeaths.slice(0, top)) {
      console.log(`   [${d.suspicion.toFixed(1)}] #${d.id} ${label(d.species)} ${d.cause} @t=${d.tick} (${d.x.toFixed(0)},${d.y.toFixed(0)}) — ${d.reason}`);
    }
  }
  if (report.stuckEpisodes.length) {
    console.log(`\n  top ${Math.min(top, report.stuckEpisodes.length)} stuck / circling episodes (by severity):`);
    for (const s of report.stuckEpisodes.slice(0, top)) {
      console.log(`   [${s.severity.toFixed(1)}] #${s.id} ${label(s.species)} ${s.kind} — ${s.detail}`);
    }
  }
  if (!report.flaggedDeaths.length && !report.stuckEpisodes.length) {
    console.log('  nothing flagged — no preventable-in-place deaths or stuck episodes over this run.');
  }
}

function label(speciesId) {
  return speciesId.split('.').pop();
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Which worlds to sweep. An explicit seed/composition runs exactly that; with
  // nothing given, a small default sweep — a few seeds across the demo default
  // and a rock/thicket-heavy stress world, the terrain most likely to trap an
  // animal — so `npm run ethologist` produces a useful report out of the box.
  let runs;
  if (opts.seeds) {
    runs = opts.seeds.map((seed) => ({ seed, composition: opts.composition }));
  } else if (opts.seedCount) {
    runs = Array.from({ length: opts.seedCount }, (_, i) => ({ seed: opts.seedBase + i, composition: opts.composition }));
  } else {
    const seeds = [1, 2, 3];
    const configs = [{}, { rocks: 6, thickets: 8 }];
    runs = configs.flatMap((composition) => seeds.map((seed) => ({ seed, composition })));
  }

  console.log(`biome ethologist — ${runs.length} world(s), ${opts.ticks} ticks each`);
  const reports = [];
  for (const run of runs) {
    const report = analyzeRun({ ...run, ticks: opts.ticks });
    reports.push(report);
    if (!opts.json) printReport(report, opts.top);
  }

  if (opts.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  // Cross-run summary: where the anomalies concentrate.
  console.log(`\n${'='.repeat(78)}\nSUMMARY — ${reports.length} world(s)`);
  const ranked = reports
    .map((r) => ({ seed: r.seed, comp: Object.entries(r.composition).map(([k, v]) => `${k}=${v}`).join(',') || 'demo', flaggedDeaths: r.flaggedDeaths.length, stuck: r.stuckEpisodes.length, worst: r.flaggedDeaths[0]?.suspicion ?? 0 }))
    .sort((a, b) => b.flaggedDeaths + b.stuck - (a.flaggedDeaths + a.stuck));
  for (const r of ranked) {
    console.log(`  seed ${String(r.seed).padStart(10)} [${r.comp}] — ${r.flaggedDeaths} flagged deaths, ${r.stuck} stuck episodes (worst death score ${r.worst.toFixed(1)})`);
  }
  console.log('\nRe-run any world with --seed=<n> [same composition flags] to drill into it.');
}

main();
