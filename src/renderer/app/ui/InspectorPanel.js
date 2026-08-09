/**
 * The inspector's shell: a floating popover anchored to the selected cell, or a
 * docked panel in the sidebar. It owns *where* the inspector is, and an
 * `InspectorView` owns *what* it says — the two hosts render the same view
 * object, so the fourteen section formatters exist once.
 *
 * Deliberately **not** a modal dialog. `role="dialog"` describes it, but focus
 * is never trapped and the page behind it stays live: the whole point of the
 * panel is to watch an animal while the simulation runs, which means panning,
 * zooming, and stepping have to keep working while it is open. Trapping focus
 * would make the inspector fight the thing it is there to inspect.
 *
 * Visibility is derived from `store.selection` rather than from an open flag of
 * its own, so there is one source of truth for "something is selected" and Esc
 * needs no special case here.
 */
import { InspectorView } from './InspectorView.js';

/** Gap in CSS pixels between the anchored cell and the popover's corner. */
const ANCHOR_OFFSET_PX = 14;
/** Keep this much of the host visible around the popover when clamping. */
const EDGE_MARGIN_PX = 8;

export class InspectorPanel {
  #floatingHost;
  #dockHost;
  #popover;
  #body;
  #view;
  #callbacks;
  /**
   * ⚠ **Docked by default since 2026-08-09.** The floating popover was the
   * original surface and it still is a mode, but it sits *over* the map — which
   * makes the panel the one piece of UI a viewer has to move the mouse across
   * the grid to reach, and the one that covers what it is describing. A column
   * of its own is where a panel you read while the world runs belongs; floating
   * is now the deliberate choice rather than the default one.
   */
  #docked = true;
  /**
   * A pinned popover stays where the viewer put it instead of re-anchoring to
   * each new selection. Dragging it pins it implicitly: having deliberately
   * placed the panel, having it jump away on the next click is not helpful.
   */
  #pinned = false;

