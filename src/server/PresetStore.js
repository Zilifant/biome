/**
 * World presets: named world compositions, stored one per JSON file.
 *
 * ⚠ **A preset is a named `simulation.restart` payload, and nothing more.** That
 * is the whole design decision. It buys three things that a bespoke preset
 * schema would have had to re-earn: the payload validates through the *existing*
 * `validateCommand` rather than a second validator that could drift from it,
 * loading one is the ordinary restart command so **commands remain the only way
 * world state ever changes**, and a preset written by hand is checked as
 * strictly as one saved by the UI.
 *
 * ⚠ This is a **host** concern, not a simulation one. `src/simulation` performs
 * no file I/O at all — `SimulationSerializer` produces and consumes plain
 * objects and lets its caller decide where they live — and presets keep that
 * line: they are the host remembering what you asked for, not simulation state.
 * They are deliberately *not* saves. A save is a world mid-life (every animal,
 * every genome, the tick it stopped on); a preset is the handful of numbers a
 * world is *started* from, so it stays readable and hand-editable.
 *
 * Files rather than a database or `localStorage`: a preset is worth sharing and
 * worth committing, and one small JSON per preset means dropping a file into the
 * directory is a valid way to add one.
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CommandTypes } from '../protocol/commands.js';
import { formatErrors, validateCommand } from '../protocol/validation.js';

/**
 * On-disk format version. Bumped only when the *envelope* changes; the `world`
 * payload inside is versioned by the protocol, which is why the file records
 * both. A reader that meets a newer envelope refuses it rather than guessing.
 */
export const PRESET_FORMAT_VERSION = 1;

/** Long enough for a sentence fragment ("rounded island, no lions"). */
export const MAX_PRESET_NAME_LENGTH = 60;

/**
 * A ceiling so a runaway client cannot fill the disk one small file at a time.
 * Generous: presets are a few hundred bytes each.
 */
export const MAX_PRESETS = 500;

/**
 * The composition fields a preset may carry — a whitelist, so a preset can never
 * smuggle an unrelated key into a restart command, and so the file stays a thing
 * a human can read.
 *
 * ⚠ The deprecated v28 role aliases (`herbivores`/`predators`/`scavengers`) are
 * deliberately **not** here. They are scheduled for deletion at v30 and they
 * cannot express the current roster anyway (one species is both predator and
 * scavenger — see FOUNDING_ROLE_ALIASES). Persisting them would be writing a
 * known lie to disk with a long shelf life.
 */
const WORLD_FIELDS = Object.freeze(['seed', 'width', 'height', 'rocks', 'thickets', 'trees', 'roundness', 'founding']);

/**
 * A filesystem-safe slug for a preset name, or null if the name cannot produce
 * one.
 *
 * ⚠ **This is the security boundary, not a formatting nicety.** The slug becomes
 * a filename, so a name like `../../etc/passwd` must not be able to address
 * anything outside the preset directory. Rather than blacklisting traversal
 * sequences — which is a game of spotting every encoding — the slug is built
 * from an allowlist: lowercase alphanumerics and single dashes, nothing else
 * survives. `..` cannot be expressed in that alphabet at all. `#resolve` then
 * re-checks containment anyway, because one defence that must never fail is
 * worse than two that agree.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function presetSlug(name) {
  if (typeof name !== 'string') return null;
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_PRESET_NAME_LENGTH);
  return slug.length > 0 ? slug : null;
}

/**
 * Keep only the known composition fields, in a stable order so a re-saved preset
 * produces a byte-identical file rather than a spurious diff.
 * @param {object} world
 */
function pickWorldFields(world) {
  const picked = {};
  for (const field of WORLD_FIELDS) {
    if (world[field] !== undefined) picked[field] = world[field];
  }
  return picked;
}

/**
 * Validate a world payload as what it is — a restart command.
 * @param {unknown} world
 * @returns {{ok: true, world: object} | {ok: false, message: string}}
 */
export function validatePresetWorld(world) {
  if (world === null || typeof world !== 'object' || Array.isArray(world)) {
    return { ok: false, message: 'world must be an object' };
  }
  const picked = pickWorldFields(/** @type {object} */ (world));
  const result = validateCommand({ type: CommandTypes.SIMULATION_RESTART, ...picked });
  if (!result.ok) return { ok: false, message: formatErrors(result.errors) };
  return { ok: true, world: picked };
}

/** Error carrying a machine-readable code, so the transport can pick a status. */
export class PresetError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'PresetError';
    this.code = code;
  }
}

export class PresetStore {
  #directory;

  /**
   * @param {object} options
   * @param {string} options.directory where preset JSON files live; created on demand
   */
  constructor({ directory }) {
    if (typeof directory !== 'string' || directory.length === 0) {
      throw new TypeError('PresetStore requires a directory');
    }
    this.#directory = path.resolve(directory);
  }

  get directory() {
    return this.#directory;
  }

  /**
   * Absolute path for a slug, proven to sit inside the preset directory.
   * The second half of the traversal defence described on `presetSlug`.
   * @param {string} slug
   */
  #resolve(slug) {
    const full = path.resolve(this.#directory, `${slug}.json`);
    const prefix = this.#directory + path.sep;
    if (!full.startsWith(prefix)) {
      throw new PresetError('invalid-preset-name', 'preset name resolves outside the preset directory');
    }
    return full;
  }

