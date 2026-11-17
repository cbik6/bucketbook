---
name: Bucketbook
description: Double-entry books with savings buckets, on your own server.
colors:
  paper: "#ffffff"
  surface: "#ffffff"
  surface-sunken: "#f3f6f4"
  ink: "#1c2620"
  ink-muted: "#56665c"
  ink-faint: "#6f7d75"
  rule: "#e8ede9"
  rule-strong: "#d3dcd6"
  field-border: "#7f8c84"
  rail: "#1f5b3f"
  rail-raised: "#286648"
  rail-active: "#2f7353"
  rail-ink: "#f2f7f3"
  rail-muted: "#cfe1d6"
  rail-rule: "#2f6a4d"
  rail-focus: "#f8ecaa"
  mark-fill: "#f8ecaa"
  signal: "#1f5b3f"
  signal-strong: "#184a33"
  signal-ink: "#1f5b3f"
  signal-soft: "#e6f2ea"
  on-signal: "#ffffff"
  focus: "#1f5b3f"
  positive: "#2b704a"
  negative: "#ad3b2a"
  negative-soft: "#f8e3de"
  negative-fill: "#c4513e"
  on-negative-fill: "#ffffff"
  scrim: "rgb(12 24 18 / 0.45)"
  # Reserved for buckets (Phase 4). Defined in globals.css, not used on any screen yet.
  bucket-pink: "#f8d6e0"
  bucket-yellow: "#f8ecaa"
  bucket-green: "#d4ebc6"
  bucket-blue: "#d3e6f5"
  on-bucket: "#1c2620"
typography:
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
    letterSpacing: "-0.02em"
  title-section:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.429
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.333
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  gutter: "20px"
  xl: "24px"
  section: "32px"
  gutter-wide: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.on-signal}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.signal-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.negative}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-small:
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "40px"
  input-disabled:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
  nav-rail-item:
    textColor: "{colors.rail-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  nav-rail-item-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.rail-ink}"
  book-switcher-trigger:
    backgroundColor: "{colors.rail-raised}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  book-switcher-trigger-hover:
    backgroundColor: "{colors.rail-active}"
  menu-popup:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "6px"
  menu-item:
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  fill-line-track:
    backgroundColor: "{colors.rule}"
    rounded: "{rounded.full}"
    height: "6px"
  fill-line-fill:
    backgroundColor: "{colors.signal}"
  option-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  option-card-selected:
    backgroundColor: "{colors.signal-soft}"
  notice:
    backgroundColor: "{colors.signal-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  form-error:
    backgroundColor: "{colors.negative-soft}"
    textColor: "{colors.negative}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  account-row:
    typography: "{typography.body-sm}"
    height: "44px"
  account-row-selected:
    backgroundColor: "{colors.signal-soft}"
---

# Design System: Bucketbook

## Overview

**Creative North Star: "The Well-Made Instrument"**

Bucketbook is a standard, fast bookkeeping shell whose distinction is in how it behaves, not in costume. The frame is familiar on purpose: a felt-green rail on the left, a plain white work area on the right, a page title row with one primary action, then the work. What makes it feel made is the response of every control: presses give back a small, quick scale, menus grow out of the thing that opened them, consequential actions ask for a deliberate hold, and progress fills in green along a hairline. Nothing moves for decoration.

The palette is balanced rather than loud. One felt green does two jobs: it is the frame (rail, phone top bar, setup header) and, on the white work area, the action color for primary buttons, focus, selection, and fills. A single pale yellow lives only on the green frame, where it marks keyboard focus, the current nav item, and the fill inside the bucket mark. Four soft pastels are defined and reserved for buckets; no screen uses them yet. Density is calm but working: 44px rows, 40px controls, hairline 1px rules instead of boxes, and one column of content capped at a readable measure. The system explicitly refuses the grey SaaS dashboard with a blue accent, and refuses motion that exists only to be seen.

