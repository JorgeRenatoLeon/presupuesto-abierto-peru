# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: ordinary Peruvian citizens with no budget vocabulary, usually on a phone, who want to know what
the State does with public money where they live — above all their own municipality — and whether
something deserves a question to the authority. When needs conflict, they come first: plain language
first, detail on demand.

Secondary (served one tap deeper, never at the citizen's expense): journalists, NGOs, regidores and
other watchdogs who audit regularly and need precise figures, sources and change history.

## Product Purpose

Presupuesto Abierto Perú turns the MEF's open budget files into something a citizen can read: how much
each entity has, what it is spending on, how fast, what changed since the last publication, and what is
worth watching (alerts). Success: a neighbour finds their municipality, understands where its money
goes and why, and knows what to ask and where.

## Positioning

Independent civic project built only on official MEF data, refreshed automatically, that explains
instead of just tabulating: every budget category carries MEF's official definition plus, from the real
data, what that money is actually spent on, how, and by whom; and every publication is kept, so changes
between MEF publications are visible (MEF overwrites its own files).

## Operating Context

- Source: MEF Portal de Datos Abiertos (daily `*-Diario.csv` files) and Consulta Amigable for QA.
- Official terminology from MEF classifiers: Clasificador Funcional (D.S. 068-2008-EF glossary:
  función, división funcional, grupo funcional) and Clasificadores Presupuestarios (genérica,
  subgenérica, específica of gasto and ingreso).
- Geography: spending is located by the executing unit's ubigeo (departamento/provincia/distrito)
  and, for gasto, by DEPARTAMENTO_META. There is no district-level "where the money lands" field.
- Actions citizens can take: request information (Ley de Transparencia), report to Contraloría,
  look up a project's official file (CUI) at MEF.

## Capabilities and Constraints

- Static site (Next.js static export) on GitHub Pages; data JSON built by the Python pipeline; free
  services only (Hugging Face dataset, GitHub Actions within the student allowance, Pages 1 GB limit).
- No accounts: follow lists live in the browser (localStorage); notifications via RSS and optional
  Telegram.
- Amounts in soles corrientes, no inflation adjustment. Data is a daily cut (e.g. "al 17 de octubre").
- Spanish only.

## Brand Commitments

- Name: "Presupuesto Abierto Perú". No other visual element is binding (colours, type and logo may be
  replaced).
- Independent citizen project: attribute MEF as source; never imply official status.

## Evidence on Hand

Real MEF data 2025–2026 (lake + Hugging Face), official MEF classifier glossaries. No testimonials,
users, press or partner endorsements exist — never fabricate them.

## Product Principles

1. Plain language first, official term second, raw code last.
2. Every number answers "compared to what?" (plan, last publication, last year, the calendar).
3. Closest government first: a citizen should reach their municipality in two taps.
4. Show the source and the cut date; never overstate what the data proves (alerts are reasons to ask,
   not accusations).
5. Free to run, light to load on a cheap phone.

## Accessibility & Inclusion

Mobile-first (375 px), low-end Android and slow connections; readable by people without financial
training; WCAG AA contrast; identity never by colour alone.
