# UI System

## Purpose

Strategy Desk uses a dark, premium, minimalist analytics interface. New UI work should keep dense information available while reducing chrome, visual noise, and simultaneous cognitive load.

## Foundations

- Typography:
  - UI text uses `IBM Plex Sans`.
  - numeric, code, keys, and technical identifiers use `IBM Plex Mono`.
- Spacing:
  - base spacing step is `8px`
  - half-step is `4px`
  - panel padding defaults to `16px`
  - shell padding stays tight so the first viewport shows real data quickly
  - page gaps should stay compact unless a section genuinely needs more separation
- Shape:
  - small radius `10px`
  - default radius `12px`
  - large surface radius `16px`
  - pills use full rounding
- Motion:
  - keep transitions in the `120–180ms` range
  - motion must support hierarchy/state change and respect reduced-motion

## Color Semantics

- Canvas is near-black graphite with restrained neutral-slate surfaces.
- Accent cyan is reserved for the primary active state, focus, selection, and the most important emphasis.
- Green means healthy/success/live.
- Amber means caution/warning.
- Coral/red means failure/high risk/destructive.
- Never rely on color alone for meaning.

## Shell Rules

- The product shell is top-first and compact:
  - sticky primary product bar
  - sticky secondary strip that combines subsection navigation and context controls
- Keep all major workflows in the existing product map unless explicitly approved.
- Keep the shell slim enough that the first screen is mostly data, not chrome.
- Primary navigation is text-first, single-line, and compact.
- Subtab navigation is text-first, horizontally scrollable, and must never wrap into multiple rows.
- Keep status, time, team, event, load, and mode controls available in the secondary strip, but do not let support controls grow the shell vertically.
- Do not add new one-off navigation zones inside page content when the existing shell can carry the action.

## Page Templates

- `Overview`:
  - situation awareness first
  - summary strip, high-signal charts, priority tables
- `Workbench`:
  - controls + results + deeper analysis
  - dense tools belong here, but supporting sections should collapse by default
  - disclosure state should persist for power users when practical
- `Reference`:
  - sidebar/search rail + main document/content pane

## Page Header Rules

- Page headers are compact and non-hero.
- Keep the title, one short explanatory sentence, and inline status badges.
- Do not add side summary cards or oversized workspace intro blocks above the data.
- The first meaningful chart/table/tool should appear quickly below the header.

## Charts And Tables

- Each chart should answer one question.
- Prefer tables when exact lookup matters more than trend recognition.
- No 3D charts.
- No decorative chart junk.
- Keep legends restrained and units explicit.
- Keep headers sticky when the table scrolls.
- Right-align numeric columns when practical.
- Show active sort/filter state clearly.

## Interaction Rules

- Every meaningful control needs visible default, hover, focus, active, disabled, loading, and error behavior.
- Use progressive disclosure for advanced controls instead of exposing everything by default.
- Keep primary task surfaces open by default; collapse supporting analytics, raw data, and secondary explanation panels behind clearly labeled disclosure sections.
- Anything moved out of the first screen must remain reachable in one obvious click.
- Do not use disclosure sections to hide the primary work surface of a page.
- Disclosure labels should describe what lives inside the section, not generic UI terms like "More" or "Advanced".
- Empty states must explain:
  - what belongs here
  - why it is empty
  - what the user should do next
- Error states must say what failed and what the user can do next.

## Accessibility Rules

- Target WCAG 2.2 AA.
- All major flows must work with keyboard only.
- Preserve visible focus.
- Keep controls large enough to hit reliably.
- Keep contrast safe in the dark theme.

## Do / Don't

- Do group panels by workflow.
- Do keep dense content calm through spacing, alignment, and hierarchy.
- Do reuse shared shell/panel/chart/table primitives.
- Don't add arbitrary inline spacing or random hex colors in feature JSX.
- Don't create a new panel style when an existing surface can be reused.
- Don't hide critical context behind hover-only interactions.
