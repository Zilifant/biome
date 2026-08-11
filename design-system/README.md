# Design system

A portable design system extracted from the biome renderer
(`src/renderer/app/styles/` and the conventions recorded in
`src/renderer/DOCS-RENDERER.md`). It packages the renderer's look — a dark,
Dracula-themed, monospace, information-dense instrument panel — as four plain
CSS files any project can drop in. No build step, no JavaScript dependency,
no framework.

## Files, in load order

| file             | what it holds                                                        |
| ---------------- | -------------------------------------------------------------------- |
| `tokens.css`     | the palette and the semantic role tokens — the only place color lives |
| `base.css`       | reset, typography, and form controls themed by type                   |
| `layout.css`     | the app frame, panel columns, viewport, and column drag handles       |
| `components.css` | panels, badges, fields, disclosures, popover, feed, key grid, figures |
| `example.html`   | a static gallery exercising every component — open it in a browser    |

```html
<link rel="stylesheet" href="design-system/tokens.css" />
<link rel="stylesheet" href="design-system/base.css" />
<link rel="stylesheet" href="design-system/layout.css" />
<link rel="stylesheet" href="design-system/components.css" />
```

Everything is prefixed `ds-` (classes) / `--ds-` (custom properties) so it can
be adopted into an existing page without collisions. `base.css` is the one
opinionated file — it themes `body` and bare form controls — so include it on
pages the system owns, and skip it where it must coexist with other styling.

## Principles

These are inherited from the renderer, where each one was earned rather than
chosen. The reasoning travels with the rule.

1. **One source of color truth.** All color lives in `tokens.css`, in two
   tiers: raw palette values (`--ds-palette-*`, Dracula Classic by default)
   and semantic roles (`--ds-surface-panel`, `--ds-danger`, …). Components
   reference only roles. Derived shades may only mix these values or apply
   opacity — no new hex values downstream.
2. **Color is never the only channel.** A badge says its state in a word; a
   feed line leads with a one-character mark; the renderer paired every color
   with a distinct glyph. Anything that must survive being glanced at, at
   small sizes, or by a color-blind reader gets a second channel.
3. **Monospace-honest.** One monospace stack everywhere, ligatures off.
   Markers are text (`+` / `-`), never icon fonts. Charts are drawn with block
   characters. Inside a character-drawn figure, pad with U+00A0, never a
   space — a space is a line-break opportunity, and a wrapped bar reads as
   two bars.
4. **Theme form controls by type, never by id.** `input[type="text"]`,
   `button`, `select` get shared rules so a new control is themed the moment
   it is added. (The renderer once styled fields per-id, and every field added
   afterwards rendered as a bare white browser widget in a dark panel.)
   Per-id rules are only for what is genuinely specific to one control — a
   fixed width.
5. **Style a panel by what it is, not where it is.** `.ds-panel` and
   `.ds-panel-column` behave identically in any column, so a panel can move
   without a CSS change.
6. **Place every grid child explicitly.** When any item in a grid is placed
   by hand (the drag handles overlay columns), auto-placement puts the rest
   in the wrong cells — and the page still *looks* roughly right while half
   of it cannot be clicked. Every child of `.ds-main` gets `grid-column` and
   `grid-row`.
7. **Default widths are minimum widths.** Column custom properties fall back
   to the narrowest width the column's content needs without wrapping, so a
   resize only ever widens. If a script restates these numbers, the two must
   agree or the first drag jumps.
8. **One shadow.** Elevation is reserved for the single element that must
   read as floating above the page (`.ds-popover`). Everything else is flat.
9. **Reserve the highlight.** `--ds-highlight` (bright yellow) means "the
   thing currently selected or currently changing" and nothing else.
10. **Expose overridable color as a custom property, not inline `color`.**
    `.ds-ref` colors via `--ds-ref-color` because an inline `color`
    declaration outranks any stylesheet rule and would kill the hover state.
11. **Controls that change label get fixed widths.** A button that resizes
    between "Pause" and "Resume" shifts its whole row every time it is used.
12. **Fixed rows stay fixed.** Feed lines are `nowrap` + ellipsis; a figure
    gets `overflow: hidden` as a backstop so a mis-measurement costs a
    clipped chart rather than a broken layout.
13. **Generate keys from registries.** A legend written by hand drifts from
    what is drawn; build it from the same data that does the drawing.
