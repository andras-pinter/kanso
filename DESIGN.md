# Design

Visual specification for kanso. Tokens, components, and conventions live in
`ui/src/kanban/kanban.css` (single CSS file; flat namespace `.kanso-*`).

## Theme

Light + dark, both first-class. Pre-paint script in `index.html` reads
`localStorage['kanso.theme']` before React mounts to avoid flash. OS preference
honored when no manual override is set; manual override (`<html data-theme>`)
wins.

**Strategy:** restrained — tinted neutrals + one accent ≤10% of surface. The
accent (blue) appears only on primary actions, focus rings, active states.
Color is not used for identity; it's used for action.

## Color

Hex tokens (legacy; not OKLCH). All references go through `--kanso-*` custom
properties. Contrast verified: body text ≈13.3 against bg-elevated (AAA),
accent ≈5.0 (AA).

### Light (`:root`)

| Role | Token | Value |
|---|---|---|
| Body bg | `--kanso-bg` | `#f7f7f5` (warm near-white) |
| Surface | `--kanso-bg-elevated` | `#ffffff` |
| Subtle bg | `--kanso-bg-subtle` | `#fafaf9` |
| Hover bg | `--kanso-bg-hover` | `#f3f4f6` |
| Border | `--kanso-border` | `#e5e7eb` |
| Border strong | `--kanso-border-strong` | `#d1d5db` |
| Text | `--kanso-fg` | `#111827` |
| Text muted | `--kanso-fg-muted` | `#6b7280` |
| Text subtle | `--kanso-fg-subtle` | `#9ca3af` |
| Accent | `--kanso-accent` | `#3b82f6` |
| Accent strong | `--kanso-accent-strong` | `#2563eb` |
| Accent bg | `--kanso-accent-bg` | `#eff6ff` |
| Danger | `--kanso-danger` | `#dc2626` |
| Warning fg | `--kanso-warning-fg` | `#b45309` |
| Success fg | `--kanso-success-fg` | `#047857` |

### Dark (`[data-theme='dark']`)

True dark, not inverted. Backgrounds sit in `#0e0f12` → `#1c1f26`. Accent
lifted to `#5b8cff` for AA contrast on dark surfaces.

| Role | Token | Value |
|---|---|---|
| Body bg | `--kanso-bg` | `#0e0f12` |
| Surface | `--kanso-bg-elevated` | `#16181d` |
| Subtle bg | `--kanso-bg-subtle` | `#1a1c22` |
| Hover bg | `--kanso-bg-hover` | `#1f2229` |
| Border | `--kanso-border` | `#2a2d35` |
| Text | `--kanso-fg` | `#e4e6ea` |
| Text muted | `--kanso-fg-muted` | `#9ba0a8` |
| Text subtle | `--kanso-fg-subtle` | `#6f747d` |
| Accent | `--kanso-accent` | `#5b8cff` |

## Typography

