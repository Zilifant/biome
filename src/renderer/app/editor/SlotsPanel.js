/**
 * The editor's slot list: every drawable thing, grouped the way the legend
 * groups its entries, each row showing the ASCII glyph being replaced, the
 * assigned sprite (as a thumbnail cut from the sheet), and its tint. Clicking
 * a row selects the slot for assignment.
 *
 * Dumb on purpose: all state lives in EditorState; this renders it and
 * reports clicks. Rows are <button>s so the whole flow is keyboard-reachable.
 */
import { describeSpriteSlots } from '../rendering/SpriteSlots.js';
import { SHEET } from '../rendering/SpriteConfig.js';

const THUMB_SIZE = 20;

export class SlotsPanel {
  #container;
  #onSelect;
  /** @type {Map<string, {row: HTMLButtonElement, thumb: HTMLCanvasElement, tintSwatch: HTMLElement, assignedText: HTMLElement}>} */
  #rows = new Map();
  /** @type {HTMLImageElement | null} */
  #atlas = null;

  /**
   * @param {HTMLElement} container
   * @param {{onSelect: (slotId: string) => void}} callbacks
   */
  constructor(container, { onSelect }) {
    this.#container = container;
    this.#onSelect = onSelect;
    this.#build();
  }

  #build() {
    const groups = describeSpriteSlots();
    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      section.appendChild(heading);
      for (const slot of group.slots) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'slot-row';
        row.dataset.slotId = slot.slotId;
        row.setAttribute('aria-pressed', 'false');

        const glyph = document.createElement('span');
        glyph.className = 'slot-glyph';
        glyph.style.color = `var(--dracula-${slot.colorToken})`;
        if (slot.italic) glyph.style.fontStyle = 'italic';
        glyph.textContent = slot.glyph;

        const label = document.createElement('span');
        label.className = 'slot-label';
        label.textContent = slot.label + (slot.note ? ` — ${slot.note}` : '');

        const assignedText = document.createElement('span');
        assignedText.className = 'slot-assigned';
        assignedText.textContent = '—';

        const thumb = document.createElement('canvas');
        thumb.className = 'slot-thumb';
        thumb.width = THUMB_SIZE;
        thumb.height = THUMB_SIZE;
        thumb.setAttribute('role', 'presentation');

        const tintSwatch = document.createElement('span');
        tintSwatch.className = 'slot-tint';
        tintSwatch.hidden = true;

        row.append(glyph, label, assignedText, thumb, tintSwatch);
        row.addEventListener('click', () => this.#onSelect(slot.slotId));
        section.appendChild(row);
        this.#rows.set(slot.slotId, { row, thumb, tintSwatch, assignedText });
      }
      fragment.appendChild(section);
    }
    this.#container.replaceChildren(fragment);
  }

  /** The sheet image thumbnails are cut from, or null when none is loaded. */
  setAtlas(atlas) {
    this.#atlas = atlas;
  }

  /** @param {object} state the editor state */
  render(state) {
    for (const [slotId, parts] of this.#rows) {
      const assignment = state.config.assignments[slotId];
      const selected = state.selectedSlotId === slotId;
      parts.row.classList.toggle('selected', selected);
      parts.row.setAttribute('aria-pressed', String(selected));
      parts.assignedText.textContent = assignment ? `${assignment.col},${assignment.row}` : '—';
      parts.tintSwatch.hidden = !assignment?.tint;
      if (assignment?.tint) {
        parts.tintSwatch.style.backgroundColor = assignment.tint;
        parts.tintSwatch.title = `tint ${assignment.tint}`;
      }
      const ctx = parts.thumb.getContext('2d');
      ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      if (assignment && this.#atlas) {
        const { spriteWidth, spriteHeight, gap, margin } = SHEET;
        const sx = margin + assignment.col * (spriteWidth + gap);
        const sy = margin + assignment.row * (spriteHeight + gap);
        if (sx + spriteWidth <= this.#atlas.naturalWidth && sy + spriteHeight <= this.#atlas.naturalHeight) {
          ctx.imageSmoothingEnabled = false;
          const scale = Math.min(THUMB_SIZE / spriteWidth, THUMB_SIZE / spriteHeight);
          const dw = Math.max(1, Math.round(spriteWidth * scale));
          const dh = Math.max(1, Math.round(spriteHeight * scale));
          ctx.drawImage(this.#atlas, sx, sy, spriteWidth, spriteHeight, Math.floor((THUMB_SIZE - dw) / 2), Math.floor((THUMB_SIZE - dh) / 2), dw, dh);
          if (assignment.tint) {
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = assignment.tint;
            ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }
    }
  }
}
