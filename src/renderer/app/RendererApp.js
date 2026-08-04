/**
 * Renderer orchestration: wires transports → store → canvas + panels,
 * owns the requestAnimationFrame loop, and handles all input.
 *
 * Clock separation: the simulation tick arrives in messages, message
 * arrival happens on transport callbacks, and drawing happens on browser
 * frames. Nothing here ever advances simulation time — the grid redraws
 * only when marked dirty (state change, camera move, selection change,
 * resize), showing discrete cell changes between authoritative ticks.
 */
import { StoreDesyncError, RendererProtocolError } from './state/RendererStore.js';
import { Camera } from './rendering/Camera.js';
import { createProjection, occupantsInCell, worldCellOf } from './rendering/GridProjection.js';
import { compareOccupants, STATUS_CYCLE_MS } from './rendering/EntityAppearance.js';
import { AsciiGridRenderer } from './rendering/AsciiGridRenderer.js';
import { TransportEvents } from './transports/RendererTransport.js';
import { describeCell } from './ui/CellDetail.js';
import { matchWatched } from './ui/Watchlist.js';

/**
 * Pointer movement, in CSS pixels, past which a press is a pan rather than a
 * click. Small enough that a deliberate click never pans, large enough that a
 * shaky click still selects.
 */
const DRAG_THRESHOLD_PX = 4;

export class RendererApp {
  #store;
  #transport;
  #http;
  #canvas;
  #grid;
  #camera;
  #ui;
  #mode;
  #dirty = true;
  #hasCentered = false;
  /** Which status a multi-status animal is showing: a wall-clock counter. */
  #statusPhase = 0;
  #recovering = false;
  /**
   * The cell under the pointer, or null when the pointer is off the grid or a
   * drag is in progress. Drawn as yellow corner brackets (the cursor itself is
   * hidden over the grid), distinct from the selected cell's grey fill.
   * @type {{cellX: number, cellY: number} | null}
   */
  #hoverCell = null;
  /**
   * The host's run state, as *reported* rather than remembered (C1). This used
   * to be a single `paused` flag fetched once at startup and updated only by
   * commands this client sent — so anything else pausing the simulation left
   * the renderer confidently wrong, and Space did the opposite of what the
   * button said. `null` means "not yet known".
   * @type {{paused: boolean | null, speed: number, running: boolean}}
   */
  #runState = { paused: null, speed: 1, running: false };
  /** @type {object | null} last entity.inspection payload */
  #inspectionDetail = null;
  /** @type {object | null} last metrics query payload */
  #metrics = null;
  #metricsTimer = null;
  #metricsIntervalMs;
  /** Poll handle for the selected entity's inspection detail (B5). */
  #inspectionTimer = null;
  #inspectionIntervalMs;

  /**
   * @param {object} options
   * @param {import('./state/RendererStore.js').RendererStore} options.store
   * @param {import('./transports/RendererTransport.js').RendererTransport} options.transport primary stream
   * @param {import('./transports/HttpRendererTransport.js').HttpRendererTransport | null} options.http
   *        query/recovery channel (live mode only)
   * @param {HTMLCanvasElement} options.canvas
   * @param {{statusPanel: object, inspector: object, metricsPanel: object,
   *          eventLog: object, controls: object}} options.ui
   * @param {'live' | 'fixture'} options.mode
   * @param {number} [options.metricsIntervalMs] metrics poll cadence (live only)
   * @param {number} [options.inspectionIntervalMs] selected-entity detail cadence
   * @param {(canvas: HTMLCanvasElement) => object} [options.createGridRenderer]
   *        factory for the grid renderer — the swap seam for alternative
   *        renderers (sprite mode). Any replacement implements the same
   *        contract: resize(w, h, dpr), cssWidth/cssHeight, draw({...}).
   */
  constructor({ store, transport, http, canvas, ui, mode, metricsIntervalMs = 3000, inspectionIntervalMs = 2000, createGridRenderer = (element) => new AsciiGridRenderer(element) }) {
    this.#store = store;
    this.#transport = transport;
    this.#http = http;
    this.#canvas = canvas;
    this.#grid = createGridRenderer(canvas);
    this.#camera = new Camera();
    this.#ui = ui;
    this.#mode = mode;
    this.#metricsIntervalMs = metricsIntervalMs;
    this.#inspectionIntervalMs = inspectionIntervalMs;
  }

