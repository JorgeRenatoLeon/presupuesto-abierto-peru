"""Validation: lake file vs its manifest record vs serving tables must agree.

The raw CSV -> Parquet hop is verified at ingest time (normalize._verify: same number of
line items and exactly the same total for every amount column), so this checks the rest:
the stored file is the one the manifest describes, and the serving layer adds up to it.
"""
from decimal import Decimal

import duckdb

import lake
from config import CANON, MESES, SERVING


def _serving() -> duckdb.DuckDBPyConnection | None:
    db = SERVING / "serving.duckdb"
    alt = SERVING / "serving.duckdb.new"
    if alt.exists() and (not db.exists() or alt.stat().st_mtime > db.stat().st_mtime):
        db = alt
    return duckdb.connect(str(db), read_only=True) if db.exists() else None


def _validate(dataset: str, year: int, fact: str, col: str) -> bool:
    ok = True

    def check(label, a, b, tol=0.01):
        nonlocal ok
        a, b = a or 0, b or 0
        good = abs(float(a) - float(b)) <= tol
        ok &= good
        print(f"  {'PASS' if good else 'FAIL'} {dataset} {label}: {float(a):,.2f} vs {float(b):,.2f}")

    m = lake.load_manifest()
    pub, path = lake.latest_pub(m, dataset, year), lake.latest_path(dataset, year)
    if not pub or not path.exists():
        print(f"  FAIL {dataset} {year}: not in the lake ({path})")
        return False
    rec = m["datasets"][dataset][str(year)]["publications"][pub]
    flujo = CANON[dataset]["flujo"]
    con = duckdb.connect()
    meses = " + ".join(f'"{flujo}_{mm}"' for mm in MESES)
    rows, pia, pim, anual, suma = con.execute(
        f'SELECT count(*), sum(MONTO_PIA), sum(MONTO_PIM), sum("{flujo}_ANUAL"), sum({meses}) '
        f"FROM read_parquet('{path}')").fetchone()
    check(f"rows lake file = manifest ({pub})", rows, rec["rows"], tol=0)
    check("PIA lake = manifest", pia, Decimal(rec["totals"]["MONTO_PIA"]), tol=0)
    check("PIM lake = manifest", pim, Decimal(rec["totals"]["MONTO_PIM"]), tol=0)
    check(f"{flujo.split('_')[1].lower()} anual lake = manifest", anual, Decimal(rec["totals"][f"{flujo}_ANUAL"]), tol=0)
    check(f"{flujo.split('_')[1].lower()}: sum of months = anual", suma, anual)

    s = _serving()
    if s is None:
        print("  FAIL serving.duckdb missing (run aggregate)")
        return False
    try:
        srv = s.execute(f"SELECT SUM({col}) FROM {fact} WHERE ano = ?", [year]).fetchone()[0]
    except duckdb.CatalogException:
        print(f"  FAIL {fact} missing (rerun aggregate)")
        return False
    check(f"{col} lake = serving", suma, srv)
    if dataset == "gasto":
        ent = s.execute("SELECT SUM(devengado) FROM fact_entidad_mes WHERE ano = ?", [year]).fetchone()[0]
        check("devengado consistent across facts", srv, ent)
        nulls = s.execute("""SELECT count(*) FROM fact_entidad_mes
                             WHERE sec_ejec IS NULL OR devengado IS NULL""").fetchone()[0]
        print(f"  {'PASS' if nulls == 0 else 'FAIL'} no NULL keys/amounts in fact_entidad_mes ({nulls})")
        ok &= nulls == 0
    s.close()
    print("OK" if ok else "VALIDATION FAILED")
    return ok


def validate(year: int) -> bool:
    return _validate("gasto", year, "fact_nacional_mes", "devengado")


def validate_ingreso(year: int) -> bool:
    return _validate("ingreso", year, "fact_ing_nacional_mes", "recaudado")
