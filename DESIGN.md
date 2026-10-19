---
name: Presupuesto Abierto Perú
description: The public budget announced like a cartel chicha, in stacked fluorescent bands on a near-black poster ground.
colors:
  negro: "#0e0e10"
  panel: "#18181c"
  regla: "#34343c"
  texto-fuerte: "#f7f7f2"
  texto: "#d9d9df"
  texto-suave: "#a6a6b1"
  fucsia: "#ff2e88"
  amarillo: "#ffe600"
  verde: "#00d26a"
  naranja: "#ff8a00"
  celeste: "#3ee0ff"
typography:
  display-key:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(40px, 12.5vw, 96px)"
    fontWeight: 400
    lineHeight: 1.04
  display:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(32px, 9.6vw, 72px)"
    fontWeight: 400
    lineHeight: 1.04
  headline:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(30px, 8.4vw, 58px)"
    fontWeight: 400
    lineHeight: 1.16
    letterSpacing: "0.005em"
  title:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(21px, 5.6vw, 28px)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0.01em"
  figure:
    fontFamily: "Anton, Arial Narrow, sans-serif"
    fontSize: "clamp(24px, 6.4vw, 32px)"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
  body-strong:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.55
    fontFeature: "tnum"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.05em"
rounded:
  none: "0px"
spacing:
  band-gap: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  row: "11px"
  gutter: "16px"
  module: "18px"
  section: "28px"
components:
  band-fucsia:
    backgroundColor: "{colors.fucsia}"
    textColor: "{colors.negro}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "0.08em 0.18em 0.04em"
  band-amarillo:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.negro}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "0.08em 0.18em 0.04em"
  section-tab:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.negro}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "0.06em 0.22em 0.02em"
  button-tab:
    backgroundColor: "{colors.negro}"
    textColor: "{colors.texto-fuerte}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
  button-tab-active:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.negro}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
  button-explain:
    backgroundColor: "{colors.negro}"
    textColor: "{colors.celeste}"
    rounded: "{rounded.none}"
    height: "26px"
    padding: "0 7px"
  button-explain-active:
    backgroundColor: "{colors.celeste}"
    textColor: "{colors.negro}"
    rounded: "{rounded.none}"
    height: "26px"
    padding: "0 7px"
  input-search:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.texto-fuerte}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  badge-alta:
    backgroundColor: "{colors.fucsia}"
    textColor: "{colors.negro}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  badge-media:
    backgroundColor: "{colors.naranja}"
    textColor: "{colors.negro}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  badge-nueva:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.negro}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  badge-neutro:
    backgroundColor: "{colors.negro}"
    textColor: "{colors.texto-suave}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  kpi-value:
    textColor: "{colors.amarillo}"
    typography: "{typography.figure}"
  cut-date-chip:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.negro}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 6px"
  nav-bottom:
    backgroundColor: "{colors.negro}"
    textColor: "{colors.texto-suave}"
    padding: "4px 2px"
  nav-bottom-active:
    textColor: "{colors.amarillo}"
  split-band:
    backgroundColor: "{colors.negro}"
    height: "44px"
---

# Design System: Presupuesto Abierto Perú

## Overview

**Creative North Star: "The Cartel Chicha"**

The budget is announced the way a Lima street poster announces a concert: a near-black ground, a stack of fluorescent ink bands carrying the question and the number, condensed block letters you can read from across the street. Every page opens with its band stack (fucsia question, amarillo subject, verde amount) and every module below is headed by its own ink tab. It deliberately refuses the white civic dashboard of same-size rounded cards with a blue accent.

Density is that of a high-information poster: one loud stack at the top, then ruled information blocks, ranked lists and stacked ink splits running on 1px rules. Nothing floats; there are no cards, no shadows, no rounded corners. Colour never decorates: each ink has a job, and the job holds across every surface. The world is dark only (`color-scheme: dark`); there is no light theme.

