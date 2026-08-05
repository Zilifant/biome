/**
 * The public deployment layer: one world per visitor, a ceiling on what a
 * command may ask for, and the two doors an operator keeps shut.
 *
 * ⚠ None of this is simulation behaviour, and none of it belongs to the
 * protocol. It is what a *host* has to be true for an anonymous audience — so
 * the assertions here are about isolation, refusal, and lifecycle rather than
 * about animals.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server/createServer.js';
import { SessionRegistry } from '../src/server/SessionRegistry.js';
import { readSessionId, sessionCookieHeader, SESSION_COOKIE } from '../src/server/sessionCookie.js';
import { checkCommand, resolvePublicLimits, DEFAULT_PUBLIC_LIMITS } from '../src/server/publicLimits.js';
import { viewSearch, rendererChoice } from '../src/renderer/app/ui/viewLinks.js';
import {
  MAX_WORLD_DIMENSION,
  MAX_FOUNDING_TOTAL,
  MAX_SPEED_MULTIPLIER,
  MAX_MANUAL_STEP_TICKS,
} from '../src/protocol/commands.js';

describe('public limits: a second, lower ceiling', () => {
  const limits = DEFAULT_PUBLIC_LIMITS;

  test('⚠ every protocol maximum is refused by a public host', () => {
    // This is the whole point of the module, so it is asserted against the
    // protocol's own constants rather than against copied numbers: if a future
    // version raises a maximum, this test still describes the real gap.
    assert.ok(checkCommand({ type: 'simulation.restart', width: MAX_WORLD_DIMENSION }, limits));
    assert.ok(checkCommand({ type: 'simulation.restart', height: MAX_WORLD_DIMENSION }, limits));
    assert.ok(
      checkCommand(
        { type: 'simulation.restart', founding: [{ speciesId: 'herbivore.gazelle', count: MAX_FOUNDING_TOTAL }] },
        limits,
      ),
    );
    assert.ok(checkCommand({ type: 'simulation.setSpeed', multiplier: MAX_SPEED_MULTIPLIER }, limits));
    assert.ok(checkCommand({ type: 'simulation.step', ticks: MAX_MANUAL_STEP_TICKS }, limits));
  });

  test('an ordinary world passes untouched', () => {
    assert.equal(checkCommand({ type: 'simulation.restart', width: 128, height: 128 }, limits), null);
    assert.equal(checkCommand({ type: 'simulation.setSpeed', multiplier: 4 }, limits), null);
    assert.equal(checkCommand({ type: 'simulation.step', ticks: 100 }, limits), null);
    assert.equal(checkCommand({ type: 'simulation.pause' }, limits), null);
    assert.equal(checkCommand({ type: 'entity.remove', entityId: 3 }, limits), null);
  });

  test('⚠ the deprecated role fields are counted too, or the cap is one rename from useless', () => {
    // A ceiling that only knew the v29 spelling would be bypassed by using the
    // v28 one, which validation still accepts.
    const refusal = checkCommand({ type: 'simulation.restart', herbivores: 20000 }, limits);
    assert.ok(refusal);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error.code, 'founding-limit');
  });

  test('a restart naming no founders is not a restart founding nobody', () => {
    // null vs 0 matters: omitting the field means "use the host's defaults".
    assert.equal(checkCommand({ type: 'simulation.restart', seed: 7 }, limits), null);
  });

  test('refusals arrive in the protocol’s own error shape', () => {
    const refusal = checkCommand({ type: 'simulation.step', ticks: 9999 }, limits);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error.code, 'step-limit');
    assert.match(refusal.error.message, /at most/);
  });

  test('admin lifts the ceiling entirely', () => {
    assert.equal(resolvePublicLimits({ BIOME_ADMIN: '1' }), null);
    assert.equal(checkCommand({ type: 'simulation.step', ticks: MAX_MANUAL_STEP_TICKS }, null), null);
  });

  test('the ceiling is configurable, and nonsense falls back rather than disabling it', () => {
    assert.equal(resolvePublicLimits({ BIOME_MAX_SPEED: '2' }).maxSpeedMultiplier, 2);
    assert.equal(resolvePublicLimits({ BIOME_MAX_SPEED: 'banana' }).maxSpeedMultiplier, DEFAULT_PUBLIC_LIMITS.maxSpeedMultiplier);
    assert.equal(resolvePublicLimits({ BIOME_MAX_SPEED: '-5' }).maxSpeedMultiplier, DEFAULT_PUBLIC_LIMITS.maxSpeedMultiplier);
  });
});

describe('view links: renderer choice and a shareable world', () => {
  test('the toggle preserves every other parameter', () => {
    // ⚠ The point of building the link from the *current* search rather than
    // from scratch: `?mode=fixture` must survive a renderer switch.
    assert.equal(viewSearch('?mode=fixture', { renderer: 'sprite' }), '?mode=fixture&renderer=sprite');
    assert.equal(viewSearch('?mode=fixture&renderer=sprite', { renderer: null }), '?mode=fixture');
    assert.equal(viewSearch('', { renderer: 'sprite' }), '?renderer=sprite');
    assert.equal(viewSearch('?renderer=sprite', { renderer: null }), '');
  });

  test('sharing stamps the seed over whatever was there', () => {
    assert.equal(viewSearch('?seed=1', { seed: 99 }), '?seed=99');
    assert.equal(viewSearch('?renderer=sprite', { seed: 42 }), '?renderer=sprite&seed=42');
  });

  test('the offered renderer is the one you are not looking at', () => {
    assert.deepEqual(rendererChoice('?renderer=sprite'), { current: 'sprite', other: 'ascii' });
    assert.deepEqual(rendererChoice(''), { current: 'ascii', other: 'sprite' });
    assert.deepEqual(rendererChoice('?renderer=ascii'), { current: 'ascii', other: 'sprite' });
  });
});

describe('the session cookie', () => {
  test('reads its own id back out of a crowded header', () => {
    const id = SessionRegistry.newId();
    assert.equal(readSessionId(`other=1; ${SESSION_COOKIE}=${id}; another=2`), id);
  });

  test('⚠ an implausible id is treated as absent, not used as a map key', () => {
    assert.equal(readSessionId(`${SESSION_COOKIE}=short`), null);
    assert.equal(readSessionId(`${SESSION_COOKIE}=${'x'.repeat(500)}`), null);
    assert.equal(readSessionId(`${SESSION_COOKIE}=has spaces and ;`), null);
    assert.equal(readSessionId(undefined), null);
    assert.equal(readSessionId('unrelated=1'), null);
  });

  test('Secure rides on TLS only, so local http still works', () => {
    assert.match(sessionCookieHeader('abcdefgh', true), /Secure/);
    assert.doesNotMatch(sessionCookieHeader('abcdefgh', false), /Secure/);
    assert.match(sessionCookieHeader('abcdefgh', false), /HttpOnly/);
  });
});

describe('the session registry', () => {
  /** A runner stand-in: the registry only ever starts and stops one. */
  const fakeRunner = () => ({
    started: false,
    start() {
      this.started = true;
    },
    stop() {
      this.started = false;
    },
  });

  test('each id gets its own world, and the same id gets the same one back', () => {
    const sessions = new SessionRegistry({ createRunner: fakeRunner });
    const a = sessions.resolve('alpha');
    const b = sessions.resolve('beta');
    assert.notEqual(a.runner, b.runner);
    assert.equal(sessions.resolve('alpha').runner, a.runner);
    assert.equal(sessions.size, 2);
    sessions.closeAll();
  });

  test('⚠ a world ticks only while somebody is watching it', () => {
    const sessions = new SessionRegistry({ createRunner: fakeRunner });
    const session = sessions.resolve('alpha');
    assert.equal(session.runner.started, false, 'a fresh session is frozen');

    const socket = {};
    sessions.attachSocket(session, socket);
    assert.equal(session.runner.started, true);

    sessions.detachSocket(session, socket);
    assert.equal(session.runner.started, false, 'the last viewer left');
    assert.equal(sessions.size, 1, '⚠ but the world is kept, so a reload resumes it');
    sessions.closeAll();
  });

  test('two viewers of one session keep it running until both leave', () => {
    const sessions = new SessionRegistry({ createRunner: fakeRunner });
    const session = sessions.resolve('alpha');
    const first = {};
    const second = {};
    sessions.attachSocket(session, first);
    sessions.attachSocket(session, second);
    sessions.detachSocket(session, first);
    assert.equal(session.runner.started, true, 'one tab closed, another still open');
    sessions.detachSocket(session, second);
    assert.equal(session.runner.started, false);
    sessions.closeAll();
  });

  test('the cap turns away newcomers rather than evicting an existing world', () => {
    const sessions = new SessionRegistry({ createRunner: fakeRunner, maxSessions: 2 });
    const a = sessions.resolve('alpha');
    sessions.resolve('beta');
    assert.equal(sessions.resolve('gamma'), null, 'full');
    assert.equal(sessions.resolve('alpha'), a, '⚠ an existing visitor is never displaced');
    sessions.closeAll();
  });

  test('⚠ a session no socket ever joined is reaped on a much shorter fuse', () => {
    // Otherwise a stream of cookie-less requests — a crawler, a health check —
    // holds worlds against the cap for the full idle window.
    const sessions = new SessionRegistry({
      createRunner: fakeRunner,
      idleMs: 10 * 60 * 1000,
      unobservedIdleMs: 60 * 1000,
    });
    const watched = sessions.resolve('watched');
    const socket = {};
    sessions.attachSocket(watched, socket);
    sessions.detachSocket(watched, socket);
    sessions.resolve('never-watched');

    const later = Date.now() + 2 * 60 * 1000;
    assert.equal(sessions.sweep(later), 1, 'only the unobserved one');
    assert.deepEqual(sessions.ids(), ['watched']);

    assert.equal(sessions.sweep(Date.now() + 11 * 60 * 1000), 1, 'and eventually the other');
    assert.equal(sessions.size, 0);
    sessions.closeAll();
  });

  test('⚠ a pinned session survives the sweep, socket or no socket', () => {
    // The host's own default session has no socket by construction, so without
    // the pin the unobserved fuse would stop the world `npm start` reports.
    const sessions = new SessionRegistry({ createRunner: fakeRunner, unobservedIdleMs: 1 });
    sessions.resolve('default').pinned = true;
    sessions.resolve('drifter');
    assert.equal(sessions.sweep(Date.now() + 60_000), 1);
    assert.deepEqual(sessions.ids(), ['default']);
    sessions.closeAll();
  });

  test('closeAll stops every world', () => {
    const sessions = new SessionRegistry({ createRunner: fakeRunner });
    const session = sessions.resolve('alpha');
    sessions.attachSocket(session, {});
    sessions.closeAll();
    assert.equal(session.runner.started, false);
    assert.equal(sessions.size, 0);
  });
});

