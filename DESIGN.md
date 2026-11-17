---
name: Bucketbook
description: Double-entry books with savings buckets, on your own server.
colors:
  paper: "#faf9f6"
  surface: "#ffffff"
  surface-sunken: "#f2f1ec"
  ink: "#18211f"
  ink-muted: "#55615d"
  ink-faint: "#737f7b"
  rule: "#e3e1d9"
  rule-strong: "#cdcac0"
  field-border: "#857f73"
  rail: "#163530"
  rail-raised: "#1e443e"
  rail-active: "#275249"
  rail-ink: "#eef3ef"
  rail-muted: "#a9bdb6"
  rail-rule: "#2a4a44"
  signal: "#e8a33d"
  signal-strong: "#d48c22"
  signal-ink: "#6b4a0e"
  signal-soft: "#fbedd3"
  on-signal: "#241a05"
  focus: "#9a6408"
  positive: "#2b704a"
  negative: "#ad3b2a"
  negative-soft: "#f8e3de"
  negative-fill: "#c4513e"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.333
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.556
    letterSpacing: "-0.02em"
  title-section:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: '"ss01", "cv11"'
  body-sm:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.429
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
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
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.signal-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.negative}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "40px"
  button-small:
    rounded: "{rounded.lg}"
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

Bucketbook is a standard, fast bookkeeping shell whose distinction is in how it behaves, not in costume. The frame is familiar on purpose: a deep spruce rail on the left, a warm paper work area on the right, a page title row with one primary action, then the work. What makes it feel made is the response of every control: presses give back a small, quick scale, menus grow out of the thing that opened them, consequential actions ask for a deliberate hold, and progress fills in marigold along a hairline. Nothing moves for decoration.

Density is calm but working: 44px rows, 40px controls, hairline 1px rules instead of boxes, and one column of content capped at a readable measure. Color is spent sparingly. Spruce belongs to the frame, ink and paper carry the content, and a single marigold signal marks what is active, focused, selected, or filling. The system explicitly refuses the grey SaaS dashboard with a blue accent, and refuses motion that exists only to be seen.

Light is the default. Dark mode follows the system unless the user picks a theme, and every color token is redefined for it: a spruce-black ground with the same marigold signal, brightened for contrast.

**Key Characteristics:**

- Spruce frame, paper work area, one marigold signal.
- One workhorse sans (Geist) with tabular figures; Geist Mono only for account codes.
- Hairline 1px rules and tonal fills for structure; shadows only on floating layers.
- 8px corners on controls, 12px on containers.
- Feel through precise, short, origin-aware motion; keyboard actions are instant.
- Hold to confirm in place of confirmation dialogs.

## Colors

A warm paper and green-cast ink palette held inside a deep spruce frame, with marigold as the only voice that asks for attention.

### Primary

- **Marigold Signal** (signal): the single signal color. Fills primary buttons, the fill line, the active-nav tick on the rail, and the caret (via Marigold Strong). Never used as text on paper.
- **Marigold Strong** (signal-strong): hover state of the primary button, the selected border and dot on option cards, and the text caret.
- **Marigold Ink** (signal-ink): marigold that can be read as text: the current-book check mark and links inside a marigold notice.
- **Marigold Wash** (signal-soft): the quiet marigold ground for a selected table row, a selected option card, the welcome notice, text selection, and the one-time saved-row glow.
- **Signal Ink** (on-signal): near-black brown text and icons placed on a marigold fill.
- **Focus Amber** (focus): the keyboard focus ring on paper. On the spruce rail the focus ring switches to Marigold Signal for contrast.

### Secondary

- **Deep Spruce** (rail): the committed shell color. The desktop rail, the phone top bar, the setup header, and the browser theme color.
- **Spruce Raised** (rail-raised): controls sitting on the rail: the book switcher trigger, the theme toggle track, rail hover.
- **Spruce Active** (rail-active): the current nav item and the active theme segment.
- **Rail Ink** (rail-ink), **Rail Muted** (rail-muted), **Rail Rule** (rail-rule): primary text, secondary text and icons, and dividers on the rail.

### Tertiary (state only)

