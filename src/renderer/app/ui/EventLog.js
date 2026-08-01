/**
 * Bounded domain-event log. Known event types get compact one-line
 * formatting; unknown types fall back to a generic rendering instead of
 * failing.
 *
 * **The viewer says which events they want**, one checkbox per event type,
 * rather than the log dividing the world into "routine" and the rest on their
 * behalf. That division was one toggle covering five types, and it answered the
 * wrong question: a viewer watching an outbreak wants infections and nothing
 * else, and no single switch could give them that. The list is long by
 * construction — every event the engine emits appears in it — so it lives in a
 * `<details>` that starts closed, with the count of what is on in its summary.
 *
 * Defaults to births and deaths: the population changing is what a viewer who
 * has not opened the filters is owed, and it stays quiet enough to read.
 */

import { linkifyIds } from './InspectorView.js';
import { resolveAppearance } from '../rendering/EntityAppearance.js';
import {
  EVENT_CATALOG,
  DEFAULT_EVENT_FILTER,
  PASSING,
  filterIdFor,
  prefixFor,
  loadEventFilter,
  saveEventFilter,
} from '../state/EventCatalog.js';

/**
 * How much of the buffer is drawn. The list is rebuilt on every store change —
 * once per authoritative tick — so this is a per-tick DOM budget, not a
 * retention setting: the store keeps 20 000 milestones (§4) and this decides how
 * far back you can scroll without changing a filter. 200 lines is ~6000 ticks of
 * births and deaths at demo rates, and a tenth of that with every filter on.
 */
const MAX_RENDERED_EVENTS = 200;

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A unitless 0..1 ratio, without the leading zero.
 *
 * `(.63 vs .58)` rather than `(0.63 vs 0.58)`: every one of these is below one,
 * so the digit is two columns per number that say nothing, in a panel whose
 * lines are already clipped at the column edge. ⚠ Only for **ratios** —
 * quantities keep their leading digit, since `+0.70` kg and `+1.01` kg have to
 * line up against each other and the `0` is what says which side of one it is
 * on. (A ratio that did somehow exceed one prints normally: there is no leading
 * zero there to remove.)
 * @param {number} value @param {number} [digits]
 */
function ratio(value, digits = 2) {
  return value.toFixed(digits).replace(/^(-?)0\./, '$1.');
}

/**
 * One line of the log, without its mark.
 *
 * ⚠ **The prefix is not written here.** Every line is headed by the single
 * character `EventCatalog` assigns to its type (see `prefixFor`), prepended by
 * the caller — so a line cannot invent a mark of its own, two types cannot end
 * up sharing one, and no type can spend two columns on it. This function
 * describes *what happened*; the catalog says what it is marked with.
 */
