/**
 * Protocol v29 (PLAN-SPECIES.md §6, phase 5) — the bump that stops the UI lying.
 *
 * Three things land together, deliberately in one version rather than three:
 * the founding roster replacing the per-role counts, the host publishing its
 * species list, and the projections phases 3 and 4 owed (DOCS A54 — persistent
 * groups, carcass possession, and the events for both).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '../src/protocol/protocolVersion.js';
import {
  FOUNDING_ROLE_ALIASES,
  MAX_FOUNDING_PER_SPECIES,
  MAX_FOUNDING_TOTAL,
} from '../src/protocol/commands.js';
import { EventTypes } from '../src/protocol/events.js';
import { validateCommand } from '../src/protocol/validation.js';
import { SUPPORTED_PROTOCOL_VERSION } from '../src/renderer/app/state/RendererStore.js';
import { EVENT_CATALOG } from '../src/renderer/app/state/EventCatalog.js';
import { speciesLabel } from '../src/renderer/app/rendering/EntityAppearance.js';
import { createDemoSimulation, buildDemoConfig } from '../src/fixtures/createDemoSimulation.js';
import { createServer } from '../src/server/createServer.js';
import { defaultSimulationConfig } from '../src/simulation/config/defaultSimulationConfig.js';

const restart = (fields) => validateCommand({ type: 'simulation.restart', ...fields });
const errorPaths = (validation) => validation.errors.map((e) => e.path);

describe('protocol v29: the bump itself', () => {
  test('⚠ the renderer and the committed fixtures moved with it', () => {
    // The guard that was missing when this phase started, and it would have
    // caught the omission: `npm test` compared the renderer's supported version
    // against *itself* symbolically, so a protocol bump could leave both the
    // renderer and the fixtures on the old number with every test green — and
    // fixture mode would then refuse every message at runtime. §17 lists
    // "renderer fixtures drifting" as held by discipline alone; this is that
    // discipline made mechanical.
    assert.equal(SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION, 'the renderer speaks the current protocol');
    const dir = 'src/renderer/fixtures';
    const fixtures = readdirSync(dir).filter((name) => name.endsWith('.json'));
    assert.ok(fixtures.length >= 3, 'the committed fixtures are there to check');
    for (const name of fixtures) {
      const fixture = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      assert.equal(fixture.protocolVersion, PROTOCOL_VERSION, `${name} was regenerated for this version`);
    }
  });

  test('every event type the engine can emit has a renderer catalog entry', () => {
    // Already enforced elsewhere, restated here because this bump adds three
    // types at once and the failure mode is an event that arrives and cannot be
    // filtered, named, or retained correctly.
    const catalogued = new Set(EVENT_CATALOG.map((entry) => entry.type));
    for (const type of Object.values(EventTypes)) {
      assert.ok(catalogued.has(type), `${type} is in the renderer's EventCatalog`);
    }
  });
});

describe('protocol v29: the founding roster', () => {
  test('a roster of { speciesId, count } is accepted', () => {
    assert.equal(restart({ founding: [{ speciesId: 'herbivore.gazelle', count: 40 }] }).ok, true);
    assert.equal(restart({ founding: [] }).ok, true, 'an empty roster is "found nothing", which is legal');
  });

  test('shape, bounds, and duplicates are all refused', () => {
    assert.deepEqual(errorPaths(restart({ founding: 'grazer' })), ['founding']);
    assert.deepEqual(errorPaths(restart({ founding: [42] })), ['founding[0]']);
    assert.deepEqual(errorPaths(restart({ founding: [{ speciesId: '', count: 1 }] })), ['founding[0].speciesId']);
    assert.deepEqual(
      errorPaths(restart({ founding: [{ speciesId: 'a', count: MAX_FOUNDING_PER_SPECIES + 1 }] })),
      ['founding[0].count'],
    );
    // ⚠ A species named twice is a caller bug, and summing or last-wins would
    // hide it behind a world that is not the one asked for.
    assert.deepEqual(
      errorPaths(restart({ founding: [{ speciesId: 'a', count: 1 }, { speciesId: 'a', count: 2 }] })),
      ['founding[1].speciesId'],
    );
    // Two counts each individually legal, together over the ceiling — which is
    // the only way to reach the total check, and the reason it exists.
    const overTotal = [
      { speciesId: 'a', count: MAX_FOUNDING_PER_SPECIES },
      { speciesId: 'b', count: MAX_FOUNDING_PER_SPECIES },
    ];
    assert.ok(2 * MAX_FOUNDING_PER_SPECIES > MAX_FOUNDING_TOTAL, 'the fixture can actually exceed the total');
    assert.deepEqual(errorPaths(restart({ founding: overTotal })), ['founding']);
  });

  test('⚠ which species exist is not the protocol’s business — but the host fails loudly', () => {
    // This layer imports nothing and knows no roster, so it validates the shape
    // and lets the host reject an id it has never heard of. The rule from §11.3
    // applies: "not worried about it" must mean *fails loudly*, not degrades
    // quietly into a world founded with nobody in it.
    assert.equal(restart({ founding: [{ speciesId: 'nope.unknown', count: 3 }] }).ok, true, 'structurally fine');

    const server = createServer({ seed: 42 });
    try {
      const result = server.runner.handleCommand({
        type: 'simulation.restart',
        founding: [{ speciesId: 'nope.unknown', count: 3 }],
      });
      assert.equal(result.ok, false);
      assert.match(result.error.message, /unknown species "nope\.unknown"/);
    } finally {
      server.runner.stop();
    }
  });

  test('the deprecated role fields still work, for one version', () => {
    assert.equal(restart({ herbivores: 40, predators: 5, scavengers: 0 }).ok, true);
    // …and translate to the species that filled them, patching the default
    // roster rather than replacing it.
    const config = buildDemoConfig({ herbivores: 40, scavengers: 0 });
    const byId = new Map(config.demo.founding.map(({ speciesId, count }) => [speciesId, count]));
    assert.equal(byId.get(FOUNDING_ROLE_ALIASES.herbivores), 40);
    assert.equal(byId.get(FOUNDING_ROLE_ALIASES.scavengers), 0, 'an explicit 0 clears a species');
    const defaults = new Map(defaultSimulationConfig.demo.founding.map((f) => [f.speciesId, f.count]));
    assert.equal(
      byId.get(FOUNDING_ROLE_ALIASES.predators),
      defaults.get(FOUNDING_ROLE_ALIASES.predators),
      'a role left out keeps its default',
    );
  });

  test('⚠ both forms at once is refused rather than resolved', () => {
    const validation = restart({ founding: [{ speciesId: 'a', count: 1 }], herbivores: 40 });
    assert.equal(validation.ok, false);
    assert.match(validation.errors[0].message, /deprecated role fields/);
  });

  test('a roster replaces the whole roster; a role field only patches it', () => {
    // The two are different operations and the difference is load-bearing:
    // "found only gazelle" has to be expressible, and the role fields could
    // never mean that.
    const replaced = buildDemoConfig({ founding: [{ speciesId: 'herbivore.gazelle', count: 7 }] });
    assert.deepEqual(replaced.demo.founding, [{ speciesId: 'herbivore.gazelle', count: 7 }]);
    const patched = buildDemoConfig({ herbivores: 7 });
    assert.equal(patched.demo.founding.length, defaultSimulationConfig.demo.founding.length);
  });

  test('a restarted world really is founded from the roster', () => {
    const engine = createDemoSimulation({
      seed: 11,
      config: buildDemoConfig({ founding: [{ speciesId: 'predator.leopard', count: 4 }] }),
    });
    const living = {};
    for (const entity of engine.world.entities.all()) {
      if (entity.kind === 'animal') living[entity.speciesId] = (living[entity.speciesId] ?? 0) + 1;
    }
    assert.deepEqual(living, { 'predator.leopard': 4 }, 'only what the roster named');
  });
});

describe('protocol v29: the host publishes its roster', () => {
  test('status carries every known species with its founding count', () => {
    const server = createServer({ seed: 42 });
    try {
      const status = server.runner.getStatus();
      assert.equal(status.protocolVersion, PROTOCOL_VERSION);
      const ids = status.species.map((entry) => entry.id);
      assert.deepEqual(ids, server.engine.species.ids(), 'every known species, in registry order');
      const byId = new Map(status.species.map((entry) => [entry.id, entry.defaultCount]));
      for (const { speciesId, count } of server.engine.config.demo.founding) {
        assert.equal(byId.get(speciesId), count, `${speciesId} reports its founding count`);
      }
      // ⚠ Ids and counts only. What to *call* a species is presentation and
      // stays renderer-side (§19), which is why the roster carries no label.
      for (const entry of status.species) {
        assert.deepEqual(Object.keys(entry).sort(), ['defaultCount', 'id']);
      }
    } finally {
      server.runner.stop();
    }
  });

  test('a species the scenario founds none of is still published', () => {
    // Otherwise it would be unreachable through the very control that exists to
    // compose a world.
    const engine = createDemoSimulation({
      seed: 3,
      config: buildDemoConfig({ founding: [{ speciesId: 'herbivore.gazelle', count: 5 }] }),
    });
    const roster = engine.getSpeciesRoster();
    assert.equal(roster.length, engine.species.ids().length);
    assert.equal(roster.find((e) => e.id === 'predator.leopard').defaultCount, 0);
  });

  test('the renderer names a species it has never seen, rather than hiding it', () => {
    assert.equal(speciesLabel('herbivore.gazelle'), 'gazelle', 'a known species uses its appearance label');
    // ⚠ Not a roster species: every one of those has had an appearance entry
    // since phase 6, so naming one here would exercise the registry rather than
    // the fallback and the test would pass for the wrong reason.
    assert.equal(speciesLabel('herbivore.okapi'), 'okapi', 'an unknown one falls back to its id');
    assert.equal(speciesLabel('bare'), 'bare');
  });
});

describe('protocol v29: the projections A54 owed', () => {
  test('a carcass reports who is standing over it', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(900);
    const held = [...engine.world.entities.all()].find((e) => e.kind === 'carcass' && e.possessorId !== null);
    assert.ok(held, 'the demo produced a possessed carcass');
    const details = engine.getEntityDetails(held.id);
    assert.equal(details.possessorId, held.possessorId, 'and inspection says so');
    const free = [...engine.world.entities.all()].find((e) => e.kind === 'carcass' && e.possessorId === null);
    if (free) assert.equal(engine.getEntityDetails(free.id).possessorId, null);
  });

  test('kill theft is an event of its own, not a mate contest', () => {
    // ⚠ The reason this bump happened rather than reusing `entity.contested`:
    // the renderer labels that one "contests over a mate", so a carcass fight
    // filed under it would be the UI lying.
    //
    // ⚠⚠ **This test fishes an emergent event out of the demo, so it is a hostage
    // to the demo's trajectory** — §1.4 D1's warning, in a test that predates it.
    // It ran on seed 42 until BEHAVIOR-PLAN P1 changed how the wildebeest and the
    // buffalo herd; that moved where grazers die, and therefore where scavengers
    // meet over a body, and seed 42's first theft went from inside this window to
    // **tick 1682**. Nothing about kill theft changed — seed 42 still produces
    // nine of them inside 3000 ticks. Measured 2026-08-05 over 3000 ticks, first
    // theft by seed: 42→1682, 1→1329, **2→898**, 3→1561, 7→1505, 13→1116. Seed 2
    // is chosen for the margin (and is the hosted world's seed); if this breaks
    // again, re-measure that row before assuming the mechanism is gone.
    const engine = createDemoSimulation({ seed: 2 });
    const robbed = [];
    for (let i = 0; i < 1500; i += 1) {
      const before = engine.events.lastSeq;
      engine.step(1);
      for (const e of engine.eventsSince(before)) if (e.type === EventTypes.ENTITY_ROBBED) robbed.push(e);
    }
    assert.ok(robbed.length > 0, 'the demo steals carcasses');
    const event = robbed[0];
    assert.ok(Number.isFinite(event.carcassId));
    assert.notEqual(event.entityId, event.victimId);
    // Both scores, because dominance decided it and there are no odds to give.
    assert.ok(event.dominance > event.victimDominance, 'the thief was the stronger animal');
    assert.equal(typeof event.escalated, 'boolean');
    assert.ok(Array.isArray(event.injured));
  });

  test('metrics report the group registry, separately from herd labels', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(200);
    const report = engine.world.metrics;
    assert.ok(report, 'metrics ran');
    // ⚠ This asserted an all-zero block until 2026-07-29, when no shipped species
    // formed a persistent group. The hyena does, so the aggregate now carries
    // real numbers — and `bySpecies` answering "the clans are hyena clans"
    // without walking a roster is the whole reason that field exists.
    assert.ok(report.groups.count > 0, 'the demo holds clans');
    assert.ok(report.groups.members >= report.groups.count * 2, 'each with at least its minimum');
    // ⚠ Two group-forming species since phase 11 (hyena clan, lion pride), so this
    // reads the roster rather than naming one — and the point of the aggregate is
    // exactly that it answers "whose groups are these" without the caller walking
    // a roster.
    const forming = engine.species.all().filter((s) => s.groups?.forms).map((s) => s.id);
    for (const speciesId of Object.keys(report.groups.bySpecies)) {
      assert.ok(forming.includes(speciesId), `${speciesId} declares groups.forms`);
    }
    const counted = Object.values(report.groups.bySpecies).reduce((sum, n) => sum + n, 0);
    assert.equal(counted, report.groups.count, 'and they sum to the world total');
    assert.equal(report.groups.bySpecies['herbivore.gazelle'], undefined, 'a herd label is not a record');
    assert.equal(report.groups.size.max >= 2, true);
    // And the per-species `grouping` block is the *other* mechanism, still alive.
    const gazelle = report.species.find((entry) => entry.speciesId === 'herbivore.gazelle');
    assert.ok(gazelle.grouping.groups > 0, 'herds are labelled as they always were');
  });

  test('entity inspection carries the group record, beside the herd label', () => {
    const engine = createDemoSimulation({ seed: 42 });
    engine.step(60);
    const animal = [...engine.world.entities.all()].find((e) => e.kind === 'animal' && e.alive);
    const details = engine.getEntityDetails(animal.id);
    assert.equal(details.group, null, 'no shipped species forms one');
    assert.ok('groupId' in details.social, 'and the herd label is still reported separately');
  });
});
