import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, ZOOM_LEVELS } from '../src/renderer/app/rendering/Camera.js';
import { createProjection, worldCellOf, occupantsInCell } from '../src/renderer/app/rendering/GridProjection.js';
import {
  planFollow,
  followBox,
  cellCentreOf,
  glideAt,
  glideDuration,
  startGlide,
  FOLLOW_DEADZONE_FRACTION,
  GLIDE_MIN_MS,
  GLIDE_MAX_MS,
  GLIDE_MS_PER_PIXEL,
} from '../src/renderer/app/rendering/FollowCamera.js';
import {
  resolveAppearance,
  compareOccupants,
  topOccupant,
  DRACULA_COLORS,
  UNKNOWN_APPEARANCE,
  CARCASS_APPEARANCE,
  CARCASS_DECAY_APPEARANCE,
  SPECIES_APPEARANCE,
  TERRAIN_APPEARANCE,
  FEATURE_APPEARANCE,
  DISTURBANCE_APPEARANCE,
  MEMORY_APPEARANCE,
  VEGETATION_APPEARANCE,
  resolveVegetationAppearance,
  fadesUnderOccupant,
  OCCUPIED_ALPHA,
  STATUS_APPEARANCE,
  STATUS_CYCLE_MS,
  statusesOf,
  HURT_HEALTH_FRACTION,
  SOCIAL_GROUP_APPEARANCE,
  recordGroupKind,
} from '../src/renderer/app/rendering/EntityAppearance.js';
import {
  describeSocialGroups,
  membershipsOf,
  outlineRegion,
  traceOutline,
  insetLoop,
  paintOutlineLayer,
  MIN_GROUP_MEMBERS,
  MAX_CORRIDOR_CELLS,
} from '../src/renderer/app/rendering/SocialLayer.js';
import { MAP_LAYERS, resolveEnabledLayers } from '../src/renderer/app/rendering/MapLayers.js';
import { describeTerritories, TERRITORY_RING } from '../src/renderer/app/rendering/TerritoryLayer.js';
import { AsciiGridRenderer } from '../src/renderer/app/rendering/AsciiGridRenderer.js';
import { structureSignature, describeSections, entityRef, linkifyIds } from '../src/renderer/app/ui/InspectorView.js';
import { describeLegend, STATUS_SHAPE_GLYPHS } from '../src/renderer/app/ui/Legend.js';
import { indexHistory, drawTrend, BAR_LEVELS, TREND_LEVELS } from '../src/renderer/app/ui/MetricsPanel.js';
import { matchWatched, WATCHABLE } from '../src/renderer/app/ui/Watchlist.js';
import {
  EVENT_CATALOG,
  DEFAULT_EVENT_FILTER,
  LASTING,
  PASSING,
  OTHER_EVENTS,
  filterIdFor,
  prefixFor,
  isLastingEvent,
} from '../src/renderer/app/state/EventCatalog.js';
import { describeEvent } from '../src/renderer/app/ui/EventLog.js';
// The renderer may not import the protocol; a *test* may, and that is what
// keeps the catalog's hand-copied list in step with the engine's.
import { EventTypes } from '../src/protocol/events.js';

describe('entity appearance', () => {
  test('appearance lookup is deterministic and species-aware', () => {
    const grazer = { kind: 'animal', speciesId: 'herbivore.gazelle', alive: true };
    const first = resolveAppearance(grazer);
    const second = resolveAppearance({ ...grazer });
    assert.equal(first, second, 'repeated lookups return the identical cached object');
    assert.equal(first.glyph, 'g');
    assert.equal(first.colorToken, 'yellow');
    assert.equal(resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph, '"');
  });

  test('glyphs differ across categories, so color is never the only distinction', () => {
    const glyphs = [
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.gazelle', alive: true }).glyph,
      resolveAppearance({ kind: 'plant', speciesId: 'demo.grass', alive: true }).glyph,
      resolveAppearance({ kind: 'animal', speciesId: 'herbivore.gazelle', alive: false }).glyph,
      resolveAppearance({ kind: 'mystery', speciesId: 'x', alive: true }).glyph,
    ];
    assert.equal(new Set(glyphs).size, glyphs.length, `expected distinct glyphs, got ${glyphs}`);
    for (const glyph of glyphs) {
      assert.equal(glyph.length, 1);
      assert.ok(glyph.charCodeAt(0) < 128, 'strict ASCII only');
    }
  });

  test('letter case is age and italic is sex, independently', () => {
    const base = { kind: 'animal', speciesId: 'herbivore.gazelle', alive: true };
    // Case is maturity: adult/senescent UPPERCASE, juvenile/subadult lowercase.
    assert.equal(resolveAppearance({ ...base, lifeStage: 'adult' }).glyph, 'G');
    assert.equal(resolveAppearance({ ...base, lifeStage: 'senescent' }).glyph, 'G');
    assert.equal(resolveAppearance({ ...base, lifeStage: 'juvenile' }).glyph, 'g');
    assert.equal(resolveAppearance({ ...base, lifeStage: 'subadult' }).glyph, 'g');
    // An absent or unknown stage reads as not-yet-grown rather than throwing.
    assert.equal(resolveAppearance(base).glyph, 'g');
    // Italic is sex, orthogonal to case: only a female is italic.
    assert.equal(resolveAppearance({ ...base, sex: 'female', lifeStage: 'adult' }).italic, true);
    assert.equal(resolveAppearance({ ...base, sex: 'female', lifeStage: 'juvenile' }).glyph, 'g');
    assert.equal(resolveAppearance({ ...base, sex: 'female', lifeStage: 'juvenile' }).italic, true);
    assert.ok(!resolveAppearance({ ...base, sex: 'male', lifeStage: 'adult' }).italic);
    // A carcass carries neither channel — case and italic are animal-only.
    assert.ok(!resolveAppearance({ ...base, alive: false, lifeStage: 'adult' }).italic);
  });

  test('dead animals become carcasses; unknown kinds and species fall back', () => {
    assert.equal(resolveAppearance({ kind: 'animal', speciesId: 'herbivore.gazelle', alive: false }), CARCASS_APPEARANCE);
    assert.equal(resolveAppearance({ kind: 'levitating.rock', speciesId: 'whatever', alive: true }), UNKNOWN_APPEARANCE);
    const unknownSpecies = resolveAppearance({ kind: 'animal', speciesId: 'not.mapped', alive: true });
    assert.equal(unknownSpecies.glyph, 'a', 'unmapped species fall back to the kind default');
  });

  test('appearance color tokens all resolve to exact Dracula values', () => {
    for (const entity of [
      { kind: 'animal', speciesId: 'herbivore.gazelle', alive: true },
      { kind: 'plant', speciesId: 'demo.grass', alive: true },
      { kind: 'animal', speciesId: 'herbivore.gazelle', alive: false },
      { kind: 'nope', speciesId: '', alive: true },
    ]) {
      const { colorToken } = resolveAppearance(entity);
      assert.match(DRACULA_COLORS[colorToken], /^#[0-9A-F]{6}$/);
    }
  });

  test('multiple occupants order deterministically: living animal > carcass > plant, ties by id', () => {
    const plant = { id: 5, kind: 'plant', speciesId: 'demo.grass', alive: true };
    const carcass = { id: 4, kind: 'animal', speciesId: 'herbivore.gazelle', alive: false };
    const animalOld = { id: 2, kind: 'animal', speciesId: 'herbivore.gazelle', alive: true };
    const animalNew = { id: 9, kind: 'animal', speciesId: 'herbivore.gazelle', alive: true };
    const sorted = [plant, carcass, animalNew, animalOld].sort(compareOccupants);
    assert.deepEqual(sorted.map((entity) => entity.id), [2, 9, 4, 5]);
    assert.equal(topOccupant([plant, carcass, animalNew]).id, 9);
    assert.equal(topOccupant([plant, carcass]).id, 4);
  });
});

describe('the layers that fade under an occupant', () => {
  // Forage, water, trails, and burrows are readings *of* a cell, so they give
  // way to whatever is standing in it; the rest of the terrain is the shape of
  // the map and stays solid. The renderer decides which is which by identity,
  // not by glyph — these layers share glyphs, and only the identity of the
  // frozen registry entry says which one answered.
  test('every forage level fades, at every level the ramp can return', () => {
    for (let level = 1; level < VEGETATION_APPEARANCE.length + 2; level += 1) {
      const appearance = resolveVegetationAppearance(level);
      assert.ok(appearance, `level ${level} should resolve to a forage glyph`);
      assert.ok(fadesUnderOccupant(appearance), `level ${level} does not fade`);
    }
  });

  test('water, thicket, trails, and burrows give way; the hard map does not', () => {
    for (const name of ['water', 'deep_water', 'thicket']) {
      assert.ok(fadesUnderOccupant(TERRAIN_APPEARANCE[name]), `${name} gives way`);
    }
    for (const appearance of Object.values(FEATURE_APPEARANCE)) {
      assert.ok(fadesUnderOccupant(appearance), 'worn ground gives way');
    }
    for (const name of ['ground', 'rock', 'cover']) {
      assert.equal(fadesUnderOccupant(TERRAIN_APPEARANCE[name]), false, `${name} must stay solid`);
    }
    // A disturbance stays solid: an animal caught in a fire is the whole point
    // of watching it get caught.
    for (const appearance of Object.values(DISTURBANCE_APPEARANCE)) {
      assert.equal(fadesUnderOccupant(appearance), false, 'disturbances stay solid');
    }
  });

  test('the test is identity, not glyph — three layers share `.`', () => {
    assert.equal(resolveVegetationAppearance(0), null);
    assert.equal(fadesUnderOccupant(null), false);
    // Bare ground, the sparsest forage, and a trail are all `.`; two of the
    // three fade and one does not, so a glyph comparison would be wrong.
    assert.equal(TERRAIN_APPEARANCE.ground.glyph, '.');
    assert.equal(resolveVegetationAppearance(1).glyph, '.');
    assert.equal(FEATURE_APPEARANCE.trail.glyph, '.');
    assert.equal(fadesUnderOccupant(TERRAIN_APPEARANCE.ground), false);
  });

  test('a covered layer is not drawn at all', () => {
    // It was 20% first. Two glyphs in one 10px cell is a smudge at any opacity
    // that leaves the lower one visible, and the occupant is always the thing
    // worth reading; the ground is one click away in the inspector.
    assert.equal(OCCUPIED_ALPHA, 0);
  });
});

/**
 * The canvas renderer, driven through a stub 2D context that records what was
 * drawn and at what opacity.
 *
 * ⚠ This is the one place the *drawing* is asserted rather than the data behind
 * it. It works because `AsciiGridRenderer` asks its canvas for a context and
 * nothing else — `#color` falls back to the exact Dracula values when there is
 * no `getComputedStyle` — so the whole pass runs in node with no DOM
 * dependency, exactly as the rest of the suite does.
 */
function recordDraw(occupants = [], vegetationLevel = 3, features = [], statusPhase = 0, selection = null, terrain = 'ground', killCells = []) {
  return drawWith(occupants, vegetationLevel, features, statusPhase, selection, terrain, killCells).ops;
}

/** As `recordDraw`, but answering the renderer's own cycling question. */
function drawAndAsk(occupants) {
  return drawWith(occupants, 3, [], 0, null, 'ground').renderer.hasCyclingStatus;
}

function drawWith(occupants, vegetationLevel, features, statusPhase, selection, terrain = 'ground', killCells = []) {
  const ops = [];
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    setTransform() {},
    fillRect(px, py, w, h) {
      ops.push({ rect: true, px, py, w, h, colorToken: tokenOf(this.fillStyle), alpha: this.globalAlpha });
    },
    stroke() {},
    fillText(glyph, px, py) {
      ops.push({ glyph, px, py, alpha: this.globalAlpha });
    },
    // Status marks are drawn as paths rather than glyphs, so the stub tracks
    // one: `arc` makes it a dot, a run of line segments a polygon, and `fill`
    // is what commits it.
    //
    // ⚠ The two polygon shapes are told apart by **vertex count**, which is the
    // only thing a canvas stub can see: a diamond is one 4-point path and a
    // chevron pair is two 6-point subpaths in one path (see `paintStatusMark`).
    // A future shape with 4 or 12 vertices would need a better discriminator —
    // the alternative today would be asserting on pixels, which this repo has no
    // dependency for.
    beginPath() {
      this.path = { shape: null, points: [] };
    },
    arc(cx, cy, radius) {
      this.path = { shape: 'dot', cx, cy, radius, points: [] };
    },
    moveTo(x, y) {
      this.path.points.push([x, y]);
    },
    lineTo(x, y) {
      this.path.points.push([x, y]);
    },
    closePath() {},
    fill() {
      const path = this.path;
      const centre = (axis) =>
        (Math.min(...path.points.map((p) => p[axis])) + Math.max(...path.points.map((p) => p[axis]))) / 2;
      const mark = path.shape === 'dot'
        ? { mark: 'dot', cx: path.cx, cy: path.cy, radius: path.radius }
        : {
            mark: path.points.length === 4 ? 'diamond' : 'chevron',
            vertices: path.points.length,
            cx: centre(0),
            cy: centre(1),
            // The apex of the topmost chevron, which is what "pointing up" means
            // geometrically: the highest vertex sits on the mark's centre line.
            apex: path.points.reduce((best, p) => (p[1] < best[1] ? p : best), path.points[0]),
          };
      ops.push({ ...mark, colorToken: tokenOf(this.fillStyle), alpha: this.globalAlpha });
    },
  };
  const renderer = new AsciiGridRenderer({ style: {}, width: 0, height: 0, getContext: () => context });
  renderer.resize(60, 60, 1);

  const world = { width: 4, height: 4 };
  const entities = occupants.map((occupant, index) => ({
    id: index + 1,
    x: occupant.cellX + 0.5,
    y: occupant.cellY + 0.5,
    ...occupant,
  }));
  const camera = new Camera();
  camera.centerOn(world.width / 2, world.height / 2);
  renderer.draw({
    store: {
      world,
      features,
      disturbances: [],
      selection,
      followedEntityId: null,
      vegetationLevelAt: () => vegetationLevel,
      terrainNameAt: () => terrain,
      getEntitiesInBounds: () => entities,
      getEntity: (id) => entities.find((entity) => entity.id === id) ?? null,
    },
    camera,
    statusPhase,
    killCells,
  });
  return { ops, renderer };
}

