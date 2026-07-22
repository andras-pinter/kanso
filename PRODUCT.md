# Product

## Register

product

## Users

A single developer (Andras / "Pinyő" and people like him) doing daily personal
task tracking on macOS. Context: tray-resident desktop app, opened many times a
day in short bursts between coding sessions. They want a fast, keyboard-driven,
local-first Kanban that feels **editor-grade** (AFFiNE / Linear / Things)
rather than **enterprise-grade** (Jira / Trello). Job to be done: capture a
thought into a card in under a second, then iterate on it later with rich-text
notes.

## Product Purpose

kanso is a personal, local-first Kanban app. It exists because every existing
Kanban tool is either too heavy (Jira/Asana — meant for teams) or too shallow
(Trello — no rich notes). kanso pairs columns/cards with a real editor
(TipTap, markdown-persisted) and a local API, so the same data is reachable
from the UI, from scripts, and from a Copilot CLI extension. Success looks
like: the app disappears — opens fast, captures fast, never gets in the way.

## Brand Personality

Calm, precise, opinionated. Voice: matter-of-fact, terse, lowercase-leaning
("kanso", not "Kanso"). Tone: confident defaults over configurable surfaces.
Emotionally: the feeling of a well-tuned editor — quiet, responsive, trusted.
Never cheerful, never playful, never enterprise.

## Anti-references

- **Jira** — heavy enterprise chrome, info density without hierarchy
- **Trello** — saturated brand-blue everywhere, playful gradients, sticker-feel cards
- **Asana** — busy iconography, color-coded everything, dashboard noise
- **Generic SaaS dashboard** — hero metrics, identical card grids, gradient accents

## Design Principles

1. **Disappear** — the app is a surface for thought, not a destination. Visual
   weight goes to the user's content, not to chrome.
2. **Keyboard-first** — every primary action has a shortcut; mouse is an
   affordance, not a requirement.
3. **Confident defaults** — opinionated choices ship as defaults; configurability
   is a last resort.
4. **Editor-grade craft** — typography, motion, and contrast match the bar set
   by best-in-class editors (Linear, AFFiNE, Things), not the bar set by
   Kanban-the-category.
5. **Local-first integrity** — the UI never lies about state. Optimistic moves
   reconcile honestly; errors surface in-place, not as anonymous toasts.

## Accessibility & Inclusion

- WCAG **AA** is the floor (body text ≥4.5:1, large text ≥3:1).
- Reduced motion is respected: every animation has a `prefers-reduced-motion`
  alternative (crossfade or instant).
- Keyboard-first is also an accessibility feature: every interaction must be
  reachable without a pointer.
- Color is never the only carrier of meaning (tags, statuses, due states pair
  color with label/icon/position).
