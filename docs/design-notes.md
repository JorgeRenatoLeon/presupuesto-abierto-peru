# Design notes

How the site looks and why. Tokens and component styles live in `apps/web/app/globals.css`.

## Who it is for

Ordinary citizens on a phone, often outdoors, with no budget vocabulary. When needs conflict
they come first: plain language first, the official term second, the raw code last. Journalists
and watchdogs get the detail one tap deeper.

## The world: a *cartel chicha*

The budget is announced like a chicha poster: the question and the number a citizen needs, set
in stacked fluorescent bands on a near-black ground, readable from across the street. It refuses
the usual white civic dashboard of same-size cards.

- **One ink, one job.** Fucsia `#ff2e88` = identity and attention; amarillo `#ffe600` = amounts
  and the primary action; verde `#00d26a` = on pace, increases; naranja `#ff8a00` = behind,
  cuts; celeste `#3ee0ff` = explanations and links. Ground `#0e0e10`, rules `#34343c`.
- **No red.** Being behind schedule is a reason to ask, not an error or an accusation.
- **Printed marks.** Flat ink, 1px rules (2px for emphasis), no shadows, no rounded corners.
- **Type.** Anton (self-hosted) for bands, page titles and section tabs; Archivo for reading,
  with tabular figures so amounts line up.
- **Dark only.** The poster is black; contrast meets WCAG AA throughout.

## Signature pieces

- **Band stack** (`components/Bandas.tsx`): the page's question and number as stacked bands,
  e.g. "¿En qué se gasta / el dinero del Perú? / S/ 289.8 mil millones · 2026".
- **Ink split** (`components/Franja.tsx`): any budget split is one stacked band of colour
  segments, with the rows below as its legend. Ink order fucsia, amarillo, verde, celeste,
  naranja (then "las demás" in grey) was checked for colour-blind separation of neighbours.
- **Section tabs:** every section is headed by its own yellow band.
- **Route always visible:** Perú › región › provincia › distrito (`components/Migas.tsx`).

## Words

- Every number answers "compared to what?" (the plan, the last MEF publication, last year, the
  calendar) and carries a plain reading ("algo más lento de lo esperado").
- Every category has "¿Qué es?": our plain summary, MEF's official definition, and from the data
  what the money buys, how and who spends it.
- MEF names arrive in unaccented capitals; `lib/nombres.ts` (and `pipeline/nombres.py` for alert
  texts) restores accents, keeps acronyms and capitalises places.

## Motion

One authored moment: bands and split segments wipe in once, left to right (clip-path, 520 ms,
exponential ease-out, short stagger). Nothing else animates; reduced-motion turns it off.
Buttons give press feedback (`scale(0.97)`); hover styles only apply to real pointers.

## History

Paper wireframes (mobile-first, bottom navigation, "busca tu municipalidad" as the emotional
entry point, alerts as shareable texts) became a first web version in red on warm neutrals. In
October 2026 it was redesigned into the chicha world above, keeping those structural decisions.
