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

OWN-WORLD: Felt-green rail (#1f5b3f, committed shell color) beside a plain white work area; green is the action color for buttons, focus, selection and fills; pale yellow (#f8ecaa) marks focus and the active item on the rail. Four soft pastels (pink, yellow, green, blue) are reserved for buckets. Dark mode: deep green ground with a lighter mint action color. Figtree for all UI text with tabular figures; Geist Mono only for account codes. Hairline 1px rules, pill-shaped buttons as in the chosen mockup, 8px radius on inputs and the book switcher, no shadows except on floating layers.

STORY: The user sees their books and accounts exactly where they expect, trusts the numbers, and finds that risky actions (archive) ask for a deliberate hold rather than a modal.

FIRST VIEWPORT: Left felt-green rail with wordmark, book switcher (popover scales from its trigger), and nav. Main area on white: page title row with primary action, then the account tree grouped by type with name, optional number, and detail type. Editing opens a side panel on desktop, a bottom sheet on phones.

FORM: signature move is the fill line: clip-path inset fills in green for progress (wizard steps now, bucket goals later) and for hold-to-archive (1.2s linear fill, 200ms ease-out release). Buckets will appear as soft pastel cards. Press feedback scale(0.97); popovers grow from the trigger; no motion on keyboard-initiated actions; reduced motion keeps only opacity and color. seed: none (pinned) "I like balanced" (the user chose this exact world from a shown round of mockups after two re-rolls; the earlier roll was seed:273238caa3e898ed).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
