# Presupuesto Abierto Perú

Web app to make Peru's national budget (allocation, spending, execution status, how it changes, and who the State contracts with) transparent and actionable for citizens. Data from MEF's open-data portal and OECE's public procurement data (SEACE).

## How it works

```text
MEF file server ──HEAD (ETag/size), daily──▶ new publication? (and last ingest ≥ 7 days ago)
      │ yes: chunked download of the *-Diario file (8-10 GB; MEF dropped the monthly files in Oct 2026)
      ▼
normalize: CSV (2–3 GB) ──lossless──▶ Parquet (60–90 MB/year), verified row by row and total by total
      ▼
lake (data/lake, mirrored to a Hugging Face dataset)
  ├─ gasto|ingreso/<año>.parquet              latest publication
  ├─ snapshots/<dataset>/<año>/<pub>.parquet  every MEF publication (MEF overwrites its files: this is the history)
  ├─ cambios/<dataset>/<año>/<pub>.parquet    budget changes vs the previous publication
  ├─ contratos/<año>.parquet                  SEACE contracts (OECE, OCDS mirror by Open Contracting Partnership), weekly
  ├─ ordenes/<año>/<mes>.parquet              purchase and service orders each entity registers in SEACE (OECE open data), monthly
  ├─ inversiones/*.parquet                    each investment project as a whole (MEF Banco de Inversiones, Formato 12B), weekly
  └─ historia.json                            what the backfill fetched (or pruned) per source-year (pipeline/historia.py)
      ▼
serving: aggregate → compare → alerts → exportar (+ contracts linked to each executing unit) → validate → QA
         (data/serving: DuckDB + JSON)
      ▼
Next.js static export ──▶ GitHub Pages
```

Why this design, with measurements: [`docs/adr-001-data-storage-and-refresh.md`](docs/adr-001-data-storage-and-refresh.md).

## Repo layout

```text
presupuesto-app/
├── pipeline/              # Python ETL (DuckDB): run.py is the entry point
│   ├── etiquetas/         # curated "temas" over the expense classifier (edit in a spreadsheet)
│   └── tests/             # pytest, on small fixtures
├── apps/web/              # Next.js static site
├── .github/workflows/     # ci.yml (quality gates), refresh-data.yml (daily data job + deploy)
├── status/                # mef-publicaciones.json: log of ingested MEF publications (written by CI)
├── data/                  # gitignored: lake/ (canonical data), serving/, raw/ (transient)
└── docs/                  # data dictionary, ADRs, design notes
```

## One-time setup (all free)