function formatEvent(event) {
  switch (event.type) {
    case 'entity.created':
      return `created #${event.entityId} ${event.speciesId ?? event.kind ?? ''}`;
    case 'entity.moved':
      return `moved #${event.entityId} → ${event.to ? `${event.to.x.toFixed(1)},${event.to.y.toFixed(1)}` : '?'}`;
    case 'entity.died':
      return `died #${event.entityId}${event.cause ? ` (${event.cause})` : ''}`;
    case 'entity.removed':
      return `removed #${event.entityId}`;
    case 'entity.fed':
      return `fed #${event.entityId}${event.cell ? ` @${event.cell.cellX},${event.cell.cellY}` : ''}${event.amount !== undefined ? ` +${event.amount.toFixed(2)}` : ''}`;
    case 'entity.mated':
      return `mated #${event.entityId} + #${event.partnerId}${event.quality !== undefined ? ` (${ratio(event.quality)})` : ''}`;
    case 'entity.courted':
      // Quality against the standard it was held to, for the same reason
      // `entity.hunted` shows its odds: the verdict should be checkable.
      return `courted #${event.entityId} → #${event.candidateId} ${event.accepted ? 'accepted' : 'rejected'}${
        event.quality !== undefined ? ` (${ratio(event.quality)} vs ${ratio(event.threshold)})` : ''
      }`;
    case 'entity.born':
      return `born #${event.entityId}${event.sex ? ` ${event.sex}` : ''}${event.parents ? ` of ${event.parents.map((id) => `#${id}`).join(' + ')}` : ''}`;
    case 'entity.provisioned':
      return `fed #${event.entityId} by #${event.guardianId}${event.amount !== undefined ? ` +${event.amount.toFixed(2)}` : ''}`;
    case 'entity.hunted':
      // The odds are shown because a hunt is not a coin flip: the number comes
      // from the two animals' speed, stamina, and condition.
      return `hunt #${event.entityId} → #${event.targetId} ${event.captured ? 'caught' : 'missed'}${event.chance !== undefined ? ` (${Math.round(event.chance * 100)}%)` : ''}`;
    case 'entity.killed':
      return `killed #${event.entityId} by #${event.predatorId}`;
    case 'entity.escaped':
      return `escaped #${event.entityId} from #${event.predatorId}`;
    case 'entity.injured':
      return `injured #${event.entityId} (${event.injury}${event.severity !== undefined ? ` ${ratio(event.severity)}` : ''})${event.sourceId != null ? ` by #${event.sourceId}` : ''}`;
    case 'entity.recovered':
      return `healed #${event.entityId}${event.injury ? ` (${event.injury})` : ''}`;
    case 'entity.decayed':
      return `decayed #${event.entityId} → ${event.stageName ?? event.stage}${event.edibleMass !== undefined ? ` (${event.edibleMass.toFixed(1)}kg left)` : ''}`;
    case 'environment.changed':
      return `${event.season} · ${event.weather}${event.temperature !== undefined ? ` · ${event.temperature.toFixed(1)}°C` : ''}`;
    case 'entity.alarmed':
      // `hops` is what makes a wave of panic readable: 0 saw the predator,
      // 1 was told by someone who did, and so on outward.
      return `alarm #${event.entityId}${event.sourceId != null ? ` from #${event.sourceId}` : ' (saw it)'}${
        event.hops !== undefined ? ` ${event.hops}h` : ''
      }`;
    case 'entity.contested':
      // No odds, because there is no roll — dominance decides it. The two
      // scores are shown instead, which is the actual reason for the outcome.
      return `contest #${event.entityId} (${event.dominance?.toFixed(0)}) v #${event.opponentId} (${event.opponentDominance?.toFixed(0)}) → #${event.winnerId}${
        event.escalated ? ' FIGHT' : ' yielded'
      }`;
    case 'entity.disputed':
      // How much ground actually moved is the payload's whole point: a dispute
      // that transfers 40 cells is a resident being evicted, one that transfers
      // 1 is a scuffle at a boundary.
      return `ground #${event.entityId} (${event.dominance?.toFixed(0)}) v #${event.ownerId} (${event.ownerDominance?.toFixed(0)}) → #${event.winnerId}${
        event.escalated ? ' FIGHT' : ''
      }${event.cellsTransferred ? ` (+${event.cellsTransferred} cells)` : ''}`;
    case 'entity.defended':
      return `defends #${event.entityId} over #${event.wardId} against #${event.threatId}`;
    case 'entity.infected':
      // A null source is a case from outside the population, not a missing
      // field — which is why it says so rather than printing "#null".
      return `infected #${event.entityId} ${event.sourceId != null ? `by #${event.sourceId}` : '(from the environment)'}`;
    case 'entity.sickened':
      return `sickened #${event.entityId}`;
    case 'entity.cured':
      return `recovered #${event.entityId}${event.immuneUntil != null ? ` <immune to t${event.immuneUntil}>` : ''}`;
    case 'environment.feature':
      return `${event.kind} ${event.state} @${event.cellX},${event.cellY}`;
    case 'environment.disturbed':
      return `${event.kind} at ${event.x?.toFixed(0)},${event.y?.toFixed(0)} r${event.radius?.toFixed(0)} <until t${event.until}>`;
    case 'environment.settled':
      // How long it lasted is the fact the record no longer holds.
      return `${event.kind} ended at ${event.x?.toFixed(0)},${event.y?.toFixed(0)} <${event.durationTicks} ticks>`;
    case 'entity.migrated':
      // Where it moved *from* and *to*, because "moved house" is a claim about
      // two places. The distance is the part that says whether this was a shift
      // next door or an animal crossing the map.
      return `moved #${event.entityId} (${event.from?.x?.toFixed(0)},${event.from?.y?.toFixed(0)}) → (${event.to?.x?.toFixed(0)},${event.to?.y?.toFixed(0)}) ${event.distance?.toFixed(0)}u${
        event.reason ? ` [${event.reason}]` : ''
      }`;
    case 'entity.lifeEvent':
      // A dispersal carries the natal centre it is leaving, so the log shows
      // where an animal grew up rather than only that it left.
      return `${event.event ?? 'life event'} #${event.entityId}${event.guardianId != null ? ` from #${event.guardianId}` : ''}${
        event.x !== undefined ? ` (born ${event.x.toFixed(0)},${event.y.toFixed(0)})` : ''
      }`;
    default: {
      const extra = Object.entries(event)
        .filter(([key]) => !['seq', 'tick', 'type'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(' ');
      return `${event.type} ${extra}`.trim();
    }
  }
}

/**
 * A whole log line: the type's mark, then what happened. Exported so the line a
 * viewer actually reads can be tested without a DOM — the mark and the body are
 * assembled in exactly one place, and this is it.
 * @param {object} event
 * @returns {string}
 */
export function describeEvent(event) {
  return `${prefixFor(event.type)} ${formatEvent(event)}`;
}

function eventClass(event) {
  if (event.type === 'entity.died') return 'event-died';
  if (event.type === 'entity.created') return 'event-created';
  if (event.type === 'entity.removed') return 'event-removed';
  if (event.type === 'entity.moved') return 'event-moved';
  if (event.type === 'entity.fed' || event.type === 'entity.provisioned') return 'event-fed';
  if (event.type === 'entity.killed' || event.type === 'entity.hunted') return 'event-died';
  if (event.type === 'entity.escaped') return 'event-other';
  if (event.type === 'entity.injured') return 'event-died';
  if (event.type === 'entity.alarmed' || event.type === 'entity.contested') return 'event-other';
  if (event.type === 'entity.disputed' || event.type === 'entity.migrated') return 'event-other';
  if (event.type === 'entity.infected' || event.type === 'entity.sickened') return 'event-died';
  if (event.type === 'entity.cured') return 'event-created';
  if (event.type === 'entity.defended') return 'event-birth';
  if (event.type === 'entity.recovered') return 'event-created';
  if (event.type === 'entity.decayed') return 'event-removed';
  if (event.type === 'environment.changed') return 'event-created';
  if (event.type === 'environment.disturbed') return 'event-died';
  if (event.type === 'environment.settled') return 'event-created';
  if (
    event.type === 'entity.mated' ||
    event.type === 'entity.born' ||
    event.type === 'entity.courted' ||
    event.type === 'entity.lifeEvent'
  ) {
    return 'event-birth';
  }
  return 'event-other';
}

/**
 * The filter list, grouped by subject with a heading per group. Built once —
 * the catalog is fixed at build time, and only the checked state changes.
 * @returns {string}
 */
function filterListHtml() {
  let html = '';
  let group = null;
  for (const entry of EVENT_CATALOG) {
    if (entry.group !== group) {
      group = entry.group;
      html += `<p class="filter-group">${group}</p>`;
    }
    // `passing` types are the ones that arrive by the hundred per tick and are
    // kept only briefly; saying so beside the box is cheaper than letting
    // someone tick "movement" and wonder where the last minute of it went.
    const notes = [entry.hint, entry.retention === PASSING ? 'frequent · kept briefly' : '']
      .filter(Boolean)
      .join(' · ');
    html += `
      <label class="watch-row">
        <input type="checkbox" data-event-type="${entry.type}" />
        <span>${entry.label}${notes ? ` <span class="dim">${notes}</span>` : ''}</span>
      </label>`;
  }
  return html;
}

export class EventLog {
  #list;
  #boxes;
  #count;
  /** Filter ids currently shown, remembered across reloads. @type {Set<string>} */
  #showing = loadEventFilter();
  #onChanged;

  /**
   * @param {HTMLElement} container
   * @param {{onFilterChanged: () => void, onSelectEntity: (entityId: number) => void}} [callbacks]
   */
  constructor(container, { onFilterChanged = () => {}, onSelectEntity = () => {} } = {}) {
    this.#onChanged = onFilterChanged;
    // Every `#123` in the log is a way into the grid: click a birth to find the
    // calf, a hunt to find the quarry.
    container.addEventListener('click', (event) => {
      const entityId = event.target?.closest?.('[data-entity]')?.dataset?.entity;
      if (entityId) onSelectEntity(Number(entityId));
    });
    container.innerHTML = `
      <h2>Events</h2>
      <details class="inspector-section" id="event-log-filters">
        <summary><span class="section-title">Show</span> <span class="section-badge" id="event-log-filter-count">nothing</span></summary>
        <div class="section-body">
          <div class="control-row">
            <button type="button" id="event-log-all">all</button>
            <button type="button" id="event-log-none">none</button>
            <button type="button" id="event-log-default">births &amp; deaths</button>
          </div>
          ${filterListHtml()}
        </div>
      </details>
      <ul id="event-log-list" aria-label="Recent domain events"></ul>`;
    this.#list = container.querySelector('#event-log-list');
    this.#count = container.querySelector('#event-log-filter-count');
    this.#boxes = [...container.querySelectorAll('[data-event-type]')];

    for (const box of this.#boxes) {
      box.addEventListener('change', () => {
        if (box.checked) this.#showing.add(box.dataset.eventType);
        else this.#showing.delete(box.dataset.eventType);
        this.#filterChanged();
      });
    }
    container.querySelector('#event-log-all').addEventListener('click', () => {
      this.#setFilter(this.#boxes.map((box) => box.dataset.eventType));
    });
    container.querySelector('#event-log-none').addEventListener('click', () => this.#setFilter([]));
    container
      .querySelector('#event-log-default')
      .addEventListener('click', () => this.#setFilter(DEFAULT_EVENT_FILTER));
    this.#syncBoxes();
  }

  /** @param {Iterable<string>} ids */
  #setFilter(ids) {
    this.#showing = new Set(ids);
    this.#syncBoxes();
    this.#filterChanged();
  }

  #filterChanged() {
    saveEventFilter(this.#showing);
    this.#renderCount();
    this.#onChanged();
  }

  #syncBoxes() {
    for (const box of this.#boxes) box.checked = this.#showing.has(box.dataset.eventType);
    this.#renderCount();
  }

  #renderCount() {
    const count = this.#showing.size;
    this.#count.textContent = count === 0 ? 'nothing' : `${count} of ${this.#boxes.length}`;
    this.#count.className = count === 0 ? 'section-badge' : 'section-badge ok';
  }

  /** @param {import('../state/RendererStore.js').RendererStore} store */
  render(store) {
    // ⚠ **The remembered living form first, the current entity second.** A log
    // line is about a moment, not about now: a prey animal is already a carcass
    // by the time its hunt is drawn, and gone entirely a few hundred ticks
    // later — so resolving against `getEntity` alone turned `g65` into `%65`
    // and then `#65` while the line itself never changed. The store keeps what
    // each id looked like alive for exactly this. Falling back to the live
    // entity still covers what was never seen alive: a carcass already lying
    // there when this client connected.
    const refAppearance = (entityId) => {
      const entity = store.rememberedAnimal(entityId) ?? store.getEntity(entityId);
      return entity ? resolveAppearance(entity) : null;
    };
    const events = [];
    for (let i = store.events.length - 1; i >= 0 && events.length < MAX_RENDERED_EVENTS; i -= 1) {
      const event = store.events[i];
      if (!this.#showing.has(filterIdFor(event.type))) continue;
      events.push(event);
    }
    const fragment = document.createDocumentFragment();
    for (const event of events) {
      const item = document.createElement('li');
      item.className = eventClass(event);
      const tickSpan = document.createElement('span');
      tickSpan.className = 'dim';
      tickSpan.textContent = `t${event.tick} `;
      item.append(tickSpan);
      // Event lines are plain text that legitimately contains `<` and `>`
      // (`<until t1205>`, `→`), so they are escaped first and linkified second.
      // Reversing that order would let an event's own punctuation become markup.
      //
      // The resolver is what puts each animal's own glyph in front of its id
      // (`g412` rather than `#412`), so a line says what it is about before you
      // read it. It is a store lookup plus a cached appearance, per reference —
      // and an id the store no longer holds resolves to null and stays `#412`,
      // because a death does not tell us what the animal looked like.
      const line = document.createElement('span');
      line.innerHTML = linkifyIds(escapeHtml(describeEvent(event)), refAppearance);
      item.append(line);
      fragment.append(item);
    }
    this.#list.replaceChildren(fragment);
  }
}
