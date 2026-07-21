/**
 * Cell inspector panel. Shows the ground of the selected cell, every occupant
 * standing on it, the active occupant's protocol-visible fields, optional live
 * inspection detail (absolute energy, injuries, remembered places, traits,
 * genome, family links, and the bounded life-history timeline from the
 * entity.inspection endpoint), and recent domain events involving the entity.
 * Only fields the protocol actually provides are shown — no invented biology.
 *
 * Rendering is two-pass, because this panel is re-rendered on every store
 * change — that is once per authoritative tick. A full `innerHTML` rebuild at
 * that cadence destroys scroll position, text selection, and any open/closed
 * state a viewer has set:
 *
 *  - the STRUCTURAL pass builds the HTML, and runs only when the *shape* of
 *    what is shown changes (a different cell, different occupants, a new
 *    inspection payload, or an optional row appearing/disappearing);
 *  - the PATCH pass runs every tick and writes only the handful of values that
 *    come from bulk snapshots, into nodes cached at build time.
 *
 * A structure signature decides between the two. When in doubt it rebuilds: a
 * missed signature field costs a wasted rebuild, while a missed *patch* field
 * would silently display a stale number.
 */
import { resolveAppearance } from '../rendering/EntityAppearance.js';

function formatHeading(radians) {
  if (typeof radians !== 'number') return '–';
  const degrees = Math.round((radians * 180) / Math.PI) % 360;
  return `${radians.toFixed(2)} rad (${degrees}°)`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render the scored action utilities (protocol v7 inspection), or nothing. */
function formatUtilities(utilityBreakdown, chosen, actionTarget) {
  if (!utilityBreakdown) return '';
  const rows = Object.entries(utilityBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, value]) =>
        `<div class="field"><span class="${name === chosen ? 'ok' : 'dim'}">${name === chosen ? '▸ ' : ''}${escapeHtml(name)}</span><span>${value.toFixed(2)}</span></div>`,
    )
    .join('');
  const target = actionTarget ? ` <span class="dim">→ (${actionTarget.cellX},${actionTarget.cellY})</span>` : '';
  return `<h3>Decides <span class="dim">${escapeHtml(chosen ?? '')}</span>${target}</h3>${rows}`;
}

/**
 * Render current injuries (protocol v16), worst first, with a severity bar and
 * the derived impairment the simulation actually acts on.
 */
function formatInjuries(detail) {
  const injuries = detail?.injuries;
  if (!injuries?.length) return '';
  const rows = injuries
    .map((injury) => {
      const bars = Math.max(1, Math.round(injury.severity * 5));
      return `<div class="field"><span class="bad">${escapeHtml(injury.kind)}</span><span>${'▰'.repeat(bars)}${'▱'.repeat(Math.max(0, 5 - bars))} <span class="dim">${injury.severity.toFixed(2)} · since t${injury.tick}</span></span></div>`;
    })
    .join('');
  const impairment = Math.round((detail.impairment ?? 0) * 100);
  return `<h3>Injured <span class="warn">${impairment}% impaired</span></h3>${rows}`;
}

/** Renderer-owned marks for the memory kinds the protocol sends (v14). */
const MEMORY_MARK = { food: '"', water: '~', barren: '·', danger: '!' };

/**
 * Render what the animal remembers (protocol v14): strongest first, with a
 * fading bar, so which memory it is currently acting on reads at the top.
 */
function formatMemories(detail) {
  const memories = detail?.memories;
  if (!memories?.length) return '';
  const rows = memories
    .map((memory) => {
      const bars = Math.max(1, Math.round(memory.strength * 5));
      const mark = MEMORY_MARK[memory.kind] ?? '?';
      return `<div class="field"><span>${escapeHtml(mark)} ${escapeHtml(memory.kind)}</span><span>(${memory.cellX},${memory.cellY}) <span class="dim">${'▮'.repeat(bars)}${'▯'.repeat(5 - bars)} t${memory.tick}</span></span></div>`;
    })
    .join('');
  return `<h3>Remembers <span class="dim">${memories.length} place${memories.length === 1 ? '' : 's'}</span></h3>${rows}`;
}

