"""Normalize raw MEF CSVs into the canonical storage layout: one typed, sorted Parquet file
per dataset-year with ONE ROW PER BUDGET LINE ITEM and months as columns (the layout of
MEF's *-Devengado-Mensual / *-Recaudado-Mensual files).

Why this layout (docs/adr-001): the 2026 gasto CSV goes from 2,068 MB to 57 MB, lossless.
Names stay inline (Parquet dictionary-encodes them), amounts are exact DECIMAL(18,2)
(MEF amounts never have more than 2 decimals), and rows are sorted by the budget
hierarchy so drill-down queries touch few row groups.

Source formats, auto-detected:
- pivoted ("devengado-mensual" / "recaudado-mensual"): already one row per line item.
- monthly rows (gasto "diario"/"mensual" with MES_EJE; ingreso with MES_DOC): pivoted here.
  Annual stocks (PIA, PIM, certificado, comprometido anual) take the latest month's value;
  monthly devengado/recaudado become month columns; monthly girado is summed into
  MONTO_GIRADO_ANUAL (monthly comprometido is not kept: nothing downstream uses it).

Every file is checked against its CSV before it is written: same number of line items and
exactly the same total for every amount column.
"""
from pathlib import Path

import duckdb

from config import CANON, MESES, SORT_KEYS, PARQUET_OPTS, SERVING

SUSPICIOUS = ("√", "Ã", "â€", "Â")  # mojibake markers (UTF-8/MacRoman/latin-1 double encodings)
DEC = "DECIMAL(18,2)"


def _csv_columns(con: duckdb.DuckDBPyConnection, path: Path) -> list[str]:
    rows = con.execute(
        "SELECT column_name FROM (DESCRIBE SELECT * FROM read_csv_auto(?, sample_size=20000))", [str(path)]
    ).fetchall()
    return [r[0] for r in rows]


def _repair_encoding(con: duckdb.DuckDBPyConnection, table: str, text_cols: list[str]) -> int:
    """Fix mojibake via ftfy on the *distinct* values (cheap), applied as UPDATEs."""
    import ftfy
    fixed_total = 0
    for col in text_cols:
        bad = con.execute(
            f"""SELECT DISTINCT "{col}" FROM {table}
                WHERE "{col}" IS NOT NULL AND ({' OR '.join(f'''"{col}" LIKE '%{m}%' ''' for m in SUSPICIOUS)})"""
        ).fetchall()
        mapping = [(v[0], ftfy.fix_text(v[0])) for v in bad]
        mapping = [(a, b) for a, b in mapping if a != b]
        if not mapping:
            continue
        con.execute("CREATE OR REPLACE TEMP TABLE _fix(bad VARCHAR, good VARCHAR)")
        con.executemany("INSERT INTO _fix VALUES (?, ?)", mapping)
        con.execute(f'UPDATE {table} SET "{col}" = _fix.good FROM _fix WHERE "{col}" = _fix.bad')
        fixed_total += len(mapping)
    return fixed_total


def _detect_format(dataset: str, cols: list[str]) -> str:
    flujo = CANON[dataset]["flujo"]
    if f"{flujo}_ENERO" in cols:
        return "pivoted"
    if ({"MES_EJE", "MES_DOC"} & set(cols)) and flujo in cols:
        return "monthly"
    raise SystemExit(f"Unknown {dataset} schema. Columns found: {cols[:12]}...")


def _dim_select(dims: list[str], cols: list[str]) -> str:
    """Canonical dims, source order-independent; absent ones NULL (e.g. TIPO_ACT_PROY_NOMBRE)."""
    out = []
    for c in dims:
        if c == "ANO_EJE":
            src = "ANO_EJE" if "ANO_EJE" in cols else "ANO_DOC"
            out.append(f'CAST("{src}" AS INTEGER) AS ANO_EJE')
        elif c in cols:
            out.append(f'"{c}"')
        else:
            out.append(f'CAST(NULL AS VARCHAR) AS "{c}"')
    return ", ".join(out)