Motion is a single printed gesture: the ink wipe. Bands and split segments are revealed left to right once per page, and nothing else animates beyond state transitions and a press scale.

**Key Characteristics:**
- Near-black poster ground with five fluorescent inks, each bound to one meaning.
- Anton for bands, tabs, figures and place names; Archivo for reading, always with tabular figures.
- Flat printed marks: 1px rules, 2px accent rules, zero radius, zero shadow.
- The band stack and the stacked ink split are the two signatures.
- One motion: the ink wipe, off under reduced motion.

## Colors

A black poster sheet printed with five fluorescent inks; the inks carry meaning, the greys carry structure.

### Primary
- **Cartel Fucsia** (fucsia): identity and attention. The wordmark block, the header and bottom-bar top rules (2px), the first band of every stack, page-title poster lines, step numbers, breadcrumb dashes, and the "Prioridad alta" alert badge.
- **Señal Amarillo** (amarillo): amounts and the primary action. KPI values, share figures, progress fills, section band tabs, active tabs and nav items, the cut-date chip, focus border on the search field, figure-block top rules (2px), selection, caret and native accent colour.

### Secondary
- **Al Día Verde** (verde): on pace and increases. The amount band in stacks, on-pace readings and progress, positive deltas, income series, "proyecto" type tags.
- **Atraso Naranja** (naranja): behind and cuts. Behind-schedule readings (tinted at 10%), negative deltas, "Atención" badges. It is the only warning ink; there is no red.

### Tertiary
- **Explica Celeste** (celeste): explain and links. "¿Qué es?" buttons, explanation highlights, underlined text links, the current breadcrumb step, glossary codes, targeted-district rule, and the 2px focus outline.

### Neutral
- **Poster Negro** (negro): the page ground, header, bottom bar, and the text colour on every ink field.
- **Panel** (panel): the one raised tone, for alert modules, the search field and explanation panels.
- **Regla** (regla): every 1px rule, empty bar tracks, and the "otras" segment of a split.
- **Texto Fuerte** (texto-fuerte): names, headings in reading type, emphasised figures.
- **Texto** (texto): body copy.
- **Texto Suave** (texto-suave): labels, metadata, notes, inactive nav.

### Named Rules
**The One Ink, One Job Rule.** Fucsia is identity and attention, amarillo is money and the primary action, verde is on pace or up, naranja is behind or down, celeste is explain and link. Never swap an ink's meaning for variety.

**The No Red Rule.** There is no error red. Bad news is naranja, and alerts read as reasons to ask, not accusations.

**The Ink Order Rule.** Categorical splits take inks in the fixed order fucsia, amarillo, verde, celeste, naranja; anything past five is "otras" in regla. This order was validated for colour-blind separation of neighbours on the dark ground (worst adjacent ΔE 12.1). A lightness-band check fails by design: equal-luminance fluorescent ink is the world, so identity never rests on colour alone; segments carry their percentage when wide enough (≥9%) and the rows beneath are the legend, each with its chip.

**The Black On Ink Rule.** Text set on any ink field is negro, never white.

## Typography

**Display Font:** Anton (with Arial Narrow, sans-serif), self-hosted via next/font, weight 400 only
**Body Font:** Archivo (with system-ui, sans-serif), self-hosted via next/font

**Character:** Anton is the poster's block letter, tall, condensed and always uppercase when it heads something; Archivo is the plain reading voice beneath it, sturdy at 15px on a cheap phone.