/**
 * Render heredity (protocol v19): what the genome codes for, what it actually
 * expresses, and what the parents looked like. Showing genotype beside
 * phenotype is the point — where they differ, a tradeoff is being paid.
 */
function formatGenetics(detail) {
  if (!detail?.genome || !detail?.genotype) return '';
  const parents = (detail.parentTraits ?? []).filter((p) => p.traits);
  const rows = Object.entries(detail.genotype)
    .map(([locus, raw]) => {
      const expressed = detail.traits?.[locus];
      const alleles = (detail.genome[locus] ?? []).map((a) => a.toFixed(2)).join('/');
      // Only call out the gap where a tradeoff actually moved the value.
      const traded =
        typeof expressed === 'number' && Math.abs(expressed - raw) > 0.005
          ? ` <span class="${expressed < raw ? 'warn' : 'ok'}">→ ${expressed.toFixed(2)}</span>`
          : '';
      const kin = parents.length
        ? ` <span class="dim">| kin ${parents.map((p) => p.traits[locus].toFixed(2)).join(' ')}</span>`
        : '';
      return `<div class="field"><span>${escapeHtml(locus)}</span><span><span class="dim">${alleles}</span> ${raw.toFixed(2)}${traded}${kin}</span></div>`;
    })
    .join('');
  const missing = (detail.parentTraits ?? []).filter((p) => !p.traits);
  const note = missing.length
    ? `<div class="field"><span class="dim">parents</span><span class="dim">${missing.map((p) => `#${p.id} ${p.status}`).join(', ')}</span></div>`
    : '';
  return `<h3>Genome <span class="dim">alleles · genotype → phenotype${parents.length ? ' | parents' : ''}</span></h3>${rows}${note}`;
}

/**
 * Render the individual's trait multipliers (protocol v13) as a bar per trait,
 * so how this animal differs from its species average is readable at a glance.
 * 1.00 is exactly average; the bar is centred on it.
 */
function formatTraits(detail) {
  if (!detail?.traits) return '';
  const rows = Object.entries(detail.traits)
    .map(([name, value]) => {
      // Map roughly [0.5, 1.5] onto the bar, clamped, with the midpoint at average.
      const offset = Math.max(-1, Math.min(1, (value - 1) * 2));
      const filled = Math.round(Math.abs(offset) * 5);
      const bar = offset < 0 ? '─'.repeat(5 - filled) + '█'.repeat(filled) + '│' + ' '.repeat(5) : ' '.repeat(5) + '│' + '█'.repeat(filled) + '─'.repeat(5 - filled);
      const tone = Math.abs(value - 1) < 0.05 ? 'dim' : '';
      return `<div class="field"><span>${escapeHtml(name)}</span><span><span class="dim">${bar}</span> <span class="${tone}">${value.toFixed(2)}</span></span></div>`;
    })
    .join('');
  const adult = detail.adultMass != null ? ` <span class="dim">grows to ${detail.adultMass.toFixed(1)} kg</span>` : '';
  return `<h3>Traits${adult}</h3>${rows}`;
}

/**
 * Render family links and the bounded life-history timeline (protocol v12),
 * or nothing when the inspection payload carries neither.
 */
function formatFamily(detail) {
  if (!detail) return '';
  const ids = (list) => list.map((id) => `#${id}`).join(', ');
  const rows = [];
  if (detail.parents?.length) {
    rows.push(`<div class="field"><span>parents</span><span>${ids(detail.parents)}</span></div>`);
  }
  if (detail.offspring?.length) {
    rows.push(`<div class="field"><span>offspring</span><span>${ids(detail.offspring)}</span></div>`);
  }
  const parenting = detail.parentingState;
  if (parenting?.dependent) {
    const care = parenting.weaned ? 'weaned' : 'nursing';
    rows.push(
      `<div class="field"><span>follows</span><span class="ok">#${parenting.guardianId} <span class="dim">(${care})</span></span></div>`,
    );
  }
  const timeline = (detail.lifeEvents ?? [])
    .slice()
    .reverse()
    .map(
      (event) =>
        `<li><span class="dim">t${event.tick}</span> ${escapeHtml(event.type)}${event.cause ? ` <span class="dim">(${escapeHtml(event.cause)})</span>` : ''}${event.entityId != null ? ` <span class="dim">#${event.entityId}</span>` : ''}</li>`,
    )
    .join('');
  if (rows.length === 0 && timeline === '') return '';
  return `<h3>Family</h3>${rows.join('')}${timeline ? `<ul class="entity-events">${timeline}</ul>` : ''}`;
}

