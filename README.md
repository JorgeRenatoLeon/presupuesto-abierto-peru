# Presupuesto Abierto Perú

Web app to make Peru's national budget (allocation, spending, execution status, and how it changes) transparent and actionable for citizens. Data from MEF's open-data portal.

## How it works

```text
MEF file server ──HEAD (ETag/size), daily──▶ new publication?
      │ yes: chunked download (32 MB ranges, fresh connections, resumable)
      ▼
normalize: CSV (2–3 GB) ──lossless──▶ Parquet (60–90 MB/year), verified row by row and total by total
      ▼
lake (data/lake, mirrored to a Hugging Face dataset)
  ├─ gasto|ingreso/<año>.parquet              latest publication
  ├─ snapshots/<dataset>/<año>/<pub>.parquet  every MEF publication (MEF overwrites its files: this is the history)
  └─ cambios/<dataset>/<año>/<pub>.parquet    budget changes vs the previous publication
      ▼
serving: aggregate → compare → alerts → validate → QA  (data/serving: DuckDB + JSON)
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
   - *Settings → Secrets and variables → Actions*: secret `HF_TOKEN`; variable `HF_DATASET` = `<usuario>/presupuesto-abierto-peru`
   - *Settings → Pages → Source*: GitHub Actions
3. **Seed the history from this machine.** `data/lake/` already holds the 2 Jul 2026 publication, which MEF
   no longer serves — push it before the first CI run:

   ```bash
   cd pipeline && HF_DATASET=<usuario>/presupuesto-abierto-peru HF_TOKEN=hf_... .venv/bin/python run.py push
   ```

4. *Actions → Refresh budget data → Run workflow* once. From then on it runs daily at 18:30 Lima.

## Pipeline (local)

```bash
cd pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

python run.py update             # daily job: check MEF → ingest new publications → push lake → rebuild serving
python run.py update --force     # also rebuild serving when MEF published nothing new
python run.py update --years 2024 2023   # backfill older years (~90 MB each in the lake)
python run.py serving            # rebuild only: aggregate → compare → alerts → validate → qa
python -m pytest tests -q        # tests (fixtures, no network)
```

Other commands: `catalog` (list files on the MEF server), `download` (manual), `normalize --year Y --dataset gasto --local-file X.csv [--published "<HTTP date>"]` (ingest a local CSV as a publication), `aggregate`, `compare`, `alerts`, `validate`, `qa [--skip-external]`, `pull` / `push` (Hugging Face). Without `HF_DATASET` everything stays in `data/lake/`.

Semantics: MEF amounts are exact `DECIMAL(18,2)`. `MONTO_DEVENGADO_<MES>` are monthly flows; PIA, PIM, certificado and comprometido/girado *anual* are annual stocks (never summed across months). The site uses the last two years (`ANOS_SITIO` in `config.py`); older years stay in the lake.

## What the site shows

- `/comparar` — **what changed**: every función (→ división → grupo), tipo de gasto (→ … → específica), tema, departamento and nivel de gobierno, compared three ways: since approval (PIA → PIM), since the previous MEF publication, and vs the previous year. "Cambio fuerte" uses the alert thresholds.
- `/alertas` — R1 entity PIM changed ≥20% (≥S/5M) between publications · R2 slow execution · R3 PIM far from PIA · R4 category changed ≥5% (≥S/100M) between publications · R5 approved budget ≥10% (≥S/100M) different from last year. Thresholds live in `pipeline/alerts.py`.
- **Temas** (`pipeline/etiquetas/`): e.g. *obras por contrata*, *pagos a empresas y proveedores privados (aproximado)*, *laudos arbitrales*, *locadores*. The classifier says what money pays for, not who receives it, so these are documented approximations with a confidence level.

## Status

- [x] Pipeline: dual-format (pivoted + monthly rows) → lossless canonical Parquet, verified against the CSV
- [x] Lake with one snapshot per MEF publication + budget change log; Hugging Face mirror
- [x] Daily refresh (ETag check, chunked downloads) + GitHub Pages deploy + CI quality gates
- [x] Comparisons (PIA→PIM, publication→publication, year→year) by función, genérica, tema, departamento, nivel
- [x] Alert rules R1–R5 on real data (Jul→Sep 2026 and 2025→2026)
- [x] Ingresos side, QA (coherence + Consulta Amigable reconciliation), web explorer, entity pages
- [ ] Connect GitHub + Hugging Face (setup above) and run the first scheduled refresh
- [ ] Deep drill-down to line level in the browser (DuckDB-WASM over the Hugging Face Parquet, ~1 MB per entity)
- [ ] Backfill 2012–2024; who-gets-paid via OSCE/SEACE contracts; Etapa 2 (reclamos/Contraloría)

Known follow-ups:

- **Next.js 14 → 16.** `npm audit` flags Next 14 (fixes exist only in 16). The advisories target server features (image optimizer, server functions, middleware) that a static export doesn't run, so CI reports them without blocking.
- `/alertas` embeds all ~3,300 alerts (2 MB HTML, 177 KB gzipped): lazy-load the long tail.
- Alert thresholds are first calibrations on 2026 data, pending review with the team.

Design rationale for the UI: `docs/design-notes.md`. ⚠️ Never commit `data/` or `.env`. The old `typescript-express-api/` prototype is deprecated (rotate its Cloudant credentials before any push).
