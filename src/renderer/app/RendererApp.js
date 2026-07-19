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
import { createProjection, occupantsInCell } from './rendering/GridProjection.js';
import { compareOccupants } from './rendering/EntityAppearance.js';
import { AsciiGridRenderer } from './rendering/AsciiGridRenderer.js';
import { TransportEvents } from './transports/RendererTransport.js';

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
  #recovering = false;
  #simPaused = null;
  /** @type {object | null} last entity.inspection payload */
  #inspectionDetail = null;

  /**
   * @param {object} options
   * @param {import('./state/RendererStore.js').RendererStore} options.store
   * @param {import('./transports/RendererTransport.js').RendererTransport} options.transport primary stream
   * @param {import('./transports/HttpRendererTransport.js').HttpRendererTransport | null} options.http
   *        query/recovery channel (live mode only)
   * @param {HTMLCanvasElement} options.canvas
   * @param {{statusPanel: object, inspector: object, eventLog: object, controls: object}} options.ui
   * @param {'live' | 'fixture'} options.mode
   */
  constructor({ store, transport, http, canvas, ui, mode }) {
    this.#store = store;
    this.#transport = transport;
    this.#http = http;
    this.#canvas = canvas;
    this.#grid = new AsciiGridRenderer(canvas);
    this.#camera = new Camera();
    this.#ui = ui;
    this.#mode = mode;
  }

  get camera() {
    return this.#camera;
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
    this.#bindPointer();
    this.#bindKeyboard();

    if (this.#mode === 'fixture') {
      this.#ui.controls.setSimulationCommandsEnabled(false, 'fixture mode replays recorded data; no live simulation');
      this.#ui.controls.setReconnectLabel('Replay');
    } else {
      this.#http
        ?.getStatus()
        .then((status) => {
          this.#simPaused = status.paused ?? null;
        })
        .catch(() => {});
    }

    this.#transport.connect();
    const frame = () => {
      if (this.#dirty) {
        this.#dirty = false;
        this.#grid.draw({
          store: this.#store,
          camera: this.#camera,
          familyIds: this.#familyIds(),
          memories: this.#selectedMemories(),
          huntTargetId: this.#huntTargetId(),
        });
        this.#ui.statusPanel.update(this.#store, this.#camera);
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
        this.#ui.controls.setStatus(event.message, event.level === 'warn' ? 'warn' : 'ok');
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
    this.#ui.controls.setStatus(`desynchronized (${error.message}) — requesting full snapshot`, 'warn');
    try {
      const source = this.#http ?? this.#transport;
      const snapshot = await source.requestSnapshot();
      if (snapshot) this.#applySnapshot(snapshot);
      else this.#ui.controls.setStatus('recovery failed: no snapshot available', 'bad');
    } catch (requestError) {
      this.#ui.controls.setStatus(`recovery failed: ${requestError}`, 'bad');
    } finally {
      this.#recovering = false;
    }
  }

  #reportProtocolProblem(error) {
    const label = error instanceof RendererProtocolError ? `protocol: ${error.message}` : String(error);
    this.#ui.controls.setStatus(label, 'bad');
  }

  // ----------------------------------------------------------------- commands

  /**
   * All external change flows through protocol commands on a transport.
   * @param {object} command
   */
  async sendCommand(command) {
    let result;
    if (this.#mode === 'live' && this.#transport.isOpen === false && this.#http) {
      result = await this.#http.sendCommand(command);
    } else {
      result = await this.#transport.sendCommand(command);
    }
    if (result?.ok) {
      if (command.type === 'simulation.pause') this.#simPaused = true;
      if (command.type === 'simulation.resume') this.#simPaused = false;
    }
    return result;
  }

  reconnect() {
    this.#transport.disconnect();
    this.#transport.connect();
  }

  // ---------------------------------------------------------------- selection

  /**
   * Select the occupants of a world cell: highest display priority becomes
   * active; Tab cycles the rest. Local only — nothing is sent anywhere.
   * @param {number} cellX
   * @param {number} cellY
   */
  selectCell(cellX, cellY) {
    const occupants = occupantsInCell(this.#store.entities.values(), cellX, cellY, this.#store.world).sort(
      compareOccupants,
    );
    if (occupants.length === 0) {
      this.#store.setSelection(null);
      this.#inspectionDetail = null;
      return;
    }
    const entityIds = occupants.map((entity) => entity.id);
    this.#store.setSelection({ entityIds, activeId: entityIds[0] });
    this.#refreshInspection(entityIds[0]);
  }

  cycleSelection() {
    const selection = this.#store.selection;
    if (!selection || selection.entityIds.length < 2) return;
    const alive = selection.entityIds.filter((entityId) => this.#store.getEntity(entityId) !== null);
    if (alive.length === 0) return;
    const currentIndex = alive.indexOf(selection.activeId);
    const nextId = alive[(currentIndex + 1) % alive.length];
    this.#store.setSelection({ entityIds: selection.entityIds, activeId: nextId });
    this.#refreshInspection(nextId);
  }

  clearSelection() {
    this.#store.setSelection(null);
    this.#inspectionDetail = null;
  }

  /** Fetch protocol inspection detail for the active entity (live only). */
  async #refreshInspection(entityId) {
    this.#inspectionDetail = null;
    if (!this.#http) return;
    try {
      const inspection = await this.#http.requestEntity(entityId);
      if (inspection?.found && this.#store.selection?.activeId === entityId) {
        this.#inspectionDetail = inspection;
        this.#dirty = true;
        this.#updatePanels();
      }
    } catch {
      // Inspection detail is optional enrichment; the store view stands alone.
    }
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
      this.#ui.controls.setStatus(`followed entity #${followedId} is gone`, 'warn');
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

  #bindPointer() {
    this.#canvas.addEventListener('click', (event) => {
      const rect = this.#canvas.getBoundingClientRect();
      const projection = createProjection(this.#camera, this.#grid.cssWidth, this.#grid.cssHeight);
      const cell = projection.cellAtScreen(event.clientX - rect.left, event.clientY - rect.top);
      this.selectCell(cell.cellX, cell.cellY);
      this.#canvas.focus();
    });
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
          if (this.#mode === 'live') {
            this.sendCommand({ type: this.#simPaused ? 'simulation.resume' : 'simulation.pause' }).then((result) =>
              this.#ui.controls.showResult({ type: this.#simPaused ? 'simulation.pause' : 'simulation.resume' }, result),
            );
          }
          break;
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
    this.#ui.statusPanel.update(this.#store, this.#camera);
    this.#ui.inspector.render(this.#store, this.#inspectionDetail);
    this.#ui.eventLog.render(this.#store);
  }
}