/**
 * Render mate choice (protocol v21): what this species reads in a mate, how
 * hard this individual weighs it, the standard it is holding right now, and the
 * last animal it sized up.
 *
 * The threshold is shown beside the quality deliberately — a rejection with no
 * visible standard just looks like the simulation being capricious, whereas
 * "0.66 against a standard of 0.71" is a decision you can check. The standard
 * falls as the animal goes unmated, so watching it drop *is* watching the cost
 * of being choosy get paid.
 */
function formatMateChoice(detail) {
  const mate = detail?.mateChoice;
  if (!mate || (mate.choosiness === null && !mate.lastCourtship)) return '';
  const rows = [];
  if (mate.preference?.trait) {
    rows.push(
      `<div class="field"><span>prefers</span><span>${escapeHtml(mate.preference.trait)} <span class="dim">+ condition ${Math.round((mate.preference.conditionWeight ?? 0) * 100)}%</span></span></div>`,
    );
  }
  if (mate.choosiness !== null && mate.choosiness !== undefined) {
    rows.push(`<div class="field"><span>choosiness</span><span>${mate.choosiness.toFixed(2)}</span></div>`);
  }
  if (mate.threshold !== null && mate.threshold !== undefined) {
    rows.push(
      `<div class="field"><span>accepts</span><span>≥ ${mate.threshold.toFixed(2)} <span class="dim">searching ${mate.searchingTicks}t</span></span></div>`,
    );
  }
  const last = mate.lastCourtship;
  if (last) {
    const verdict = last.accepted ? '<span class="ok">accepted</span>' : '<span class="warn">rejected</span>';
    rows.push(
      `<div class="field"><span>last courted</span><span>#${last.candidateId} ${last.quality.toFixed(2)}/${last.threshold.toFixed(2)} ${verdict} <span class="dim">t${last.tick}</span></span></div>`,
    );
  }
  if (rows.length === 0) return '';
  return `<h3>Mate choice</h3>${rows.join('')}`;
}

/**
 * Render sociality (protocol v22): the herd, this animal's standing in it, and
 * whether it is currently panicking or squaring up to something.
 *
 * `dominance` has no units and is not meant to — only comparisons between two
 * animals mean anything, which is why it is shown beside the group rather than
 * as a stat with a bar. It is derived on read from mass, condition, and
 * temperament, so watching it fall as an animal is wounded is watching the
 * thing that decides its next contest.
 */
function formatSocial(detail) {
  const social = detail?.social;
  if (!social) return '';
  const rows = [];
  const nearby = social.nearby;
  if (social.groupId !== null && social.groupId !== undefined) {
    const company = nearby ? ` <span class="dim">${nearby.groupmates} in range (${nearby.adults} adult)</span>` : '';
    rows.push(`<div class="field"><span>herd</span><span>#${social.groupId}${company}</span></div>`);
  } else {
    rows.push('<div class="field"><span>herd</span><span class="dim">alone</span></div>');
  }
  if (nearby?.drift != null) {
    rows.push(`<div class="field"><span>from centre</span><span>${nearby.drift.toFixed(1)}</span></div>`);
  }
  if (typeof social.dominance === 'number') {
    rows.push(`<div class="field"><span>dominance</span><span>${social.dominance.toFixed(1)} <span class="dim">(relative)</span></span></div>`);
  }
  if (social.alarmed) {
    const hops = social.alarmSource?.hops;
    const how = hops === 0 ? 'saw it' : hops != null ? `${hops} hop${hops === 1 ? '' : 's'} away` : '';
    rows.push(`<div class="field"><span>alarm</span><span class="bad">panicking <span class="dim">${escapeHtml(how)}</span></span></div>`);
  }
  if (social.defendingId != null) {
    rows.push(`<div class="field"><span>defending</span><span class="warn">#${social.defendingId}</span></div>`);
  }
  if (social.lastContestTick != null) {
    rows.push(`<div class="field"><span>last contest</span><span class="dim">t${social.lastContestTick}</span></div>`);
  }
  return `<h3>Herd</h3>${rows.join('')}`;
}

