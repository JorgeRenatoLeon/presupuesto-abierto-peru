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

## Addendum (2026-10-18): MEF discontinued the monthly files

Since mid-October 2026 the `*-Devengado-Mensual.csv` and `*-Mensual.csv` files return 404 for
2025 and 2026, gasto and ingreso. Only the `*-Diario.csv` files remain (gasto 2026: 8.3 GB;
2025: 10.5 GB), re-stamped every day. Measured on the 2026 file: rows for **month 0** carry each
line's annual PIA and PIM; rows for **months 1–12** carry that month's certificado, compromiso,
devengado and girado, with PIA = PIM = 0.

The pipeline fell back to the Diario file automatically, but it read annual amounts from each
line's latest month, so national PIA came out at S/ 42 bn instead of ~S/ 258 bn. QA caught it
(Consulta Amigable reconciliation and `devengado <= PIM`), and the run failed without publishing.

Changes:
- Every amount of a monthly-rows source is the **sum** over the line's rows; normalization now
  checks that every total (PIA and PIM included) matches the CSV exactly.
- `TIPO_ACT_PROY` keeps the label (`PROYECTO`/`ACTIVIDAD`): the Diario file uses codes, and line
  keys must match across snapshots from both formats. The canonical layout is unchanged.
- **Cadence:** the daily job still checks MEF with HEAD requests, but downloads a dataset-year at
  most every 7 days (previous year: 30) — `CADENCIA_DIAS`. Re-downloading ~19 GB every day would
  burden MEF's server and add a daily snapshot to the lake.
- A server that can't be checked now fails the run (a 404 is the only "no file"); on 2026-10-16
  unreachable files had been treated as "nothing new".
- Expected execution pace is the share of the year the data covers (the publication date for
  daily files), not `month / 12`. Spending "to the same date" last year prorates that year's
  last month by the days covered (17 Oct: 16/31 of October 2025); counting the whole month made
  2026 look +3.8% instead of +9.0%. Pages name the real cut ("al 17 de octubre").
- Verified on the real 17 Oct files before release: PIA identical to the 3 Sep monthly snapshot
  (S/ 257,561,619,143.00), January–August spending within 0.004%, 99.8% of line keys matched.
- Consulta Amigable is a month-end snapshot ("Última actualización: 30 de septiembre de 2026"),
  not live. QA reads its TOTAL row by label and compares flows over the months it covers: on
  2026-10-18 spending for January–September matched to 0.004%; revenue differed 2.75% (late
  entries for past months), reported as WARN. The earlier check took the closest number on
  the page, which for devengado was CA's "compromiso mensual" column.