- **Ledger Green** (positive): success text, such as a saved-settings confirmation.
- **Brick** (negative): error text, invalid field borders, the danger button label and its hover border.
- **Brick Wash** (negative-soft): background of the form-level error box.
- **Brick Fill** (negative-fill): the sweep that fills a danger hold button while it is held.

### Neutral

- **Paper** (paper): the page ground, also painted on the html element so overscroll stays on palette.
- **Surface** (surface): white working surfaces: inputs, secondary buttons, the editor panel, menus, toasts.
- **Sunken** (surface-sunken): ghost hover, menu item highlight, disabled inputs, the archived badge, row hover at 70%.
- **Ink** (ink): primary text, a near-black with a green cast.
- **Ink Muted** (ink-muted): secondary text, hints, descriptions, placeholders, idle icons.
- **Ink Faint** (ink-faint): decoration only, such as the strike line on an archived account name. Not for text that must be read.
- **Rule** (rule): hairline dividers between rows and around menus, toasts, and the editor panel; the fill line track.
- **Rule Strong** (rule-strong): the underline of an account type heading, the nesting tick, the sheet grabber, scrollbar thumbs.
- **Field Border** (field-border): the 1px stroke on inputs, secondary and danger buttons, and option cards, dark enough to read as a control boundary.

### Named Rules

**The One Marigold Rule.** Marigold is the only accent hue. It marks what is primary, focused, selected, active, or filling, and nothing else. A second accent color for actions or emphasis is not part of this system.

**The Spruce Frame Rule.** Spruce is the frame, never the content. It is used for the rail, the top bar, and the setup header; content surfaces stay on paper and white.

**The Red Means Risk Rule.** Brick appears only for errors and destructive actions. Even then, meaning is carried by words ("Hold to delete account", the error message), not by color alone.

## Typography

**Body Font:** Geist (with ui-sans-serif, system-ui, sans-serif), loaded through the geist package.
**Label/Mono Font:** Geist Mono (with ui-monospace, monospace), for account numbers only.

**Character:** One quiet, precise sans does everything, from page titles to figures. Hierarchy comes from weight and a small set of sizes, not from a display face.

The body ground is 15px (0.9375rem) at 1.5 line height with the Geist stylistic alternates ss01 and cv11 turned on. Headings h1 to h3 are balanced and tightened to -0.02em. On touch screens inputs are forced to 16px so iOS never zooms.

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

**The Mono Is For Codes Rule.** Geist Mono appears only on account numbers. Keyboard hints, figures, and everything else stay in Geist.

**The Sentence Case Rule.** Labels, headings, and buttons are sentence case at normal tracking. No uppercase tracked labels.

## Layout

The app is a two-part frame. From 1024px the page is a grid of a 16rem spruce rail and a fluid work area; the rail color is painted as a background stripe so it runs the full height, and the rail itself is sticky at full viewport height. The rail stacks the wordmark, the book switcher, the book nav, and, pinned to the bottom above a rail rule, the user, the theme toggle, and sign out.

Below 1024px the rail becomes a spruce top bar: a 56px row with the wordmark and the compact theme and sign-out controls, then the book switcher and the nav as horizontal pills, respecting the safe-area inset.

The work area has a 20px side gutter on phones and 40px from 1024px. Every page starts with a page header row (title and optional muted description on the left, actions on the right, a Rule line below), stacking vertically below 640px. List content is capped at a 46rem measure and the header aligns its right edge to it. Account type sections sit 32px apart.

Editing never leaves the list. From 1024px the editor is a 26rem side panel, separated by a 1px Rule on its left and sticky to the viewport. Below 1024px it is a bottom sheet up to 88% of the viewport height over a dark scrim.

Setup and sign-in use a plain shell: a 56px spruce header with the wordmark, then a centered column 28rem wide (42rem for the book step), with 40px top padding on phones and 64px from 640px.

Spacing follows a 4px base with a working set of 6, 8, 12, 16, 20, 24, 32, and 40px. Forms stack fields 20 to 24px apart, with 6px between a label, its control, and its hint.

## Elevation & Depth