Light is the default. Dark mode follows the system unless the user picks a theme, and every color token is redefined for it: a deep green ground (#0f1712) with a lighter mint action color (#7fd0a2) and the same pale yellow on the rail.

**Key Characteristics:**

- Felt-green frame, white work area, green as the one action color.
- Pale yellow only on the green frame: focus, the active-nav tick, the mark.
- Pastel bucket colors reserved, unused until buckets ship.
- Figtree for all UI text with tabular figures; Geist Mono only for account codes.
- Pill buttons, 8px inputs and rail controls, 12px containers.
- Hairline 1px rules and tonal fills for structure; shadows only on floating layers.
- Feel through precise, short, origin-aware motion; keyboard-opened menus are instant.
- Hold to confirm in place of confirmation dialogs.

## Colors

A cool, green-cast neutral set on white, held inside a felt-green frame, with that same green as the only voice that asks for action and pale yellow kept to the frame.

### Primary

- **Felt Green** (signal): the action color. Fills primary buttons, the fill line, the toast action, the skip link, and the signal-tone hold sweep; it is also the text caret. In light mode it is the same value as the rail, so action and frame read as one family. In dark mode it lifts to mint.
- **Deep Felt** (signal-strong): hover state of the primary button, and the selected border and dot on option cards.
- **Felt Ink** (signal-ink): green that can be read as text: the current-book check mark and the action link inside a green notice.
- **Green Wash** (signal-soft): the quiet green ground for a selected table row, a selected option card, the welcome notice, text selection, and the one-time saved-row glow.
- **On Green** (on-signal): white text and icons placed on a green fill.
- **Focus Green** (focus): the keyboard focus ring and focused input border on the white work area.

### Secondary

- **Felt Rail** (rail): the committed shell color. The desktop rail, the phone top bar, the setup and sign-in header, and the browser theme color.
- **Rail Raised** (rail-raised): controls sitting on the rail: the book switcher trigger, the theme toggle track, rail item hover, sign-out hover.
- **Rail Active** (rail-active): the current nav item, the active theme segment, the hovered or open book switcher trigger.
- **Rail Ink** (rail-ink), **Rail Muted** (rail-muted), **Rail Rule** (rail-rule): primary text, secondary text and icons, and dividers on the rail.
- **Rail Yellow** (rail-focus): pale yellow that replaces the focus color anywhere inside the green frame, and the 2px tick on the current rail nav item.
- **Mark Yellow** (mark-fill): the fill line inside the bucket mark in the wordmark. Same pale yellow, kept as its own token.

### Tertiary (state only)

- **Ledger Green** (positive): success text, such as a saved-settings confirmation.
- **Brick** (negative): error text, invalid field borders, the danger button label and its hover border, and negative amounts (always with a minus sign, so color is never the only signal).
- **Brick Wash** (negative-soft): background of the form-level error box.
- **Brick Fill** (negative-fill) with **On Brick** (on-negative-fill): the sweep that fills a danger hold button while it is held, and its label.

### Reserved for buckets (not yet used)

- **Bucket Pink** (bucket-pink), **Bucket Yellow** (bucket-yellow), **Bucket Green** (bucket-green), **Bucket Blue** (bucket-blue), with **On Bucket** (on-bucket) for text on them. Defined in light and dark and exposed as utilities, but no screen uses them. They are held for bucket cards when buckets arrive; until then they appear nowhere.

### Neutral

- **Paper** (paper): the page ground, also painted on the html element so overscroll stays on palette. White in light mode (the same as Surface); one step darker than Surface in dark mode.
- **Surface** (surface): working surfaces: inputs, secondary buttons, the editor panel, menus, toasts, option cards.
- **Sunken** (surface-sunken): ghost hover, menu item highlight, disabled and locked inputs, the archived badge, row hover at 70%.
- **Ink** (ink): primary text, a near-black with a green cast.
- **Ink Muted** (ink-muted): secondary text, hints, descriptions, placeholders, idle icons.
- **Ink Faint** (ink-faint): decoration only, such as the strike line on an archived account name. Not for text that must be read.
- **Rule** (rule): hairline dividers between rows and around menus, toasts, and the editor panel; the fill line track; loading skeletons.
- **Rule Strong** (rule-strong): the underline of an account type heading, the nesting tick, the sheet grabber, scrollbar thumbs.
- **Field Border** (field-border): the 1px stroke on inputs, secondary and danger buttons, option cards, and radio rings, dark enough to read as a control boundary.
- **Scrim** (scrim): the dark veil behind the phone bottom sheet.

### Named Rules

**The One Green Rule.** Felt green is the only action hue. On the work area it marks what is primary, focused, selected, or filling, and nothing else. A second accent color for actions or emphasis is not part of this system.

**The Felt Frame Rule.** The rail color fills only the frame: the rail, the phone top bar, and the setup and sign-in header. Content surfaces stay white; green reaches content only as the action, focus, selection, and fill tokens, never as a filled section ground.

**The Yellow On Green Rule.** Pale yellow appears only inside the green frame: the focus ring there, the active-nav tick, and the fill in the mark. It is never used on the white work area.

**The Reserved Pastels Rule.** The four bucket pastels belong to buckets. Until bucket UI exists they are not used, and when it does they mark buckets only, never general decoration or status.

**The Red Means Risk Rule.** Brick appears only for errors and destructive actions. Even then, meaning is carried by words ("Hold to delete account", the error message), not by color alone.

## Typography

**Body Font:** Figtree (with ui-sans-serif, system-ui, sans-serif), self-hosted at build time through next/font.
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace), for account numbers only.

