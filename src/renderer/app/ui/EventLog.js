/**
 * Bounded domain-event log. Known event types get compact one-line
 * formatting; unknown types fall back to a generic rendering instead of
 * failing. Some events recur every tick per animal (movement, feeding,
 * provisioning) and would drown out the milestones, so they are hidden behind
 * a renderer-local toggle by default.
 */

import { linkifyIds } from './InspectorView.js';

const MAX_RENDERED_EVENTS = 60;

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** High-frequency events, hidden unless "show routine" is checked. */
const ROUTINE_EVENT_TYPES = new Set([
  'entity.moved',
  'entity.fed',
  'entity.provisioned',
  'entity.alarmed',
  // Ground wearing in and fading out (Step 28) is genuine turnover rather than
  // noise — animals really do use a patch and then abandon it — but it happens
  // most of a tick, and the *state* already rides in every snapshot. So the log
  // hides it by default rather than the simulation emitting less of it.
  'environment.feature',
]);

function formatEvent(event) {
  switch (event.type) {
    case 'entity.created':
      return `+ created #${event.entityId} ${event.speciesId ?? event.kind ?? ''}`;
    case 'entity.moved':
      return `~ moved #${event.entityId} → ${event.to ? `${event.to.x.toFixed(1)},${event.to.y.toFixed(1)}` : '?'}`;
    case 'entity.died':
      return `x died #${event.entityId}${event.cause ? ` (${event.cause})` : ''}`;
    case 'entity.removed':
      return `- removed #${event.entityId}`;
    case 'entity.fed':
      return `= fed #${event.entityId}${event.cell ? ` @${event.cell.cellX},${event.cell.cellY}` : ''}${event.amount !== undefined ? ` +${event.amount.toFixed(2)}` : ''}`;
    case 'entity.mated':
      return `& mated #${event.entityId} + #${event.partnerId}${event.quality !== undefined ? ` (${event.quality.toFixed(2)})` : ''}`;
    case 'entity.courted':
      // Quality against the standard it was held to, for the same reason
      // `entity.hunted` shows its odds: the verdict should be checkable.
      return `? courted #${event.entityId} → #${event.candidateId} ${event.accepted ? 'accepted' : 'rejected'}${
        event.quality !== undefined ? ` (${event.quality.toFixed(2)} vs ${event.threshold.toFixed(2)})` : ''
      }`;
    case 'entity.born':
      return `* born #${event.entityId}${event.sex ? ` ${event.sex}` : ''}${event.parents ? ` of ${event.parents.map((id) => `#${id}`).join(' + ')}` : ''}`;
    case 'entity.provisioned':
      return `^ fed #${event.entityId} by #${event.guardianId}${event.amount !== undefined ? ` +${event.amount.toFixed(2)}` : ''}`;
    case 'entity.hunted':
      // The odds are shown because a hunt is not a coin flip: the number comes
      // from the two animals' speed, stamina, and condition.
      return `> hunt #${event.entityId} → #${event.targetId} ${event.captured ? 'caught' : 'missed'}${event.chance !== undefined ? ` (${Math.round(event.chance * 100)}%)` : ''}`;
    case 'entity.killed':
      return `X killed #${event.entityId} by #${event.predatorId}`;
    case 'entity.escaped':
      return `/ escaped #${event.entityId} from #${event.predatorId}`;
    case 'entity.injured':
      return `! injured #${event.entityId} (${event.injury}${event.severity !== undefined ? ` ${event.severity.toFixed(2)}` : ''})${event.sourceId != null ? ` by #${event.sourceId}` : ''}`;
    case 'entity.recovered':
      return `+ recovered #${event.entityId}${event.injury ? ` (${event.injury})` : ''}`;
    case 'entity.decayed':
      return `~ decayed #${event.entityId} → ${event.stageName ?? event.stage}${event.edibleMass !== undefined ? ` (${event.edibleMass.toFixed(1)}kg left)` : ''}`;
    case 'environment.changed':
      return `@ ${event.season} · ${event.weather}${event.temperature !== undefined ? ` · ${event.temperature.toFixed(1)}°C` : ''}`;
    case 'entity.alarmed':
      // `hops` is what makes a wave of panic readable: 0 saw the predator,
      // 1 was told by someone who did, and so on outward.
      return `! alarm #${event.entityId}${event.sourceId != null ? ` from #${event.sourceId}` : ' (saw it)'}${
        event.hops !== undefined ? ` ${event.hops}h` : ''
      }`;
    case 'entity.contested':
      // No odds, because there is no roll — dominance decides it. The two
      // scores are shown instead, which is the actual reason for the outcome.
      return `vs contest #${event.entityId} (${event.dominance?.toFixed(0)}) v #${event.opponentId} (${event.opponentDominance?.toFixed(0)}) → #${event.winnerId}${
        event.escalated ? ' FIGHT' : ' yielded'
      }`;
    case 'entity.disputed':
      // How much ground actually moved is the payload's whole point: a dispute
      // that transfers 40 cells is a resident being evicted, one that transfers
      // 1 is a scuffle at a boundary.
      return `[] ground #${event.entityId} (${event.dominance?.toFixed(0)}) v #${event.ownerId} (${event.ownerDominance?.toFixed(0)}) → #${event.winnerId}${
        event.escalated ? ' FIGHT' : ''
      }${event.cellsTransferred ? ` (+${event.cellsTransferred} cells)` : ''}`;
    case 'entity.defended':
      return `# defends #${event.entityId} over #${event.wardId} against #${event.threatId}`;
    case 'entity.infected':
      // A null source is a case from outside the population, not a missing
      // field — which is why it says so rather than printing "#null".
      return `~ infected #${event.entityId} ${event.sourceId != null ? `by #${event.sourceId}` : '(from the environment)'}`;
    case 'entity.sickened':
      return `!! sickened #${event.entityId}`;
    case 'entity.cured':
      return `++ recovered #${event.entityId}${event.immuneUntil != null ? ` <immune to t${event.immuneUntil}>` : ''}`;
    case 'environment.feature':
      return `${event.state === 'formed' ? '::' : '..'} ${event.kind} ${event.state} @${event.cellX},${event.cellY}`;
    case 'environment.disturbed':
      return `*! ${event.kind} at ${event.x?.toFixed(0)},${event.y?.toFixed(0)} r${event.radius?.toFixed(0)} <until t${event.until}>`;
    case 'environment.settled':
      // How long it lasted is the fact the record no longer holds.
      return `*. ${event.kind} ended at ${event.x?.toFixed(0)},${event.y?.toFixed(0)} <${event.durationTicks} ticks>`;
    case 'entity.migrated':
      // Where it moved *from* and *to*, because "moved house" is a claim about
      // two places. The distance is the part that says whether this was a shift
      // next door or an animal crossing the map.
      return `=> moved #${event.entityId} (${event.from?.x?.toFixed(0)},${event.from?.y?.toFixed(0)}) → (${event.to?.x?.toFixed(0)},${event.to?.y?.toFixed(0)}) ${event.distance?.toFixed(0)}u${
        event.reason ? ` [${event.reason}]` : ''
      }`;
    case 'entity.lifeEvent':
      // A dispersal carries the natal centre it is leaving, so the log shows
      // where an animal grew up rather than only that it left.
      return `> ${event.event ?? 'life event'} #${event.entityId}${event.guardianId != null ? ` from #${event.guardianId}` : ''}${
        event.x !== undefined ? ` (born ${event.x.toFixed(0)},${event.y.toFixed(0)})` : ''
      }`;
    default: {
      const extra = Object.entries(event)
        .filter(([key]) => !['seq', 'tick', 'type'].includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(' ');
      return `? ${event.type} ${extra}`.trim();
    }
  }
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

export class EventLog {
  #list;
  #showMoves = false;
  #onChanged;

  /**
   * @param {HTMLElement} container
   * @param {{onFilterChanged: () => void}} [callbacks]
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
      <label class="log-filter"><input type="checkbox" id="event-log-moves" /> show routine (moves, feeding)</label>
      <ul id="event-log-list" aria-label="Recent domain events"></ul>`;
    this.#list = container.querySelector('#event-log-list');
    container.querySelector('#event-log-moves').addEventListener('change', (event) => {
      this.#showMoves = event.target.checked;
      this.#onChanged();
    });
  }

  /** @param {import('../state/RendererStore.js').RendererStore} store */
  render(store) {
    const events = [];
    for (let i = store.events.length - 1; i >= 0 && events.length < MAX_RENDERED_EVENTS; i -= 1) {
      const event = store.events[i];
      if (!this.#showMoves && ROUTINE_EVENT_TYPES.has(event.type)) continue;
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
      const line = document.createElement('span');
      line.innerHTML = linkifyIds(escapeHtml(formatEvent(event)));
      item.append(line);
      fragment.append(item);
    }
    this.#list.replaceChildren(fragment);
  }
}