/** The Dracula token a resolved hex belongs to — the stub sees colours, not tokens. */
const tokenOf = (hex) => Object.keys(DRACULA_COLORS).find((token) => DRACULA_COLORS[token] === hex) ?? hex;

/** A living gazelle standing in the given cell. */
const gazelleAt = (cellX, cellY, overrides = {}) => ({
  kind: 'animal',
  alive: true,
  speciesId: 'herbivore.gazelle',
  healthFraction: 1,
  cellX,
  cellY,
  ...overrides,
});

describe('animal statuses', () => {
  // A status is a mark in the corner of the cell, not a change to the glyph.
  // Tinting the letter spent the one channel that says which species it is, and
  // could only ever show one condition at a time.
  const gazelle = (overrides = {}) => ({
    kind: 'animal',
    alive: true,
    speciesId: 'herbivore.gazelle',
    healthFraction: 1,
    ...overrides,
  });

  test('every status has a distinct id, colour, and one of the three shapes', () => {
    const ids = STATUS_APPEARANCE.map((status) => status.id);
    const colours = STATUS_APPEARANCE.map((status) => status.colorToken);
    assert.equal(new Set(ids).size, ids.length, `duplicate status ids in ${ids}`);
    // ⚠ Colour is what makes a marker findable in a herd, and at the 10px floor it
    // is the *only* channel left — three shapes is already more than that size can
    // carry (see `paintStatusMark`), so a shared colour would be two statuses
    // nobody can tell apart. This is the assertion that keeps that true.
    assert.equal(new Set(colours).size, colours.length, `two statuses share a colour: ${colours}`);
    for (const status of STATUS_APPEARANCE) {
      assert.ok(['dot', 'diamond', 'chevron'].includes(status.shape), `${status.id} has shape ${status.shape}`);
      assert.ok(DRACULA_COLORS[status.colorToken], `${status.id} has an unknown colour token`);
      assert.ok(status.label, `${status.id} needs a label for the legend`);
    }
  });

  test('each status reads a bulk-snapshot field, so it is true of every animal on screen', () => {
    assert.deepEqual(statusesOf(gazelle({ healthFraction: HURT_HEALTH_FRACTION - 0.01 })).map((s) => s.id), ['hurt']);
    assert.deepEqual(statusesOf(gazelle({ diseaseState: 'symptomatic' })).map((s) => s.id), ['ill']);
    assert.deepEqual(statusesOf(gazelle({ gestating: true })).map((s) => s.id), ['gestating']);
    assert.deepEqual(statusesOf(gazelle({ seekingMate: true })).map((s) => s.id), ['rut']);
    assert.deepEqual(statusesOf(gazelle({ dispersing: true })).map((s) => s.id), ['dispersing']);
    // Flight (protocol v32). ⚠ Reads the bulk field, like every other predicate
    // here — `flying` rides in the snapshot precisely so a status can.
    assert.deepEqual(statusesOf(gazelle({ flying: true })).map((s) => s.id), ['flying']);
    // ⚠ An incubating carrier is deliberately unmarked: the disease model rests
    // on it being invisible.
    assert.deepEqual(statusesOf(gazelle({ diseaseState: 'incubating' })).map((s) => s.id), []);
  });

  test('an ordinary animal and a carcass have none, and the empty answer does not allocate', () => {
    assert.deepEqual(statusesOf(gazelle()), []);
    // A carcass has no condition and no life left to be in the middle of.
    assert.deepEqual(statusesOf({ kind: 'carcass', alive: false, healthFraction: 0, seekingMate: true }), []);
    assert.deepEqual(statusesOf({ kind: 'animal', alive: false, healthFraction: 0 }), []);
    // Same frozen array every time: this runs per drawn cell per frame.
    assert.equal(statusesOf(gazelle()), statusesOf({ kind: 'plant' }));
  });

  test('several statuses come back in registry order, which is the order they cycle', () => {
    const many = statusesOf(gazelle({ healthFraction: 0.2, diseaseState: 'symptomatic', gestating: true }));
    assert.deepEqual(many.map((s) => s.id), ['hurt', 'ill', 'gestating']);
    assert.equal(STATUS_CYCLE_MS, 500);
  });
});

describe('the grid renderer', () => {
  // The forage ramp for level 3 is `"`; the gazelle is `g`; a fresh carcass `%`.
  const forageGlyph = resolveVegetationAppearance(3).glyph;

  test('an occupied cell draws no forage at all, and every other cell still does', () => {
    // Two glyphs in one cell is a smudge at any opacity that leaves the lower
    // one readable, and the occupant is always the one worth reading.
    const ops = recordDraw([gazelleAt(1, 1)]);
    const animal = ops.find((op) => op.glyph === 'g');
    assert.ok(animal, 'the animal was drawn');

    const grass = ops.filter((op) => op.glyph === forageGlyph);
    assert.ok(grass.length > 1, 'the world is vegetated');
    assert.equal(
      grass.filter((op) => op.px === animal.px && op.py === animal.py).length,
      0,
      'nothing is drawn under the animal',
    );
    for (const op of grass) assert.equal(op.alpha, 1, 'forage nobody is standing in is untouched');
  });

  test('thicket gives way too — the layer animals are most often inside', () => {
    // A `♣` and a `g` in the same 10px cell is the collision this exists for.
    const thicketGlyph = TERRAIN_APPEARANCE.thicket.glyph;
    const bare = recordDraw([], 0, [], 0, null, 'thicket');
    assert.ok(bare.some((op) => op.glyph === thicketGlyph), 'thicket is drawn when nobody is standing in it');

    const ops = recordDraw([gazelleAt(1, 1)], 0, [], 0, null, 'thicket');
    const animal = ops.find((op) => op.glyph === 'g');
    assert.equal(
      ops.filter((op) => op.glyph === thicketGlyph && op.px === animal.px && op.py === animal.py).length,
      0,
    );
  });

  test('tree terrain remains visible when its cell is bare', () => {
    const treeGlyph = TERRAIN_APPEARANCE.tree.glyph;
    const ops = recordDraw([], 0, [], 0, null, 'tree');
    assert.ok(ops.some((op) => op.glyph === treeGlyph), 'tree is drawn');
    assert.equal(ops.some((op) => op.glyph === forageGlyph), false, 'forage does not hide the tree');
  });

  test('a carcass covers the ground it is lying on, exactly as an animal does', () => {
    const ops = recordDraw([{ kind: 'carcass', alive: false, decayStage: 0, cellX: 1, cellY: 1 }]);
    const carcass = ops.find((op) => op.glyph === '%');
    assert.ok(carcass, 'the carcass was drawn');
    assert.equal(
      ops.filter((op) => op.glyph === forageGlyph && op.px === carcass.px && op.py === carcass.py).length,
      0,
    );
  });

  test('a trail or burrow under an occupant is not drawn, and one nobody stands on is', () => {
    const features = [
      { kind: 'trail', cellX: 1, cellY: 1 },
      { kind: 'burrow', cellX: 2, cellY: 2 },
    ];
    // ⚠ Over *rock*, deliberately. A trail is `.` and so is bare ground, which
    // does not give way — so on ground this test would find the terrain's own
    // `.` in the animal's cell and call it the trail. The same collision the
    // renderer resolves by identity rather than by glyph.
    const ops = recordDraw([gazelleAt(1, 1)], 0, features, 0, null, 'rock');
    const animal = ops.find((op) => op.glyph === 'g');
    assert.ok(animal, 'the animal was drawn');
    assert.equal(
      ops.filter((op) => op.glyph === FEATURE_APPEARANCE.trail.glyph && op.px === animal.px && op.py === animal.py)
        .length,
      0,
      'the occupied trail is not drawn',
    );
    const burrow = ops.find((op) => op.glyph === FEATURE_APPEARANCE.burrow.glyph);
    assert.ok(burrow, 'a burrow nobody is standing on is drawn as usual');
    assert.equal(burrow.alpha, 1);
  });

  test('with nothing standing anywhere, nothing is faded', () => {
    for (const op of recordDraw()) assert.equal(op.alpha, 1);
  });

  test('a status is a mark in the cell\'s upper-left corner, not a tint on the glyph', () => {
    const ops = recordDraw([gazelleAt(1, 1, { healthFraction: 0.2 })]);
    const animal = ops.find((op) => op.glyph === 'g');
    // ⚠ The glyph keeps its *species* colour. It used to be recoloured, which
    // spent the channel that says what the animal is.
    assert.equal(animal.colorToken, undefined, 'glyph ops carry no override');
    const marks = ops.filter((op) => op.mark);
    assert.equal(marks.length, 1);
    assert.equal(marks[0].mark, 'dot', 'a condition is a dot');
    assert.equal(marks[0].colorToken, 'orange');
    // Upper-left of that cell, inside it, and above the glyph's own centre.
    assert.ok(marks[0].cx < animal.px, 'left of the glyph centre');
    assert.ok(marks[0].cy < animal.py, 'above the glyph centre');
  });

  test('a state is a diamond, and the shapes are the three families', () => {
    const ops = recordDraw([gazelleAt(1, 1, { gestating: true })]);
    const mark = ops.find((op) => op.mark);
    assert.equal(mark.mark, 'diamond');
    assert.equal(mark.colorToken, 'pink');
  });

  test('being on the wing is a cyan double chevron pointing up', () => {
    // The third shape family: *where* the animal is, rather than what is wrong
    // with it (dot) or what is happening to it (diamond).
    const ops = recordDraw([gazelleAt(1, 1, { flying: true })]);
    const mark = ops.find((op) => op.mark);
    assert.equal(mark.mark, 'chevron');
    assert.equal(mark.colorToken, 'cyan');
    // Two chevrons of six vertices each — one would be a wedge, and `»` is a pair.
    assert.equal(mark.vertices, 12, 'a pair of chevrons, not one');
    // ⚠ Pointing **up**: the topmost vertex is the apex, and it sits on the
    // mark's own centre line. A `»` drawn unrotated would put its extreme point
    // out to one side instead.
    assert.ok(Math.abs(mark.apex[0] - mark.cx) < 0.01, `apex ${mark.apex} is centred under ${mark.cx}`);
    assert.ok(mark.apex[1] < mark.cy, 'and above the centre');
  });

  test('an animal in several statuses shows one at a time, chosen by the phase', () => {
    // The phase is a wall-clock counter, so this is what makes a paused world
    // still cycle.
    const occupant = gazelleAt(1, 1, { healthFraction: 0.2, gestating: true });
    const shown = (phase) => recordDraw([occupant], 3, [], phase).find((op) => op.mark);
    assert.equal(shown(0).colorToken, 'orange');
    assert.equal(shown(1).colorToken, 'pink');
    assert.equal(shown(2).colorToken, 'orange', 'and round again');
    // One mark at a time: four in a 10px cell is a smudge.
    assert.equal(recordDraw([occupant], 3, [], 0).filter((op) => op.mark).length, 1);
  });

  test('the renderer reports whether anything on screen is mid-cycle', () => {
    // `RendererApp` redraws on the phase turning over only when this is true,
    // so a still, unremarkable world costs no frames at all.
    assert.equal(drawAndAsk([gazelleAt(1, 1)]), false);
    assert.equal(drawAndAsk([gazelleAt(1, 1, { gestating: true })]), false, 'one status never cycles');
    assert.equal(drawAndAsk([gazelleAt(1, 1, { gestating: true, healthFraction: 0.1 })]), true);
  });

  test('a status mark survives the selection fill that paints over its cell', () => {
    // Drawn last of all: a mark drawn before the selection's fillRect vanished
    // the moment you clicked the animal you were watching.
    const ops = recordDraw([gazelleAt(1, 1, { id: 1, healthFraction: 0.2 })], 3, [], 0, {
      cellX: 1,
      cellY: 1,
      entityIds: [1],
      activeId: 1,
    });
    const markIndex = ops.findIndex((op) => op.mark);
    const selectionGlyph = ops.map((op) => op.glyph).lastIndexOf('g');
    assert.ok(markIndex > selectionGlyph, 'the mark is drawn after the selection redraw');
  });

  test('a kill fills its cell red, behind everything else in it', () => {
    // A `%` appearing among the glyphs is the only other sign a hunt landed,
    // and on a moving grid that is no sign at all.
    const ops = recordDraw([{ kind: 'carcass', alive: false, decayStage: 0, cellX: 1, cellY: 1 }], 3, [], 0, null, 'ground', [
      { cellX: 1, cellY: 1 },
    ]);
    const flash = ops.filter((op) => op.rect && op.colorToken === 'red');
    assert.equal(flash.length, 1);

    const carcass = ops.find((op) => op.glyph === '%');
    assert.equal(flash[0].px, carcass.px - flash[0].w / 2, 'the fill is that cell, not an offset one');
    assert.ok(ops.indexOf(flash[0]) < ops.indexOf(carcass), 'behind the body it is pointing at');
  });

  test('no kill, no flash — it is a moment, not a layer', () => {
    assert.equal(
      recordDraw([gazelleAt(1, 1)]).filter((op) => op.rect && op.colorToken === 'red').length,
      0,
    );
  });

  test('the shape of the map stays solid under an animal', () => {
    // Level 0 means the ground glyph is terrain rather than forage. A herd
    // crossing a ridge must not erase the ridge.
    for (const op of recordDraw([gazelleAt(1, 1)], 0)) assert.equal(op.alpha, 1);
  });
});

