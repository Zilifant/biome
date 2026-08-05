/**
 * World presets (2026-08-02): named world compositions, stored as JSON files.
 *
 * A preset is a named `simulation.restart` payload, which is what makes these
 * tests short: the payload's *shape* is already covered by the protocol suite,
 * so what is asserted here is the part that is genuinely new — that storage
 * round-trips, that a hand-edited file is treated as untrusted input, that a
 * name can never address a file outside the preset directory, and that loading a
 * preset still goes through the ordinary restart command.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PresetStore,
  PresetError,
  presetSlug,
  validatePresetWorld,
  PRESET_FORMAT_VERSION,
  MAX_PRESETS,
} from '../src/server/PresetStore.js';
import { createServer } from '../src/server/createServer.js';
import { MAX_ROUNDNESS } from '../src/protocol/commands.js';

const WORLD = Object.freeze({
  seed: 42,
  width: 160,
  height: 120,
  rocks: 2,
  thickets: 2,
  roundness: MAX_ROUNDNESS,
  founding: [{ speciesId: 'herbivore.gazelle', count: 40 }],
});

let dir;
let store;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'biome-presets-'));
  store = new PresetStore({ directory: dir });
});

describe('preset slugs are an allowlist, not a blacklist', () => {
  test('ordinary names become readable slugs', () => {
    assert.equal(presetSlug('Rounded Island'), 'rounded-island');
    assert.equal(presetSlug('  lots   of   space  '), 'lots-of-space');
    assert.equal(presetSlug('seed 42 / roundness 4'), 'seed-42-roundness-4');
  });

  test('⚠ nothing that could escape the directory survives slugging', () => {
    // The point of building from an allowlist rather than stripping traversal
    // sequences: `..` and separators are simply not expressible in the output
    // alphabet, so there is no encoding to be clever about.
    for (const attack of ['../../etc/passwd', '..', '../..', 'a/../../b', '..\\..\\win', '%2e%2e%2f']) {
      const slug = presetSlug(attack);
      if (slug === null) continue;
      assert.ok(!slug.includes('/'), `slug "${slug}" kept a separator`);
      assert.ok(!slug.includes('\\'), `slug "${slug}" kept a separator`);
      assert.ok(!slug.split('-').includes('..'), `slug "${slug}" kept a traversal segment`);
      assert.doesNotMatch(slug, /^\.|\.$/, `slug "${slug}" starts or ends with a dot`);
    }
  });

  test('a name with nothing usable in it is refused rather than silently renamed', () => {
    for (const empty of ['', '   ', '///', '...', null, undefined, 42]) {
      assert.equal(presetSlug(/** @type {any} */ (empty)), null, `${JSON.stringify(empty)} should have no slug`);
    }
  });

  test('a traversal name is sanitised into the directory, never out of it', async () => {
    // ⚠ The property that matters is *containment*, not rejection. A name built
    // from an allowlist cannot express an escape, so `../escaped` saves as the
    // ordinary preset `escaped` rather than erroring — safe, and kinder than
    // refusing a name a person may have typed for innocent reasons.
    for (const attack of ['../escaped', '../../etc/passwd', 'a/../../b']) {
      const saved = await store.save({ name: attack, world: WORLD });
      assert.ok(
        path.resolve(dir, `${saved.slug}.json`).startsWith(dir + path.sep),
        `"${attack}" resolved outside the directory as "${saved.slug}"`,
      );
    }
    // Every file landed in the preset directory and nowhere else.
    for (const file of await readdir(dir)) {
      assert.match(file, /^[a-z0-9-]+\.json(\.\d+\.tmp)?$/, `unexpected file "${file}"`);
    }
    await assert.rejects(
      () => readFile(path.join(dir, '..', 'escaped.json'), 'utf8'),
      'nothing was written above the preset directory',
    );
  });
});