def _load_pivoted(con, dataset: str, cols: list[str]) -> None:
    spec = CANON[dataset]
    montos = []
    for c in spec["montos"]:
        if c in cols:
            montos.append(f'CAST("{c}" AS {DEC}) AS "{c}"')
        elif c.endswith("_ANUAL") and c.startswith(spec["flujo"]):  # derive annual flow if absent
            montos.append("(" + " + ".join(f'coalesce(CAST("{spec["flujo"]}_{m}" AS {DEC}), 0)' for m in MESES)
                          + f') AS "{c}"')
        else:
            raise SystemExit(f"{dataset}: amount column {c} missing from source")
    con.execute(f"CREATE TABLE canon AS SELECT {_dim_select(spec['dims'], cols)}, {', '.join(montos)} FROM src")


def _load_monthly(con, dataset: str, cols: list[str]) -> None:
    spec = CANON[dataset]
    mes = "MES_EJE" if "MES_EJE" in cols else "MES_DOC"
    flujo = spec["flujo"]
    dims = _dim_select(spec["dims"], cols)
    codes = ", ".join(f'"{c}"' for c in spec["dims"] if not c.endswith("_NOMBRE"))
    # line item = its codes; a name renamed mid-year takes its latest month's value
    dim_out = ", ".join(f'arg_max("{c}", mes) AS "{c}"' if c.endswith("_NOMBRE") else f'"{c}"'
                        for c in spec["dims"])
    if dataset == "gasto":
        stocks = {"MONTO_PIA": "MONTO_PIA", "MONTO_PIM": "MONTO_PIM",
                  "MONTO_CERTIFICADO_ANUAL": "MONTO_CERTIFICADO",
                  "MONTO_COMPROMETIDO_ANUAL": "MONTO_COMPROMETIDO_ANUAL"}
        extra_flows = {"MONTO_GIRADO_ANUAL": "MONTO_GIRADO"}
    else:
        stocks = {"MONTO_PIA": "MONTO_PIA", "MONTO_PIM": "MONTO_PIM"}
        extra_flows = {}
    per_month = ", ".join(
        [f'sum(CAST("{s}" AS {DEC})) AS "{s}"' for s in stocks.values()]
        + [f'sum(CAST("{flujo}" AS {DEC})) AS "{flujo}"']
        + [f'sum(CAST("{f}" AS {DEC})) AS "{f}"' for f in extra_flows.values()])
    pivot = ", ".join(
        [f'arg_max("{src}", mes) AS "{dst}"' for dst, src in stocks.items()]
        + [f'coalesce(sum("{flujo}") FILTER (mes = {i + 1}), 0) AS "{flujo}_{m}"' for i, m in enumerate(MESES)]
        + [f'sum("{flujo}") AS "{flujo}_ANUAL"']
        + [f'sum("{src}") AS "{dst}"' for dst, src in extra_flows.items()])
    # 1) collapse duplicate rows within a month (stocks add up within a month), 2) pivot months
    con.execute(f"""
        CREATE TABLE canon AS
        WITH m AS (SELECT {dims}, CAST("{mes}" AS INTEGER) AS mes, {per_month} FROM src GROUP BY ALL)
        SELECT {dim_out}, {pivot} FROM m GROUP BY {codes}""")