describe('the species roster', () => {
  // The whole planned roster has an appearance entry before the species exist,
  // so that adding one is a config change rather than a config change *and* a
  // renderer change (PLAN-SPECIES §7). This list is the claim: a species batch
  // that lands without its glyph fails here rather than drawing a bare `a`.
  const ROSTER = [
    'herbivore.gazelle',
    'herbivore.wildebeest',
    'herbivore.zebra',
    'herbivore.buffalo',
    'herbivore.rhino',
    'herbivore.elephant',
    'predator.leopard',
    'predator.lion',
    'scavenger.hyena',
    'scavenger.vulture',
  ];

  test('every roster species has an appearance entry', () => {
    for (const speciesId of ROSTER) {
      assert.ok(SPECIES_APPEARANCE[speciesId], `${speciesId} has no appearance entry`);
    }
  });

  test('every species glyph is one ASCII letter drawn in a real Dracula colour', () => {
    for (const [speciesId, appearance] of Object.entries(SPECIES_APPEARANCE)) {
      assert.match(appearance.glyph, /^[a-z]$/, `${speciesId} should be one lowercase ASCII letter`);
      assert.match(DRACULA_COLORS[appearance.colorToken] ?? '', /^#[0-9A-F]{6}$/, `${speciesId}`);
      assert.equal(typeof appearance.priority, 'number', `${speciesId} needs a display priority`);
      assert.ok(appearance.label, `${speciesId} needs a label`);
    }
  });

  test('two species share a glyph only when one is the rename of the other', () => {
    // Case is age and italic is sex, so the letter is all that is left to say
    // *which animal this is* — two live species on one letter would be
    // indistinguishable. The three that do share one are the shipped species
    // and the roster entries they are renamed into, which never coexist in a
    // world; `supersededBy` is what says so, and it is deleted with the entry
    // when the rename lands.
    const byGlyph = new Map();
    for (const [speciesId, appearance] of Object.entries(SPECIES_APPEARANCE)) {
      const sharing = byGlyph.get(appearance.glyph) ?? [];
      sharing.push(speciesId);
      byGlyph.set(appearance.glyph, sharing);
    }
    for (const [glyph, sharing] of byGlyph) {
      if (sharing.length === 1) continue;
      assert.equal(sharing.length, 2, `more than two species claim "${glyph}": ${sharing}`);
      const [first, second] = sharing;
      const superseded =
        SPECIES_APPEARANCE[first].supersededBy === second ||
        SPECIES_APPEARANCE[second].supersededBy === first;
      assert.ok(superseded, `"${glyph}" is claimed by unrelated species ${sharing}`);
    }
  });

  test('a supersededBy names a species that actually has an entry', () => {
    // Otherwise the successor is a promise rather than a glyph, and the rename
    // phase discovers it at the point it is meant to be trivial.
    for (const [speciesId, appearance] of Object.entries(SPECIES_APPEARANCE)) {
      if (!appearance.supersededBy) continue;
      assert.ok(
        SPECIES_APPEARANCE[appearance.supersededBy],
        `${speciesId} is superseded by ${appearance.supersededBy}, which has no entry`,
      );
      assert.ok(!SPECIES_APPEARANCE[appearance.supersededBy].supersededBy, 'supersession does not chain');
    }
  });
});

describe('population sparklines fit the column they are in', () => {
  // A sparkline is one character per sample, so 120 samples is 120 unbreakable
  // columns in a 300px panel: it ran off the edge and took the species name
  // with it. The series is resampled to the space available instead.
  const rising = Array.from({ length: 120 }, (_, i) => i);

  test('a long history is compressed to the width, not cut off at it', () => {
    assert.equal(drawTrend(rising, 20).length, 20);
    assert.equal(drawTrend(rising, 7).length, 7);
    // ⚠ Compressed, not truncated: the shape of the *whole* history is the
    // point of the row, so a rising series still reads as rising end to end.
    const chart = drawTrend(rising, 20);
    assert.equal(chart[0], TREND_LEVELS[0]);
    assert.equal(chart.at(-1), TREND_LEVELS.at(-1));
  });

  test('the lowest sample is a visible bar, never a blank', () => {
    // ⚠ A histogram has a zero and a sparkline does not. Sharing one ramp drew
    // the window's *minimum* as empty space, so `41,41,41,40` came out as
    // `███ ` — losing one animal of 41 looking exactly like the species
    // disappearing — and a steady population came out as a line of nothing.
    assert.equal(drawTrend([41, 41, 41, 40]), '███▁');
    assert.equal(drawTrend([38, 39, 40, 41, 42])[0], '▁');
    for (const chart of [drawTrend(rising, 30), drawTrend([40, 40, 39, 40]), drawTrend(Array(9).fill(7))]) {
      assert.ok(!chart.includes(BAR_LEVELS[0]), `a trend must not contain the blank rung: ${JSON.stringify(chart)}`);
    }
    // The blank rung is still the histogram's, where a bin of nothing is
    // genuinely nothing.
    assert.equal(TREND_LEVELS.length, BAR_LEVELS.length - 1);
    assert.equal(TREND_LEVELS[0], BAR_LEVELS[1]);
  });

  test('a steady population draws a flat line, not an empty one', () => {
    const flat = drawTrend(Array(40).fill(120), 20);
    assert.equal(flat.length, 20);
    assert.equal(new Set(flat).size, 1);
    assert.equal(flat[0], '▁', 'steady reads as no change, at the foot of the chart');
  });

  test('a short history is drawn one-to-one and simply ends', () => {
    // Early in a run there is less data than column: the rest of the line is
    // empty, rather than four points stretched across the panel.
    assert.equal(drawTrend([1, 2, 3], 40).length, 3);
    assert.equal(drawTrend([1, 2, 3]).length, 3, 'unbounded width is the same answer');
  });

  test('a width too small for a chart draws none at all', () => {
    assert.equal(drawTrend(rising, 1), '');
    assert.equal(drawTrend(rising, 0), '');
    // And too little data is still no chart, at any width.
    assert.equal(drawTrend([5], 40), '');
    assert.equal(drawTrend([], 40), '');
  });

  test('every bucket averages a fair share, so the last one is not a spike', () => {
    // `history % width` is almost never zero; a final bucket over two samples
    // where the rest cover five is a cliff at the right-hand end of every chart.
    // A flat series must therefore draw completely flat at any width.
    const flat = Array(97).fill(4);
    for (const width of [5, 12, 31, 96]) {
      assert.equal(new Set(drawTrend(flat, width)).size, 1, `width ${width} is not flat`);
      assert.equal(drawTrend(flat, width).length, width);
      assert.ok(!drawTrend(flat, width).includes(BAR_LEVELS[0]), 'and visible at every width');
    }
  });
});

describe('metrics history indexing', () => {
  // The panel draws a sparkline per trait per species out of one bounded
  // history. Indexing it once is what keeps that linear rather than quadratic
  // in species count (PLAN-SPECIES §7).
  const history = [
    { tick: 1, species: [{ speciesId: 'a', living: 3, traits: { size: 1 } }, { speciesId: 'b', living: 9, traits: { size: 2 } }] },
    { tick: 2, species: [{ speciesId: 'b', living: 8, traits: { size: 3 } }] },
    { tick: 3, species: [{ speciesId: 'a', living: 5, traits: { size: 4 } }, { speciesId: 'b', living: 7, traits: { size: 5 } }] },
  ];

  test('groups every sample by species, in the order the history holds them', () => {
    const index = indexHistory(history);
    assert.deepEqual(index.get('a').map((sample) => sample.living), [3, 5]);
    assert.deepEqual(index.get('b').map((sample) => sample.living), [9, 8, 7]);
    assert.equal(index.get('never-existed'), undefined);
  });

  test('it agrees with the per-sample lookup it replaced', () => {
    // The old code mapped over the whole history and looked each species up,
    // producing an `undefined` for samples that did not mention it. The trend
    // renderer discards non-numbers, so dropping those slots is the same
    // sparkline — asserted rather than assumed, because a silently different
    // trend line is exactly the kind of regression nobody notices.
    const index = indexHistory(history);
    for (const speciesId of ['a', 'b']) {
      const viaFind = history
        .map((sample) => sample.species.find((entry) => entry.speciesId === speciesId)?.traits.size)
        .filter((value) => typeof value === 'number');
      assert.deepEqual(index.get(speciesId).map((sample) => sample.traits.size), viaFind);
    }
  });

  test('an empty or species-less history indexes to nothing rather than throwing', () => {
    assert.equal(indexHistory([]).size, 0);
    assert.equal(indexHistory([{ tick: 1 }]).size, 0);
  });
});

describe('grid projection', () => {
  const camera = { centerX: 64, centerY: 64, cellSize: 16 };
  const viewport = { width: 800, height: 600 };

  test('world cells project to integer-aligned screen cells and back', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    // The camera center cell lands mid-viewport.
    const { px, py } = projection.cellToScreen(64, 64);
    assert.ok(Math.abs(px + 8 - viewport.width / 2) <= 16, `center cell x near mid-viewport, got ${px}`);
    assert.ok(Math.abs(py + 8 - viewport.height / 2) <= 16, `center cell y near mid-viewport, got ${py}`);
    assert.equal(px, Math.round(px), 'integer pixel alignment');
    // Round trip: every screen pixel inside the cell maps back to it.
    for (const [dx, dy] of [[0, 0], [15, 15], [8, 3]]) {
      const cell = projection.cellAtScreen(px + dx, py + dy);
      assert.deepEqual(cell, { cellX: 64, cellY: 64 });
    }
    // Neighboring cells are exactly one cellSize apart (no drift).
    const next = projection.cellToScreen(65, 64);
    assert.equal(next.px - px, 16);
  });

  test('screen-to-world selection matches what is drawn at that pixel', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const entity = { x: 70.9, y: 60.2 };
    const cell = worldCellOf(entity, { width: 128, height: 128 });
    assert.deepEqual(cell, { cellX: 70, cellY: 60 });
    const { px, py } = projection.cellToScreen(cell.cellX, cell.cellY);
    assert.deepEqual(projection.cellAtScreen(px + 5, py + 5), cell);
  });

  test('entities clamped to the world border display in the last cell', () => {
    const world = { width: 128, height: 128 };
    assert.deepEqual(worldCellOf({ x: 128, y: 0 }, world), { cellX: 127, cellY: 0 });
    assert.deepEqual(worldCellOf({ x: 0, y: 128 }, world), { cellX: 0, cellY: 127 });
  });

  test('visible bounds cover the viewport plus margin', () => {
    const projection = createProjection(camera, viewport.width, viewport.height);
    const cells = projection.visibleCellBounds();
    assert.ok(cells.maxCellX - cells.minCellX >= viewport.width / camera.cellSize - 1);
    const bounds = projection.visibleWorldBounds(2);
    assert.equal(bounds.minX, cells.minCellX - 2);
    assert.equal(bounds.maxY, cells.maxCellY + 1 + 2);
  });

  test('occupantsInCell returns exactly the entities whose cell matches', () => {
    const world = { width: 128, height: 128 };
    const entities = [
      { id: 1, x: 10.2, y: 10.9 },
      { id: 2, x: 10.8, y: 10.1 },
      { id: 3, x: 11.0, y: 10.5 }, // next cell over
    ];
    assert.deepEqual(occupantsInCell(entities, 10, 10, world).map((entity) => entity.id), [1, 2]);
  });
});