1. **Hugging Face** (data storage, no credit card): create an account and a
   [write token](https://huggingface.co/settings/tokens). The dataset repo is created on the first push.
2. **GitHub** (code, daily job, hosting): push this repo (public: free Pages and Actions minutes). Then
   - *Settings → Secrets and variables → Actions*: secret `HF_TOKEN`; `HF_DATASET` = `<usuario>/presupuesto-abierto-peru`
     (a variable is preferable since the name is public, but a secret also works)
   - *Settings → Pages → Source*: GitHub Actions
   - Optional, Telegram digest of each new MEF publication (free): create a bot with @BotFather, make it admin of a
     public channel, then add secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (e.g. `@presupuestoabierto`) and
     variable `TELEGRAM_CANAL_URL` (e.g. `https://t.me/presupuestoabierto`, linked from /metodologia)
3. **Seed the history from this machine.** `data/lake/` already holds the 2 Jul 2026 publication, which MEF
   no longer serves — push it before the first CI run:

   ```bash
   cd pipeline && HF_DATASET=<usuario>/presupuesto-abierto-peru HF_TOKEN=hf_... .venv/bin/python run.py push
   ```

4. *Actions → Refresh budget data → Run workflow* once. From then on it runs daily at 18:30 Lima.

## Cost: everything stays free

- **GitHub Actions:** free for public repositories on standard hosted runners (this repo is public). If it ever
  becomes private, GitHub Pro from the Student Pack includes 3,000 minutes and 1 GB of artifact storage per month,
  and without a payment method GitHub blocks usage instead of charging. Expected use, under 300 min/month
  (timings measured on GitHub runners in October 2026):

  | What | When | Minutes/month |
  |---|---|---|
  | Check MEF (HEAD requests, tests) | daily, ~1 min | ~30 |
  | Ingest the current year (8.3 GB file: 17 min download), rebuild, deploy | weekly (`CADENCIA_DIAS`), ~35 min | ~150 |
  | Ingest the previous year (10.5 GB: 21 min download) | monthly, +25 min | ~25 |
  | CI on pushes and pull requests | ~3 min each | ~60 |
  | Browser checks before each deploy | +1 min per deploy | ~10 |
  | Refresh the SEACE contracts (two ~150 MB files) | weekly, ~2 min | ~10 |

  `timeout-minutes: 120` caps a run against a slow MEF server; the deploy artifact (the ~570 MB site) is kept 1 day.
  To use less, raise `CADENCIA_DIAS` in `pipeline/config.py` or check fewer days in the workflow's `cron`.
- **Hugging Face:** a free public dataset ("best effort" past the first few GB). Each weekly snapshot adds ~60–80 MB, the
  contracts ~16 MB a week, the purchase orders ~175 MB a year. The nightly **Backfill history** workflow
  (`.github/workflows/backfill-history.yml`, `pipeline/historia.py`) fetches past years a few at a time (MEF spending and
  revenue since 2009, contracts since 2009, orders since 2018; ~3.5 GB in all) and keeps the dataset under `HF_LIMITE_GB`
  (repo variable, default 10): first it squashes the history of rewritten files, then, only if the current files don't fit,
  prunes the oldest backfilled year (its publisher still serves it). The current and previous year and every snapshot of
  them are never touched; projects' progress is kept as a small monthly file (`inversiones/avance/`).
- **GitHub Pages:** free for public repos; the site is ~570 MB of the 1 GB limit (mostly the 2,900 entity pages).

## Pipeline (local)

```bash
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

python run.py update             # daily job: check MEF → ingest new publications → push lake → rebuild serving
python run.py update --force     # also rebuild serving when MEF published nothing new
python run.py update --years 2024 2023   # backfill older years (~90 MB each in the lake)
python run.py update --ignore-cadence     # download now even if ingested < 7 days ago (CADENCIA_DIAS)
python run.py serving            # rebuild only: aggregate → compare → alerts → exportar → validate → qa
python run.py contratos --force  # refresh the SEACE contracts now (the update step does it weekly)
python run.py ordenes            # refresh the purchase and service orders (OECE, republished monthly)
python run.py historia --unidades 2 [--solo ordenes contratos]   # backfill the next missing past years
python -m pytest tests -q        # tests (fixtures, no network)
```

Other commands: `catalog` (list files on the MEF server), `download` (manual), `normalize --year Y --dataset gasto --local-file X.csv [--published "<HTTP date>"]` (ingest a local CSV as a publication), `aggregate`, `compare`, `alerts`, `exportar`, `validate`, `qa [--skip-external]`, `pull` / `push` (Hugging Face). Without `HF_DATASET` everything stays in `data/lake/`.

Semantics: MEF amounts are exact `DECIMAL(18,2)`. `MONTO_DEVENGADO_<MES>` are monthly flows; PIA, PIM, certificado and comprometido/girado *anual* are annual stocks (never summed across months). The site uses the last two years (`ANOS_SITIO` in `config.py`); older years stay in the lake.

## What the site shows

- `/` — the budget at a glance, **"¿A dónde va cada S/ 100?"**, a region picker and what to watch.
- `/localidad/<dep>` — **"Tu región"**: what the State spends in each department and who spends it (national, regional,
  municipal), the biggest projects and those with no progress, every municipality (searchable, sortable by execution) and
  the department's alerts.
- `/comparar` — **what changed**: every función (→ división → grupo), tipo de gasto (→ … → específica), tema, departamento and nivel de gobierno, compared three ways: since approval (PIA → PIM), since the previous MEF publication, and vs the previous year. "Cambio fuerte" uses the alert thresholds.
- `/auditar` — **"Qué vigilar"**: five signals worth checking each month (projects with no progress, the December
  spending rush, court/arbitration payouts, sharp budget changes, entities that don't execute) and how to act: a
  Ley 27806 information request (Portal de Transparencia Estándar) or a Contraloría complaint (gob.pe/9260).
- `/entidad/<id>` — an executing unit's budget, monthly execution, projects (each linked to its MEF investment record by CUI) and alerts.
  **"¿A quién le contrata?"**: the contracts it signed in SEACE (supplier and RUC, amount and final amount, procedure, number of
  participants, the signed contract and its amendments as PDFs, and what was bought line by line with quantities and unit prices,
  each next to what the State usually pays for the same catalogue item), its largest suppliers and the signals worth a question
  (single participant, no competition, a price 2–10× the usual, adicionales, extensions, terminated or annulled contracts).
  Each contract gets the budget's expense type it corresponds to, from the catalogue code of what it buys
  (`pipeline/etiquetas/bienes_gasto.csv`) or, for works, from its project's budget lines: so each expense type of an activity
  ("Combustibles", "Alimentos para programas sociales"…) opens the unit's contracts of that type, and each project its own
  contracts (CUI). Buyers are linked to executing units by name and by the CUIs they contract (`pipeline/contratos.py`): 88% of the
  2025–2026 contracts. What was contracted, not what was paid: the State publishes no payments per supplier.
  **"¿Qué compra en el día a día?"**: the purchase and service orders it registered this year (`pipeline/ordenes.py`):
  small purchases up to 8 UIT, services by people (locadores), utilities, catalogue purchases and contract payments, how it
  bought, what (expense type inferred from each order's description, `pipeline/etiquetas/ordenes_gasto.csv`) and from whom.
  Each expense type of an activity also opens the orders of that type, and each project the orders that cite its CUI: what
  catch-all lines such as "Servicios diversos" or "Locación de servicios" paid for. 86% of 2026's order amounts are linked.
  The page opens with the route of the money (budget → areas → activities and works → contracts and orders); an activity's
  detail lists every expense type, the largest first and the rest grouped by family.
- `/proveedores`, `/proveedor/?id=<RUC>` — **suppliers**: every company, consortium or person that signed with the State in the period
  (~50,000, one data file each, one page for all): which units contracted it, what it sells by expense type, its contracts and signals.
- `/productos`, `/producto/?id=<CUBSO>` — **"Precios del Estado"**: each catalogue item bought at least five times by two or more units
  (~1,400): the unit price of every purchase over time with the month's median and the usual range, who sells it and at what price,
  who buys it, its latest purchases with the signed contract. Contract lines link to their item's page.
- `/mapa` — **the map of projects**: this year's projects that MEF locates (Banco de Inversiones coordinates), sized by total cost,
  orange when they have no spending this year; filter by department, entity (`?sec=`), signal or name/CUI. Leaflet + OpenStreetMap tiles, darkened in CSS.
- Entity pages also show **what the unit is buying now**: SEACE procedures called or awarded but not yet signed (reference value,
  deadline for offers, participants, the bidding documents), and how many were deserted, annulled or cancelled
  (`lake/procesos/<año>.parquet`, from the same OCDS files as the contracts).
- `/seguimiento` — **"Siguiendo"**: entities, regions, temas, suppliers and products the visitor follows (☆ Seguir), kept in the
  browser (no accounts), with what is new since the last visit: alerts, contracts (entities, suppliers), purchases and a change
  in the usual price (products).
- `/alertas` — R1 entity PIM changed ≥20% (≥S/5M) between publications · R2 slow execution · R3 PIM far from PIA · R4 category changed ≥5% (≥S/100M) between publications · R5 approved budget ≥10% (≥S/100M) different from last year · R6 project of ≥S/5M with no spending by mid-year · R7 ≥35% of last year's spending made in December. Thresholds live in `pipeline/alerts.py`. The page loads one rule's or one department's list on demand (`?regla=…&dep=…` deep links).
- **Notifications**: RSS feeds under `/data/feeds/` (high-priority alerts, changes by tema, projects with no progress, one per department) and the optional Telegram digest.
- **Temas** (`pipeline/etiquetas/`): e.g. *obras por contrata*, *pagos a empresas y proveedores privados (aproximado)*, *laudos arbitrales*, *locadores*. The classifier says what money pays for, not who receives it, so these are documented approximations with a confidence level.

## Status

- [x] Pipeline: dual-format (pivoted + monthly rows) → lossless canonical Parquet, verified against the CSV
- [x] Lake with one snapshot per MEF publication + budget change log; Hugging Face mirror
- [x] Daily refresh (ETag check, chunked downloads) + GitHub Pages deploy + CI quality gates
- [x] 78 browser checks on the built site with real data before every deploy (`apps/web/e2e/sitio.mjs`)
- [x] Comparisons (PIA→PIM, publication→publication, year→year) by función, genérica, tema, departamento, nivel
- [x] Alert rules R1–R8 on real data, incl. R8 "sin descripción": budget MEF publishes with a generic project code
      and no name or meta (S/ 2,651 M in Oct 2026, mostly defence)
- [x] Regions, projects with signals, audit agenda with how-to-act, watchlist, RSS + Telegram notifications
- [x] Down to each activity/project of an entity: its metas, expense types (specific clasificador) and funding sources
      (`detalle/<sec>.json`, loaded on demand); every figure labelled as budget vs spent, with the pace expected by now
- [x] Ingresos side, QA (coherence + Consulta Amigable reconciliation), web explorer, entity pages
- [x] Who the State contracts with: SEACE contracts (OECE, OCDS) linked to executing units and their projects (CUI), with
      the signed contract and amendments as PDFs and red flags; contracted amounts, not payments
- [x] What exactly was bought (contract lines with quantity and unit price), the expense type each contract corresponds to
      (83% of them), and a page per supplier
- [x] Unit prices against the State's usual price for the same item (363 comparable catalogue items); each project as a whole
      from MEF's Banco de Inversiones (total vs approved cost, spending since it began, physical progress, the entity's latest
      report and problems), since a year's budget is only that year's slice of a project (`pipeline/inversiones.py`)
- [ ] Deep drill-down to line level in the browser (DuckDB-WASM over the Hugging Face Parquet, ~1 MB per entity)
- [x] Purchase and service orders (≤ 8 UIT purchases, locadores, utilities, catalogue), linked to units, expense types and projects
- [x] Backfill of past years within a storage budget (nightly; history squashed, oldest backfilled year pruned only if needed)
- [ ] Etapa 2 (reclamos/Contraloría)

Known follow-ups:

- **Next.js 16** was tried and skipped for now: its static export writes each page's payload three times (segment
  prefetch files), 782 MB against 529 MB on Next 15.5, too close to the 1 GB Pages limit. Revisit if it becomes
  configurable. The site runs Next 15.5 with React 19; `npm audit` reports 0 vulnerabilities (postcss pinned
  through `overrides`).
- Alert thresholds are first calibrations on 2026 data, pending review with the team.

Design: `docs/design-notes.md` (the chicha visual system; tokens in `apps/web/app/globals.css`). ⚠️ Never commit `data/` or `.env`. The old `typescript-express-api/` prototype is deprecated (rotate its Cloudant credentials before any push).