### Hierarchy
- **Display Key** (Anton 400, clamp(40px, 12.5vw, 96px), 1.04): the loudest line of a band stack, usually the entity or place name.
- **Display** (Anton 400, clamp(32px, 9.6vw, 72px), 1.04, uppercase): a band in the stack. A small band variant runs at clamp(20px, 5.4vw, 34px).
- **Headline** (Anton 400, clamp(30px, 8.4vw, 58px), 1.16, uppercase): a page title without a stack, set inline on fucsia so every wrapped line becomes its own band.
- **Title** (Anton 400, clamp(21px, 5.6vw, 28px), 1.12, uppercase): the section band tab on amarillo. Place names in lists use Anton at 17 to 22px uppercase in texto-fuerte.
- **Figure** (Anton 400, clamp(24px, 6.4vw, 32px), 1.1): KPI values in amarillo; share figures in rows at 26px.
- **Body** (Archivo 400, 15px, 1.55, tabular figures): reading copy, capped near 64 to 72ch. Secondary text steps down to 14.5, 13 and 12.5px.
- **Label** (Archivo 700, 12px, 0.05em, uppercase): names a figure or a table column directly above or beside it. Nav labels use the same voice at 13px with 0.03em.

### Named Rules
**The Tabular Axis Rule.** Every number is set with tabular figures (`font-variant-numeric: tabular-nums` on body) and right-aligned in rows, so amounts sit on one axis.

**The Readable Names Rule.** MEF publishes names in unaccented capitals; the site never shows them that way. Every entity, category and place name passes through the name formatter (`lib/nombres.ts`, mirrored by `pipeline/nombres.py`): sentence case with Spanish accents restored, connectors lowercased, acronyms kept as published.

## Layout

Phone first at 375px. Content sits in a single column (max 1080px, 16px side padding); the header container widens to 1320px on desktop so the wordmark and full top nav fit. Pages are a vertical grid with a 28px gap between modules; modules open with a 1px top rule and 18px of space. Rows (lists, splits, desglose, obras) run at 11px vertical padding separated by 1px rules, the last row unruled.

The grid is the armature: figure blocks are 2 columns on phones and 4 from 768px, divided by 1px vertical rules and capped by a 2px amarillo rule. Province and comparison indexes use auto-fill columns (min 220 to 230px) on the same ruled grid. On phones under 600px the band stack bleeds to the left screen edge.

Navigation: a fixed six-item bottom bar below 1024px (body reserves 76px for it), a top nav from 1024px. The route país › región › provincia › distrito is always visible as breadcrumbs on place and entity pages.

Breakpoints observed: 520px, 600px, 768px, 1024px, 1180px.

## Elevation & Depth

None. The system is flat printed ink: no box-shadows anywhere, no blur, no gradients beyond the two-triangle select arrow. Hierarchy comes from ink fields (bands and tabs), rule weight (1px regla for structure, 2px amarillo or fucsia for emphasis), and one tonal step (panel on negro) for contained modules such as alerts, explanations and the search field.

### Named Rules
**The Printed Mark Rule.** Depth is ink and rules, never shadow. A module separates from its neighbours by a rule or a panel tone, not by lifting.

## Shapes

