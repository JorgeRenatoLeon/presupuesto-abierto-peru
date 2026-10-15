"""Diff between two MEF publications of the same dataset-year.

MEF files carry only the *current* PIM, so budget modifications (transfers, cuts, new
funding) are visible only by comparing publications. A line item is identified by its
codes (config.line_key); the ~100 duplicate keys in a 2.1M-line file are summed first.

Two outputs (measured Jul->Sep 2026: 1.3M of 2.4M lines differ, mostly because a new
month of execution arrives, so a full line diff is as large as a snapshot):
- the change log file: only BUDGET changes -- lines added, removed, or whose PIA/PIM
  changed -- with before/after values and names, so it can be read on its own;
- a summary: counts per field, totals, and revisions of months that were already
  closed in the previous publication (MEF does rewrite past months).
"""
from pathlib import Path

import duckdb

from config import CANON, MESES, PARQUET_OPTS, line_key

PRESUPUESTO = ["MONTO_PIA", "MONTO_PIM"]


def diff(dataset: str, prev: Path, new: Path, out: Path) -> dict:
    """Write the budget change log prev -> new to `out`; return a summary for the manifest."""
    spec = CANON[dataset]
    key, montos, flujo = line_key(dataset), spec["montos"], spec["flujo"]
    names = [c for c in spec["dims"] if c.endswith("_NOMBRE")]
    q = lambda cs: ", ".join(f'"{c}"' for c in cs)

    con = duckdb.connect()
    con.execute("SET enable_progress_bar = false")
    for t, path in (("a", prev), ("b", new)):
        con.execute(f"""CREATE TABLE {t} AS
            SELECT {q(key)}, {', '.join(f'any_value("{c}") AS "{c}"' for c in names)},
                   {', '.join(f'sum("{c}") AS "{c}"' for c in montos)}, true AS presente
            FROM read_parquet('{path}') GROUP BY {q(key)}""")
    on = " AND ".join(f'a."{c}" IS NOT DISTINCT FROM b."{c}"' for c in key)
    con.execute(f"""
        CREATE TABLE j AS
        SELECT {', '.join(f'coalesce(b."{c}", a."{c}") AS "{c}"' for c in key + names)},
               CASE WHEN a.presente IS NULL THEN 'nueva'
                    WHEN b.presente IS NULL THEN 'eliminada' ELSE 'modificada' END AS ESTADO,
               {', '.join(f'a."{c}" AS "{c}_ANTES", b."{c}" AS "{c}_DESPUES"' for c in montos)}
        FROM a FULL OUTER JOIN b ON {on}""")

    budget = " OR ".join(f'"{c}_ANTES" IS DISTINCT FROM "{c}_DESPUES"' for c in PRESUPUESTO)
    before_after = ", ".join(f'"{c}_ANTES", "{c}_DESPUES"' for c in PRESUPUESTO)
    out.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY (SELECT {q(key + names)}, ESTADO, {before_after} FROM j
                          WHERE ESTADO != 'modificada' OR {budget} ORDER BY {q(key)})
                    TO '{out}' ({PARQUET_OPTS})""")

    existing = "ESTADO = 'modificada'"
    lineas = dict(con.execute(f"SELECT ESTADO, count(*) FROM j WHERE ESTADO != 'modificada' OR {budget} "
                              "GROUP BY 1").fetchall())
    campos = {c: n for c in montos if (n := con.execute(
        f'SELECT count(*) FROM j WHERE {existing} AND "{c}_ANTES" != "{c}_DESPUES"').fetchone()[0])}
    mes_ult_prev = con.execute("SELECT coalesce(max(mes), 0) FROM (" + " UNION ALL ".join(
        f'SELECT {i + 1} AS mes FROM a WHERE "{flujo}_{m}" != 0' for i, m in enumerate(MESES)) + ")").fetchone()[0]
    revisiones = {}
    for i, m in enumerate(MESES[:mes_ult_prev]):
        c = f"{flujo}_{m}"
        n, neto = con.execute(f'SELECT count(*), sum("{c}_DESPUES" - "{c}_ANTES") FROM j '
                              f'WHERE {existing} AND "{c}_ANTES" != "{c}_DESPUES"').fetchone()
        if n:
            revisiones[i + 1] = {"lineas": n, "neto": str(neto)}
    totales = {c: {"antes": str(con.execute(f'SELECT coalesce(sum("{c}"), 0) FROM a').fetchone()[0]),
                   "despues": str(con.execute(f'SELECT coalesce(sum("{c}"), 0) FROM b').fetchone()[0])}
               for c in montos}
    con.close()
    return {"lineas": {"nueva": lineas.get("nueva", 0), "eliminada": lineas.get("eliminada", 0),
                       "presupuesto_modificado": lineas.get("modificada", 0)},
            "campos_modificados": campos, "meses_cerrados_revisados": revisiones, "totales": totales}