/**
 * Render territory (protocol v23): where this animal lives, how far it has
 * strayed, and whose ground it is standing on.
 *
 * The home range is shown as a centre and a radius because that is literally
 * all the simulation keeps — four numbers accumulated in place, not a track.
 * `standingOn` is the same O(1) lookup the avoidance behaviour reads, so an
 * animal heading away from good grass has a visible reason.
 */
function formatTerritory(detail) {
  const territory = detail?.territory;
  if (!territory) return '';
  const rows = [];
  const range = territory.homeRange;
  if (range) {
    rows.push(
      `<div class="field"><span>lives around</span><span>${range.x.toFixed(0)},${range.y.toFixed(0)} <span class="dim">r ${range.radius.toFixed(1)}</span></span></div>`,
    );
    if (territory.drift != null) {
      const far = territory.rangeRadius != null && territory.drift > territory.rangeRadius;
      rows.push(
        `<div class="field"><span>from centre</span><span class="${far ? 'warn' : ''}">${territory.drift.toFixed(1)}${far ? ' (outside)' : ''}</span></div>`,
      );
    }
  } else {
    rows.push('<div class="field"><span>home range</span><span class="dim">not settled yet</span></div>');
  }
  if (territory.defends) {
    rows.push(`<div class="field"><span>holds</span><span>${territory.holding} cell${territory.holding === 1 ? '' : 's'}</span></div>`);
  }
  const ground = territory.standingOn;
  if (ground && ground.ownerId !== 0) {
    rows.push(
      ground.own
        ? `<div class="field"><span>standing on</span><span class="ok">own ground <span class="dim">${ground.strength.toFixed(2)}</span></span></div>`
        : `<div class="field"><span>standing on</span><span class="warn">#${ground.ownerId}'s ground <span class="dim">${ground.strength.toFixed(2)}</span></span></div>`,
    );
  }
  return `<h3>Range</h3>${rows.join('')}`;
}

/**
 * Render migration (protocol v25): which way this animal is drifting and why.
 *
 * The live habitat reading is shown beside the drift it produced, for the same
 * reason a courtship shows its threshold beside the quality — otherwise a bias
 * is just an arrow with no argument behind it. A dispersing juvenile is called
 * out separately because that drive *overrides* the habitat reading rather than
 * competing with it, and showing both without saying which is winning would be
 * misleading.
 */
function formatMigration(detail) {
  const migration = detail?.migration;
  if (!migration) return '';
  const rows = [];
  if (migration.dispersing) {
    rows.push(
      `<div class="field"><span>dispersing</span><span class="warn">leaving home${
        migration.dispersalUntil != null ? ` <span class="dim">until t${migration.dispersalUntil}</span>` : ''
      }</span></div>`,
    );
  }
  const drift = migration.drift;
  if (drift) {
    const compass = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const heading = compass[Math.round((drift.heading / (Math.PI * 2)) * 8) % 8];
    rows.push(
      `<div class="field"><span>drifting</span><span>${heading} <span class="dim">${Math.round(drift.strength * 100)}%</span></span></div>`,
    );
  } else if (migration.tracksForage) {
    rows.push('<div class="field"><span>drifting</span><span class="dim">nowhere better</span></div>');
  }
  if (migration.habitat) {
    rows.push(
      `<div class="field"><span>better forage</span><span class="dim">${(migration.habitat.strength * 100).toFixed(0)}% better within ${migration.cueRadius}u</span></div>`,
    );
  }
  if (migration.settled) {
    rows.push(
      `<div class="field"><span>settled from</span><span class="dim">${migration.settled.x.toFixed(0)},${migration.settled.y.toFixed(0)}</span></div>`,
    );
  }
  return rows.length ? `<h3>Migration</h3>${rows.join('')}` : '';
}

