/**
 * Bounded domain-event log. Known event types get compact one-line
 * formatting; unknown types fall back to a generic rendering instead of
 * failing. `entity.moved` events flood at one per animal per tick, so they
 * are hidden behind a renderer-local toggle by default.
 */

const MAX_RENDERED_EVENTS = 60;

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
  if (event.type === 'entity.fed') return 'event-fed';
  if (event.type === 'entity.mated' || event.type === 'entity.born') return 'event-birth';
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
      if (!this.#showMoves && (event.type === 'entity.moved' || event.type === 'entity.fed')) continue;
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
