/**
 * Entity inspector panel. Shows every occupant of the selected cell, the
 * active occupant's protocol-visible fields, optional live inspection
 * detail (absolute energy, remembered places, traits, family links, and the
 * bounded life-history timeline from the entity.inspection endpoint), and
 * recent domain events involving the entity. Only fields the protocol actually
 * provides are shown — no invented biology.
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

export class EntityInspector {
  #container;
  #callbacks;

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
   */
  render(store, inspectionDetail) {
    const selection = store.selection;
    if (!selection) {
      this.#container.innerHTML = `
        <h2>Inspector</h2>
        <p class="hint">Click a cell to select an entity.<br />Tab cycles occupants, F follows, Esc clears.</p>`;
      return;
    }
    const occupants = selection.entityIds
      .map((entityId) => ({ entityId, entity: store.getEntity(entityId) }))
      .filter(({ entity }) => entity !== null || selection.entityIds.includes(selection.activeId));
    const active = store.getEntity(selection.activeId);
    const activeIndex = selection.entityIds.indexOf(selection.activeId);
    const following = store.followedEntityId === selection.activeId;

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

    let fields = '<p class="hint">This entity no longer exists.</p>';
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
        ${active.lifeStage ? `<div class="field"><span>life stage</span><span>${escapeHtml(active.lifeStage)}</span></div>` : ''}
        ${active.action ? `<div class="field"><span>action</span><span>${escapeHtml(active.action)}</span></div>` : ''}
        <div class="field"><span>position</span><span>${active.x.toFixed(2)}, ${active.y.toFixed(2)}</span></div>
        <div class="field"><span>heading</span><span>${formatHeading(active.heading)}</span></div>
        <div class="field"><span>age</span><span>${active.age} ticks</span></div>
        <div class="field"><span>body mass</span><span>${active.bodyMass} kg</span></div>
        <div class="field"><span>energy %</span><span>${Math.round(active.energyFraction * 100)}%</span></div>
        ${active.hydrationFraction !== undefined ? `<div class="field"><span>hydration %</span><span class="${active.hydrationFraction < 0.25 ? 'warn' : ''}">${Math.round(active.hydrationFraction * 100)}%</span></div>` : ''}
        <div class="field"><span>health %</span><span>${Math.round(active.healthFraction * 100)}%</span></div>
        ${detail}
        <div class="field"><span>alive</span><span class="${active.alive ? 'ok' : 'bad'}">${active.alive ? 'yes' : 'no'}</span></div>`;
    }

    const liveDetail = active && inspectionDetail?.entity?.id === active.id ? inspectionDetail.entity : null;
    const utilitiesBlock = liveDetail
      ? formatUtilities(liveDetail.utilityBreakdown, active.action, liveDetail.actionTarget)
      : '';
    const perceptionBlock = formatPerception(liveDetail ? liveDetail.perception : null);
    const familyBlock = formatFamily(liveDetail);
    const traitsBlock = formatTraits(liveDetail);
    const memoriesBlock = formatMemories(liveDetail);

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
      ${memoriesBlock}
      ${traitsBlock}
      ${familyBlock}
      ${utilitiesBlock}
      ${perceptionBlock}
      <div class="inspector-actions">
        ${occupants.length > 1 ? '<button type="button" data-action="cycle">Cycle (Tab)</button>' : ''}
        <button type="button" data-action="follow">${following ? 'Unfollow (F)' : 'Follow (F)'}</button>
      </div>
      ${events ? `<h3>Recent events</h3><ul class="entity-events">${events}</ul>` : ''}`;
  }
}