**Character:** One friendly, open geometric sans does everything, from page titles to figures. Hierarchy comes from weight and a small set of sizes, not from a display face.

The body ground is 15px (0.9375rem) at 1.5 line height. Headings h1 to h3 are balanced and tightened to -0.02em, and the wordmark is set at 600 with the same tightening. On touch screens inputs are forced to 16px so iOS never zooms.

### Hierarchy

- **Headline** (600, 1.5rem, 1.333): the page title in the page header row. The setup wizard steps it up to 1.75rem from 640px.
- **Title** (600, 1.125rem, 1.556): the editor panel title.
- **Title Section** (600, 0.9375rem): account type headings in the chart, followed by a tabular count in Label size at 400 weight, Ink Muted.
- **Body** (400, 0.9375rem, 1.5): running text and setup explanations.
- **Body Small** (400 or 500, 0.875rem): controls, table rows, nav, menus, notices. Depth-zero account names step up to 500.
- **Label** (500, 0.8125rem): field labels and legends. The same size at 400 in Ink Muted carries hints, captions, the step counter, and secondary links.
- **Caption** (400 or 500, 0.75rem): the rail's email line, the book template line, menu group labels, the archived badge.
- **Code** (Geist Mono, 400, 0.8125rem): account numbers in the chart and the account number input.

### Named Rules

**The Tabular Figures Rule.** Every count, date, step number, and amount uses tabular numbers, through tables or the tabular utility. Figures must line up.

**The Mono Is For Codes Rule.** Geist Mono appears only on account numbers. Keyboard hints, figures, and everything else stay in Figtree.

**The Sentence Case Rule.** Labels, headings, and buttons are sentence case at normal tracking. No uppercase tracked labels.

## Layout

The app is a two-part frame. From 1024px the page is a grid of a 16rem felt-green rail and a fluid work area; the rail color is painted as a background stripe so it runs the full height, and the rail itself is sticky at full viewport height. The rail stacks the wordmark, the book switcher, the book nav, and, pinned to the bottom above a rail rule, the user, the theme toggle, and sign out.

Below 1024px the rail becomes a green top bar: a 56px row with the wordmark and the compact theme and sign-out controls, then the book switcher and the nav as horizontal pills, respecting the safe-area inset.