describe('preset storage round-trips', () => {
  test('a saved preset reads back exactly, and lands as readable JSON on disk', async () => {
    const saved = await store.save({ name: 'Rounded Island', world: WORLD });
    assert.equal(saved.slug, 'rounded-island');

    const read = await store.read('rounded-island');
    assert.equal(read.name, 'Rounded Island');
    assert.deepEqual(read.world, WORLD);

    // The file is meant to be opened and edited by a person, so its shape is
    // part of the contract rather than an implementation detail.
    const raw = await readFile(path.join(dir, 'rounded-island.json'), 'utf8');
    assert.ok(raw.endsWith('\n'), 'files end with a newline');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.formatVersion, PRESET_FORMAT_VERSION);
    assert.equal(parsed.name, 'Rounded Island');
    assert.deepEqual(parsed.world, WORLD);
    assert.match(parsed.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('only known composition fields are stored — a preset cannot smuggle a key', async () => {
    await store.save({
      name: 'sneaky',
      world: { ...WORLD, tickIntervalMs: 5, __proto__: { polluted: true }, nonsense: 'x' },
    });
    const parsed = JSON.parse(await readFile(path.join(dir, 'sneaky.json'), 'utf8'));
    assert.deepEqual(Object.keys(parsed.world).sort(), Object.keys(WORLD).sort());
    assert.equal(parsed.world.tickIntervalMs, undefined);
    assert.equal(parsed.world.nonsense, undefined);
  });

  test('saving twice overwrites in place rather than accumulating', async () => {
    await store.save({ name: 'world', world: WORLD });
    await store.save({ name: 'world', world: { ...WORLD, roundness: 0 } });
    assert.equal((await readdir(dir)).length, 1);
    assert.equal((await store.read('world')).world.roundness, 0);
  });

  test('a re-save of an unchanged preset is byte-identical apart from its timestamp', async () => {
    // Stable key order, so a preset kept in a repo does not churn its diff.
    const a = await store.save({ name: 'stable', world: WORLD, savedAt: '2026-08-02T00:00:00.000Z' });
    const first = await readFile(path.join(dir, 'stable.json'), 'utf8');
    await store.save({ name: 'stable', world: { roundness: MAX_ROUNDNESS, seed: 42, width: 160, height: 120, rocks: 2, thickets: 2, founding: WORLD.founding }, savedAt: a.savedAt });
    assert.equal(await readFile(path.join(dir, 'stable.json'), 'utf8'), first, 'field order should not depend on input order');
  });

  test('listing is newest-first and totally ordered', async () => {
    await store.save({ name: 'oldest', world: WORLD, savedAt: '2026-08-01T00:00:00.000Z' });
    await store.save({ name: 'newest', world: WORLD, savedAt: '2026-08-03T00:00:00.000Z' });
    await store.save({ name: 'middle', world: WORLD, savedAt: '2026-08-02T00:00:00.000Z' });
    assert.deepEqual((await store.list()).map((p) => p.slug), ['newest', 'middle', 'oldest']);

    // Same instant: the tie-break is the slug, so the order is stable across calls.
    await rm(dir, { recursive: true, force: true });
    await store.save({ name: 'bravo', world: WORLD, savedAt: '2026-08-02T00:00:00.000Z' });
    await store.save({ name: 'alpha', world: WORLD, savedAt: '2026-08-02T00:00:00.000Z' });
    assert.deepEqual((await store.list()).map((p) => p.slug), ['alpha', 'bravo']);
  });

  test('listing an absent directory yields nothing rather than throwing', async () => {
    const missing = new PresetStore({ directory: path.join(dir, 'not', 'created', 'yet') });
    assert.deepEqual(await missing.list(), []);
  });

  test('deleting is idempotent', async () => {
    await store.save({ name: 'temporary', world: WORLD });
    assert.equal(await store.remove('temporary'), true);
    assert.equal(await store.remove('temporary'), false, 'deleting what is already gone is not an error');
    await assert.rejects(() => store.read('temporary'), (e) => e.code === 'preset-not-found');
  });

  test('the store refuses to grow without bound', async () => {
    const store2 = new PresetStore({ directory: dir });
    await Promise.all(
      Array.from({ length: MAX_PRESETS }, (_, i) => store2.save({ name: `preset-${i}`, world: WORLD })),
    );
    await assert.rejects(
      () => store2.save({ name: 'one-too-many', world: WORLD }),
      (error) => error instanceof PresetError && error.code === 'too-many-presets',
    );
    // ...but overwriting an existing one is still allowed at the cap.
    await store2.save({ name: 'preset-0', world: { ...WORLD, roundness: 1 } });
    assert.equal((await store2.read('preset-0')).world.roundness, 1);
  });
});

describe('a preset file is untrusted input', () => {
  test('a world that would be refused as a command is refused as a preset', () => {
    assert.equal(validatePresetWorld({ ...WORLD, roundness: 99 }).ok, false);
    assert.equal(validatePresetWorld({ ...WORLD, width: 2 }).ok, false);
    assert.equal(validatePresetWorld({ founding: [{ speciesId: '', count: 1 }] }).ok, false);
    assert.equal(validatePresetWorld(null).ok, false);
    assert.equal(validatePresetWorld([]).ok, false);
    assert.equal(validatePresetWorld({}).ok, true, 'an empty world is valid — every field is optional');
  });

  test('⚠ a hand-edited file with an invalid world is reported, not loaded', async () => {
    // The directory is meant to be hand-editable, which makes every file a
    // request body from an unknown author.
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'tampered.json'),
      JSON.stringify({ formatVersion: 1, name: 'tampered', world: { width: 999999, roundness: 41 } }),
      'utf8',
    );
    await assert.rejects(
      () => store.read('tampered'),
      (error) => error instanceof PresetError && error.code === 'preset-invalid',
    );
  });

  test('malformed and future-format files are reported by name but never break the listing', async () => {
    await mkdir(dir, { recursive: true });
    await store.save({ name: 'good', world: WORLD });
    await writeFile(path.join(dir, 'broken.json'), '{ not json', 'utf8');
    await writeFile(
      path.join(dir, 'futuristic.json'),
      JSON.stringify({ formatVersion: PRESET_FORMAT_VERSION + 1, name: 'futuristic', world: WORLD }),
      'utf8',
    );
    await writeFile(path.join(dir, 'notes.txt'), 'not a preset at all', 'utf8');

    await assert.rejects(() => store.read('broken'), (e) => e.code === 'preset-unreadable');
    await assert.rejects(() => store.read('futuristic'), (e) => e.code === 'preset-unsupported');

    // ⚠ One bad file must not hide every good one.
    assert.deepEqual((await store.list()).map((p) => p.slug), ['good']);
  });
});