  get camera() {
    return this.#camera;
  }

  /**
   * Mark the grid dirty from outside the app's own handlers — e.g. a renderer
   * whose spritesheet finished loading after the first frames were drawn.
   * Nothing is drawn here; the rAF loop picks the flag up on its next frame.
   */
  requestRedraw() {
    this.#dirty = true;
  }

  start() {
    this.#store.setMode(this.#mode);
    this.#store.subscribe(() => {
      this.#dirty = true;
      this.#updatePanels();
    });
    this.#transport.subscribe((event) => this.#onTransportEvent(event));

    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    // ⚠ The grid's size is no longer only the window's. Dragging a column edge
    // (ui/columnResize.js) or folding a panel changes the viewport without any
    // window event, so the wrapper is observed directly and the window listener
    // above is only the fallback for a browser without ResizeObserver. Observing
    // the *wrapper* rather than the canvas is what keeps this from looping: the
    // wrapper is sized by the grid, and resizing the canvas inside it cannot
    // change it back.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.#resize()).observe(this.#canvas.parentElement);
    }
    this.#bindPointer();
    this.#bindKeyboard();

    if (this.#mode === 'fixture') {
      this.#ui.controls.setSimulationCommandsEnabled(false, 'fixture mode replays recorded data; no live simulation');
      this.#ui.controls.setReconnectLabel('Replay');
    }

    // Metrics are a summary view, so they are polled rather than streamed —
    // histograms for every trait of every species would dwarf the per-tick
    // payload, and nothing here needs tick resolution. The run state rides the
    // same timer: it is equally cheap, equally not per-tick, and polling it is
    // the whole of C1 — the renderer reports what the host says rather than
    // what it last told the host to do.
    if (this.#http) {
      const poll = async () => {
        try {
          this.#metrics = await this.#http.requestMetrics();
          this.#ui.metricsPanel.render(this.#metrics);
        } catch {
          // Optional enrichment; the rest of the view stands alone.
        }
        try {
          this.#applyRunState(await this.#http.getStatus());
        } catch {
          // Leave the last known state rather than claiming a wrong one.
        }
      };
      poll();
      this.#metricsTimer = setInterval(poll, this.#metricsIntervalMs);
    } else {
      this.#ui.metricsPanel.render(null);
    }

    this.#transport.connect();
    const frame = (now) => {
      // An animal in several statuses shows them one at a time, and the turn is
      // taken on the *wall* clock rather than the tick stream — so a paused
      // world still cycles, which is when a viewer is most likely to be reading
      // the marks. Redrawn only when the phase actually turns over, and only
      // while something on screen is mid-cycle: a still, unremarkable world
      // costs no frames at all.
      const phase = Math.floor((now ?? 0) / STATUS_CYCLE_MS);
      if (phase !== this.#statusPhase) {
        this.#statusPhase = phase;
        if (this.#grid.hasCyclingStatus) this.#dirty = true;
      }
      if (this.#dirty) {
        this.#dirty = false;
        this.#grid.draw({
          store: this.#store,
          camera: this.#camera,
          familyIds: this.#familyIds(),
          memories: this.#selectedMemories(),
          huntTargetId: this.#huntTargetId(),
          groupId: this.#selectedGroupId(),
          homeRange: this.#selectedHomeRange(),
          hoverCell: this.#hoverCell,
          statusPhase: this.#statusPhase,
          killCells: this.#killCells(),
        });
        this.#ui.statusPanel.update(this.#store, this.#camera, this.#runState);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- transport

  #onTransportEvent(event) {
    switch (event.type) {
      case TransportEvents.CONNECTION:
        this.#store.setConnection(event.state, event.detail ?? '');
        break;
      case TransportEvents.SNAPSHOT:
        this.#applySnapshot(event.snapshot);
        break;
      case TransportEvents.DELTA:
        this.#applyDelta(event.delta);
        break;
      case TransportEvents.EVENTS:
        try {
          this.#store.applyEventBatch(event.batch);
        } catch (error) {
          this.#reportProtocolProblem(error);
        }
        break;
      case TransportEvents.COMMAND_RESULT:
        // Promise-based senders surface results; nothing extra to do here.
        break;
      case TransportEvents.NOTICE:
        this.#ui.statusPanel.setCommandStatus(event.message, event.level === 'warn' ? 'warn' : 'ok');
        break;
      default:
        break;
    }
  }

  #applySnapshot(snapshot) {
    try {
      this.#store.applyFullSnapshot(snapshot);
      this.#recovering = false;
      if (!this.#hasCentered && this.#store.world) {
        this.#camera.centerOn(this.#store.world.width / 2, this.#store.world.height / 2);
        this.#hasCentered = true;
      }
    } catch (error) {
      this.#reportProtocolProblem(error);
    }
  }

  #applyDelta(delta) {
    try {
      const result = this.#store.applyDelta(delta);
      if (result.applied) {
        this.#followCamera();
        this.#checkWatchlist(delta.events);
      }
    } catch (error) {
      if (error instanceof StoreDesyncError) {
        this.#recoverFromDesync(error);
      } else {
        this.#reportProtocolProblem(error);
      }
    }
  }

  /**
   * Desynchronized: request a fresh FULL snapshot instead of guessing.
   * (Bounded snapshots are not used for recovery because protocol v1 deltas
   * are world-global — a partial store would immediately desync again.)
   */
  async #recoverFromDesync(error) {
    if (this.#recovering) return;
    this.#recovering = true;
    this.#ui.statusPanel.setCommandStatus(`desynchronized (${error.message}) — requesting full snapshot`, 'warn');
    try {
      const source = this.#http ?? this.#transport;
      const snapshot = await source.requestSnapshot();
      if (snapshot) this.#applySnapshot(snapshot);
      else this.#ui.statusPanel.setCommandStatus('recovery failed: no snapshot available', 'bad');
    } catch (requestError) {
      this.#ui.statusPanel.setCommandStatus(`recovery failed: ${requestError}`, 'bad');
    } finally {
      this.#recovering = false;
    }
  }

  #reportProtocolProblem(error) {
    const label = error instanceof RendererProtocolError ? `protocol: ${error.message}` : String(error);
    this.#ui.statusPanel.setCommandStatus(label, 'bad');
  }

  // ----------------------------------------------------------------- commands

  /**
   * All external change flows through protocol commands on a transport.
   *
   * ⚠ **Sending clears the last report.** The status line says what the current
   * command did, so the previous one's message is stale the instant another
   * command goes out — and a stale "failed" or "paused: kill" left on screen
   * reads as the state right now rather than as history. This is the single
   * chokepoint every command passes through, which is why the clear lives here
   * rather than at each of the callers that later write a result.
   * @param {object} command
   */
  async sendCommand(command) {
    this.#ui.statusPanel.clearCommandStatus();
    let result;
    if (this.#mode === 'live' && this.#transport.isOpen === false && this.#http) {
      result = await this.#http.sendCommand(command);
    } else {
      result = await this.#transport.sendCommand(command);
    }
    // Command results already carry the new run state (`paused`, `speed`), so
    // the panel updates immediately rather than waiting out the poll interval.
    // The poll remains the source of truth; this is only how it stops lagging.
    if (result?.ok) this.#applyRunState(result);
    return result;
  }

  /**
   * Adopt whatever the host reported about its run state. Fields are taken only
   * when present, since a command result carries a subset of what `/api/status`
   * does.
   * @param {{paused?: boolean, speed?: number, running?: boolean}} report
   */
  #applyRunState(report) {
    if (typeof report?.seed === 'number') this.#ui.controls.setSeed(report.seed);
    // The host's species roster (protocol v29): the restart panel builds one
    // founder field per species from it rather than hardcoding three roles. Only
    // the status report carries it — a command result does not — which is why
    // this is guarded like every other field here.
    if (Array.isArray(report?.species)) this.#ui.controls.setSpecies(report.species);
    if (typeof report?.paused === 'boolean') this.#runState.paused = report.paused;
    if (typeof report?.speed === 'number') this.#runState.speed = report.speed;
    if (typeof report?.running === 'boolean') this.#runState.running = report.running;
    this.#ui.controls.setRunState(this.#runState);
    this.#dirty = true;
  }

  /**
   * Advance the simulation by whole ticks, pausing first if it is running (C3).
   *
   * `simulation.step` is refused outright while the runner's timer is going —
   * so a Step button on a running simulation used to print a red error rather
   * than doing the obvious thing. Pausing first is two existing commands in
   * sequence, entirely renderer-side.
   * @param {number} ticks
   */
  async stepTicks(ticks) {
    if (this.#runState.paused !== true) {
      const paused = await this.sendCommand({ type: 'simulation.pause' });
      if (!paused?.ok) {
        this.#ui.controls.showResult({ type: 'simulation.pause' }, paused);
        return paused;
      }
    }
    const result = await this.sendCommand({ type: 'simulation.step', ticks });
    this.#ui.controls.showResult({ type: 'simulation.step', ticks }, result);
    return result;
  }

  /**
   * Pause when a watched event goes by, and show what stopped it.
   *
   * Renderer policy over authoritative output: the engine emits the events it
   * always did and this responds with the ordinary pause command. It stops
   * *just after* the event rather than at it — the delta for that tick is
   * already applied and the pause is a round trip on top — so at high speed it
   * can overshoot. Pausing exactly at the event would be a breakpoint inside
   * the runner, which is a protocol change rather than a renderer feature.
   *
   * @param {object[]} events the batch that arrived with this delta
   */
  #checkWatchlist(events) {
    if (this.#mode !== 'live' || this.#runState.paused !== false) return;
    const match = matchWatched(events, this.#ui.controls.watching);
    if (!match) return;
    // Guard against a second trigger from the same batch while the pause is in
    // flight: the flag only turns true when the host confirms.
    this.#runState.paused = true;
    this.sendCommand({ type: 'simulation.pause' }).then((result) => {
      if (!result?.ok) {
        this.#runState.paused = false;
        return;
      }
      this.#ui.statusPanel.setCommandStatus(`paused: ${match.watchable.label} (t${match.event.tick})`, 'warn');
      // Go to it. Being interrupted is only useful if you can see what for.
      const entityId = match.event.entityId ?? match.event.disturbanceId ?? null;
      if (typeof entityId === 'number') this.selectEntity(entityId);
      else if (typeof match.event.x === 'number') {
        this.#camera.centerOn(match.event.x, match.event.y);
        this.#camera.clampToWorld(this.#store.world);
        this.#dirty = true;
      }
    });
  }

  /**
   * Rebuild the world. A restart shares no ids, no tick, and not even a
   * `simulationId` with what came before, so everything the renderer holds
   * about the old world — selection, inspection detail, follow target — is
   * dropped rather than left pointing at animals that no longer exist.
   * @param {object} command
   */
  async restart(command) {
    const result = await this.sendCommand(command);
    this.#ui.controls.showResult(command, result);
    if (!result?.ok) return result;
    this.clearSelection();
    this.#store.setFollowedEntity(null);
    this.#hasCentered = false;
    this.#ui.controls.setSeed(result.seed);
    this.#ui.statusPanel.setCommandStatus(`restarted — seed ${result.seed}`, 'ok');
    return result;
  }

  /** Pause or resume, whichever the host is not currently doing. */
  async toggleRun() {
    const command = { type: this.#runState.paused ? 'simulation.resume' : 'simulation.pause' };
    const result = await this.sendCommand(command);
    this.#ui.controls.showResult(command, result);
    return result;
  }

  reconnect() {
    this.#transport.disconnect();
    this.#transport.connect();
  }

  // ---------------------------------------------------------------- selection

  /**
   * Select a world cell. The cell is the unit of selection, not the entity:
   * bare ground is still terrain, forage, worn ground, and possibly a fire, so
   * clicking it reports the ground rather than clearing. Occupants sort by
   * display priority, the top one becomes active, and Tab cycles the rest.
   * Local only — nothing is sent anywhere.
   * @param {number} cellX
   * @param {number} cellY
   */
  selectCell(cellX, cellY) {
    const occupants = occupantsInCell(this.#store.entities.values(), cellX, cellY, this.#store.world).sort(
      compareOccupants,
    );
    const entityIds = occupants.map((entity) => entity.id);
    const activeId = entityIds[0] ?? null;
    this.#store.setSelection({ cellX, cellY, entityIds, activeId });
    this.#inspectionDetail = null;
    this.#anchorInspector(cellX, cellY);
    if (activeId !== null) this.#refreshInspection(activeId);
  }

  /**
   * Point the inspector at a cell's on-screen position. The projection is the
   * renderer's own, so this is the same arithmetic that decided which cell was
   * clicked — the panel cannot end up beside the wrong cell.
   */
  #anchorInspector(cellX, cellY) {
    const projection = createProjection(this.#camera, this.#grid.cssWidth, this.#grid.cssHeight);
    const { px, py } = projection.cellToScreen(cellX, cellY);
    this.#ui.inspector.anchorAt?.(px + projection.cellSize, py);
  }

  cycleSelection() {
    const selection = this.#store.selection;
    if (!selection || selection.entityIds.length < 2) return;
    const alive = selection.entityIds.filter((entityId) => this.#store.getEntity(entityId) !== null);
    if (alive.length === 0) return;
    const currentIndex = alive.indexOf(selection.activeId);
    const nextId = alive[(currentIndex + 1) % alive.length];
    this.#store.setSelection({ ...selection, activeId: nextId });
    this.#refreshInspection(nextId);
  }

  clearSelection() {
    this.#store.setSelection(null);
    this.#inspectionDetail = null;
    this.#stopInspectionPolling();
  }

  /**
   * Fetch protocol inspection detail for the active entity (live only), and
   * keep it fresh while that entity stays selected.
   *
   * Inspection is a query rather than a stream, so without this the utilities,
   * perception, memories, and stamina of a selected animal freeze at the moment
   * it was clicked while the animal carries on acting — which made the most
   * interesting part of the panel the least trustworthy. One entity at a time,
   * on a slow cadence, and cancelled the moment the selection changes.
   */
  async #refreshInspection(entityId) {
    this.#inspectionDetail = null;
    this.#stopInspectionPolling();
    if (!this.#http) return;
    await this.#fetchInspection(entityId);
    // Only poll while something is selected; a stale timer outliving its
    // selection is how these turn into a leak.
    this.#inspectionTimer = setInterval(() => {
      const activeId = this.#store.selection?.activeId ?? null;
      if (activeId === null) {
        this.#stopInspectionPolling();
        return;
      }
      this.#fetchInspection(activeId);
    }, this.#inspectionIntervalMs);
  }

  async #fetchInspection(entityId) {
    try {
      const inspection = await this.#http.requestEntity(entityId);
      // The selection can change while the request is in flight; a late reply
      // for an animal nobody is looking at any more must not overwrite the one
      // they are.
      if (inspection?.found && this.#store.selection?.activeId === entityId) {
        this.#inspectionDetail = inspection;
        this.#dirty = true;
        this.#updatePanels();
      }
    } catch {
      // Inspection detail is optional enrichment; the store view stands alone.
    }
  }

  #stopInspectionPolling() {
    if (this.#inspectionTimer !== null) {
      clearInterval(this.#inspectionTimer);
      this.#inspectionTimer = null;
    }
  }

  /**
   * Select an entity by id and bring it into view — what makes the `#123`
   * references in the inspector and event log navigable. Nothing is sent
   * anywhere: this is a camera move plus a local selection.
   * @param {number} entityId
   */
  selectEntity(entityId) {
    const entity = this.#store.getEntity(entityId);
    if (!entity) {
      this.#ui.statusPanel.setCommandStatus(`#${entityId} is not in view`, 'warn');
      return;
    }
    const cell = worldCellOf(entity, this.#store.world);
    this.#camera.centerOn(entity.x, entity.y);
    this.#camera.clampToWorld(this.#store.world);
    this.#dirty = true;
    this.selectCell(cell.cellX, cell.cellY);
    // Selecting by id means asking for *that* animal, so make it active even
    // when something else outranks it in the same cell.
    const selection = this.#store.selection;
    if (selection?.entityIds.includes(entityId) && selection.activeId !== entityId) {
      this.#store.setSelection({ ...selection, activeId: entityId });
      this.#refreshInspection(entityId);
    }
  }

  /**
   * Cells where something was killed on the tick now being displayed, for the
   * red flash on the grid.
   *
   * ⚠ **Read back from the event buffer, not from a field.** `entity.killed`
   * carries `{ entityId, predatorId }` and no position — but the body is at the
   * death site and arrives in the same delta, so the cell is a lookup rather
   * than a protocol change. An id that is somehow gone contributes nothing
   * instead of guessing a cell.
   *
   * The scan walks *backwards* and stops at the first event from an earlier
   * tick, which costs a handful of comparisons against a 20 000-event buffer:
   * events are seq-ascending and therefore tick-ascending, so this tick's are
   * the tail. ⚠ That also gives the right answer for a coalesced step, where
   * kills from earlier ticks in the window are simply not from *this* tick and
   * are not flashed — the alternative would be a screen of red after
   * `Advance 500`.
   *
   * @returns {Array<{cellX: number, cellY: number}>}
   */
  #killCells() {
    const events = this.#store.events;
    const cells = [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.tick !== this.#store.tick) break;
      if (event.type !== 'entity.killed') continue;
      const prey = this.#store.getEntity(event.entityId);
      if (prey) cells.push(worldCellOf(prey, this.#store.world));
    }
    return cells;
  }

  /**
   * The prey the selected predator is pursuing (protocol v15), so a chase can
   * be followed on the grid rather than inferred from two moving glyphs.
   * @returns {number | null}
   */
  #huntTargetId() {
    const detail = this.#inspectionDetail?.entity;
    if (!detail || detail.id !== this.#store.selection?.activeId) return null;
    return detail.huntTargetId ?? null;
  }

  /**
   * The selected animal's herd label (protocol v22). Unlike the other overlays
   * this comes straight off the bulk snapshot rather than the inspection
   * payload, so the herd marks track live instead of going stale between
   * inspection fetches — `groupId` is one of the few relationship-ish things
   * cheap enough to project per tick.
   * @returns {number | null}
   */
  #selectedGroupId() {
    const activeId = this.#store.selection?.activeId;
    if (activeId == null) return null;
    return this.#store.getEntity(activeId)?.groupId ?? null;
  }

  /**
   * The selected animal's settled home range (protocol v23), for the grid
   * overlay. Inspection-only and therefore live-only, like memories and family
   * marks: a range moves slowly, so refreshing it with the selection rather
   * than every tick loses nothing.
   * @returns {{x: number, y: number, radius: number} | null}
   */
  #selectedHomeRange() {
    const detail = this.#inspectionDetail?.entity;
    if (!detail || detail.id !== this.#store.selection?.activeId) return null;
    return detail.territory?.homeRange ?? null;
  }

  /**
   * Places the selected entity remembers (protocol v14), for the grid overlay.
   * Live-only, like the family marks — memories are inspection-only, so they
   * refresh when the selection changes rather than every tick.
   * @returns {Array<{kind: string, cellX: number, cellY: number, strength: number}>}
   */
  #selectedMemories() {
    const detail = this.#inspectionDetail?.entity;
    if (!detail || detail.id !== this.#store.selection?.activeId) return [];
    return detail.memories ?? [];
  }

  /**
   * Relatives of the selected entity — its guardian and its offspring, from
   * the inspection payload (protocol v12). Marked in the grid so a family
   * group can be picked out; purely presentational and live-only, since bulk
   * snapshots deliberately don't carry relationships.
   * @returns {number[]}
   */
  #familyIds() {
    const detail = this.#inspectionDetail?.entity;
    if (!detail || detail.id !== this.#store.selection?.activeId) return [];
    const guardianId = detail.parentingState?.guardianId;
    return guardianId != null ? [guardianId, ...(detail.offspring ?? [])] : (detail.offspring ?? []);
  }

  toggleFollow() {
    const activeId = this.#store.selection?.activeId ?? null;
    if (this.#store.followedEntityId !== null) {
      this.#store.setFollowedEntity(null);
    } else if (activeId !== null) {
      this.#store.setFollowedEntity(activeId);
      this.#followCamera();
    }
  }

  #followCamera() {
    const followedId = this.#store.followedEntityId;
    if (followedId === null) return;
    const entity = this.#store.getEntity(followedId);
    if (!entity) {
      this.#store.setFollowedEntity(null);
      this.#ui.statusPanel.setCommandStatus(`followed entity #${followedId} is gone`, 'warn');
      return;
    }
    this.#camera.centerOn(entity.x, entity.y);
    this.#camera.clampToWorld(this.#store.world);
    this.#dirty = true;
  }

  recenter() {
    if (this.#store.followedEntityId !== null) {
      this.#followCamera();
      return;
    }
    if (this.#store.world) {
      this.#camera.centerOn(this.#store.world.width / 2, this.#store.world.height / 2);
      this.#dirty = true;
    }
  }

  // -------------------------------------------------------------------- input

  /**
   * Set the hovered cell (or clear it with null), redrawing only when it
   * actually changes so pointer moves within one cell cost nothing.
   * @param {{cellX: number, cellY: number} | null} cell
   */
  #setHoverCell(cell) {
    const same =
      cell === null
        ? this.#hoverCell === null
        : this.#hoverCell !== null && this.#hoverCell.cellX === cell.cellX && this.#hoverCell.cellY === cell.cellY;
    if (same) return;
    this.#hoverCell = cell;
    this.#dirty = true;
  }

  /** The in-world cell under a pointer event, or null if it is off the map. */
  #cellUnderPointer(event) {
    const rect = this.#canvas.getBoundingClientRect();
    const projection = createProjection(this.#camera, this.#grid.cssWidth, this.#grid.cssHeight);
    const cell = projection.cellAtScreen(event.clientX - rect.left, event.clientY - rect.top);
    const world = this.#store.world;
    const inWorld =
      world && cell.cellX >= 0 && cell.cellY >= 0 && cell.cellX < world.width && cell.cellY < world.height;
    return inWorld ? cell : null;
  }

  #bindPointer() {
    // Drag-to-pan. The minimum cell size is 10px, so a large world does not fit
    // the viewport at any zoom level and the mouse has to be able to reach the
    // rest of it. A drag past the threshold suppresses the click that follows,
    // because otherwise every pan ends by selecting whatever the pointer
    // happened to stop over.
    let dragging = null;
    this.#canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      // Hide the hover mark while a press is held — it re-appears on the next
      // move once the press is a click (selection) or a drag (pan) is done.
      this.#setHoverCell(null);
      dragging = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
      this.#canvas.setPointerCapture(event.pointerId);
    });
    this.#canvas.addEventListener('pointermove', (event) => {
      if (!dragging) {
        // Not dragging: track the hovered cell for the on-canvas hover marker.
        this.#setHoverCell(this.#cellUnderPointer(event));
        return;
      }
      const dx = event.clientX - dragging.lastX;
      const dy = event.clientY - dragging.lastY;
      if (
        !dragging.moved &&
        Math.abs(event.clientX - dragging.startX) < DRAG_THRESHOLD_PX &&
        Math.abs(event.clientY - dragging.startY) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      dragging.moved = true;
      dragging.lastX = event.clientX;
      dragging.lastY = event.clientY;
      // Dragging the world by hand is an explicit "stop following" — but only
      // say so once. Setting it unconditionally would notify the store on every
      // pointer move, i.e. re-render the panels at pointer rate.
      if (this.#store.followedEntityId !== null) this.#store.setFollowedEntity(null);
      this.#camera.panByPixels(dx, dy);
      this.#camera.clampToWorld(this.#store.world);
      this.#canvas.classList.add('dragging');
      this.#dirty = true;
    });
    // Leaving the grid clears the hover mark; a pointer over the sidebar is not
    // over any cell.
    this.#canvas.addEventListener('pointerleave', () => this.#setHoverCell(null));
    const endDrag = (event) => {
      if (!dragging) return;
      const wasDrag = dragging.moved;
      dragging = null;
      this.#canvas.classList.remove('dragging');
      // Releasing a capture that is not held throws, and pointercancel has
      // already released it.
      if (this.#canvas.hasPointerCapture?.(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
      if (wasDrag) return;
      const rect = this.#canvas.getBoundingClientRect();
      const projection = createProjection(this.#camera, this.#grid.cssWidth, this.#grid.cssHeight);
      const cell = projection.cellAtScreen(event.clientX - rect.left, event.clientY - rect.top);
      this.selectCell(cell.cellX, cell.cellY);
      this.#canvas.focus();
    };
    this.#canvas.addEventListener('pointerup', endDrag);
    this.#canvas.addEventListener('pointercancel', endDrag);
    this.#canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = this.#canvas.getBoundingClientRect();
        const projection = createProjection(this.#camera, this.#grid.cssWidth, this.#grid.cssHeight);
        const anchor = projection.worldPointAtScreen(event.clientX - rect.left, event.clientY - rect.top);
        if (this.#camera.zoomAt(anchor.x, anchor.y, event.deltaY < 0 ? 1 : -1)) {
          this.#camera.clampToWorld(this.#store.world);
          this.#dirty = true;
        }
      },
      { passive: false },
    );
  }

  #bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof Element && event.target.closest('input, select, textarea, button')) return;
      const step = event.shiftKey ? 10 : 1;
      let handled = true;
      switch (event.key) {
        case 'ArrowUp': case 'w': case 'W': this.#pan(0, -step); break;
        case 'ArrowDown': case 's': case 'S': this.#pan(0, step); break;
        case 'ArrowLeft': case 'a': case 'A': this.#pan(-step, 0); break;
        case 'ArrowRight': case 'd': case 'D': this.#pan(step, 0); break;
        case '+': case '=': this.#zoom(1); break;
        case '-': case '_': this.#zoom(-1); break;
        case 'c': case 'C': this.recenter(); break;
        case 'f': case 'F': this.toggleFollow(); break;
        case 'Escape': this.clearSelection(); break;
        case 'Tab':
          if (this.#store.selection) this.cycleSelection();
          else handled = false;
          break;
        case ' ':
          if (this.#mode === 'live') this.toggleRun();
          break;
        case '[': this.#ui.controls.stepSpeed(-1); break;
        case ']': this.#ui.controls.stepSpeed(1); break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    });
  }

  #pan(dx, dy) {
    this.#store.setFollowedEntity(null);
    this.#camera.panByCells(dx, dy);
    this.#camera.clampToWorld(this.#store.world);
    this.#dirty = true;
  }

  #zoom(direction) {
    if (direction > 0 ? this.#camera.zoomIn() : this.#camera.zoomOut()) {
      this.#dirty = true;
    }
  }

  #resize() {
    const wrap = this.#canvas.parentElement;
    this.#grid.resize(wrap.clientWidth, wrap.clientHeight, window.devicePixelRatio || 1);
    this.#dirty = true;
  }

  // ----------------------------------------------------------------- panels

  #updatePanels() {
    this.#ui.statusPanel.update(this.#store, this.#camera, this.#runState);
    this.#ui.inspector.render(this.#store, this.#inspectionDetail, this.#selectedCellDetail());
    this.#ui.eventLog.render(this.#store);
  }

  /**
   * The ground of the selected cell, described from layers already in the
   * store (terrain, vegetation, worn ground, disturbances). Recomputed per
   * update rather than cached: it is a handful of lookups plus one scan of a
   * bounded disturbance list, and a cached copy would go stale as grass grows
   * and fires move under a stationary selection.
   * @returns {import('./ui/CellDetail.js').CellDescription | null}
   */
  #selectedCellDetail() {
    const selection = this.#store.selection;
    if (!selection) return null;
    return describeCell(this.#store, selection.cellX, selection.cellY);
  }
}