The work area has a 20px side gutter on phones and 40px from 1024px. Every page starts with a page header row (title and optional muted description on the left, actions on the right, a Rule line below), stacking vertically below 640px. List content is capped at a 46rem measure and the header aligns its right edge to it. Account type sections sit 32px apart.

Editing never leaves the list. From 1024px the editor is a 26rem side panel, separated by a 1px Rule on its left and sticky to the viewport. Below 1024px it is a bottom sheet up to 88% of the viewport height over the Scrim.

Setup and sign-in use a plain shell: a 56px green header with the wordmark, then a centered column 28rem wide (42rem for the book step), with 40px top padding on phones and 64px from 640px.

Spacing follows a 4px base with a working set of 6, 8, 12, 16, 20, 24, 32, and 40px. Forms stack fields 20 to 24px apart, with 6px between a label, its control, and its hint.

## Elevation & Depth

The system is flat at rest. Structure comes from hairline rules and tonal steps, not from shadow. In light mode Paper and Surface are both white, so the steps are white and Sunken; in dark mode Paper, Surface, and Sunken are three distinct greens. A single shadow token exists and it belongs only to layers that float above the page.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 12px 32px -8px rgb(20 50 35 / 0.18), 0 2px 6px -2px rgb(20 50 35 / 0.12)`, a deeper black version in dark mode): the book switcher menu, toasts, and the phone bottom sheet.

### Named Rules

**The Float-Only Shadow Rule.** A shadow means the layer floats over the page. Docked surfaces, including the desktop editor panel, use a 1px Rule border instead and carry no shadow.

## Shapes

Corners are scaled by role. Buttons (primary, secondary, ghost, danger, and the hold button built on them) are fully round pills. Inputs, selects, textareas, the book switcher trigger, rail nav items, the theme toggle track, icon buttons, and the form error box use 8px. Containers (menus, toasts, option cards, the welcome notice) use 12px. Menu items, phone nav pills, theme segments, and the skip link use 6px so they nest inside an outer radius. Small inline marks (the archived badge, the keyboard hint, row links, the focus ring) use 4px. The bottom sheet rounds only its top corners at 16px. The fill line, the sheet grabber, the active-nav tick, and radio dots are fully round.

Borders are always 1px. Nested accounts are indented 1.25rem per level and marked with a 10px horizontal hairline tick in Rule Strong, not with tree lines or chevrons.

The mark is a bucket outline with a pale yellow fill line inside it and a faint tint of the current text color, drawn as pure geometry.

## Components

Every control answers the hand: a short scale on press, color shifts on hover, and no motion at all when a menu is opened from the keyboard.

### Buttons

- **Shape:** fully round pills, 40px tall by default with 16px side padding; small size is 32px tall with 12px padding and 0.8125rem text. Text is 500 weight; icons sit 8px from the label.
- **Primary:** Felt Green fill with white text. One per view, in the page header or at the foot of a form. It may carry a keyboard hint (a small 4px-cornered key in Figtree at 0.6875rem, a 25% On Green border, 70% opacity) from 640px.
- **Hover / Focus:** primary darkens to Deep Felt; secondary and danger sharpen their border (Ink Muted, Brick). These button hover styles apply only on devices that hover. Press scales to 0.97 over 150ms with the ease-out curve. Disabled is 50% opacity with no pointer events.
- **Secondary:** white surface, Ink text, 1px Field Border.
- **Ghost:** no fill, Ink Muted text, a Sunken fill and Ink text on hover. Used for Cancel and view toggles.
- **Danger:** white surface, Brick text, 1px Field Border that turns Brick on hover.
- **Pending:** a submitting button keeps its size, swaps to a pending label ("Saving", "Creating book"), and ignores further clicks.

### Hold Button (signature)

Consequential actions such as archive and delete are confirmed by pressing and holding, not by a dialog. The button reads "Hold to archive account"; while held, a fill sweeps across it from the left (clip-path, 1200ms linear, so the progress reads honestly) and reveals "Keep holding". Release before the end snaps the fill back in 200ms ease-out. It works with pointer, touch, and a held Space or Enter key. Danger tone sits on the danger pill and fills with Brick Fill; signal tone sits on the secondary pill and fills with Felt Green. Under reduced motion the confirming state fades in over 200ms instead of sweeping. A successful archive is followed by a toast with Undo.

### Fill Line (signature)

A 6px fully round track in Rule, filled from the left in Felt Green by a clip-path inset, so the fill never changes layout. The fill eases over 500ms on the in-out curve. It reports itself as a progressbar with a label. It is the shared progress device: setup wizard steps now, bucket goals later, and the same gesture as the hold sweep and the fill in the mark. It also sits under the journal entry form's totals, filling as credits approach debits and full when the entry balances.

### Inputs / Fields

- **Style:** 40px tall, white surface, 1px Field Border, 8px corners, 12px side padding, 0.875rem Ink text, Ink Muted placeholder. Selects use the same box with a chevron at the right; textareas grow in height with 8px vertical padding.
- **Field:** a Label above (with a muted "(optional)" suffix when it applies), 6px gaps, then a hint in Label size Ink Muted. An error replaces the hint in Brick.
- **Focus:** the border turns Focus Green with a 2px Focus Green ring at 25% opacity, transitioned over 150ms.
- **Error / Disabled:** invalid fields take a Brick border. Disabled and locked fields sit on Sunken with Ink Muted text. Form-level errors appear in a Brick Wash box with a 40% Brick border, Brick text, and 8px corners above the form.

### Option Cards

Radio choices that need a description (the starting chart of accounts) are full-width cards: white surface, 1px Field Border, 12px corners, 16px padding, a custom round radio. Selecting one turns the border Deep Felt and the ground Green Wash, and the radio dot scales in. Keyboard focus draws the focus ring around the whole card.

### Navigation

- **Rail nav:** 36px items, 8px corners, 12px padding, a 16px line icon, Rail Muted text. Hover lifts to Rail Raised with Rail Ink text. The current page sits on Rail Active at 500 weight with a 2px Rail Yellow tick on its left edge.
- **Phone nav:** the same links as horizontal pills (6px corners) in the green top bar, scrolling sideways if they overflow; the current one sits on Rail Active.
- **Book switcher:** a 44px trigger with 8px corners on Rail Raised showing the book name and its template on a second line, with an up-down chevron; it turns Rail Active on hover or while open and presses to 0.98. Its menu is a 12px-cornered white popup with the Float shadow that scales in from 0.96 at the trigger's origin over 150ms and leaves faster (100ms). Opened from the keyboard, it appears with no motion. Items are 36px with a Sunken highlight; the current book carries a Felt Ink check.
- **Theme toggle:** a three-segment radio group (match system, light, dark) of icon buttons on a Rail Raised track.
- **Focus on the frame:** everything inside the rail, top bar, and plain-shell header draws its focus ring in Rail Yellow.
- **Skip link:** a Felt Green chip that appears at the top left on focus.

### Account Rows

The chart of accounts is a set of tables grouped by type, each under a section heading with a Rule Strong underline and a muted "Add ... account" link. Rows are 44px with Rule hairlines between them, no visible column headers, and Sunken hover. The selected row sits on Green Wash. A just-saved row glows Green Wash once and fades over 1.6s. Archived accounts are struck through in Ink Faint with a small Sunken "Archived" badge. App-owned accounts carry a small lock icon. The per-row "add sub-account" button is hidden until the row is hovered or focused on hover devices, and always visible on touch.

### Editor Sheet

On phones the editor rises from the bottom edge over 400ms on the drawer curve, with 16px top corners, a 40 by 4px grabber, the Float shadow, and the Scrim behind it. On desktop it is a docked panel with no shadow and no entrance animation.

### Ledger Tables

Registers, the general ledger, the journal list and entry lines share one table style: a 1px Rule Strong rule under a Label-size Ink Muted header row, 1px Rule hairlines between rows, no fills or stripes, and a soft Sunken hover. Dates are Ink Muted and never wrap. Amounts are right aligned in tabular figures through the Money component (Brick and a minus sign when negative, blank instead of $0.00 in a debit or credit column). Entry numbers (JE 12) are Felt Ink links to the entry. A register shows a running balance in the account's natural direction and an italic "Balance forward" row when a range starts after the first entry. On phones the register drops the number and the separate debit and credit columns for one signed Amount plus Balance.

### Journal Line Grid

The entry form is a grid of Account, Debit, Credit, Line memo and Remove, with headers aligned to the text inside the inputs. Account pickers are native selects grouped by type, with options labeled by their full path ("Food: Groceries") so every line starts flush. Typing in one amount clears the other; choosing an account on a new line fills the balancing amount. One blank spare line always waits at the end. Under the lines, totals sit under their columns beside a Fill Line that fills as credits approach debits and the words "Balanced" or "Out of balance by $x" (meaning never by color alone). On phones each line stacks: account with an inline remove, then debit and credit side by side, then memo.

### Kind Badges

Small labels after an entry's title or date: "Opening balances", "Reversal", "Reversed", "Edited, v2". Sunken fill, Ink Muted Caption text, 4px corners. They state facts, never status colors.

### Range Picker

Date range presets (This month, Last month, Year to date, Last year, All dates) as small pills, the active one filled Felt Green, followed by a From and To date pair and an Apply button at the same 40px height. The range lives in the URL so views can be bookmarked.

### Keyboard Hints

Shortcuts are shown where they apply, as small keys in Figtree at 0.6875rem with a 1px border and 4px corners: N on New account and New entry, and Ctrl+Enter and Enter beneath the entry form's buttons.

### Notices and Toasts

An inline notice (the welcome message) is a Green Wash block with 12px corners and Body Small Ink text, its action link in Felt Ink. Toasts sit at the bottom right on white with a Rule border, 12px corners, and the Float shadow; their action button is Felt Green.

## Do's and Don'ts

### Do:

- **Do** use the color tokens for every color so light and dark mode both hold; never hard-code a hex in a component.
- **Do** spend felt green on the work area only on the primary action, focus, selection, current state, and fills (The One Green Rule).
- **Do** keep pale yellow on the green frame only: focus there, the active-nav tick, the mark (The Yellow On Green Rule).
- **Do** use tabular figures for every number and right-align amounts in tables.
- **Do** make buttons pills, and keep inputs and rail controls at 8px.
- **Do** give every button the 0.97 press scale at 150ms ease-out, and guard button hover styles behind a hover-capable device.
- **Do** skip transitions when a menu or panel is opened from the keyboard.
- **Do** confirm archive and delete with the Hold Button and offer Undo afterward in a toast.
- **Do** use the Fill Line for any progress toward a goal or through steps.
- **Do** edit in place: a side panel from 1024px, a bottom sheet below it.
- **Do** keep reduced motion working: no sweeps, slides, or keyframes; color and opacity changes only.
- **Do** write all copy, labels, and documentation without em dashes or en dashes; use commas, colons, parentheses, or separate sentences.

### Don't:

- **Don't** introduce a second action hue or a grey dashboard with a blue accent.
- **Don't** use the bucket pastels for anything but buckets, and don't use them at all before bucket UI exists.
- **Don't** put pale yellow on the white work area.
- **Don't** put shadows on docked or resting surfaces; the Float shadow is for menus, toasts, and the phone sheet only.
- **Don't** fill content cards or page sections with the rail green; it is the frame.
- **Don't** add motion for decoration, or a confirmation modal for archive or delete.
- **Don't** use Geist Mono for anything but account numbers.
- **Don't** use uppercase tracked labels or eyebrow text above headings.
- **Don't** convey a negative amount, an error, or a destructive action by color alone.
- **Don't** use Ink Faint for text that has to be read.
- **Don't** use an em dash or en dash anywhere, including in this file.
