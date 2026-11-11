# Design notes

How the site looks and why. Tokens and component styles live in `apps/web/app/globals.css`.

## Who it is for

Ordinary citizens on a phone, often outdoors, with no budget vocabulary. When needs conflict
they come first: plain language first, the official term second, the raw code last. Journalists
and watchdogs get the detail one tap deeper.

## The world: a *khipu*

The State's accounts kept the way the Tawantinsuyu kept them: on undyed cotton, a slate main cord
and dyed cords hanging from it, each cord's length the money, its knots the units. It refuses
both the usual white civic dashboard of rounded cards and the dark neon poster the site used
before (too hard to read outdoors, in condensed capitals, with every section shouting).

- **Light ground.** Cotton white `#fafaf7`; white `#ffffff` for open panels and fields; a
  tinted `#f0f2ee` for insets; rules `#dde1dc`. Most visitors read on a cheap phone in daylight.
- **Colour does jobs.** Slate `#22303a` is the shell (header), the primary action and the
  selected state. The natural dyes only name the parts of a split, always in this order:
  añil `#2b5ea7`, cochinilla `#b0306a`, q'olle `#b07a0c`, maíz morado `#6b4aa0`, turquesa
  `#008a7a`, then "las demás" in undyed grey. Green `#2c7646` only means on pace or up; achiote
  `#b0441a` only behind or down (a reason to ask, not an accusation). Links are añil `#23508f`.
  No brown, nothing that could pass for a government site, not the wiphala's seven colours.
- **Type.** Alegreya Sans (Huerta Tipográfica, self-hosted) in sentence case, body at 17px,
  with tabular lining figures so amounts line up. No condensed capitals anywhere.
- **Calm structure.** Modules open with a plain heading under a 1px rule; panels are white with
  a hairline and soft 8px corners; no shadows except the map's floating popup.
- Contrast meets WCAG AA throughout; the dye order was checked with a palette validator for
  colour-blind separation of neighbours (worst ΔE 10.2) and 3:1 against the ground.

## Signature pieces

- **Khipu** (`components/Khipu.tsx`): any budget split is drawn as cords hanging from one main
  cord, each labelled with its share, with a knot every round amount ("cada nudo: S/ 20 mil
  millones"); the rows below are its legend, each with a dot in its cord's dye.
- **The expected point is a knot:** progress cords (`components/MontoPar.tsx`) mark where
  spending should be by today as a dark knot on the cord.
- **Page title** (`components/Titulo.tsx`): one plain sentence, with the amount it is about on
  its own line beneath it.
- **Route always visible:** Perú › región › provincia › distrito (`components/Migas.tsx`); only
  the level you are on is filled.

## Words

- Every number answers "compared to what?" (the plan, the last MEF publication, last year, the
  calendar) and carries a plain reading ("algo más lento de lo esperado").
- Every category has "¿Qué es?": our plain summary, MEF's official definition, and from the data
  what the money buys, how and who spends it.
- MEF names arrive in unaccented capitals; `lib/nombres.ts` (and `pipeline/nombres.py` for alert
  texts) restores accents, keeps acronyms and capitalises places.

## Motion

One authored moment: the cords of a khipu drop from the main cord once (clip-path, 620 ms,
exponential ease-out, short stagger). Nothing else animates; reduced-motion turns it off.
Buttons give press feedback (`scale(0.97)`); hover styles only apply to real pointers.

## History

Paper wireframes (mobile-first, bottom navigation, "busca tu municipalidad" as the emotional
entry point, alerts as shareable texts) became a first web version in red on warm neutrals. In
October 2026 it became a dark *cartel chicha* poster; in November 2026, because that was hard to
read, it was rethemed into the light khipu world above, keeping the same structure.