describe('the host, end to end', () => {
  let server;
  let base;
  let presetDir;

  before(async () => {
    presetDir = await mkdtemp(path.join(tmpdir(), 'biome-deploy-'));
    server = createServer({ seed: 1, presetDirectory: presetDir });
    const address = await server.listen(0);
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
    await rm(presetDir, { recursive: true, force: true });
  });

  test('a visitor is issued a session cookie', async () => {
    const response = await fetch(`${base}/api/status`);
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie, 'issued');
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE.replace('.', '\\.')}=`));
    assert.match(cookie, /HttpOnly/);
  });

  test('⚠ two visitors restart independently — the core promise', async () => {
    const alice = `${SESSION_COOKIE}=${SessionRegistry.newId()}`;
    const bob = `${SESSION_COOKIE}=${SessionRegistry.newId()}`;

    const restart = await fetch(`${base}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ type: 'simulation.restart', seed: 4242 }),
    });
    assert.equal((await restart.json()).ok, true);

    const aliceStatus = await (await fetch(`${base}/api/status`, { headers: { cookie: alice } })).json();
    const bobStatus = await (await fetch(`${base}/api/status`, { headers: { cookie: bob } })).json();

    assert.equal(aliceStatus.seed, 4242, 'alice got the world she asked for');
    assert.equal(bobStatus.seed, 1, '⚠ and bob is still in the one he started in');
    assert.notEqual(aliceStatus.simulationId, bobStatus.simulationId);
  });

  test('a visitor keeps their world across requests', async () => {
    const cookie = `${SESSION_COOKIE}=${SessionRegistry.newId()}`;
    const first = await (await fetch(`${base}/api/status`, { headers: { cookie } })).json();
    const second = await (await fetch(`${base}/api/status`, { headers: { cookie } })).json();
    assert.equal(first.simulationId, second.simulationId);
  });

  test('the public ceiling is enforced over HTTP, in the shape the UI already shows', async () => {
    const response = await fetch(`${base}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'simulation.restart', width: MAX_WORLD_DIMENSION, height: MAX_WORLD_DIMENSION }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'world-size-limit');
  });

  test('⚠ the health check reports the process without building a world', async () => {
    // A platform pings this every few seconds and keeps no cookies. If it
    // resolved a session, each ping would build and reap a whole engine.
    const before = server.sessions.size;
    for (let i = 0; i < 5; i += 1) {
      const response = await fetch(`${base}/healthz`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.equal(response.headers.get('set-cookie'), null, 'not even a cookie');
    }
    assert.equal(server.sessions.size, before, 'no worlds built');
  });

  test('the sprite editor is not served, and its absence is a 404', async () => {
    assert.equal((await fetch(`${base}/sprite-editor.html`)).status, 404);
    // The main view is unaffected.
    assert.equal((await fetch(`${base}/`)).status, 200);
  });

  test('⚠ the public list offers only worlds this host will actually build', async () => {
    // The operator's directory may hold worlds far above the ceiling; a button
    // that always fails is worse than no button.
    const oversized = { seed: 1, width: MAX_WORLD_DIMENSION, height: MAX_WORLD_DIMENSION };
    await server.presets.save({ name: 'far too big', world: oversized });
    await server.presets.save({ name: 'just right', world: { seed: 1, width: 128, height: 128 } });

    const { presets } = await (await fetch(`${base}/api/presets`)).json();
    const slugs = presets.map((preset) => preset.slug);
    assert.ok(slugs.includes('just-right'));
    assert.ok(!slugs.includes('far-too-big'), 'the oversized world is not offered');
  });

  test('presets are readable but not writable', async () => {
    assert.equal((await fetch(`${base}/api/presets`)).status, 200);
    const write = await fetch(`${base}/api/presets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nope', world: { seed: 1 } }),
    });
    assert.equal(write.status, 403);
    assert.equal((await write.json()).error.code, 'read-only-presets');
    assert.equal((await fetch(`${base}/api/presets/nope`, { method: 'DELETE' })).status, 403);
  });

  test('⚠ fetching a page does not build a world; only asking for one does', async () => {
    // A crawler that never keeps its cookie must not leave an engine behind per
    // request — that is how the session cap gets filled by nobody.
    const before = server.sessions.size;
    for (let i = 0; i < 5; i += 1) await fetch(`${base}/`);
    assert.equal(server.sessions.size, before, 'static requests are free');

    await fetch(`${base}/api/status`, { headers: { cookie: `${SESSION_COOKIE}=${SessionRegistry.newId()}` } });
    assert.equal(server.sessions.size, before + 1, 'asking for status builds one');
  });
});

describe('the admin host', () => {
  let server;
  let base;
  let presetDir;

  before(async () => {
    presetDir = await mkdtemp(path.join(tmpdir(), 'biome-deploy-admin-'));
    server = createServer({ seed: 1, presetDirectory: presetDir, admin: true });
    const address = await server.listen(0);
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await server.close();
    await rm(presetDir, { recursive: true, force: true });
  });

  test('the operator keeps the tool they had: editor, preset writes, and no ceiling', async () => {
    assert.equal(server.limits, null);
    assert.equal((await fetch(`${base}/sprite-editor.html`)).status, 200);
    const write = await fetch(`${base}/api/presets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin world', world: { seed: 3, width: 64, height: 64 } }),
    });
    assert.equal(write.status, 200);
  });
});