/**
 * Render disease (protocol v24). `infectious` is shown separately from
 * `symptomatic` because the two genuinely differ — an incubating animal is
 * spreading it while looking perfectly well, and that gap is the whole model.
 */
function formatDisease(detail) {
  const disease = detail?.disease;
  if (!disease || disease.state === 'susceptible') return '';
  const tone = disease.symptomatic ? 'bad' : disease.state === 'recovered' ? 'ok' : 'warn';
  const rows = [`<div class="field"><span>state</span><span class="${tone}">${escapeHtml(disease.state)}</span></div>`];
  if (disease.infectious) {
    rows.push(
      `<div class="field"><span>infectious</span><span class="bad">yes${disease.symptomatic ? '' : ' <span class="dim">(and looks fine)</span>'}</span></div>`,
    );
  }
  if (disease.until != null) {
    rows.push(`<div class="field"><span>until</span><span class="dim">t${disease.until}</span></div>`);
  }
  if (disease.severity > 0) {
    rows.push(`<div class="field"><span>impaired</span><span class="warn">${Math.round(disease.severity * 100)}%</span></div>`);
  }
  return `<h3>Disease</h3>${rows.join('')}`;
}

/** Render the transient perception summary (protocol v6), or nothing. */
function formatPerception(perception) {
  if (!perception) return '';
  const cell = (c, label) =>
    c
      ? `<div class="field"><span>${label}</span><span>(${c.cellX},${c.cellY}) <span class="dim">d${c.distance.toFixed(1)}${c.level !== undefined ? ` lvl${c.level}` : ''}</span></span></div>`
      : `<div class="field"><span>${label}</span><span class="dim">none in range</span></div>`;
  const nearest = perception.nearestAnimal
    ? `#${perception.nearestAnimal.id} <span class="dim">d${perception.nearestAnimal.distance.toFixed(1)}</span>`
    : '<span class="dim">none</span>';
  return `
    <h3>Perceives <span class="dim">(r${perception.radius})</span></h3>
    <div class="field"><span>animals</span><span>${perception.animalCount} <span class="dim">nearest ${nearest}</span></span></div>
    ${cell(perception.nearestFood, 'food')}
    ${cell(perception.nearestWater, 'water')}
    ${cell(perception.nearestObstacle, 'obstacle')}`;
}

/**
 * Render the ground of the selected cell (A3) from a `CellDetail` description.
 * Every value here is something the protocol already sends — terrain and its
 * authoritative passability, quantized vegetation, worn ground, and any
 * disturbance whose circle covers this cell. Nothing is derived except how long
 * a disturbance has left, which is subtraction on two reported ticks.
 */
function formatGround(cell) {
  if (!cell) return '';
  if (!cell.inWorld) {
    return `<h3>Ground <span class="dim">${cell.cellX},${cell.cellY}</span></h3>
      <div class="field"><span>terrain</span><span class="dim">outside the world</span></div>`;
  }
  const rows = [];
  if (cell.terrain) {
    const passable =
      cell.terrain.passable === null
        ? ''
        : cell.terrain.passable
          ? ' <span class="dim">passable</span>'
          : ' <span class="bad">impassable</span>';
    rows.push(`<div class="field"><span>terrain</span><span>${escapeHtml(cell.terrain.name)}${passable}</span></div>`);
  }
  if (cell.vegetation.maxLevel > 0) {
    const { level, maxLevel } = cell.vegetation;
    const bars = '▮'.repeat(level) + '▯'.repeat(Math.max(0, maxLevel - level));
    rows.push(
      `<div class="field"><span>forage</span><span class="${level === 0 ? 'dim' : ''}">${
        level === 0 ? 'bare' : `level ${level}/${maxLevel}`
      } <span class="dim">${bars}</span></span></div>`,
    );
  }
  if (cell.feature) {
    rows.push(
      `<div class="field"><span>worn ground</span><span class="warn">${escapeHtml(cell.feature.kind)} <span class="dim">wear ${cell.feature.wear.toFixed(2)}</span></span></div>`,
    );
  }
  for (const disturbance of cell.disturbances) {
    const left = disturbance.ticksRemaining === null ? '' : ` <span class="dim">${disturbance.ticksRemaining}t left</span>`;
    rows.push(
      `<div class="field"><span>disturbance</span><span class="bad">${escapeHtml(disturbance.kind)}${left}</span></div>`,
    );
  }
  return `<h3>Ground <span class="dim">${cell.cellX},${cell.cellY}</span></h3>${rows.join('')}`;
}