The system is flat at rest. Structure comes from hairline rules and tonal steps (paper, surface, sunken), not from shadow. A single shadow token exists and it belongs only to layers that float above the page.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 12px 32px -8px rgb(22 53 48 / 0.18), 0 2px 6px -2px rgb(22 53 48 / 0.12)`, a deeper black version in dark mode): the book switcher menu, toasts, and the phone bottom sheet.

### Named Rules

**The Float-Only Shadow Rule.** A shadow means the layer floats over the page. Docked surfaces, including the desktop editor panel, use a 1px Rule border instead and carry no shadow.

## Shapes

Corners are gently rounded and scaled by role. Controls (buttons, inputs, nav items, the book switcher trigger, icon buttons) use 8px. Containers (menus, toasts, option cards, notices) use 12px. Menu items, phone nav pills, and theme segments inside a container use 6px so they nest inside the outer radius. Small inline marks (the archived badge, keyboard hint, row links, the focus ring) use 4px. The bottom sheet rounds only its top corners at 16px. The fill line, the sheet grabber, the active-nav tick, and radio dots are fully round.

Borders are always 1px. Nested accounts are indented 1.25rem per level and marked with a 10px horizontal hairline tick in Rule Strong, not with tree lines or chevrons.

The mark is a bucket outline with a marigold fill line inside it, drawn as pure geometry in the current text color.

## Components

Every control answers the hand: a short scale on press, color shifts on hover only where a hover exists, and no motion at all when the action came from the keyboard.

### Buttons

- **Shape:** gently rounded (8px), 40px tall by default with 16px side padding; small size is 32px tall with 12px padding and 0.8125rem text. Text is 500 weight; icons sit 8px from the label.
- **Primary:** Marigold Signal fill with Signal Ink text. One per view, in the page header or at the foot of a form. It may carry a keyboard hint (a small bordered key in Geist at 0.6875rem, 70% opacity) from 640px.
- **Hover / Focus:** primary darkens to Marigold Strong; secondary and danger sharpen their border (Ink Muted, Brick). Hover styles apply only on devices that hover. Press scales to 0.97 over 150ms with the ease-out curve. Disabled is 50% opacity with no pointer events.
- **Secondary:** white surface, Ink text, 1px Field Border.
- **Ghost:** no fill, Ink Muted text, a Sunken fill and Ink text on hover. Used for Cancel and view toggles.
- **Danger:** white surface, Brick text, 1px Field Border that turns Brick on hover.
- **Pending:** a submitting button keeps its size, swaps to a pending label ("Saving", "Creating book"), and ignores further clicks.

### Hold Button (signature)

Consequential actions such as archive and delete are confirmed by pressing and holding, not by a dialog. The button reads "Hold to archive account"; while held, a fill sweeps across it from the left (clip-path, 1200ms linear, so the progress reads honestly) and reveals "Keep holding". Release before the end snaps the fill back in 200ms ease-out. It works with pointer, touch, and a held Space or Enter key. Danger tone fills with Brick Fill; signal tone fills with Marigold Signal. Under reduced motion the confirming state fades in instead of sweeping. A successful archive is followed by a toast with Undo.

### Fill Line (signature)

A 6px fully round track in Rule, filled from the left in Marigold Signal by a clip-path inset, so the fill never changes layout. The fill eases over 500ms on the in-out curve. It reports itself as a progressbar with a label. It is the shared progress device: setup wizard steps now, bucket goals later, and the same gesture as the hold sweep and the bucket in the mark.

### Inputs / Fields

- **Style:** 40px tall, white surface, 1px Field Border, 8px corners, 12px side padding, 0.875rem Ink text, Ink Muted placeholder. Selects use the same box with a chevron at the right; textareas grow in height with 8px vertical padding.
- **Field:** a Label above (with a muted "(optional)" suffix when it applies), 6px gaps, then a hint in Label size Ink Muted. An error replaces the hint in Brick.
- **Focus:** the border turns Focus Amber with a 2px Focus Amber ring at 25% opacity, transitioned over 150ms.
- **Error / Disabled:** invalid fields take a Brick border. Disabled and locked fields sit on Sunken with Ink Muted text. Form-level errors appear in a Brick Wash box with Brick text and 8px corners above the form.

### Option Cards

Radio choices that need a description (the starting chart of accounts) are full-width cards: white surface, 1px Field Border, 12px corners, 16px padding, a custom round radio. Selecting one turns the border Marigold Strong and the ground Marigold Wash, and the radio dot scales in. Keyboard focus draws the focus ring around the whole card.

### Navigation

- **Rail nav:** 36px items, 8px corners, 12px padding, a 16px line icon, Rail Muted text. Hover lifts to Spruce Raised with Rail Ink text. The current page sits on Spruce Active at 500 weight with a 2px Marigold tick on its left edge.
- **Phone nav:** the same links as horizontal pills (6px corners) in the spruce top bar, scrolling sideways if they overflow; the current one sits on Spruce Active.
- **Book switcher:** a 44px trigger on Spruce Raised showing the book name and its template on a second line, with an up-down chevron; it presses to 0.98. Its menu is a 12px-cornered white popup with the Float shadow that scales in from 0.96 at the trigger's origin over 150ms and leaves faster (100ms). Opened from the keyboard, it appears with no motion. Items are 36px with a Sunken highlight; the current book carries a Marigold Ink check.
- **Theme toggle:** a three-segment radio group (match system, light, dark) of icon buttons on a Spruce Raised track.
- **Skip link:** a Marigold Signal chip that appears at the top left on focus.

### Account Rows

The chart of accounts is a set of tables grouped by type, each under a section heading with a Rule Strong underline and a muted "Add ... account" link. Rows are 44px with Rule hairlines between them, no visible column headers, and Sunken hover. The selected row sits on Marigold Wash. A just-saved row glows Marigold Wash once and fades over 1.6s. Archived accounts are struck through in Ink Faint with a small Sunken "Archived" badge. App-owned accounts carry a small lock icon. The per-row "add sub-account" button is hidden until the row is hovered or focused on hover devices, and always visible on touch.

### Editor Sheet

On phones the editor rises from the bottom edge over 400ms on the drawer curve, with 16px top corners, a 40 by 4px grabber, the Float shadow, and a scrim behind it. On desktop it is a docked panel with no shadow and no entrance animation.

### Notices and Toasts

An inline notice (the welcome message) is a Marigold Wash block with 12px corners and Body Small Ink text, its action link in Marigold Ink. Toasts sit at the bottom right on white with a Rule border, 12px corners, and the Float shadow; their action button is Marigold Signal.

## Do's and Don'ts

### Do:

- **Do** use the color tokens for every color so light and dark mode both hold; never hard-code a hex in a component.
- **Do** spend marigold only on the primary action, focus, selection, current state, and fills (The One Marigold Rule).
- **Do** use tabular figures for every number and right-align amounts in tables.
- **Do** give every pressable control the 0.97 press scale at 150ms ease-out, and guard hover styles behind a hover-capable device.
- **Do** skip transitions when a menu or panel is opened from the keyboard.
- **Do** confirm archive and delete with the Hold Button and offer Undo afterward in a toast.
- **Do** use the Fill Line for any progress toward a goal or through steps.
- **Do** edit in place: a side panel from 1024px, a bottom sheet below it.
- **Do** keep reduced motion working: no sweeps, slides, or keyframes; color and opacity changes only.
- **Do** write all copy, labels, and documentation without em dashes or en dashes; use commas, colons, parentheses, or separate sentences.

### Don't:

- **Don't** introduce a second accent hue or a grey dashboard with a blue accent.
- **Don't** put shadows on docked or resting surfaces; the Float shadow is for menus, toasts, and the phone sheet only.
- **Don't** use spruce for content cards or page sections; it is the frame.
- **Don't** add motion for decoration, or a confirmation modal for archive or delete.
- **Don't** use Geist Mono for anything but account numbers.
- **Don't** use uppercase tracked labels or eyebrow text above headings.
- **Don't** convey a negative amount, an error, or a destructive action by color alone.
- **Don't** use Ink Faint for text that has to be read.
- **Don't** use an em dash or en dash anywhere, including in this file.