14. **Real widgets, no traps.** Resize handles are `role="separator"`,
    focusable, keyboard-operable. Popovers are not modals: no focus trap, the
    page behind stays live. One visible `:focus-visible` treatment for
    everything; never removed without a replacement.

## Color roles

| role                                   | default (Dracula)   | meaning                             |
| -------------------------------------- | ------------------- | ----------------------------------- |
| `--ds-surface-page`                    | `#191A21`           | the page — darkest thing on screen  |
| `--ds-surface-panel`                   | `#21222C`           | panels, bars                        |
| `--ds-surface-viewport`                | `#282A36`           | the central content well            |
| `--ds-surface-raised` / `-hover`       | `#343746`/`#424450` | controls, and their hover           |
| `--ds-border` / `-strong` / `-faint`   | `#44475A` / …       | panel edges / emphasis / row rules  |
| `--ds-text` / `--ds-text-secondary`    | `#F8F8F2`/`#6272A4` | content / labels and hints          |
| `--ds-heading`, `--ds-accent`, `--ds-focus` | `#BD93F9`      | headings, toggles, focus ring       |
| `--ds-ok` / `--ds-warn` / `--ds-danger`| green/orange/red    | success · degraded · failure        |
| `--ds-info`, `--ds-link`               | `#8BE9FD`           | links, informational feed lines     |
| `--ds-highlight`                       | `#FFFFA5`           | the selection — reserved            |
| `--ds-special`                         | `#FF79C6`           | rare notable events                 |

**Retheming:** override the role tokens (tier 2) in a stylesheet loaded after
`tokens.css`. Leave the component files untouched — if a retheme needs to edit
`components.css`, a role is missing and should be added instead.

## Component inventory

- **`.ds-status-bar`** — top bar of `label value` readings; `.ds-status-end`
  pins a trailing item right.
- **`.ds-badge`** (+ `--warn`, `--danger`, `--info`) — inverted state chips.
- **`.ds-panel`**, **`.ds-panel--collapsible`**, **`.ds-panel--fill`** —
  bordered sections with uppercase headings; collapsible ones toggle
  `.collapsed` on header click (script contract; persist the set in
  `localStorage`); `--fill` makes a panel take its column's height and scroll
  inside itself (a feed's home).
- **`.ds-panel-column`**, **`.ds-main`**, **`.ds-app`**, **`.ds-viewport`** —
  the frame. The page declares its own `grid-template-columns`.
- **`.ds-col-resizer`** — drag handle overlaying a column's inner edge;
  invisible until hovered (it is a target, not a decoration).
- **`.ds-control-row`**, **`.ds-toggle-row`**, **`.ds-value-fixed`** — control
  layouts; whole-row click targets for toggles.
- **`.ds-field`** — label/value line with a faint rule; the unit of readouts.
- **`.ds-section`** — `<details>` disclosure with text markers, collapsed by
  default; **`.ds-group-label`** divides long lists.
- **`.ds-popover`** — the one floating element; header is the drag grip.
- **`.ds-ref`** — a button styled as text for inline references; color via
  `--ds-ref-color`.
- **`.ds-key-grid`** (+ `--dense`) — legend of symbol/label pairs.
- **`.ds-feed`** (+ per-line `--ok/--warn/--danger/--info/--special/--muted`) —
  one-line log entries, each headed by a unique one-character mark.
- **`.ds-figure`** — character-drawn sparkline/histogram. Sparklines use a
  ramp with no blank rung (a flat series must read as "no change", not as
  nothing); histograms may have one (an empty bin is empty).
- **`.ds-help-bar`**, **`.ds-hint`**, **`.ds-ok/.ds-warn/.ds-bad/.ds-dim`** —
  footer, secondary text, inline status text.

## What was deliberately not carried over

- Renderer-specific IDs and wiring (`#biome-canvas`, inspector dock tracks,
  `data-inspector` attributes) — those are one app's layout decisions, not
  the system.
- The JavaScript (collapsing, column resize, popover drag, live-value
  patching). The CSS states the contracts (`.collapsed`, `.dragging`,
  `--ds-*-width` custom properties); each project brings its own few lines of
  script.
- The entity-appearance registry (glyphs, species colors, status marks) —
  that is the simulation's visual vocabulary, not the UI chrome. Its
  *principles* (shape + color as independent channels, registries that
  generate their legends) are kept above as rules 2 and 13.