/**
 * The values that change tick to tick, all of them from bulk snapshots. Keyed
 * by the `data-live` attribute the structural pass writes, so the patch pass is
 * a map walk over cached nodes rather than a rebuild.
 * @param {object | null} active
 * @returns {Map<string, {text: string, className?: string}>}
 */
function liveFields(active) {
  const fields = new Map();
  if (!active) return fields;
  fields.set('position', { text: `${active.x.toFixed(2)}, ${active.y.toFixed(2)}` });
  fields.set('heading', { text: formatHeading(active.heading) });
  fields.set('age', { text: `${active.age} ticks` });
  fields.set('bodyMass', { text: `${active.bodyMass} kg` });
  fields.set('energyFraction', { text: `${Math.round(active.energyFraction * 100)}%` });
  fields.set('healthFraction', { text: `${Math.round(active.healthFraction * 100)}%` });
  fields.set('alive', { text: active.alive ? 'yes' : 'no', className: active.alive ? 'ok' : 'bad' });
  if (active.hydrationFraction !== undefined) {
    fields.set('hydrationFraction', {
      text: `${Math.round(active.hydrationFraction * 100)}%`,
      className: active.hydrationFraction < 0.25 ? 'warn' : '',
    });
  }
  if (active.action) fields.set('action', { text: active.action });
  if (active.lifeStage) fields.set('lifeStage', { text: active.lifeStage });
  return fields;
}

/**
 * A signature of the panel's *shape*. When it is unchanged, the structural
 * markup is still valid and only the live values need writing.
 *
 * It deliberately includes the presence of every optional row, not just the
 * selection identity: an animal that gains an `action` or a `hydrationFraction`
 * changes the row count, and patching a node that does not exist yet is how
 * this class of optimization usually breaks. A missed field here costs one
 * wasted rebuild; a missed field in `liveFields` would show a stale number.
 *
 * Exported because it *is* the mechanism: whether the panel survives a tick is
 * decided entirely here, and it is testable without a DOM.
 */
export function structureSignature(store, selection, active, inspectionDetail, cell) {
  return [
    selection ? `${selection.cellX},${selection.cellY}` : 'none',
    selection ? selection.entityIds.join('.') : '',
    selection?.activeId ?? 'null',
    active ? 'live' : 'gone',
    // Optional rows on the active entity.
    active?.lifeStage ? 'L' : '',
    active?.sex ? 'S' : '',
    active?.action ? 'A' : '',
    active?.hydrationFraction !== undefined ? 'H' : '',
    // The inspection payload swaps every derived block at once.
    inspectionDetail?.entity?.id ?? 'nodetail',
    inspectionDetail?.tick ?? '',
    // Ground rows come and go as the world changes under a stationary selection.
    cell ? `${cell.inWorld}|${cell.terrain?.name ?? ''}|${cell.feature?.kind ?? ''}|${cell.disturbances.length}` : '',
    // The follow button's label, and the event list, are structural.
    store.followedEntityId === selection?.activeId ? 'F' : '',
    active ? store.eventsForEntity(active.id, 8).map((event) => event.seq).join('.') : '',
  ].join('#');
}

export class EntityInspector {
  #container;
  #callbacks;
  /** Structure signature of the markup currently in the DOM. */
  #signature = null;
  /** `data-live` key → node, cached by the structural pass. @type {Map<string, HTMLElement>} */
  #liveNodes = new Map();