Every corner is square (0px, including the search input's native radius, reset explicitly). Shapes are rectangles of ink: bands sized to their text, tabs sized to their label, 8px and 6px bar tracks, 12px square legend chips, 34px square step numbers. Rules are the only lines: 1px solid for structure, 2px for accents and the targeted district, 1px dashed for empty states and chart gridlines (3 4). Split segments are separated by 2px gaps of ground, not borders.

## Components

### Buttons
Tactile, square and ruled.
- **Shape:** square (0px), 1px regla border.
- **Tab / action:** transparent with texto-fuerte label, Archivo 700 14px, padding 9px 14px; active or selected fills amarillo with negro text.
- **Hover / Focus:** hover (fine pointers only) lifts the border to texto-suave; focus-visible draws a 2px celeste outline offset 2px. Press scales to 0.97 over 160ms on the shared ease.
- **Explain ("¿Qué es?"):** 26px tall, 1px celeste border, celeste label; open state fills celeste. Text-link variant: celeste, 700, underlined at 3px offset.
- **Disabled:** 40% opacity, not-allowed cursor.

### Chips
- **Badges:** uppercase Archivo 800 at 11.5px. Alta on fucsia, Atención on naranja, Nueva on amarillo, all with negro text; neutral badges are texto-suave inside a 1px regla rule.
- **Cut-date chip:** "al 17 oct" in the header, negro on amarillo, uppercase 12px.
- **Type tags:** 10.5px uppercase in a 1px rule; "proyecto" fills verde.

### Cards / Containers
- **Corner Style:** square.
- **Background:** none for modules (a 1px top rule only); panel for alerts and explanation panels; negro inset for the official MEF definition.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px regla.
- **Internal Padding:** 14px.

### Inputs / Fields
- **Style:** panel background, 2px regla border, 16px text (no iOS zoom), padding 12px 14px, square.
- **Focus:** border turns amarillo; no outline ring on the field.
- **Select:** same field with an amarillo chevron drawn from two gradient triangles.

### Navigation
- **Header:** sticky, negro, 58px, 2px fucsia bottom rule; wordmark is a fucsia "S/" block plus "Presupuesto Abierto Perú" in Anton with "Abierto" in amarillo.
- **Top nav (≥1024px):** Archivo 700 13px uppercase in texto-suave; active item fills amarillo.
- **Bottom bar (<1024px):** fixed, six items, 2px fucsia top rule, 21px line icons (lucide, inline SVG) over 10.5px labels; active item turns amarillo.
- **Breadcrumbs:** uppercase 13px, steps joined by 10x2px fucsia dashes; the current step fills celeste.

### Band Stack (signature)
The page's question and number as two to four stacked bands: one h1 for assistive tech, each band aria-hidden. Bands are 4px apart, left-aligned, sized to their text, and typically run fucsia question, amarillo subject (often Display Key), verde amount. Each band wipes in once with the ink wipe, staggered 70ms.

### Stacked Ink Split (signature)
A budget split drawn as one 44px band of ink segments in the fixed ink order, 2px ground gaps, minimum segment 3px, "otras" in regla. Segments of 9% or more carry their percentage in Anton 18px. The rows below are the legend, each with its 12px chip and its share in amarillo Anton. Segments wipe in after a 120ms delay, staggered 50ms.

### Figure Block
KPIs as a poster's information block, not cards: a 2px amarillo top rule, cells divided by 1px rules, uppercase label, amarillo Anton value, texto-suave note.

### Reading
A sentence that interprets a number: 1px border and 10% tint in verde (on pace) or naranja (behind; 2px when serious), with a 20px lucide status icon in the same ink. The change summary variant sits on panel with an amarillo icon.

### Motion
One ink wipe: `clip-path: inset(0 100% 0 0)` to `inset(0)`, 520ms, cubic-bezier(0.23, 1, 0.32, 1), on bands, poster-line titles and split segments, only under `prefers-reduced-motion: no-preference`. State transitions use 160ms on the same ease; progress fills ease width over 400ms.

## Do's and Don'ts

### Do:
- **Do** open every page with a band stack or a fucsia poster-line title, and head every module with an amarillo band tab.
- **Do** keep each ink on its one job: fucsia identity and attention, amarillo amounts and primary action, verde on pace and increases, naranja behind and cuts, celeste explain and links.
- **Do** set text on ink in negro.
- **Do** draw categorical splits in the order fucsia, amarillo, verde, celeste, naranja, then "otras" in regla, and always label them in text.
- **Do** use tabular figures and a right-aligned number axis in every row.
- **Do** run names through the name formatter so they show in sentence case with accents.
- **Do** gate hover styles to `(hover: hover) and (pointer: fine)` and give presses a 0.97 scale.
- **Do** use inline line icons (lucide) at 1em or 20 to 21px, in the ink of their meaning.

### Don't:
- **Don't** add box-shadows, blur, or rounded corners; separate with 1px rules and the panel tone.
- **Don't** introduce a red error colour; behind and bad read in naranja.
- **Don't** add a light theme; the world is dark only.
- **Don't** animate anything beyond the ink wipe and state transitions, and never run the wipe under reduced motion.
- **Don't** show MEF names in raw unaccented capitals.
- **Don't** set Anton in body copy or at weights other than 400.
