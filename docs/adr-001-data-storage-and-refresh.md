# ADR-001 — Data storage, history and refresh

Status: accepted (2026-09-29)

## Context

MEF publishes one CSV per year and dataset (`<year>-Gasto-Devengado-Mensual.csv`: 2.1 GB in
July 2026, 2.8 GB for a full year) and **overwrites it** every month. The POC kept a 332 MB
Parquet per year, had no history, refreshed on a fixed monthly date and could not detect
budget changes. The project must run on free services.

## Measurements (real 2026/2025 files, DuckDB 1.5)

Why the CSV is big: 84% of its bytes are names repeated on every row (e.g.
`TIPO_TRANSACCION_NOMBRE` has one distinct value and takes 46 MB); amounts are 5%.

| Format (2026 gasto, 2.1M line items) | Size |
|---|---|
| MEF CSV | 2,068 MB |
| POC Parquet (one row per line *and month*, DOUBLE) | 332 MB |
| CSV + `zstd -19` (archive only) | 44 MB |
| **One row per line item, months as columns, DECIMAL(18,2), sorted by hierarchy** | **57 MB** |
| Same with names moved to lookup tables (star schema) | 48 MB |
| DuckDB native file | 143 MB |

Full year 2025: 2,794 MB CSV → 88 MB. Round trip verified lossless (every row, and every
amount total to the cent). Converting the 2.8 GB file takes ~15 s and peaks at ~8 GB RAM.

Bytes a browser would fetch from static Parquet over HTTP range requests (cold cache):
national views 8–12 MB (3 MB from a pre-aggregated cube) → keep them as precomputed JSON;
one pliego 0.6–0.9 MB; one executing unit, every line, 1.0–1.5 MB. DuckDB-WASM itself is a
7.3 MB one-time download.

MEF file server: a fresh connection gets 2–7 MB/s, but one long GET drops to ~0.2 MB/s after
~130 MB; parallel connections share ~2 MB/s. Sequential 32 MB Range requests on fresh
connections sustained 6–7 MB/s (2.3 GB in 349 s).

Two publications of 2026 (Jul 2 → Sep 3): 266,723 new lines, PIM changed on 429,390, and
MEF rewrote closed months (2,815 lines of June devengado; revenue months move by billions).

## Decision

1. **Canonical storage:** one Parquet file per dataset-year, one row per budget line item with
   the MEF columns, amounts as exact `DECIMAL(18,2)`, sorted by the budget hierarchy,
   30k-row groups. Names stay inline: the star schema saves only 15% and costs a join on
   every query. The raw CSV is transient (deleted after conversion).
2. **History:** every MEF publication is kept as an immutable snapshot, plus a budget change
   log (lines added/removed or with PIA/PIM changes; 15 MB vs 65 MB for a full line diff).
   MEF overwrites its files, so these snapshots are the only history there is.
3. **Free storage:** a public **Hugging Face dataset** (no credit card, versioned, readable
   directly by DuckDB/pandas, community-visible). Cloudflare R2 was the first choice but
   needs a payment method on file. GitHub Releases lack CORS for browser use.
4. **Refresh:** a daily GitHub Actions run does HEAD requests (ETag/size) and only
   downloads when MEF published something; downloads are chunked and resumable. The
   site is a static export on **GitHub Pages**, rebuilt only when data changes.
5. **Serving:** precomputed JSON for every page (national, entity, comparisons). Deep
   ad-hoc drill-down (DuckDB-WASM reading the Hugging Face Parquet) is a later step; the
   storage layout above already supports it (~1 MB per entity query).

## Rejected alternatives

- **Graph database:** the budget is a set of fixed hierarchies plus amounts to add up;
  columnar scans answer "sum a subtree" in milliseconds. A graph fits later for *who gets
  paid* (entity → contract → supplier), which needs OSCE/SEACE data.
- **Postgres / ClickHouse / BigQuery:** unnecessary at ~60–90 MB per year; they add cost and
  operations. Postgres may come later for app state (alert subscriptions).
- **Keeping raw CSVs:** 2–3 GB per publication; the Parquet is lossless and ~30× smaller
  (if an audit copy of the original bytes is ever needed, `zstd -19` gets it to ~44 MB).

## Consequences

- One code path for both MEF formats (pivoted monthly columns and monthly rows).
- Budget changes are detectable (new alert rules R1/R4/R5) and comparable across
  publications and years; the site's comparisons and alerts depend on the lake's history.
- The daily job needs `HF_DATASET` + `HF_TOKEN`; without them it still works but keeps no
  history between CI runs.
- ~8 GB peak RAM to convert a full-year file: fine on GitHub's 16 GB runners for public
  repos; private repos (7 GB runners) rely on DuckDB spilling to disk.