describe('camera', () => {
  test('panning moves the center by whole cells and clamps to world bounds', () => {
    const camera = new Camera({ centerX: 5, centerY: 5, cellSize: 16 });
    camera.panByCells(3, -2);
    assert.equal(camera.centerX, 8);
    assert.equal(camera.centerY, 3);
    camera.panByCells(-100, -100);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.equal(camera.centerX, 0);
    assert.equal(camera.centerY, 0);
    camera.centerOn(999, 999);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.deepEqual([camera.centerX, camera.centerY], [128, 128]);
  });

  test('zoom steps through the fixed levels and stops at the ends', () => {
    const camera = new Camera({ cellSize: ZOOM_LEVELS[0] });
    assert.equal(camera.zoomOut(), false, 'cannot zoom below the smallest level');
    assert.equal(camera.zoomIn(), true);
    assert.equal(camera.cellSize, ZOOM_LEVELS[1]);
    const top = new Camera({ cellSize: ZOOM_LEVELS.at(-1) });
    assert.equal(top.zoomIn(), false, 'cannot zoom above the largest level');
  });

  test('anchored zoom keeps the anchor point in the same screen cell', () => {
    const camera = new Camera({ centerX: 64, centerY: 64, cellSize: 16 });
    const viewport = { width: 800, height: 600 };
    const anchor = { x: 80.5, y: 50.5 };
    const before = createProjection(camera, viewport.width, viewport.height);
    const screenBefore = before.cellToScreen(Math.floor(anchor.x), Math.floor(anchor.y));
    camera.zoomAt(anchor.x, anchor.y, 1);
    const after = createProjection(camera, viewport.width, viewport.height);
    // The world point under the old screen position must still be the anchor's cell.
    const cellAfter = after.cellAtScreen(screenBefore.px + 8, screenBefore.py + 8);
    assert.ok(Math.abs(cellAfter.cellX - Math.floor(anchor.x)) <= 1, `anchor drifted to ${cellAfter.cellX}`);
    assert.ok(Math.abs(cellAfter.cellY - Math.floor(anchor.y)) <= 1, `anchor drifted to ${cellAfter.cellY}`);
    assert.equal(camera.cellSize, 20);
  });

  test('cell size snaps to supported zoom levels', () => {
    assert.equal(new Camera({ cellSize: 15 }).cellSize, 14);
    assert.equal(Camera.snapCellSize(1000), ZOOM_LEVELS.at(-1));
  });

  test('no zoom level is smaller than a reliable click target', () => {
    // Every cell is selectable now, bare ground included, so a cell that is
    // hard to hit is a broken control rather than a merely small one.
    assert.equal(Math.min(...ZOOM_LEVELS), 10);
    assert.equal(Camera.snapCellSize(1), 10, 'snapping never drops below the floor');
  });

  test('pixel panning moves the camera opposite the drag, scaled by zoom', () => {
    const camera = new Camera({ centerX: 50, centerY: 50, cellSize: 10 });
    // Dragging right by one cell's width reveals what is to the left.
    camera.panByPixels(10, 0);
    assert.equal(camera.centerX, 49);
    // The same drag at double the zoom covers half the world distance.
    const zoomed = new Camera({ centerX: 50, centerY: 50, cellSize: 20 });
    zoomed.panByPixels(10, 0);
    assert.equal(zoomed.centerX, 49.5);
    // Fractional, so a drag does not stutter cell to cell.
    zoomed.panByPixels(0, 5);
    assert.equal(zoomed.centerY, 49.75);
  });
});

describe('the follow camera', () => {
  // The camera used to sit on the followed animal's float position while the
  // grid drew that animal at its floored cell, so every tick slid the whole map
  // by a fraction of a cell and jumped the glyph back the other way. These are
  // the two halves of the fix: a deadzone that answers "do not move" on most
  // ticks, and an eased glide for when it does.
  const VIEWPORT = { width: 800, height: 600 };
  const plan = (camera, target, options = {}) =>
    planFollow({
      camera,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      target,
      ...options,
    });

  test('an animal inside the box does not move the camera at all', () => {
    const camera = new Camera({ centerX: 50, centerY: 50, cellSize: 16 });
    // 800px / 16px = 50 cells across, so the box is 25 cells and its half is
    // 12.5. Anything nearer than that is the common case: no move.
    assert.equal(plan(camera, { x: 55.5, y: 45.5 }), null);
    assert.equal(plan(camera, { x: 62.4, y: 50.5 }), null);
  });

  test('an animal outside the box recentres on the cell it is drawn in', () => {
    const camera = new Camera({ centerX: 50, centerY: 50, cellSize: 16 });
    const move = plan(camera, cellCentreOf({ x: 63.2, y: 50.9 }));
    // The centre of cell 63, not 63.2 — following the float is what made the
    // map shift by a fraction of a cell on every single tick.
    assert.deepEqual([move.x, move.y], [63.5, 50.5]);
    assert.equal(move.snap, false);
  });

  test('the box is a share of the viewport, so zooming in narrows it', () => {
    const near = new Camera({ centerX: 50, centerY: 50, cellSize: 16 });
    const far = new Camera({ centerX: 50, centerY: 50, cellSize: 32 });
    const target = { x: 58.5, y: 50.5 }; // 8 cells out
    assert.equal(plan(near, target), null, '8 cells is inside the box at 16px');
    assert.ok(plan(far, target), '…and outside it at 32px, where half as much world is visible');
    assert.ok(followBox(32, VIEWPORT.width, VIEWPORT.height).halfX < followBox(16, VIEWPORT.width, VIEWPORT.height).halfX);
  });

  test('the box never reaches the edge of the viewport', () => {
    // A box the full width of the screen would let the animal sit half off it.
    const halfViewportCells = VIEWPORT.width / 16 / 2;
    assert.ok(followBox(16, VIEWPORT.width, VIEWPORT.height).halfX <= halfViewportCells - 1);
    // And the share is what it claims to be, at a zoom where nothing clamps.
    assert.equal(followBox(16, VIEWPORT.width, VIEWPORT.height).halfX, (VIEWPORT.width / 16) * FOLLOW_DEADZONE_FRACTION / 2);
  });

  test('a target beyond the world is clamped, and a move that clamps to nothing is not a move', () => {
    const camera = new Camera({ centerX: 0, centerY: 0, cellSize: 16 });
    const world = { width: 128, height: 128 };
    const move = plan(camera, { x: 200, y: 40 }, { world });
    assert.equal(move.x, 128, 'clamped to the world, not to where the target claimed to be');
    // Forcing a recentre when the camera is already on the target is the `C`
    // key pressed twice: no glide, no wasted frames.
    const centred = new Camera({ centerX: 10.5, centerY: 10.5, cellSize: 16 });
    assert.equal(plan(centred, { x: 10.5, y: 10.5 }, { world, ignoreDeadzone: true }), null);
  });

  test('a forced plan ignores the deadzone', () => {
    const camera = new Camera({ centerX: 50, centerY: 50, cellSize: 16 });
    assert.equal(plan(camera, { x: 52.5, y: 50.5 }), null);
    assert.deepEqual(
      (({ x, y }) => [x, y])(plan(camera, { x: 52.5, y: 50.5 }, { ignoreDeadzone: true })),
      [52.5, 50.5],
    );
  });

  test('a long jump is a snap, not a glide — measured on screen, not in cells', () => {
    // ⚠⚠ The regression this exists for: the threshold was 40 *cells*, so at the
    // 10px zoom floor an ordinary recentre cleared it and every routine follow
    // move took the teleport branch. The reported symptom was "zoomed far out,
    // the map re-adjusts almost instantly".
    // A move of a given share of the screen must be classed the same way at
    // every zoom, because that is the same move as far as anyone watching is
    // concerned. 0.6 of an 800px viewport is 48 cells at the 10px floor and 15
    // at 32px — under the old rule the first jumped and the second glided.
    const snapsAcrossScreen = (cellSize, screenFraction) => {
      const camera = new Camera({ centerX: 10, centerY: 10, cellSize });
      const cells = (VIEWPORT.height * screenFraction) / cellSize;
      return plan(camera, { x: 10.5, y: 10 + cells }).snap;
    };
    for (const cellSize of [10, 16, 32]) {
      assert.equal(snapsAcrossScreen(cellSize, 0.6), false, `half a screen is a pan, not a jump (${cellSize}px)`);
      assert.equal(snapsAcrossScreen(cellSize, 1.5), true, `a screen and a half is a jump (${cellSize}px)`);
    }
  });

  test('the same move on screen takes the same time at every zoom', () => {
    // A recentre is always about a quarter of the viewport, whatever the zoom —
    // so if it is paced per *cell* it is a different animation at every zoom
    // level. 150 screen pixels is 15 cells at the 10px floor and 4.7 at 32px.
    // ⚠ Deliberately inside both clamps: two durations that agree only because
    // they both hit `GLIDE_MAX_MS` would pass this test while proving nothing.
    const at10 = glideDuration(150 / 10, 10);
    const at32 = glideDuration(150 / 32, 32);
    assert.ok(at10 > GLIDE_MIN_MS && at10 < GLIDE_MAX_MS, `${at10}ms should be clear of the clamps`);
    assert.ok(Math.abs(at10 - at32) < 1, `${at10}ms vs ${at32}ms for the same 150px`);
    // …and twice the screen distance takes twice as long. ⚠ The band between
    // the clamps is narrow, so the two distances are derived from the constants
    // rather than written down: a doubling test that strays outside the band is
    // really a test of `GLIDE_MAX_MS`, and passes for the wrong reason.
    const shortPx = (GLIDE_MIN_MS / GLIDE_MS_PER_PIXEL) * 1.05;
    assert.ok(shortPx * 2 * GLIDE_MS_PER_PIXEL < GLIDE_MAX_MS, 'the clamps leave no room to test doubling');
    assert.ok(Math.abs(glideDuration((shortPx * 2) / 16, 16) - 2 * glideDuration(shortPx / 16, 16)) < 1);
  });

  test('a glide starts at its origin and ends exactly on its target', () => {
    const glide = startGlide(0, 0, 10, 20, 16);
    const start = glideAt(glide, 1000);
    assert.deepEqual([start.x, start.y, start.done], [0, 0, false]);
    const mid = glideAt({ ...glide, startMs: 1000 }, 1000 + glide.durationMs / 2);
    assert.ok(mid.x > 5, 'eased out: more than half the distance is covered in the first half');
    assert.ok(mid.x < 10);
    const end = glideAt({ ...glide, startMs: 1000 }, 1000 + glide.durationMs);
    // Exactly, not interpolated to within a rounding error: a camera stopping a
    // millionth of a cell short leaves the pixel offset one off forever.
    assert.deepEqual([end.x, end.y, end.done], [10, 20, true]);
  });

  test('a glide is paced by distance, within bounds', () => {
    assert.equal(glideDuration(0.5, 16), GLIDE_MIN_MS, 'a short hop does not crawl');
    assert.equal(glideDuration(1000, 16), GLIDE_MAX_MS, 'a long one does not become a tour');
    assert.ok(glideDuration(12, 16) > GLIDE_MIN_MS && glideDuration(12, 16) < GLIDE_MAX_MS);
  });

  test('the camera advances a glide on the frame clock, then stops costing frames', () => {
    const camera = new Camera({ centerX: 0, centerY: 0, cellSize: 16 });
    camera.glideTo(10, 0);
    assert.equal(camera.gliding, true);
    assert.equal(camera.advance(1000), true, 'the first frame stamps the start');
    assert.equal(camera.centerX, 0);
    camera.advance(1100);
    assert.ok(camera.centerX > 0 && camera.centerX < 10);
    camera.advance(2000);
    assert.equal(camera.centerX, 10);
    assert.equal(camera.gliding, false);
    assert.equal(camera.advance(3000), false, 'a settled camera costs no frames at all');
  });

  test('retargeting mid-glide continues from where the camera is now', () => {
    const camera = new Camera({ centerX: 0, centerY: 0, cellSize: 16 });
    camera.glideTo(10, 0);
    camera.advance(1000);
    camera.advance(1060);
    const midway = camera.centerX;
    assert.ok(midway > 0 && midway < 10);
    camera.glideTo(20, 0);
    camera.advance(1060);
    assert.equal(camera.centerX, midway, 'a restart from the original origin would jerk backwards');
    camera.advance(9000);
    assert.equal(camera.centerX, 20);
  });

  test('every way of moving the camera by hand cancels the glide', () => {
    // Six call sites move this camera; a glide surviving any of them fights the
    // viewer for the next fifth of a second.
    for (const move of [
      (camera) => camera.panByPixels(10, 0),
      (camera) => camera.panByCells(1, 0),
      (camera) => camera.centerOn(1, 1),
      (camera) => camera.zoomIn(),
      (camera) => camera.zoomOut(),
      (camera) => camera.zoomAt(5, 5, 1),
    ]) {
      const camera = new Camera({ centerX: 0, centerY: 0, cellSize: 16 });
      camera.glideTo(50, 50);
      move(camera);
      assert.equal(camera.gliding, false, `${move} left a glide running`);
    }
  });

  test('clamping to the world does not cancel a glide', () => {
    // Its endpoints are already clamped, so every eased point between them is
    // in bounds; cancelling here would stop the follow camera dead every tick,
    // since clamping is what every other camera mover does next.
    const camera = new Camera({ centerX: 5, centerY: 5, cellSize: 16 });
    camera.glideTo(20, 20);
    camera.clampToWorld({ width: 128, height: 128 });
    assert.equal(camera.gliding, true);
  });
});