  /**
   * @param {object} options
   * @param {HTMLElement} options.floatingHost positioned ancestor for the popover
   * @param {HTMLElement} options.dockHost sidebar section used when docked
   * @param {{onCycle: () => void, onFollowToggle: () => void, onClose: () => void}} options.callbacks
   */
  constructor({ floatingHost, dockHost, callbacks }) {
    this.#floatingHost = floatingHost;
    this.#dockHost = dockHost;
    this.#callbacks = callbacks;
    this.#view = new InspectorView(callbacks);

    this.#popover = document.createElement('div');
    this.#popover.className = 'inspector-popover';
    this.#popover.setAttribute('role', 'dialog');
    this.#popover.setAttribute('aria-label', 'Cell inspector');
    this.#popover.hidden = true;
    this.#popover.innerHTML = `
      <div class="popover-header">
        <span class="popover-grip" aria-hidden="true">::</span>
        <span class="popover-title">cell</span>
        <button type="button" class="popover-button" data-panel="pin" aria-pressed="false" title="Keep this panel where it is when the selection changes">pin</button>
        <button type="button" class="popover-button" data-panel="dock" title="Move the inspector into the sidebar">dock</button>
        <button type="button" class="popover-button" data-panel="close" aria-label="Close inspector" title="Close (Esc)">×</button>
      </div>
      <div class="popover-body"></div>`;
    this.#body = this.#popover.querySelector('.popover-body');
    floatingHost.append(this.#popover);

    this.#popover.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-panel]')?.dataset?.panel;
      if (button === 'close') this.#callbacks.onClose();
      if (button === 'pin') this.#setPinned(!this.#pinned);
      if (button === 'dock') this.#setDocked(!this.#docked);
    });
    // The docked header lives outside the popover, so it needs its own
    // listener — bound once here rather than per dock, which would stack.
    dockHost.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-panel="dock"]')) this.#setDocked(false);
    });
    this.#bindDrag();
    // Apply the initial state through the same path every later toggle takes,
    // so "docked by default" cannot drift from what docking actually does.
    this.#setDocked(this.#docked);
  }

  /** The sidebar host, so the docked state can be restored on load. */
  get docked() {
    return this.#docked;
  }

  /**
   * @param {import('../state/RendererStore.js').RendererStore} store
   * @param {object | null} inspectionDetail
   * @param {import('./CellDetail.js').CellDescription | null} cell
   */
  render(store, inspectionDetail, cell) {
    const selected = store.selection !== null;
    if (!this.#docked) this.#popover.hidden = !selected;
    if (selected) {
      this.#popover.querySelector('.popover-title').textContent = `cell ${store.selection.cellX},${store.selection.cellY}`;
    }
    // The view still renders while hidden only if docked; a hidden popover has
    // nothing to say and rendering into it would cost a rebuild per tick for
    // markup nobody can see.
    if (selected || this.#docked) this.#view.render(store, inspectionDetail, cell);
  }

  /**
   * Anchor the popover beside a cell's screen position, flipping and clamping
   * so it stays inside the viewport. Ignored while pinned or docked.
   * @param {number} px cell's top-left pixel within the floating host
   * @param {number} py
   */
  anchorAt(px, py) {
    if (this.#pinned || this.#docked) return;
    this.#popover.hidden = false;
    const host = this.#floatingHost.getBoundingClientRect();
    const box = this.#popover.getBoundingClientRect();
    // Prefer down-and-right of the cell; flip when that would overflow, which
    // is what keeps a selection near the right or bottom edge readable.
    let left = px + ANCHOR_OFFSET_PX;
    let top = py + ANCHOR_OFFSET_PX;
    if (left + box.width > host.width - EDGE_MARGIN_PX) left = px - box.width - ANCHOR_OFFSET_PX;
    if (top + box.height > host.height - EDGE_MARGIN_PX) top = py - box.height - ANCHOR_OFFSET_PX;
    this.#place(left, top);
  }

  /** Clamp a position into the host and apply it. */
  #place(left, top) {
    const host = this.#floatingHost.getBoundingClientRect();
    const box = this.#popover.getBoundingClientRect();
    const maxLeft = Math.max(EDGE_MARGIN_PX, host.width - box.width - EDGE_MARGIN_PX);
    const maxTop = Math.max(EDGE_MARGIN_PX, host.height - box.height - EDGE_MARGIN_PX);
    this.#popover.style.left = `${Math.min(Math.max(left, EDGE_MARGIN_PX), maxLeft)}px`;
    this.#popover.style.top = `${Math.min(Math.max(top, EDGE_MARGIN_PX), maxTop)}px`;
  }

  #setPinned(pinned) {
    this.#pinned = pinned;
    const button = this.#popover.querySelector('[data-panel="pin"]');
    button.setAttribute('aria-pressed', String(pinned));
    button.classList.toggle('active', pinned);
  }

  /**
   * Move the view between the popover and the sidebar. This is the reason the
   * view is a separate object at all: docking is a change of host, not a
   * different panel.
   *
   * The docked host gets its own header and a separate body element for the
   * view to own. The view writes `innerHTML` over its whole container on a
   * structural rebuild, so a control placed *inside* that container would
   * survive exactly until the next selection.
   */
  #setDocked(docked) {
    this.#docked = docked;
    this.#popover.hidden = docked;
    this.#dockHost.hidden = !docked;
    // ⚠ The dock host now lives in a column of its own, so docking is a change
    // to the page's *layout* and not only to this panel. One attribute on the
    // grid drives the track width, the aside and its drag handle together (see
    // `#main[data-inspector]` in renderer.css) — a hidden aside on its own would
    // leave the map with a dead gutter beside it, because a hidden grid item
    // still holds its column open.
    this.#dockHost.closest('#main')?.setAttribute('data-inspector', docked ? 'docked' : 'floating');
    this.#popover.querySelector('[data-panel="dock"]').textContent = docked ? 'float' : 'dock';
    if (docked) {
      this.#dockHost.innerHTML = `
        <div class="popover-header">
          <span class="popover-title">inspector</span>
          <button type="button" class="popover-button" data-panel="dock" title="Float the inspector over the grid">float</button>
        </div>
        <div class="dock-body"></div>`;
      this.#view.mount(this.#dockHost.querySelector('.dock-body'));
    } else {
      this.#view.mount(this.#body);
      this.#dockHost.innerHTML = '';
    }
  }

  /** Drag the header to move the popover; moving it pins it. */
  #bindDrag() {
    const header = this.#popover.querySelector('.popover-header');
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-panel]')) return; // buttons are not a grip
      const box = this.#popover.getBoundingClientRect();
      const host = this.#floatingHost.getBoundingClientRect();
      drag = {
        offsetX: event.clientX - box.left,
        offsetY: event.clientY - box.top,
        hostLeft: host.left,
        hostTop: host.top,
      };
      header.setPointerCapture(event.pointerId);
      this.#popover.classList.add('dragging');
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag) return;
      this.#place(event.clientX - drag.hostLeft - drag.offsetX, event.clientY - drag.hostTop - drag.offsetY);
    });
    const end = (event) => {
      if (!drag) return;
      drag = null;
      this.#popover.classList.remove('dragging');
      if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
      this.#setPinned(true);
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  }
}
