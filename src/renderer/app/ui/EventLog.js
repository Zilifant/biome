/**
 * Bounded domain-event log. Known event types get compact one-line
 * formatting; unknown types fall back to a generic rendering instead of
 * failing. Some events recur every tick per animal (movement, feeding,
 * provisioning) and would drown out the milestones, so they are hidden behind
 * a renderer-local toggle by default.
 */

const MAX_RENDERED_EVENTS = 60;

/** High-frequency events, hidden unless "show routine" is checked. */
const ROUTINE_EVENT_TYPES = new Set(['entity.moved', 'entity.fed', 'entity.provisioned']);

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
      return `& mated #${event.entityId} + #${event.partnerId}`;
    case 'entity.born':
      return `* born #${event.entityId}${event.parents ? ` of ${event.parents.map((id) => `#${id}`).join(' + ')}` : ''}`;
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
    case 'entity.lifeEvent':
      return `> ${event.event ?? 'life event'} #${event.entityId}${event.guardianId != null ? ` from #${event.guardianId}` : ''}`;
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
  if (event.type === 'entity.recovered') return 'event-created';
  if (event.type === 'entity.decayed') return 'event-removed';
  if (event.type === 'environment.changed') return 'event-created';
  if (event.type === 'entity.mated' || event.type === 'entity.born' || event.type === 'entity.lifeEvent') {
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
  constructor(container, { onFilterChanged = () => {} } = {}) {
    this.#onChanged = onFilterChanged;
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
      item.append(tickSpan, document.createTextNode(formatEvent(event)));
      fragment.append(item);
    }
    this.#list.replaceChildren(fragment);
  }
}