describe('inspector structure signature (the per-tick rebuild guard)', () => {
  // The panel is re-rendered on every store change — once per authoritative
  // tick. A full rebuild at that cadence destroys scroll position, text
  // selection, and section open/closed state, so the signature decides whether
  // the markup can be patched in place instead. These tests are the acceptance
  // criterion for that: the shape must be stable across an ordinary tick, and
  // must move the moment a row could appear or vanish.
  const store = { followedEntityId: null, eventsForEntity: () => [] };
  const selection = { cellX: 4, cellY: 7, entityIds: [1], activeId: 1 };
  const animal = (overrides = {}) => ({
    id: 1,
    x: 4.2,
    y: 7.9,
    heading: 0.5,
    age: 100,
    bodyMass: 30,
    energyFraction: 0.5,
    healthFraction: 1,
    alive: true,
    lifeStage: 'adult',
    action: 'wander',
    ...overrides,
  });
  const cell = { inWorld: true, terrain: { name: 'ground' }, feature: null, disturbances: [] };
  const sign = (active, detail = null, groundCell = cell, sel = selection) =>
    structureSignature(store, sel, active, detail, groundCell);

  test('an ordinary tick does not change the shape', () => {
    // Everything a delta moves: position, age, energy, health, hydration.
    const before = sign(animal());
    const after = sign(animal({ x: 5.1, y: 8.4, age: 101, energyFraction: 0.42, healthFraction: 0.9 }));
    assert.equal(before, after, 'moving values must patch in place, never rebuild');
  });

  test('an action changing does not rebuild, but gaining one does', () => {
    // The action row exists either way, so switching action is a patch...
    assert.equal(sign(animal({ action: 'eat' })), sign(animal({ action: 'flee' })));
    // ...but an animal that had no action row now needs one.
    assert.notEqual(sign(animal({ action: undefined })), sign(animal({ action: 'eat' })));
  });

  test('an optional row appearing changes the shape', () => {
    // Patching a node that does not exist yet is how this breaks.
    assert.notEqual(sign(animal()), sign(animal({ hydrationFraction: 0.8 })));
    assert.notEqual(sign(animal()), sign(animal({ lifeStage: undefined })));
    assert.notEqual(sign(animal()), sign(animal({ sex: 'female' })));
  });

  test('a new selection, occupant, or inspection payload changes the shape', () => {
    assert.notEqual(sign(animal()), sign(animal(), null, cell, { ...selection, cellX: 9 }));
    assert.notEqual(sign(animal()), sign(animal(), null, cell, { ...selection, entityIds: [1, 2] }));
    assert.notEqual(sign(animal()), sign(animal(), { entity: { id: 1 }, tick: 12 }));
  });

  test('a fresher inspection payload does NOT change the shape', () => {
    // This is what makes B5's polling viable: re-fetching the same animal's
    // inspection every couple of seconds brings new *numbers* on the same rows,
    // and rebuilding for that would throw away scroll position and collapse
    // every section the viewer had opened. New numbers patch; new rows rebuild.
    assert.equal(
      sign(animal(), { entity: { id: 1 }, tick: 12 }),
      sign(animal(), { entity: { id: 1 }, tick: 13 }),
    );
    // ...but a payload that changes which rows exist still rebuilds.
    assert.notEqual(
      sign(animal(), { entity: { id: 1, edibleMass: 0 }, tick: 12 }),
      sign(animal(), { entity: { id: 1, edibleMass: 4.2 }, tick: 12 }),
    );
    assert.notEqual(
      sign(animal(), { entity: { id: 1, reproState: { gestating: true } }, tick: 12 }),
      sign(animal(), { entity: { id: 1, reproState: { gestating: false, lastMatedTick: 9 } }, tick: 12 }),
    );
  });

  test('a section appearing or vanishing changes the shape', () => {
    // Section *contents* are patched in place, so the id set has to be part of
    // the shape — otherwise a new section would have nowhere to be written.
    const withInjury = { injuries: [{ kind: 'gash', severity: 0.3, tick: 4 }], impairment: 0.1 };
    const detailSign = (detail) =>
      structureSignature(store, selection, animal(), { entity: { id: 1, ...detail }, tick: 12 }, cell,
        describeSections({ id: 1, ...detail }, animal()).map((s) => s.id));
    assert.notEqual(detailSign({}), detailSign(withInjury));
    assert.equal(detailSign(withInjury), detailSign(withInjury));
  });

  test('ground changing under a stationary selection changes the shape', () => {
    // Grass grows and fires arrive while the selection sits still.
    assert.notEqual(sign(animal()), sign(animal(), null, { ...cell, feature: { kind: 'trail', wear: 0.5 } }));
    assert.notEqual(sign(animal()), sign(animal(), null, { ...cell, disturbances: [{ kind: 'fire' }] }));
  });

  test('an empty cell is a stable shape too', () => {
    const empty = { cellX: 4, cellY: 7, entityIds: [], activeId: null };
    assert.equal(sign(null, null, cell, empty), sign(null, null, cell, empty));
    assert.notEqual(sign(null, null, cell, empty), sign(animal()));
  });
});

describe('inspector sections (progressive disclosure)', () => {
  // Sections are what the tooltip collapses. A formatter whose data the
  // protocol did not send must produce no section at all — an empty expandable
  // row is worse than an absent one, and inventing a field is worse than both.
  const ids = (sections) => sections.map((s) => s.id);

  test('an entity with no inspection payload has no sections', () => {
    assert.deepEqual(describeSections(null, { action: 'wander' }), []);
  });

  test('only the sections the protocol actually populated appear', () => {
    const detail = {
      injuries: [{ kind: 'gash', severity: 0.4, tick: 12 }],
      impairment: 0.2,
      memories: [{ kind: 'food', cellX: 3, cellY: 4, strength: 0.8, tick: 9 }],
    };
    assert.deepEqual(ids(describeSections(detail, null)), ['injuries', 'memories']);
  });

  test('recent events become a section, and no events becomes none', () => {
    assert.deepEqual(ids(describeSections(null, null, [{ tick: 3, type: 'entity.fed' }])), ['events']);
    assert.deepEqual(ids(describeSections(null, null, [])), []);
  });

  test('section ids are unique and stable, since they key the remembered open-set', () => {
    const detail = {
      injuries: [{ kind: 'gash', severity: 0.4, tick: 1 }],
      impairment: 0.1,
      memories: [{ kind: 'water', cellX: 1, cellY: 1, strength: 0.5, tick: 1 }],
      traits: { size: 1.1 },
      genome: { size: [1.0, 1.2] },
      genotype: { size: 1.1 },
      disease: { state: 'infectious', infectious: true, severity: 0 },
      social: { groupId: 4, dominance: 12 },
      territory: { homeRange: { x: 1, y: 2, radius: 3 } },
      migration: { drift: { heading: 0, strength: 0.4 } },
      mateChoice: { choosiness: 0.5, preference: { trait: 'size' } },
      perception: { radius: 8, animalCount: 2 },
      utilityBreakdown: { eat: 0.7 },
      action: 'eat',
    };
    const sections = describeSections(detail, { action: 'eat' }, [{ tick: 2, type: 'entity.moved' }]);
    assert.equal(new Set(ids(sections)).size, sections.length, `duplicate ids in ${ids(sections)}`);
    // Every section carries a title and a non-empty body, or it should not exist.
    for (const entry of sections) {
      assert.ok(entry.title.length > 0, `${entry.id} has no title`);
      assert.ok(entry.body.length > 0, `${entry.id} has an empty body`);
    }
  });

  test('the utilities highlight follows the inspection tick, not the live action', () => {
    // The utility numbers were computed on the inspection tick, so highlighting
    // an action the animal has since switched to would caption them wrongly.
    const detail = { utilityBreakdown: { eat: 0.9, flee: 0.2 }, action: 'eat' };
    const [utilities] = describeSections(detail, { action: 'flee' });
    assert.match(utilities.body, /▸ eat/);
    assert.doesNotMatch(utilities.body, /▸ flee/);
  });
});

describe('legend', () => {
  // The legend's whole reason for being generated rather than written is that a
  // hand-maintained one goes stale the first time a species is added. These
  // tests are that guarantee: every registry entry must reach the legend.
  const allEntries = () => describeLegend().flatMap((group) => group.entries);

  test('every species reaches the legend, showing its young/grown age case', () => {
    for (const [speciesId, appearance] of Object.entries(SPECIES_APPEARANCE)) {
      const entry = allEntries().find((e) => e.label === appearance.label);
      assert.ok(entry, `${speciesId} is missing from the legend`);
      // Case is age: the species is shown in both its lowercase (young) and
      // UPPERCASE (grown) forms.
      assert.ok(entry.glyph.includes(appearance.glyph), `${speciesId} should show its young glyph`);
      assert.ok(
        entry.glyph.includes(appearance.glyph.toUpperCase()),
        `${speciesId} should show its grown glyph`,
      );
    }
  });

  test('every terrain, feature, disturbance, and memory kind reaches the legend', () => {
    const labels = new Set(allEntries().map((e) => e.label));
    for (const name of Object.keys(TERRAIN_APPEARANCE)) {
      if (name === 'unknown' || name === 'outOfBounds') continue; // fallbacks, not terrain
      assert.ok(labels.has(name), `terrain "${name}" is missing from the legend`);
    }
    for (const kind of Object.keys(FEATURE_APPEARANCE)) {
      assert.ok(labels.has(kind), `feature "${kind}" is missing from the legend`);
    }
    for (const kind of Object.keys(DISTURBANCE_APPEARANCE)) {
      assert.ok(labels.has(kind), `disturbance "${kind}" is missing from the legend`);
    }
    for (const kind of Object.keys(MEMORY_APPEARANCE)) {
      assert.ok(labels.has(`remembered ${kind}`), `memory "${kind}" is missing from the legend`);
    }
  });

  test('every carcass decay stage reaches the legend', () => {
    const labels = new Set(allEntries().map((e) => e.label));
    for (const appearance of CARCASS_DECAY_APPEARANCE) {
      assert.ok(labels.has(appearance.label), `carcass stage "${appearance.label}" is missing`);
    }
  });

  test('every status reaches the legend, with the shape the grid draws', () => {
    // A status added to the grid and forgotten here is a mark nobody can read.
    const group = describeLegend().find((g) => g.title === 'Status');
    assert.equal(group.entries.length, STATUS_APPEARANCE.length);
    for (const status of STATUS_APPEARANCE) {
      const entry = group.entries.find((e) => e.label === status.label);
      assert.ok(entry, `${status.id} is missing from the legend`);
      assert.equal(entry.colorToken, status.colorToken);
      // ⚠ Against the shared table rather than a literal, so a new shape with no
      // row there fails here instead of silently falling back to the dot.
      assert.ok(STATUS_SHAPE_GLYPHS[status.shape], `shape "${status.shape}" has no legend character`);
      assert.equal(entry.glyph, STATUS_SHAPE_GLYPHS[status.shape]);
    }
  });

  test('no row carries a note — the legend is a key, not a manual', () => {
    for (const entry of allEntries()) {
      assert.ok(!entry.note, `${entry.label} still carries "${entry.note}"`);
    }
  });

  test('the female row shows both cases, because the two channels are independent', () => {
    // A single `g` there read as "the female form is the young one", which is
    // the one reading case-is-age and italic-is-sex being separate rules out.
    const group = describeLegend().find((g) => g.title === 'Age & sex');
    const female = group.entries.find((entry) => entry.label === 'female');
    assert.equal(female.italic, true);
    assert.equal(female.glyph, group.entries.find((entry) => entry.label === 'young / grown').glyph);
    assert.match(female.glyph, /^[a-z]\/[A-Z]$/);
  });

  test('every legend colour is a real Dracula token', () => {
    // The legend renders colours as `var(--dracula-<token>)`, so a token that
    // is not in the palette silently renders as inherited text.
    for (const entry of allEntries()) {
      assert.ok(DRACULA_COLORS[entry.colorToken], `unknown colour token "${entry.colorToken}" for ${entry.label}`);
    }
  });
});

describe('bars do not break across lines', () => {
  // A histogram or sparkline is one "word" to the browser, and an ordinary
  // space inside it is a line-break opportunity — so a bar with an empty bin
  // wrapped there and the rest of the distribution appeared on the next line,
  // reading as two bars. Both bar builders pad with U+00A0 instead.
  test('no rung of the histogram ramp is a breaking space', () => {
    assert.ok(BAR_LEVELS.length > 1);
    for (const rung of BAR_LEVELS) {
      assert.equal(rung.length, 1, `a rung must be one character, got ${JSON.stringify(rung)}`);
      assert.ok(!/\s/.test(rung) || rung === '\u00a0', `rung ${JSON.stringify(rung)} can break a line`);
    }
    assert.equal(BAR_LEVELS[0], '\u00a0', 'the empty rung is the one that used to be a plain space');
  });

  test("the inspector's centred trait bar pads with no-break spaces", () => {
    const detail = { traits: { speed: 1.4, size: 0.6 }, traitReference: { speed: 1, size: 1 } };
    const body = describeSections(detail, null).find((section) => section.id === 'traits')?.body ?? '';
    assert.ok(body.includes('█'), 'a trait bar was drawn');
    assert.ok(body.includes('\u00a0'), 'the empty side of the bar is padded with U+00A0');
    // The bar itself — between the first block and the last — holds no ordinary
    // space, which is the character that would let it wrap.
    const bar = body.slice(body.indexOf('│') - 6, body.indexOf('│') + 7);
    assert.ok(!bar.includes(' '), `the bar must not contain a plain space: ${JSON.stringify(bar)}`);
  });
});