def _verify(con, dataset: str, cols: list[str], fmt: str) -> dict:
    """Canonical table must reproduce the CSV: line items and exact totals per amount."""
    spec = CANON[dataset]
    n_canon = con.execute("SELECT count(*) FROM canon").fetchone()[0]
    if fmt == "pivoted":
        n_src = con.execute("SELECT count(*) FROM src").fetchone()[0]
        checks = [c for c in spec["montos"] if c in cols]
        pairs = {c: c for c in checks}
    else:  # monthly rows: compare flows only (stocks are repeated per month in the source)
        mes = "MES_EJE" if "MES_EJE" in cols else "MES_DOC"
        key = ", ".join(f'"{c}"' for c in spec["dims"] if c in cols and not c.endswith("_NOMBRE") and c != "ANO_EJE")
        n_src = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT {key} FROM src)").fetchone()[0]
        pairs = {f"{spec['flujo']}_ANUAL": spec["flujo"]}
        if dataset == "gasto" and "MONTO_GIRADO" in cols:
            pairs["MONTO_GIRADO_ANUAL"] = "MONTO_GIRADO"
    if n_canon != n_src:
        raise SystemExit(f"{dataset}: {n_canon:,} canonical line items vs {n_src:,} in the CSV")
    totals = {}
    for canon_col, src_col in pairs.items():
        a = con.execute(f'SELECT sum(CAST("{src_col}" AS DECIMAL(38,6))) FROM src').fetchone()[0] or 0
        b = con.execute(f'SELECT sum("{canon_col}") FROM canon').fetchone()[0] or 0
        if a != b:
            raise SystemExit(f"{dataset}: total {canon_col} differs from CSV ({b} vs {a}); "
                             f"amounts with more than 2 decimals?")
        totals[canon_col] = str(b)
    for c in spec["montos"]:  # also record totals of columns not compared (stocks of monthly sources)
        totals.setdefault(c, str(con.execute(f'SELECT sum("{c}") FROM canon').fetchone()[0] or 0))
    return {"rows": n_canon, "totals": totals}


def normalize(dataset: str, year: int, files: list[Path], out: Path) -> dict:
    """Raw MEF CSV(s) for one dataset-year -> canonical Parquet at `out`. Returns stats."""
    if not files:
        raise SystemExit(f"No raw {dataset} CSVs for {year}")
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")  # lower memory on big files
    con.execute("SET enable_progress_bar=false")
    con.execute(f"SET temp_directory='{SERVING.parent / 'tmp_duckdb'}'")
    cols = _csv_columns(con, files[0])
    fmt = _detect_format(dataset, cols)
    print(f"Normalizing {dataset} {year} [{fmt}]: {[f.name for f in files]}", flush=True)
    con.execute("""CREATE TABLE src AS SELECT * FROM read_csv(?, header=true, delim=',', quote='"',
                   encoding='utf-8', null_padding=true, union_by_name=true, all_varchar=true)""",
                [[str(f) for f in files]])
    (_load_pivoted if fmt == "pivoted" else _load_monthly)(con, dataset, cols)

    years = [r[0] for r in con.execute("SELECT DISTINCT ANO_EJE FROM canon").fetchall()]
    if years != [year]:
        raise SystemExit(f"Expected year {year} in {dataset} file, found {years}")
    stats = _verify(con, dataset, cols, fmt)
    con.execute("DROP TABLE src")  # verified: the raw copy is no longer needed
    fixed = _repair_encoding(con, "canon", [c for c in CANON[dataset]["dims"] if c.endswith("_NOMBRE")])
    if fixed:
        print(f"  encoding: repaired {fixed} distinct mojibake values")

    flujo = CANON[dataset]["flujo"]
    stats["mes_ult"] = con.execute(
        "SELECT coalesce(max(mes), 0) FROM (" + " UNION ALL ".join(
            f'SELECT {i + 1} AS mes FROM canon WHERE "{flujo}_{m}" != 0' for i, m in enumerate(MESES)) + ")"
    ).fetchone()[0]
    stats["format"] = fmt
    out.parent.mkdir(parents=True, exist_ok=True)
    order = ", ".join(f'"{c}"' for c in SORT_KEYS[dataset])
    con.execute(f"COPY (SELECT * FROM canon ORDER BY {order}) TO '{out}' ({PARQUET_OPTS})")
    con.close()
    print(f"  {stats['rows']:,} line items, data through month {stats['mes_ult']} -> {out} "
          f"({out.stat().st_size/1e6:.1f} MB)", flush=True)
    return stats
