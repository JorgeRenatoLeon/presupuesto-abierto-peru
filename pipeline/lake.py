"""The data lake: canonical Parquet per dataset-year plus an immutable snapshot of every MEF
publication we ingested. Lives in data/lake/ and is mirrored to a Hugging Face dataset
(hfsync.py) so CI runs share state and anyone can query it with DuckDB or pandas.

    gasto/2026.parquet                              latest publication (what the site shows)
    snapshots/gasto/2026/20260903T200428Z.parquet   every publication, never rewritten
    cambios/gasto/2026/20260903T200428Z.parquet     line-level changes vs the previous one
    manifest.json                                   source ETag/size/date, rows, totals

MEF overwrites its files every month, so these snapshots are the only budget history there is.
"""
import json
import shutil
import time
from email.utils import parsedate_to_datetime
from pathlib import Path

import duckdb

from config import LAKE, CANON, MESES, ANOS_SITIO

DATASETS = ("gasto", "ingreso")


def pub_id(last_modified: str) -> str:
    """HTTP Last-Modified -> sortable publication id, e.g. '20260903T200428Z'."""
    return parsedate_to_datetime(last_modified).strftime("%Y%m%dT%H%M%SZ")


def pub_date(pub: str) -> str:
    return f"{pub[:4]}-{pub[4:6]}-{pub[6:8]}"


def latest_path(dataset: str, year: int) -> Path:
    return LAKE / dataset / f"{year}.parquet"


def snapshot_path(dataset: str, year: int, pub: str) -> Path:
    return LAKE / "snapshots" / dataset / str(year) / f"{pub}.parquet"


def changes_path(dataset: str, year: int, pub: str) -> Path:
    return LAKE / "cambios" / dataset / str(year) / f"{pub}.parquet"


def rel(path: Path) -> str:
    """Path inside the lake (= path inside the Hugging Face dataset repo)."""
    return path.relative_to(LAKE).as_posix()


# --- manifest -------------------------------------------------------------------

def load_manifest() -> dict:
    p = LAKE / "manifest.json"
    return json.loads(p.read_text()) if p.exists() else {"datasets": {}}


def save_manifest(m: dict) -> None:
    m["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (LAKE / "manifest.json").write_text(json.dumps(m, indent=1, ensure_ascii=False))


def _entry(m: dict, dataset: str, year: int) -> dict:
    return m["datasets"].setdefault(dataset, {}).setdefault(str(year), {"publications": {}})


def publications(m: dict, dataset: str, year: int) -> list[str]:
    return sorted(m["datasets"].get(dataset, {}).get(str(year), {}).get("publications", {}))


def latest_pub(m: dict, dataset: str, year: int) -> str | None:
    return m["datasets"].get(dataset, {}).get(str(year), {}).get("latest")


def previous_pub(m: dict, dataset: str, year: int, pub: str) -> str | None:
    older = [p for p in publications(m, dataset, year) if p < pub]
    return older[-1] if older else None


def years(m: dict, dataset: str) -> list[int]:
    return sorted(int(y) for y, e in m["datasets"].get(dataset, {}).items() if e.get("latest"))


def is_known(m: dict, dataset: str, year: int, source: dict) -> bool:
    """Did we already ingest this exact file? MEF re-stamps unchanged files, so compare
    ETag + size rather than Last-Modified alone."""
    for p in m["datasets"].get(dataset, {}).get(str(year), {}).get("publications", {}).values():
        s = p.get("source", {})
        if s.get("size") == source.get("size") and (
                s.get("etag") == source.get("etag") or s.get("last_modified") == source.get("last_modified")):
            return True
    return False


def add_publication(m: dict, dataset: str, year: int, pub: str, parquet: Path,
                    source: dict, stats: dict) -> Path:
    """Store a normalized publication as an immutable snapshot; advance 'latest' if newer."""
    snap = snapshot_path(dataset, year, pub)
    snap.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(parquet), snap)
    e = _entry(m, dataset, year)
    e["publications"][pub] = {
        "source": {k: source.get(k) for k in ("name", "etag", "size", "last_modified")},
        "rows": stats["rows"], "mes_ult": stats["mes_ult"], "format": stats.get("format"),
        "totals": stats["totals"],
        "ingested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if pub >= e.get("latest", ""):
        e["latest"] = pub
        latest = latest_path(dataset, year)
        latest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(snap, latest)
    return snap


# --- views -----------------------------------------------------------------------

def register_views(con: duckdb.DuckDBPyConnection) -> dict[str, list[int]]:
    """TEMP views over the latest file of the last ANOS_SITIO years in the lake:

    gasto_wide / ingreso_wide  canonical: one row per line item, months as columns, DECIMAL
    gasto / ingreso            legacy long shape: one row per line item and month up to the
                               last month with data, DOUBLE amounts (annual stocks repeated
                               on every month) -- what aggregate/alerts/qa were written for.
    """
    found: dict[str, list[int]] = {}
    for ds in DATASETS:
        files = sorted((LAKE / ds).glob("*.parquet"))[-ANOS_SITIO:]
        if not files:
            continue
        found[ds] = [int(f.stem) for f in files]
        spec, flujo = CANON[ds], CANON[ds]["flujo"]
        con.execute(f"CREATE OR REPLACE TEMP VIEW {ds}_wide AS SELECT * FROM "
                    f"read_parquet({[str(f) for f in files]!r}, union_by_name=true)")
        activos = " UNION ALL ".join(
            f'SELECT ANO_EJE, {i + 1} AS mes FROM {ds}_wide WHERE "{flujo}_{m}" != 0' for i, m in enumerate(MESES))
        ult = con.execute(f"SELECT ANO_EJE, max(mes) FROM ({activos}) GROUP BY 1").fetchall()
        ult_values = ", ".join(f"({a}, {b})" for a, b in ult) or "(0, 0)"
        unpivot = ", ".join(f'(w."{flujo}_{m}", {i + 1})' for i, m in enumerate(MESES))
        dims = ", ".join(f'w."{c}"' for c in spec["dims"])
        if ds == "gasto":
            amounts = """CAST(w.MONTO_PIA AS DOUBLE) AS MONTO_PIA, CAST(w.MONTO_PIM AS DOUBLE) AS MONTO_PIM,
                CAST(w.MONTO_CERTIFICADO_ANUAL AS DOUBLE) AS MONTO_CERTIFICADO,
                CAST(w.MONTO_COMPROMETIDO_ANUAL AS DOUBLE) AS MONTO_COMPROMETIDO_ANUAL,
                CAST(NULL AS DOUBLE) AS MONTO_COMPROMETIDO,
                CAST(m.monto AS DOUBLE) AS MONTO_DEVENGADO,
                CAST(NULL AS DOUBLE) AS MONTO_GIRADO,
                CAST(w.MONTO_GIRADO_ANUAL AS DOUBLE) AS MONTO_GIRADO_ANUAL"""
        else:
            amounts = """CAST(w.MONTO_PIA AS DOUBLE) AS MONTO_PIA, CAST(w.MONTO_PIM AS DOUBLE) AS MONTO_PIM,
                CAST(m.monto AS DOUBLE) AS MONTO_RECAUDADO"""
        con.execute(f"""
            CREATE OR REPLACE TEMP VIEW {ds} AS
            SELECT {dims}, m.mes AS MES_EJE, {amounts}
            FROM {ds}_wide w, LATERAL (VALUES {unpivot}) m(monto, mes), (VALUES {ult_values}) u(ano, mes_ult)
            WHERE w.ANO_EJE = u.ano AND m.mes <= u.mes_ult""")
    return found
