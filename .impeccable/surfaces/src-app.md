---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

# Surface: app shell, setup wizard, books, chart of accounts

Mode: operate. Audience: a household or small-business bookkeeper doing a weekly sit-down at a desk, and quick phone checks. Task in Phase 1: first-run setup, switching books, building and tidying the chart of accounts.

The user delegated the direction: "use Emil Kowalski's design features to come up with something unique." Pinned whole by that instruction, no roll used for the build.

## Direction contract

THESIS: Distinction through feel, not costume. A standard, fast bookkeeping shell whose every press, open and confirm behaves with the precision of a well-made instrument. Refuses the grey SaaS dashboard with a blue accent and decorative motion.

OWN-WORLD: Deep spruce rail (committed shell color) beside a warm paper-white work area; marigold is the single signal color for focus, selection and fill; ink near-black with a green cast. Dark mode: spruce-black ground, the marigold unchanged. One workhorse sans (Geist) for UI and figures with tabular numbers; Geist Mono only for account codes. Hairline 1px rules, 8px radius on controls, no shadows except on floating layers.

STORY: The user sees their books and accounts exactly where they expect, trusts the numbers, and finds that risky actions (archive) ask for a deliberate hold rather than a modal.

FIRST VIEWPORT: Left spruce rail with wordmark, book switcher (popover scales from its trigger), and nav. Main area: page title row with primary action, then the account tree grouped by type with code, name, subtype, and status columns. Editing opens a side panel on desktop, a bottom sheet on phones.

FORM: signature move is the fill line: clip-path inset fills in marigold for progress (wizard steps now, bucket goals later) and for hold-to-archive (1.2s linear fill, 200ms ease-out release). Press feedback scale(0.97) at 160ms; popovers 180ms ease-out from trigger origin; no motion on keyboard-initiated actions; reduced motion keeps only opacity. seed: none (pinned) "use emils design features to come up with something unique".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