describe('the preset HTTP API', () => {
  let server;
  let base;
  let apiDir;

  before(async () => {
    apiDir = await mkdtemp(path.join(tmpdir(), 'biome-preset-api-'));
    // ⚠ Preset *writes* are admin-only: the store is shared by every visitor
    // rather than per-session, so a public host serves it read-only. This suite
    // exercises the write API, so it asks for the operator's server.
    server = createServer({ seed: 1, presetDirectory: apiDir, admin: true });
    const address = await server.listen(0);
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
    await rm(apiDir, { recursive: true, force: true });
  });

  const api = (method, url, body) =>
    fetch(`${base}${url}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

  test('save, list, read, delete over HTTP', async () => {
    const put = await api('PUT', '/api/presets/my-island', { name: 'My Island', world: WORLD });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).preset.slug, 'my-island');

    const list = await (await api('GET', '/api/presets')).json();
    assert.equal(list.ok, true);
    assert.equal(list.presets.length, 1);
    assert.equal(list.presets[0].name, 'My Island');

    const read = await (await api('GET', '/api/presets/my-island')).json();
    assert.deepEqual(read.preset.world, WORLD);

    assert.equal((await (await api('DELETE', '/api/presets/my-island')).json()).removed, true);
    assert.equal((await (await api('GET', '/api/presets')).json()).presets.length, 0);
  });

  test('the path decides where a preset is stored, not the body', async () => {
    // Otherwise `PUT /presets/a` with `{name: "b"}` writes to b — a request
    // taking effect somewhere other than where it was addressed.
    await api('PUT', '/api/presets/addressed', { name: 'Something Else', world: WORLD });
    const read = await (await api('GET', '/api/presets/addressed')).json();
    assert.equal(read.ok, true);
    assert.equal(read.preset.name, 'Something Else', 'the body still supplies the label');
    assert.equal((await api('GET', '/api/presets/something-else')).status, 404);
    await api('DELETE', '/api/presets/addressed');
  });

  test('errors carry a code and a fitting status', async () => {
    assert.equal((await api('GET', '/api/presets/nothing-here')).status, 404);

    const bad = await api('PUT', '/api/presets/bad-world', { name: 'bad', world: { roundness: 99 } });
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'invalid-preset-world');
    assert.match(body.error.message, /roundness/);
  });

  test('⚠ a traversal slug in the URL cannot reach outside the preset directory', async () => {
    // Express normalises `..` in paths, so this mostly proves the route cannot
    // be addressed at all — but the store refuses it independently (above), and
    // the two defences are meant to agree rather than to be relied on singly.
    for (const attack of ['/api/presets/..%2f..%2fescape', '/api/presets/%2e%2e%2fescape']) {
      const response = await api('GET', attack);
      assert.ok(response.status >= 400, `${attack} should not succeed (got ${response.status})`);
    }
    const escaped = path.join(apiDir, '..', 'escape.json');
    await assert.rejects(() => readFile(escaped, 'utf8'), 'nothing was written outside the directory');
  });
});

describe('loading a preset restarts the world through the ordinary command', () => {
  let server;
  let base;
  let apiDir;

  before(async () => {
    apiDir = await mkdtemp(path.join(tmpdir(), 'biome-preset-apply-'));
    server = createServer({ seed: 1, presetDirectory: apiDir, admin: true });
    const address = await server.listen(0);
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
    await rm(apiDir, { recursive: true, force: true });
  });

  test('a stored world, fetched and sent as simulation.restart, rebuilds exactly that world', async () => {
    // ⚠ The whole point of a preset being a restart payload: there is no
    // "apply preset" path in the engine, so nothing new can change world state.
    const world = { ...WORLD, width: 96, height: 64, roundness: 2, founding: [{ speciesId: 'herbivore.gazelle', count: 7 }] };
    await fetch(`${base}/api/presets/applied`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Applied', world }),
    });

    const { preset } = await (await fetch(`${base}/api/presets/applied`)).json();
    // ⚠ The host serves one world per visitor, so a cookie-less request is a
    // *new* visitor with a new world. This assertion is about the world
    // `server.runner` holds, so the request has to say so.
    const restart = await fetch(`${base}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: server.sessionCookie },
      body: JSON.stringify({ type: 'simulation.restart', ...preset.world }),
    });
    assert.equal(restart.status, 200);
    assert.equal((await restart.json()).ok, true);

    assert.equal(server.runner.engine.world.width, 96);
    assert.equal(server.runner.engine.world.height, 64);
    assert.equal(server.runner.engine.config.terrain.roundness, 2);
    const gazelle = [...server.runner.engine.world.entities.all()].filter((e) => e.speciesId === 'herbivore.gazelle');
    assert.equal(gazelle.length, 7);
  });
});