- **Stack:** system (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- **Body:** 14px / 1.45, antialiased
- **Card title:** 13px / 500
- **Column name:** 13px / 600, tracking `-0.005em`
- **Section h1 (Connect Apps hero):** 24px, tracking `-0.03em`
- **Modal h2:** 18px, tracking `-0.02em`
- **Doc title (`--kanso-fs-doc-title`, 22px / 600, tracking `-0.02em`):**
  used by the card-as-doc modal (`.kanso-doc-title`). Renders as an
  autosizing textarea with no border and no accent-ring focus glow — the
  document is the header. Placeholder `Untitled` at `--kanso-fg-muted`.
- **Legacy form title (`.kanso-title-input`):** 15px / 500 boxed input,
  still used by side drawers (Add card, edit forms). No longer used in
  the card modal.
- **Mono:** `'SFMono-Regular', Consolas, 'Liberation Mono', monospace` (code snippets only)

## Shape & Elevation

| Token | Value | Use |
|---|---|---|
| `--kanso-radius-sm` | 4px | inputs, buttons, menu items |
| `--kanso-radius-md` | 6px | cards, modals (header), toggle pills |
| `--kanso-radius-lg` | 8px | columns, drawers, large surfaces |
| Pill | `999px` | tag chips, count badges, saved pill |

Shadows are theme-aware (heavier in dark mode). Five named depths:
`card` (resting), `card-hover`, `drag`, `drawer`, `modal`. Never inline.

### Z-index scale

Semantic ladder defined as CSS custom properties on `:root`. Never use
raw z-index numbers in component styles.

| Token | Value | Use |
|---|---|---|
| `--kanso-z-overlay` | 2 | in-card absolutely-positioned affordances |
| `--kanso-z-popover` | 30 | tag picker, board switcher menu |
| `--kanso-z-drawer-backdrop` | 50 | dim layer behind drawers |
| `--kanso-z-drawer` | 51 | drawer surface (Manage tags / boards) |
| `--kanso-z-palette` | 55 | ⌘K search palette |
| `--kanso-z-modal` | 60 | modal backdrop + content (card detail, alerts) |
| `--kanso-z-shortcuts` | 70 | global keyboard shortcuts overlay |

## Layout

- **App shell:** `flex column`, `height: 100vh`, `overflow: hidden`.
- **Header:** `space-between`, 16/24px padding, `bg-elevated` over board bg.
- **Board:** horizontal `flex`, `overflow-x: auto`, columns 288–320px wide with
  16px gap.
- **Column:** `flex column`, `gap: 10px`, 12px padding, internal `overflow-y`
  on cards list.
- **Card:** 10/12px padding, hover-lift via border + shadow swap.
- **Drawers:** fixed right edge, 400px wide, full height, `shadow-drawer`.
- **Modals:** centered, 80vh max, `shadow-modal`, overlay `rgba(17,24,39,0.5)`.
- **Spacing scale (informal):** 2 / 4 / 6 / 8 / 10 / 12 / 16 / 20 / 24 / 32px.

## Components

Inventory (`ui/src/kanban/`):

- **KanbanBoard** — top-level board with horizontal column list
- **Column / ColumnList** — sortable columns with drag handle on header
- **Card** — draggable card face: title + tag chips + subtle has-body dot
- **CardDetailModal** — card-as-doc surface: autosizing title, tags row,
  BlockSuite editor at 680px reading width, overflow menu + X close
- **CardBodyEditor** — lazy-loaded BlockSuite host
- **CardHeaderMenu** — overflow menu (`.kanso-menu`) inside the card modal
- **AddCardInline / AddColumnTile** — inline create affordances
- **BoardSwitcher** — dropdown header trigger with board dot
- **ManageBoardsDrawer / ManageTagsDrawer** — right-edge side panels
- **ColorPicker** — flat swatch grid (~20px circles)
- **TagChips / TagPickerPopover** — pill-shaped tag chips + popover picker
- **DueBadge / DueDateEditor** — inline date affordance with overdue
  variant (not currently rendered on the card face or in the card modal;
  kept for potential future surfaces)
- **SearchPalette** — Cmd+K modal palette, 600px wide
- **ColumnHeaderMenu** — three-dot menu, generic `.kanso-menu` dropdown
- **ThemeToggle** — segmented light/dark control in header
- **ErrorBoundary** — full-bleed fallback with retry actions
- **CliExtConsentModal** — first-launch consent modal (420px)

## Motion

- Transitions: 120ms `ease` on `border-color`, `background`, `color`,
  `box-shadow`. No layout property animations.
- The saved-pill in drawers fades via opacity (200ms ease).
- No keyframed entrance animations; cards/columns appear instantly.
- **The card-as-doc modal opens/closes instantly on purpose:** motion is
  deferred to a later phase so an editor surface can't feel gimmicky.
- **`prefers-reduced-motion` is not yet explicitly handled** (flag for audit).

## Imagery & Iconography

- No iconography library committed. Currently uses Unicode glyphs (e.g. ☀ ☾
  on theme toggle) and CSS shapes (dots, swatches, pills).
- No imagery/illustration in the product surface; this is a chrome-light
  utility.

## Conventions

- Single CSS file, BEM-ish class names (`.kanso-card--dragging`,
  `.kanso-card--selected`).
- No CSS-in-JS, no Tailwind. Tokens via custom properties.
- Focus rings: 3px `accent-ring` (`rgba(accent, 0.18)` in light, `0.28` in
  dark), accent border. Applied on `:focus` for inputs and textareas.
- Z-index scale (de facto): drawer-backdrop `50`, drawer `51`, menu/modal
  `60`, first-launch modal `100`. **Not yet semantic — flag for audit.**