  /**
   * @param {HTMLElement} container
   * @param {{onCycle: () => void, onFollowToggle: () => void}} callbacks
   */
  constructor(container, callbacks) {
    this.#container = container;
    this.#callbacks = callbacks;
    container.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'cycle') this.#callbacks.onCycle();
      if (action === 'follow') this.#callbacks.onFollowToggle();
    });
  }

  /**
   * @param {import('../state/RendererStore.js').RendererStore} store
   * @param {{entityId: number, tick: number, entity: object} | null} inspectionDetail
   *        last fetched entity.inspection payload, if any
   * @param {import('./CellDetail.js').CellDescription | null} [cell]
   *        the described ground of the selected cell, if any
   */
  render(store, inspectionDetail, cell = null) {
    const selection = store.selection;
    const active = selection?.activeId != null ? store.getEntity(selection.activeId) : null;
    const signature = structureSignature(store, selection, active, inspectionDetail, cell);

    // PATCH pass: the markup is still shaped correctly, so write only the
    // values that moved. This is what preserves scroll, text selection, and
    // (once Phase B lands) open/closed section state across a tick.
    if (signature === this.#signature) {
      this.#patch(active);
      return;
    }

    // STRUCTURAL pass. The `data-live` placeholders are built empty and then
    // filled by one patch pass, so there is exactly one place that knows how a
    // live value is formatted.
    this.#signature = signature;
    this.#buildMarkup(store, selection, active, inspectionDetail, cell);
    this.#liveNodes = new Map();
    for (const node of this.#container.querySelectorAll('[data-live]')) {
      this.#liveNodes.set(node.dataset.live, node);
    }
    this.#patch(active);
  }

  /** Write the tick-to-tick values into the nodes cached at build time. */
  #patch(active) {
    for (const [key, { text, className }] of liveFields(active)) {
      const node = this.#liveNodes.get(key);
      if (!node) continue;
      if (node.textContent !== text) node.textContent = text;
      if (className !== undefined && node.className !== className) node.className = className;
    }
  }

  #buildMarkup(store, selection, active, inspectionDetail, cell) {
    if (!selection) {
      this.#container.innerHTML = `
        <h2>Inspector</h2>
        <p class="hint">Click any cell to inspect it — ground included.<br />Tab cycles occupants, F follows, Esc clears.<br />Drag to pan.</p>`;
      return;
    }
    const occupants = selection.entityIds
      .map((entityId) => ({ entityId, entity: store.getEntity(entityId) }))
      .filter(({ entity }) => entity !== null || selection.entityIds.includes(selection.activeId));
    const activeIndex = selection.entityIds.indexOf(selection.activeId);
    const following = selection.activeId != null && store.followedEntityId === selection.activeId;

    const occupantList = occupants
      .map(({ entityId, entity }) => {
        const appearance = entity ? resolveAppearance(entity) : null;
        const marker = entityId === selection.activeId ? '&gt;' : '&nbsp;';
        const label = entity
          ? `${escapeHtml(appearance.glyph)} #${entityId} ${escapeHtml(appearance.label)}`
          : `#${entityId} (gone)`;
        return `<li class="${entityId === selection.activeId ? 'active' : ''}">${marker} ${label}</li>`;
      })
      .join('');

    // An empty cell is a selection like any other: the ground block below is
    // the whole report, and saying "nothing here" beats saying nothing.
    let fields =
      selection.entityIds.length === 0
        ? '<p class="hint">Nothing standing here.</p>'
        : '<p class="hint">This entity no longer exists.</p>';
    if (active) {
      const appearance = resolveAppearance(active);
      const live = inspectionDetail && inspectionDetail.entity?.id === active.id ? inspectionDetail.entity : null;
      const detail = live
        ? `<div class="field"><span>energy</span><span>${live.energy.toFixed(1)} / ${live.maxEnergy} <span class="dim">(tick ${inspectionDetail.tick})</span></span></div>` +
          (live.lowEnergy ? '<div class="field"><span>state</span><span class="warn">low energy</span></div>' : '') +
          `<div class="field"><span>health</span><span>${live.health.toFixed(1)} / ${live.maxHealth}</span></div>` +
          `<div class="field"><span>speed</span><span>${live.speed.toFixed(2)} u/tick</span></div>` +
          (live.edibleMass > 0 ? `<div class="field"><span>edible mass</span><span>${live.edibleMass.toFixed(1)} kg</span></div>` : '') +
          (live.reproState?.gestating
            ? `<div class="field"><span>gestating</span><span class="ok">until t${live.reproState.gestationUntil}</span></div>`
            : live.reproState?.lastMatedTick !== null && live.reproState?.lastMatedTick !== undefined
              ? `<div class="field"><span>last mated</span><span class="dim">t${live.reproState.lastMatedTick}</span></div>`
              : '')
        : '';
      fields = `
        <div class="field"><span>id</span><span>#${active.id}</span></div>
        <div class="field"><span>kind</span><span>${escapeHtml(active.kind)}</span></div>
        <div class="field"><span>species</span><span>${escapeHtml(active.speciesId)} <span class="dim">(${escapeHtml(appearance.label)})</span></span></div>
        ${active.lifeStage ? '<div class="field"><span>life stage</span><span data-live="lifeStage"></span></div>' : ''}
        ${active.sex ? `<div class="field"><span>sex</span><span>${escapeHtml(active.sex)}</span></div>` : ''}
        ${active.action ? '<div class="field"><span>action</span><span data-live="action"></span></div>' : ''}
        <div class="field"><span>position</span><span data-live="position"></span></div>
        <div class="field"><span>heading</span><span data-live="heading"></span></div>
        <div class="field"><span>age</span><span data-live="age"></span></div>
        <div class="field"><span>body mass</span><span data-live="bodyMass"></span></div>
        <div class="field"><span>energy %</span><span data-live="energyFraction"></span></div>
        ${active.hydrationFraction !== undefined ? '<div class="field"><span>hydration %</span><span data-live="hydrationFraction"></span></div>' : ''}
        <div class="field"><span>health %</span><span data-live="healthFraction"></span></div>
        ${detail}
        <div class="field"><span>alive</span><span data-live="alive"></span></div>`;
    }

    const liveDetail = active && inspectionDetail?.entity?.id === active.id ? inspectionDetail.entity : null;
    // The highlight reads the *inspection's* action, not the live one. The
    // utility numbers were computed on the inspection tick, so highlighting the
    // action the animal has since switched to would caption them wrongly — and
    // a live value here would also force a structural rebuild every time an
    // animal changed its mind, which is most ticks.
    const utilitiesBlock = liveDetail
      ? formatUtilities(liveDetail.utilityBreakdown, liveDetail.action ?? active.action, liveDetail.actionTarget)
      : '';
    const perceptionBlock = formatPerception(liveDetail ? liveDetail.perception : null);
    const diseaseBlock = formatDisease(liveDetail);
    const territoryBlock = formatTerritory(liveDetail);
    const migrationBlock = formatMigration(liveDetail);
    const socialBlock = formatSocial(liveDetail);
    const mateChoiceBlock = formatMateChoice(liveDetail);
    const familyBlock = formatFamily(liveDetail);
    const traitsBlock = formatTraits(liveDetail);
    const geneticsBlock = formatGenetics(liveDetail);
    const memoriesBlock = formatMemories(liveDetail);
    const injuriesBlock = formatInjuries(liveDetail);

    const events = active
      ? store
          .eventsForEntity(active.id, 8)
          .map((event) => `<li><span class="dim">t${event.tick}</span> ${escapeHtml(event.type)}</li>`)
          .join('')
      : '';

    this.#container.innerHTML = `
      <h2>Inspector <span class="dim">${occupants.length > 1 ? `${activeIndex + 1}/${occupants.length} in cell` : ''}</span></h2>
      ${occupants.length > 1 ? `<ul class="occupants">${occupantList}</ul>` : ''}
      ${fields}
      ${formatGround(cell)}
      ${injuriesBlock}
      ${memoriesBlock}
      ${traitsBlock}
      ${geneticsBlock}
      ${diseaseBlock}
      ${socialBlock}
      ${territoryBlock}
      ${migrationBlock}
      ${mateChoiceBlock}
      ${familyBlock}
      ${utilitiesBlock}
      ${perceptionBlock}
      <div class="inspector-actions">
        ${occupants.length > 1 ? '<button type="button" data-action="cycle">Cycle (Tab)</button>' : ''}
        ${active ? `<button type="button" data-action="follow">${following ? 'Unfollow (F)' : 'Follow (F)'}</button>` : ''}
      </div>
      ${events ? `<h3>Recent events</h3><ul class="entity-events">${events}</ul>` : ''}`;
  }
}
