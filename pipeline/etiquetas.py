"""Curated tags over the expense classifier: etiquetas/etiquetas.csv says what each tag
means, etiquetas/reglas.csv which classifier lines it covers (edit both in a spreadsheet).

The classifier says WHAT the money pays for, not WHO receives it, so tags such as
'sector_privado' are documented approximations (confianza: alta/media). A line can carry
several tags: tags overlap and must never be added together.

Rule semantics: a classifier line gets a tag if some 'incluye' rule matches and no
'excluye' rule does. A rule matches when the line's classifier path (e.g. '2.3.2.7.1.1')
equals or starts with `prefijo`, and -- if given -- ESPECIFICA_DET_NOMBRE matches
`especifica_det_nombre` (SQL LIKE, accent-insensitive).
"""
import csv
from pathlib import Path

import duckdb

DIR = Path(__file__).resolve().parent / "etiquetas"
CLASIFICADOR = ["TIPO_TRANSACCION", "GENERICA", "SUBGENERICA", "SUBGENERICA_DET", "ESPECIFICA", "ESPECIFICA_DET"]


def _read(name: str) -> list[dict]:
    with open(DIR / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def definiciones() -> list[dict]:
    return _read("etiquetas.csv")


def reglas() -> list[dict]:
    rs, known = _read("reglas.csv"), {d["etiqueta"] for d in definiciones()}
    for r in rs:
        if r["etiqueta"] not in known or r["accion"] not in ("incluye", "excluye"):
            raise SystemExit(f"etiquetas/reglas.csv: invalid rule {r}")
    return rs


def ruta_sql(alias: str = "") -> str:
    """Classifier path, e.g. '2.3.2.7.1.1', from the code columns."""
    p = f"{alias}." if alias else ""
    return " || '.' || ".join(f'{p}"{c}"' for c in CLASIFICADOR)


def register(con: duckdb.DuckDBPyConnection, source: str) -> None:
    """TEMP TABLE etiqueta_clasificador(etiqueta, <classifier codes>) for the lines in `source`."""
    con.execute("CREATE OR REPLACE TEMP TABLE _reglas(etiqueta VARCHAR, accion VARCHAR, prefijo VARCHAR, nombre VARCHAR)")
    con.executemany("INSERT INTO _reglas VALUES (?, ?, ?, ?)",
                    [(r["etiqueta"], r["accion"], r["prefijo"], r["especifica_det_nombre"] or None) for r in reglas()])
    cls = ", ".join(f'"{c}"' for c in CLASIFICADOR)
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE etiqueta_clasificador AS
        WITH c AS (SELECT DISTINCT {cls}, ESPECIFICA_DET_NOMBRE, {ruta_sql()} AS ruta FROM {source}),
        m AS (SELECT r.etiqueta, r.accion, c.*
              FROM c JOIN _reglas r
                ON (c.ruta = r.prefijo OR c.ruta LIKE r.prefijo || '.%')
               AND (r.nombre IS NULL OR strip_accents(upper(c.ESPECIFICA_DET_NOMBRE)) LIKE strip_accents(upper(r.nombre))))
        SELECT etiqueta, {cls} FROM m WHERE accion = 'incluye'
        EXCEPT
        SELECT etiqueta, {cls} FROM m WHERE accion = 'excluye'""")