describe('entity references', () => {
  test('ids become buttons carrying the entity id', () => {
    assert.match(entityRef(42), /data-entity="42"/);
    assert.match(entityRef(42), /#42/);
  });

  test('event text is escaped before it is linkified, not after', () => {
    // Event lines legitimately contain `<` and `>` — `<until t1205>`, `→`.
    // Linkifying first would let an event's own punctuation become markup.
    const line = '*! fire at 3,4 <until t1205> hit #7';
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = linkifyIds(escaped);
    assert.ok(!html.includes('<until'), 'raw angle brackets must not survive as markup');
    assert.match(html, /&lt;until t1205&gt;/);
    assert.match(html, /data-entity="7"/);
  });

  test('a tick reference is not mistaken for an entity id', () => {
    // `t1205` has no `#`, so it must stay plain text.
    assert.doesNotMatch(linkifyIds('ended at t1205'), /data-entity/);
  });

  test('given an appearance, a reference wears the animal\'s own glyph', () => {
    const gazelle = resolveAppearance({ kind: 'animal', speciesId: 'herbivore.gazelle', alive: true, sex: 'female' });
    const html = entityRef(412, gazelle);
    assert.match(html, />g412</, 'the species glyph replaces the #');
    assert.match(html, /data-entity="412"/);
    assert.match(html, /font-style: italic/, 'the sex channel carries over to the reference');
    // ⚠ The colour must ride on the custom property, never on `color` — an
    // inline `color` outranks the stylesheet and the cyan hover would be dead.
    assert.match(html, /--ref-color: var\(--dracula-yellow\)/);
    const declarations = html.match(/style="([^"]*)"/)[1].split(';').map((part) => part.split(':')[0].trim());
    assert.ok(!declarations.includes('color'), `an inline color would kill the hover: ${declarations}`);
  });

  test('an id the renderer can no longer place keeps its #', () => {
    // An animal that died leaves its number behind in the log, and nothing says
    // what it looked like — so the reference is honest rather than guessing.
    assert.match(entityRef(7, null), />#7</);
    assert.match(linkifyIds('x died #7', () => null), />#7</);
  });

  test('a resolver puts a glyph on every id in a line', () => {
    const leopard = resolveAppearance({ kind: 'animal', speciesId: 'predator.leopard', alive: true, lifeStage: 'adult' });
    const html = linkifyIds('X killed #7 by #9', () => leopard);
    assert.equal(html.match(/>P\d+</g).length, 2);
  });
});

describe('auto-pause watchlist', () => {
  // Renderer policy over authoritative output: the engine emits what it always
  // did, and the renderer decides whether that is worth stopping for.
  const enabled = (...ids) => new Set(ids);

  test('nothing watched means nothing matches, whatever happens', () => {
    const events = [{ type: 'entity.killed', entityId: 3 }, { type: 'entity.born', entityId: 9 }];
    assert.equal(matchWatched(events, new Set()), null);
    assert.equal(matchWatched(events, null), null);
  });

  test('a watched event matches and reports which watchable caught it', () => {
    const match = matchWatched([{ type: 'entity.killed', entityId: 3 }], enabled('predation'));
    assert.equal(match.watchable.id, 'predation');
    assert.equal(match.event.entityId, 3);
  });

  test('an unwatched event is ignored even in a busy batch', () => {
    const events = [
      { type: 'entity.moved', entityId: 1 },
      { type: 'entity.fed', entityId: 2 },
      { type: 'entity.born', entityId: 3 },
    ];
    assert.equal(matchWatched(events, enabled('predation')), null);
    assert.equal(matchWatched(events, enabled('birth')).event.entityId, 3);
  });

  test('one watchable can cover several event types', () => {
    // A contest over a mate and a contest over ground are the same thing to a
    // viewer, so they are one checkbox.
    assert.equal(matchWatched([{ type: 'entity.disputed' }], enabled('conflict')).watchable.id, 'conflict');
    assert.equal(matchWatched([{ type: 'entity.contested' }], enabled('conflict')).watchable.id, 'conflict');
  });

  test('the first watched event wins, in the order the engine emitted them', () => {
    // A tick can carry a kill and the death it caused; picking between them
    // would invent a hierarchy the engine does not have.
    const events = [{ type: 'entity.killed', entityId: 5 }, { type: 'entity.died', entityId: 5 }];
    assert.equal(matchWatched(events, enabled('predation', 'death')).watchable.id, 'predation');
    assert.equal(matchWatched([...events].reverse(), enabled('predation', 'death')).watchable.id, 'death');
  });

  test('every watchable has a unique id and at least one event type', () => {
    // The id keys the remembered set and the checkbox, so a collision would
    // silently tie two toggles together.
    const ids = WATCHABLE.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids}`);
    for (const entry of WATCHABLE) {
      assert.ok(entry.types.length > 0, `${entry.id} watches nothing`);
      assert.ok(entry.label.length > 0, `${entry.id} has no label`);
    }
  });

  test('no event type is claimed by two watchables', () => {
    // Overlapping coverage would make which checkbox "caught" an event depend
    // on declaration order rather than on what the viewer asked for.
    const seen = new Map();
    for (const entry of WATCHABLE) {
      for (const type of entry.types) {
        assert.equal(seen.get(type), undefined, `${type} claimed by both ${seen.get(type)} and ${entry.id}`);
        seen.set(type, entry.id);
      }
    }
  });

  test('watched types are real event types the engine emits', () => {
    // Guards against a typo silently creating a checkbox that can never fire.
    const emitted = new Set([
      'entity.killed', 'entity.escaped', 'entity.courted', 'entity.mated', 'entity.born',
      'entity.died', 'environment.disturbed', 'entity.sickened', 'entity.contested',
      'entity.disputed', 'entity.injured', 'entity.migrated', 'environment.changed',
    ]);
    for (const entry of WATCHABLE) {
      for (const type of entry.types) {
        assert.ok(emitted.has(type), `"${type}" is not an event type this renderer expects`);
      }
    }
  });
});

describe('event log filters', () => {
  // One checkbox per event type, so the question "why am I not seeing X" always
  // has an answer in the list rather than in the source.
  test('every event type the engine emits has a filter option', () => {
    // Imported rather than restated: the renderer cannot import the protocol
    // (§3), so this test is the mechanism that keeps its copy honest.
    const emitted = Object.values(EventTypes);
    const filtered = new Set(EVENT_CATALOG.map((entry) => entry.type));
    for (const type of emitted) {
      assert.ok(filtered.has(type), `"${type}" is emitted by the engine but has no filter option`);
    }
    // And nothing in the catalog is a type the engine cannot emit — a checkbox
    // that can never match is worse than a missing one, since it looks like it
    // works.
    for (const entry of EVENT_CATALOG) {
      if (entry.type === OTHER_EVENTS) continue;
      assert.ok(emitted.includes(entry.type), `"${entry.type}" is not an event type the engine emits`);
    }
  });

  test('catalog entries are unique, labelled, and grouped', () => {
    const types = EVENT_CATALOG.map((entry) => entry.type);
    assert.equal(new Set(types).size, types.length, `duplicate types in ${types}`);
    for (const entry of EVENT_CATALOG) {
      assert.ok(entry.label.length > 0, `${entry.type} has no label`);
      assert.ok(entry.group.length > 0, `${entry.type} has no group`);
      assert.ok([LASTING, PASSING].includes(entry.retention), `${entry.type} has no retention tier`);
    }
  });

  test('every event type has a one-character prefix, and no two share one', () => {
    // The mark at the head of a line is the only part of it that is scannable
    // in a column of a hundred, so it has to be exactly one column wide and it
    // has to mean one thing. Both halves were broken before this: `!!` and `++`
    // and `::` were two columns, and `+` meant *both* a birth and an injury
    // healing while `!` meant both a wound and an alarm call.
    const prefixes = EVENT_CATALOG.map((entry) => entry.prefix);
    for (const entry of EVENT_CATALOG) {
      assert.equal(
        typeof entry.prefix === 'string' && [...entry.prefix].length,
        1,
        `${entry.type} has a prefix of ${JSON.stringify(entry.prefix)}, which is not one character`,
      );
      assert.notEqual(entry.prefix.trim(), '', `${entry.type} has a blank prefix`);
    }
    assert.equal(
      new Set(prefixes).size,
      prefixes.length,
      `two event types share a prefix in ${prefixes.join(' ')}`,
    );
  });

  test('a ratio drops its leading zero; a quantity keeps its leading digit', () => {
    // `(.63 vs .58)` rather than `(0.63 vs 0.58)`: every one of these is below
    // one, so the digit is two columns per number that say nothing, in a panel
    // whose lines are already clipped at the column edge.
    const courted = describeEvent({
      type: 'entity.courted', entityId: 83, candidateId: 108, accepted: true, quality: 0.63, threshold: 0.58,
    });
    assert.ok(courted.endsWith('(.63 vs .58)'), courted);
    assert.ok(describeEvent({ type: 'entity.mated', entityId: 1, partnerId: 2, quality: 0.7 }).endsWith('(.70)'));
    assert.ok(describeEvent({ type: 'entity.injured', entityId: 1, injury: 'gash', severity: 0.4 }).includes('gash .40'));
    // ⚠ A fed amount is kilograms, not a ratio — `+0.70` and `+1.01` have to
    // line up, and the `0` is what says which side of one it is on.
    assert.ok(describeEvent({ type: 'entity.fed', entityId: 1, amount: 0.7 }).includes('+0.70'));
  });

  test('a log line is its type\'s prefix, and an unnamed type gets the catch-all\'s', () => {
    assert.equal(prefixFor('entity.sickened'), '"');
    assert.ok(describeEvent({ type: 'entity.sickened', entityId: 7 }).startsWith('" sickened'));
    // A newer engine's event reads as "something this build cannot name" rather
    // than borrowing a mark that means something else.
    assert.equal(prefixFor('entity.somethingNewInV30'), prefixFor(OTHER_EVENTS));
    assert.ok(describeEvent({ type: 'entity.somethingNewInV30', entityId: 7 }).startsWith(prefixFor(OTHER_EVENTS)));
  });

  test('the default filter is births and deaths, and both are real types', () => {
    assert.deepEqual([...DEFAULT_EVENT_FILTER], ['entity.born', 'entity.died']);
    for (const type of DEFAULT_EVENT_FILTER) {
      assert.ok(
        EVENT_CATALOG.some((entry) => entry.type === type),
        `${type} is not in the catalog`,
      );
    }
  });

  test('an unrecognized event type falls under the catch-all, not silence', () => {
    // A newer engine's event must be reachable through some checkbox, or an
    // older renderer hides it with no way to ask for it.
    assert.equal(filterIdFor('entity.born'), 'entity.born');
    assert.equal(filterIdFor('entity.somethingNewInV29'), OTHER_EVENTS);
  });

  test('only the per-tick chatter is passing; every milestone lasts', () => {
    // Retention is a frequency judgement (measured: the five passing types were
    // 99.2% of 127 464 events over 1000 demo ticks), so getting one wrong means
    // either losing milestones or holding a hundred thousand move events.
    const passing = EVENT_CATALOG.filter((entry) => entry.retention === PASSING).map((entry) => entry.type);
    assert.deepEqual(passing.sort(), [
      'entity.alarmed',
      'entity.fed',
      'entity.moved',
      'entity.provisioned',
      'environment.feature',
    ]);
    assert.equal(isLastingEvent('entity.born'), true);
    assert.equal(isLastingEvent('entity.moved'), false);
    // Unknown types are presumed rare and kept, since both tiers are capped.
    assert.equal(isLastingEvent('entity.somethingNewInV29'), true);
  });
});

describe('map layers', () => {
  test('every layer has an id, a label, and a note saying what it draws', () => {
    const ids = new Set();
    for (const layer of MAP_LAYERS) {
      assert.ok(layer.id && !ids.has(layer.id), `duplicate or missing layer id "${layer.id}"`);
      ids.add(layer.id);
      assert.ok(layer.label, `${layer.id} has no label`);
      assert.ok(layer.note, `${layer.id} has no note`);
      assert.equal(typeof layer.defaultEnabled, 'boolean');
    }
    assert.ok(ids.has('social'));
  });

  test('nothing stored means the defaults, and every layer defaults to off', () => {
    // A layer earns the screen when it is asked for: something drawn over every
    // animal that nobody switched on is noise the first time it is seen.
    assert.deepEqual([...resolveEnabledLayers(null)], []);
    assert.deepEqual([...resolveEnabledLayers(undefined)], []);
    for (const layer of MAP_LAYERS) assert.equal(layer.defaultEnabled, false);
  });

  test('an empty stored set means off, not "use the defaults"', () => {
    // The event filter's rule, for the same reason: a viewer who switched
    // everything off has said something, and honouring it is the difference
    // between a stored preference and a suggestion.
    assert.deepEqual([...resolveEnabledLayers([])], []);
    assert.deepEqual([...resolveEnabledLayers(['social'])], ['social']);
  });

  test('a layer id this build has never heard of is dropped, not carried', () => {
    assert.deepEqual([...resolveEnabledLayers(['social', 'weather-from-a-later-version'])], ['social']);
  });
});

describe('the social layer', () => {
  const animal = (cellX, cellY, overrides = {}) => ({
    id: cellX * 1000 + cellY,
    kind: 'animal',
    alive: true,
    speciesId: 'herbivore.gazelle',
    x: cellX + 0.5,
    y: cellY + 0.5,
    groupId: null,
    groupRecordId: null,
    ...overrides,
  });
  const world = { width: 60, height: 60 };
  const cells = (region) => [...region].length;

  describe('the registry', () => {
    test('no two kinds of group share a colour, and every colour is real', () => {
      // The same rule the statuses keep, and for the same reason: colour is what
      // makes one outline distinguishable from another inside it, and two kinds
      // in one colour would make the overlap unreadable — which is the whole
      // feature.
      const seen = new Map();
      for (const [kind, appearance] of Object.entries(SOCIAL_GROUP_APPEARANCE)) {
        assert.ok(DRACULA_COLORS[appearance.colorToken], `${kind} uses unknown colour "${appearance.colorToken}"`);
        assert.ok(!seen.has(appearance.colorToken), `${kind} shares ${appearance.colorToken} with ${seen.get(appearance.colorToken)}`);
        seen.set(appearance.colorToken, kind);
        assert.ok(appearance.label, `${kind} has no label`);
      }
    });

    test('the herd label runs outside every record, because that is the containment', () => {
      // A band is part of a herd, never the other way round — so the label takes
      // the outer ring and everything else nests inside it.
      assert.equal(SOCIAL_GROUP_APPEARANCE.herd.ring, 0);
      for (const [kind, appearance] of Object.entries(SOCIAL_GROUP_APPEARANCE)) {
        if (kind === 'herd') continue;
        assert.equal(appearance.ring, 1, `${kind} should nest inside the herd label`);
      }
    });

    test('a species naming its own group gets it; anything else is a "group"', () => {
      assert.equal(recordGroupKind('predator.lion'), 'pride');
      assert.equal(recordGroupKind('scavenger.hyena'), 'clan');
      assert.equal(recordGroupKind('herbivore.zebra'), 'band');
      // A roster this build has never seen is outlined and nameable rather than
      // invisible — the same fallback `speciesLabel` makes one level up.
      assert.equal(recordGroupKind('predator.wildDogFromALaterVersion'), 'group');
      assert.ok(SOCIAL_GROUP_APPEARANCE[recordGroupKind('anything')], 'the fallback kind is in the registry');
    });
  });

  describe('membership', () => {
    test('an animal in a herd and a band is in two groups at once', () => {
      // The overlap is the point: the label is who it is standing with, the
      // record is who it belongs to, and an animal has both.
      const zebra = animal(5, 5, { speciesId: 'herbivore.zebra', groupId: 12, groupRecordId: 3 });
      assert.deepEqual(membershipsOf(zebra), [
        { key: 'herd:herbivore.zebra:12', kind: 'herd' },
        { key: 'record:3', kind: 'band' },
      ]);
    });

    test('a herd label is keyed by species as well as by id', () => {
      // Labels are conspecific but the id is an animal's id, so keying on the id
      // alone could enrol a gazelle into a wildebeest's outline.
      const [gazelleHerd] = membershipsOf(animal(1, 1, { groupId: 7 }));
      const [wildebeestHerd] = membershipsOf(animal(2, 2, { speciesId: 'herbivore.wildebeest', groupId: 7 }));
      assert.notEqual(gazelleHerd.key, wildebeestHerd.key);
    });

    test('an unattached animal is in nothing', () => {
      assert.deepEqual(membershipsOf(animal(1, 1)), []);
    });
  });

  describe('the region a bubble encloses', () => {
    test('one animal is a padded square, so the border clears its glyph', () => {
      const region = outlineRegion([{ cellX: 10, cellY: 10 }], world);
      assert.equal(cells(region), 9, 'three by three around the animal');
    });

    test('two animals two cells apart are one blob, with no arm between them', () => {
      const region = outlineRegion([{ cellX: 10, cellY: 10 }, { cellX: 12, cellY: 10 }], world);
      const loops = traceOutline(region);
      assert.equal(loops.length, 1, 'the padding merged them');
      assert.equal(cells(region), 15, 'a 5x3 block');
    });

    test('an outlying animal is reached by a one-cell arm, not by a bigger bubble', () => {
      const region = outlineRegion([{ cellX: 10, cellY: 10 }, { cellX: 11, cellY: 10 }, { cellX: 25, cellY: 18 }], world);
      const loops = traceOutline(region);
      assert.equal(loops.length, 1, 'the arm makes it one outline');
      // The two padded squares are 12 and 9 cells; everything else is corridor,
      // and a corridor is one cell wide by construction.
      const corridor = cells(region) - 12 - 9;
      assert.ok(corridor > 0 && corridor <= 15 + 8, `an arm of ${corridor} cells is one cell wide`);
    });

    test('⚠ an animal further than the corridor cap keeps its outline and loses its arm', () => {
      // A frame budget, not a nicety: a dispersing animal can be most of a map
      // away, and an unbounded arm would trace hundreds of cells for a group
      // nobody is looking at. Two loops in one colour is also the more honest
      // picture of an animal that is nowhere near its clan.
      const far = MAX_CORRIDOR_CELLS + 10;
      const wide = { width: 5 + far + 20, height: 60 };
      const region = outlineRegion([{ cellX: 5, cellY: 5 }, { cellX: 6, cellY: 5 }, { cellX: 5 + far, cellY: 5 }], wide);
      assert.equal(traceOutline(region).length, 2, 'the far animal is its own island');
    });

    test('a ring of animals is one bubble, not a donut', () => {
      // A gap in the middle of a herd is still the middle of the herd; drawing it
      // as a second loop reads as a hole in the group.
      const ring = [];
      for (let angle = 0; angle < 12; angle += 1) {
        ring.push({
          cellX: 30 + Math.round(5 * Math.cos((angle * Math.PI) / 6)),
          cellY: 30 + Math.round(5 * Math.sin((angle * Math.PI) / 6)),
        });
      }
      assert.equal(traceOutline(outlineRegion(ring, world)).length, 1);
    });

    test('a bubble never leaves the world, however close to the edge the animals are', () => {
      const region = outlineRegion([{ cellX: 0, cellY: 0 }], world);
      assert.equal(cells(region), 4, 'a corner animal gets the quarter of its square that exists');
    });
  });

  describe('tracing an outline', () => {
    test('one cell traces one closed loop of four corners', () => {
      const loops = traceOutline(outlineRegion([{ cellX: 3, cellY: 4 }], world, { padding: 0 }));
      assert.deepEqual(loops, [[
        { x: 3, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]]);
    });

    test('every loop is closed, axis-aligned, and turns at every point it keeps', () => {
      const region = outlineRegion([{ cellX: 10, cellY: 10 }, { cellX: 14, cellY: 13 }], world);
      for (const loop of traceOutline(region)) {
        assert.ok(loop.length >= 4 && loop.length % 2 === 0, `a rectilinear loop has an even number of corners`);
        for (let i = 0; i < loop.length; i += 1) {
          const current = loop[i];
          const next = loop[(i + 1) % loop.length];
          const straight = current.x === next.x || current.y === next.y;
          assert.ok(straight, 'every edge is horizontal or vertical');
          assert.ok(current.x !== next.x || current.y !== next.y, 'no zero-length edge');
        }
      }
    });

    test('a loop is wound with the region on its right, which is what inset relies on', () => {
      // The winding is not decoration: `insetLoop` moves each edge to the right
      // of travel, so a loop wound the other way would inflate the bubble
      // instead of tightening it — and a hole, which *is* wound the other way,
      // needs exactly that opposite treatment.
      const [loop] = traceOutline(outlineRegion([{ cellX: 3, cellY: 4 }], world, { padding: 0 }));
      const inset = insetLoop(loop, 0.25);
      const width = Math.max(...inset.map((p) => p.x)) - Math.min(...inset.map((p) => p.x));
      assert.ok(width < 1, `inset shrank the square to ${width}`);
      assert.deepEqual(inset[0], { x: 3.25, y: 4.25 });
    });

    test('a zero inset is the loop itself, and a short loop is left alone', () => {
      const [loop] = traceOutline(outlineRegion([{ cellX: 1, cellY: 1 }], world, { padding: 0 }));
      assert.equal(insetLoop(loop, 0), loop);
      assert.deepEqual(insetLoop([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2), [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    });
  });

  describe('describing every group on the map', () => {
    test('a herd and the band inside it are two outlines, in two colours, on two rings', () => {
      // The headline claim: an animal can be wrapped in more than one outline,
      // because the engine models more than one kind of belonging.
      const band = [
        animal(10, 10, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 2 }),
        animal(11, 10, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 2 }),
        animal(12, 10, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 9 }),
        animal(13, 10, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 9 }),
      ];
      const groups = describeSocialGroups(band, world);
      assert.deepEqual(groups.map((group) => group.kind), ['herd', 'band', 'band']);
      assert.equal(groups[0].members, 4);
      assert.equal(groups[0].ring, 0, 'the herd is drawn outside');
      assert.ok(groups.slice(1).every((group) => group.ring === 1), 'both bands nest inside it');
      assert.notEqual(groups[0].colorToken, groups[1].colorToken);
    });

    test('a pair is a group and a lone animal is not', () => {
      // The engine agrees twice over: a herd label needs three animals to exist
      // and a record dissolves below two. A bubble around one animal says nothing
      // its own glyph does not.
      assert.equal(describeSocialGroups([animal(1, 1, { groupId: 5 })], world).length, 0);
      assert.equal(describeSocialGroups([animal(1, 1, { groupId: 5 }), animal(2, 1, { groupId: 5 })], world).length, 1);
      assert.equal(MIN_GROUP_MEMBERS, 2);
    });

    test('the dead are not members, however they died', () => {
      // A carcass keeps the record id it had — a fact about who it was, like
      // `deathCause` — and enrolling it would stretch a bubble around a body long
      // after the group had moved on.
      const survivors = [
        animal(4, 4, { groupId: 8 }),
        animal(5, 4, { groupId: 8 }),
        animal(20, 20, { groupId: 8, alive: false }),
        animal(21, 20, { kind: 'carcass', groupId: 8, groupRecordId: 1 }),
      ];
      const [herd] = describeSocialGroups(survivors, world);
      assert.equal(herd.members, 2);
      assert.ok(herd.bounds.maxCellX < 10, 'the bubble does not reach the bodies');
      assert.equal(describeSocialGroups(survivors, world).length, 1, 'and the carcass founds no record of its own');
    });

    test('⚠ the same tick always draws the same outlines, whatever order the entities arrive in', () => {
      // Presentation must be reproducible from its inputs (§3). The spanning tree
      // keeps the first pair at the shortest distance and ties are common on a
      // lattice, so without a sorted membership two clients watching one tick drew
      // different arms — and one client drew different arms after a reconnect.
      const herd = [
        animal(10, 10, { groupId: 3 }),
        animal(10, 20, { groupId: 3 }),
        animal(20, 10, { groupId: 3 }),
        animal(20, 20, { groupId: 3 }),
      ];
      const forwards = describeSocialGroups(herd, world);
      const backwards = describeSocialGroups([...herd].reverse(), world);
      assert.deepEqual(backwards, forwards);
    });

    test('a group nobody can see is not traced at all', () => {
      // The layer costs what is on the screen, not what is in the world — tracing
      // is tens of set operations per cell covered, and the demo holds ~60 groups.
      const near = [animal(10, 10, { groupId: 1 }), animal(11, 10, { groupId: 1 })];
      const far = [animal(50, 50, { groupId: 2 }), animal(51, 50, { groupId: 2 })];
      const visible = { minCellX: 0, minCellY: 0, maxCellX: 20, maxCellY: 20 };
      const groups = describeSocialGroups([...near, ...far], world, { visible });
      assert.deepEqual(groups.map((group) => group.key), ['herd:herbivore.gazelle:1']);
    });

    test('⚠ but a group straddling the view is traced whole, arm and all', () => {
      // The test is the *whole* member bounding box, so a group with one animal
      // above the view and one below still draws the arm that crosses it —
      // clipping the membership instead would draw an outline that ends at the
      // edge of the screen.
      const straddling = [animal(30, 2, { groupId: 6 }), animal(30, 40, { groupId: 6 })];
      const visible = { minCellX: 20, minCellY: 15, maxCellX: 40, maxCellY: 25 };
      const [group] = describeSocialGroups(straddling, world, { visible });
      assert.ok(group, 'the group is traced');
      assert.ok(group.bounds.minCellY <= 2 && group.bounds.maxCellY >= 40, 'and traced whole');
    });
  });

  describe('painting', () => {
    /** A stub 2D context that records stroked rounded paths. */
    function paintWith(groups, cellSize = 20) {
      const strokes = [];
      let current = null;
      const ctx = {
        lineJoin: 'miter',
        lineWidth: 1,
        strokeStyle: '',
        beginPath() {
          current = { points: [], colorToken: null, radii: [] };
        },
        moveTo(x, y) {
          current.points.push([x, y]);
        },
        arcTo(x1, y1, x2, y2, radius) {
          current.points.push([x1, y1], [x2, y2]);
          current.radii.push(radius);
        },
        closePath() {},
        stroke() {
          strokes.push({ ...current, color: this.strokeStyle, lineJoin: this.lineJoin });
        },
      };
      const projection = { cellSize, cellToScreen: (cellX, cellY) => ({ px: cellX * cellSize, py: cellY * cellSize }) };
      paintOutlineLayer(ctx, {
        groups,
        projection,
        visible: { minCellX: 0, minCellY: 0, maxCellX: 40, maxCellY: 40 },
        resolveColor: (token) => DRACULA_COLORS[token],
      });
      return strokes;
    }

    test('an outline is one stroked path per loop, in its kind’s colour', () => {
      const zebra = (cellX) => animal(cellX, 6, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 2 });
      const strokes = paintWith(describeSocialGroups([zebra(6), zebra(7)], { width: 40, height: 40 }));
      assert.equal(strokes.length, 2, 'the herd label and the band');
      // ⚠ Compared as resolved colours rather than as tokens: `comment` and
      // `current-line` are the same hex in this palette, so a hex→token lookup
      // cannot tell them apart and would fail on the right answer.
      assert.deepEqual(strokes.map((stroke) => stroke.color), [
        DRACULA_COLORS[SOCIAL_GROUP_APPEARANCE.herd.colorToken],
        DRACULA_COLORS[SOCIAL_GROUP_APPEARANCE.band.colorToken],
      ]);
      // Rounded corners are the whole visual distinction from the selection's
      // square corner brackets, so a radius of zero would be a silent regression.
      assert.ok(strokes.every((stroke) => stroke.radii.every((radius) => radius > 0)));
      assert.ok(strokes.every((stroke) => stroke.lineJoin === 'round'));
    });

    test('⚠ the inner ring is drawn inside the outer one, never on top of it', () => {
      // Two outlines around the same cells would otherwise land on exactly the
      // same boundary, and only the last drawn would be visible — which would
      // silently lose one of the two facts the layer exists to show.
      const zebra = (cellX) => animal(cellX, 6, { speciesId: 'herbivore.zebra', groupId: 4, groupRecordId: 2 });
      const [herd, band] = paintWith(describeSocialGroups([zebra(6), zebra(7)], { width: 40, height: 40 }));
      const spread = (stroke) => Math.max(...stroke.points.map((p) => p[0])) - Math.min(...stroke.points.map((p) => p[0]));
      assert.ok(spread(band) < spread(herd), `the band (${spread(band)}) sits inside the herd (${spread(herd)})`);
    });

    test('a group off screen is skipped without being drawn', () => {
      const groups = describeSocialGroups(
        [animal(90, 90, { groupId: 2 }), animal(91, 90, { groupId: 2 })],
        { width: 200, height: 200 },
      );
      assert.equal(groups.length, 1, 'it was traced');
      assert.equal(paintWith(groups).length, 0, 'and not painted');
    });

    test('nothing at all is drawn while the layer is off', () => {
      assert.deepEqual(paintWith([]), []);
    });
  });
});

// ---------------------------------------------------------------------------
// The territory layer (protocol v37) — the social layer's twin, over the ground
// rather than over the animals.
// ---------------------------------------------------------------------------

describe('the territory layer', () => {
  const CLAIM = 4; // world cells per claim cell, as the engine ships it
  const animal = (id, overrides = {}) => ({
    id,
    kind: 'animal',
    alive: true,
    speciesId: 'predator.lion',
    groupRecordId: null,
    ...overrides,
  });

  /**
   * A claim layer from a picture: one row per string, one character per claim
   * cell, `.` unclaimed and any other character an owner id looked up in `by`.
   */
  const claims = (rows, by) => {
    const width = rows[0].length;
    const owners = new Int32Array(width * rows.length);
    rows.forEach((row, cellY) => {
      [...row].forEach((mark, cellX) => {
        owners[cellY * width + cellX] = mark === '.' ? 0 : by[mark];
      });
    });
    return { width, height: rows.length, cellSize: CLAIM, revision: 1, owners };
  };

  const entityMap = (...animals) => new Map(animals.map((entity) => [entity.id, entity]));

  describe('whose ground it is', () => {
    test('two pride-mates hold one territory, not two', () => {
      // The engine's own rule (`holdsClaim`): a pride-mate's mark is the pride's
      // ground. Two lionesses marking adjacent cells is one purple outline.
      const territory = claims(['ab', '..'], { a: 1, b: 2 });
      const groups = describeTerritories(
        territory,
        entityMap(animal(1, { groupRecordId: 9 }), animal(2, { groupRecordId: 9 })),
      );
      assert.equal(groups.length, 1);
      assert.equal(groups[0].key, 'record:9');
      assert.equal(groups[0].holders, 2, 'two animals, one side');
      assert.equal(groups[0].colorToken, SOCIAL_GROUP_APPEARANCE.pride.colorToken, 'the pride’s own colour');
      assert.match(groups[0].label, /pride/);
    });

    test('two prides are two territories, and a clan is a third in its own colour', () => {
      const territory = claims(['a.b', '..c'], { a: 1, b: 2, c: 3 });
      const groups = describeTerritories(
        territory,
        entityMap(
          animal(1, { groupRecordId: 9 }),
          animal(2, { groupRecordId: 10 }),
          animal(3, { speciesId: 'scavenger.hyena', groupRecordId: 11 }),
        ),
      );
      assert.deepEqual(groups.map((group) => group.key), ['record:10', 'record:11', 'record:9']);
      const clan = groups.find((group) => group.key === 'record:11');
      assert.equal(clan.colorToken, SOCIAL_GROUP_APPEARANCE.clan.colorToken);
      assert.match(clan.label, /clan/);
    });

    test('a lone holder gets its own ground in its species’ colour', () => {
      // A leopard belongs to nothing, so there is no group to name — and its red
      // beside a pride's purple says which animal marked it with no legend.
      const groups = describeTerritories(claims(['a'], { a: 4 }), entityMap(animal(4, { speciesId: 'predator.leopard' })));
      assert.equal(groups[0].key, 'holder:4');
      assert.equal(groups[0].colorToken, SPECIES_APPEARANCE['predator.leopard'].colorToken);
      assert.match(groups[0].label, /leopard/);
    });

    test('⚠ a dead holder’s ground is not drawn, exactly as the engine will not honour it', () => {
      // `holdsClaim` requires the owner alive: a dead lion's marks fade like
      // anyone else's and the next animal through writes its own. Drawing them
      // would show a pride holding ground it has already lost.
      const territory = claims(['ab'], { a: 1, b: 2 });
      const groups = describeTerritories(
        territory,
        entityMap(animal(1, { groupRecordId: 9, alive: false }), animal(2, { groupRecordId: 9 })),
      );
      assert.equal(groups.length, 1);
      assert.equal(groups[0].holders, 1, 'only the living lioness holds anything');
      assert.equal(groups[0].claimCells, 1);
    });

    test('a claim whose holder this client has never seen is dropped, never guessed at', () => {
      assert.deepEqual(describeTerritories(claims(['a'], { a: 77 }), entityMap()), []);
    });

    test('an absent claim layer draws nothing at all', () => {
      assert.deepEqual(describeTerritories(null, entityMap(animal(1))), []);
    });
  });

  describe('the shape of a territory', () => {
    test('⚠ two patches of held ground are two outlines — no arm between them', () => {
      // The one place this layer parts company with the social layer. An arm
      // between two blobs of a herd wraps an animal that wandered off; an arm
      // between two blobs of a *territory* would draw a claim over ground
      // nobody has marked, which is what this layer exists to show the absence
      // of.
      const territory = claims(['a....a'], { a: 1 });
      const [ground] = describeTerritories(territory, entityMap(animal(1, { groupRecordId: 9 })));
      assert.equal(ground.loops.length, 2, 'two islands');
      assert.equal(ground.claimCells, 2, 'and no ground invented between them');
    });

    test('a pocket inside a territory is filled, so it reads as one boundary', () => {
      const territory = claims(['aaa', 'a.a', 'aaa'], { a: 1 });
      const [ground] = describeTerritories(territory, entityMap(animal(1, { groupRecordId: 9 })));
      assert.equal(ground.loops.length, 1, 'the hole is not a second loop');
      assert.equal(ground.claimCells, 9);
    });

    test('⚠ outlines come back in world cells, scaled off the claim grid’s own resolution', () => {
      // Traced at claim resolution — 16× fewer cells at cellSize 4 — and scaled
      // afterwards, which is exact because a claim boundary only ever falls on a
      // claim-cell edge.
      const [ground] = describeTerritories(claims(['.a'], { a: 1 }), entityMap(animal(1)));
      const xs = ground.loops[0].map((point) => point.x);
      assert.deepEqual([Math.min(...xs), Math.max(...xs)], [CLAIM, 2 * CLAIM]);
      assert.deepEqual(ground.bounds, { minCellX: 4, minCellY: 0, maxCellX: 7, maxCellY: 3 });
    });

    test('a territory nobody can see is not traced at all', () => {
      const groups = describeTerritories(claims(['a'], { a: 1 }), entityMap(animal(1)), {
        visible: { minCellX: 200, minCellY: 200, maxCellX: 260, maxCellY: 260 },
      });
      assert.deepEqual(groups, []);
    });

    test('⚠ the same claims always draw the same outlines, whatever order the ids come in', () => {
      // §3: presentation must be reproducible from its inputs alone.
      const territory = claims(['ab', 'ba'], { a: 1, b: 2 });
      const forwards = describeTerritories(territory, entityMap(animal(1, { groupRecordId: 9 }), animal(2, { groupRecordId: 9 })));
      const backwards = describeTerritories(territory, entityMap(animal(2, { groupRecordId: 9 }), animal(1, { groupRecordId: 9 })));
      assert.deepEqual(forwards, backwards);
    });
  });

  describe('the layer’s place in the registry', () => {
    test('it is a layer, off by default, with the social layer beside it', () => {
      const ids = MAP_LAYERS.map((layer) => layer.id);
      assert.deepEqual(ids, ['social', 'territory']);
      assert.equal(MAP_LAYERS.find((layer) => layer.id === 'territory').defaultEnabled, false);
      assert.equal(resolveEnabledLayers(null).size, 0, 'nothing is on before anyone asks');
    });

    test('⚠ a viewer who stored their choice before this layer existed gets it off', () => {
      // The registry's own rule: a layer the stored set could not have known
      // about takes its default, and this one's default is off.
      assert.deepEqual([...resolveEnabledLayers(['social'])], ['social']);
    });

    test('territory runs in the outermost lane, so it can never coincide with a record’s ring', () => {
      const [group] = describeTerritories(claims(['a'], { a: 1 }), entityMap(animal(1, { groupRecordId: 9 })));
      assert.equal(group.ring, TERRITORY_RING);
      assert.notEqual(group.ring, SOCIAL_GROUP_APPEARANCE.pride.ring);
    });
  });
});

// ⚠ Appended as its own block rather than folded into "the shape of a
// territory": it is a claim about the *painter* shared with the social layer,
// and it is the one property of the territory layer that falls out of geometry
// nobody wrote for it.
describe('two territories that share a border', () => {
  const animal = (id, overrides = {}) => ({ id, kind: 'animal', alive: true, speciesId: 'predator.lion', groupRecordId: null, ...overrides });

  test('⚠ draw two lines a pixel apart, not one over the other', () => {
    // Territory boundaries sit exactly where two animals' marking rates balance,
    // so a shared edge is the *usual* case here rather than a corner one — and
    // "two outlines on one ring lose one of them" (§9a) would make it a real
    // defect. It is not, because `insetLoop` moves each outline inward toward
    // its own region: one lands on the pixel row inside one territory, the other
    // on the row inside the other.
    const owners = new Int32Array([1, 2]);
    const territory = { width: 2, height: 1, cellSize: 4, revision: 1, owners };
    const described = describeTerritories(
      territory,
      new Map([[1, animal(1, { groupRecordId: 9 })], [2, animal(2, { groupRecordId: 10 })]]),
    );
    // ⚠ By key, not by position: the sort is lexicographic, so `record:10` comes
    // before `record:9` and destructuring would silently swap the two sides.
    const left = described.find((group) => group.key === 'record:9');
    const right = described.find((group) => group.key === 'record:10');
    // They meet on the world-cell lattice line at x = 4 and each claims up to it.
    assert.equal(Math.max(...left.loops[0].map((p) => p.x)), 4);
    assert.equal(Math.min(...right.loops[0].map((p) => p.x)), 4);
    // And the painter insets each one into its own side of that line.
    const insetLeft = insetLoop(left.loops[0].map((p) => ({ x: p.x * 10, y: p.y * 10 })), 0.5);
    const insetRight = insetLoop(right.loops[0].map((p) => ({ x: p.x * 10, y: p.y * 10 })), 0.5);
    assert.equal(Math.max(...insetLeft.map((p) => p.x)), 39.5, 'the left outline stops inside itself');
    assert.equal(Math.min(...insetRight.map((p) => p.x)), 40.5, 'and the right one starts inside itself');
  });
});