  async #ensureDirectory() {
    await mkdir(this.#directory, { recursive: true });
  }

  /**
   * Every readable preset, newest first, each as `{ name, slug, savedAt, world }`.
   *
   * ⚠ Unreadable and malformed files are **skipped rather than thrown on**. The
   * directory is meant to be hand-editable, so one bad file must not make the
   * list endpoint fail and hide every good one. `read` still reports the specific
   * failure when you ask for that preset by name.
   * @returns {Promise<Array<object>>}
   */
  async list() {
    await this.#ensureDirectory();
    const entries = await readdir(this.#directory, { withFileTypes: true });
    const presets = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const slug = entry.name.slice(0, -'.json'.length);
      try {
        presets.push(await this.read(slug));
      } catch {
        // A malformed preset is invisible to the list, not fatal to it.
      }
    }
    // Newest first, then by slug so the order is total and stable — two presets
    // saved in the same millisecond must not swap places between requests.
    presets.sort((a, b) => (a.savedAt === b.savedAt ? a.slug.localeCompare(b.slug) : b.savedAt.localeCompare(a.savedAt)));
    return presets;
  }

  /**
   * One preset by slug.
   * @param {string} slug
   * @returns {Promise<{name: string, slug: string, savedAt: string, world: object}>}
   */
  async read(slug) {
    const safeSlug = presetSlug(slug);
    if (safeSlug === null) throw new PresetError('invalid-preset-name', 'preset name must contain a letter or digit');
    let raw;
    try {
      raw = await readFile(this.#resolve(safeSlug), 'utf8');
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
        throw new PresetError('preset-not-found', `no preset named "${safeSlug}"`);
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new PresetError('preset-unreadable', `preset "${safeSlug}" is not valid JSON`);
    }
    if (parsed?.formatVersion > PRESET_FORMAT_VERSION) {
      throw new PresetError(
        'preset-unsupported',
        `preset "${safeSlug}" is format v${parsed.formatVersion}; this build reads v${PRESET_FORMAT_VERSION}`,
      );
    }
    // ⚠ Validated on the way *in*, not only on the way out. The directory is
    // hand-editable by design, so a file is untrusted input exactly like a
    // request body — and a preset that would be refused as a command must be
    // refused here, where the name of the offending field can still be reported.
    const checked = validatePresetWorld(parsed?.world);
    if (!checked.ok) {
      throw new PresetError('preset-invalid', `preset "${safeSlug}" is not a valid world: ${checked.message}`);
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : safeSlug,
      slug: safeSlug,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      world: checked.world,
    };
  }

  /**
   * Save (or overwrite) a preset.
   *
   * The write is atomic — a temp file in the same directory, then a rename — so a
   * crash mid-write leaves the previous preset intact rather than a truncated
   * file the list would silently skip.
   *
   * @param {object} options
   * @param {string} options.name human-readable label stored inside the file
   * @param {object} options.world a `simulation.restart` payload
   * @param {string} [options.slug] where to store it; defaults to the slug of
   *        `name`. ⚠ Passed explicitly by the HTTP layer, where the *path* says
   *        which preset is being addressed: deriving the location from the body
   *        instead would let `PUT /presets/a` with `{name: "b"}` write to `b`,
   *        which is a request writing somewhere other than where it was sent.
   * @param {string} [options.savedAt] ISO timestamp; defaults to now
   * @returns {Promise<{name: string, slug: string, savedAt: string, world: object}>}
   */
  async save({ name, world, slug: requestedSlug, savedAt = new Date().toISOString() }) {
    const slug = presetSlug(requestedSlug ?? name);
    if (slug === null) {
      throw new PresetError('invalid-preset-name', 'preset name must contain a letter or digit');
    }
    const checked = validatePresetWorld(world);
    if (!checked.ok) throw new PresetError('invalid-preset-world', checked.message);

    await this.#ensureDirectory();
    const target = this.#resolve(slug);
    const existing = await readdir(this.#directory);
    const isNew = !existing.includes(`${slug}.json`);
    if (isNew && existing.filter((file) => file.endsWith('.json')).length >= MAX_PRESETS) {
      throw new PresetError('too-many-presets', `at most ${MAX_PRESETS} presets can be stored`);
    }

    const record = {
      formatVersion: PRESET_FORMAT_VERSION,
      name: String(name).slice(0, MAX_PRESET_NAME_LENGTH),
      savedAt,
      world: checked.world,
    };
    // Trailing newline: these are files a person opens and a repo may hold.
    const body = `${JSON.stringify(record, null, 2)}\n`;
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, body, 'utf8');
    await rename(temp, target);
    return { name: record.name, slug, savedAt, world: record.world };
  }

  /**
   * Delete a preset. Returns true if one was removed, false if there was none —
   * deleting something already gone is not an error.
   * @param {string} slug
   * @returns {Promise<boolean>}
   */
  async remove(slug) {
    const safeSlug = presetSlug(slug);
    if (safeSlug === null) throw new PresetError('invalid-preset-name', 'preset name must contain a letter or digit');
    try {
      await unlink(this.#resolve(safeSlug));
      return true;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
      throw error;
    }
  }
}
