"""What each budget category means and what its money actually pays for.

For every node of the función and genérica comparisons (compare.DIMENSIONES) writes
data/serving/json/explicar/<dimension>/<id>.json with:
  oficial   MEF's official definition (glosario/funcional.csv, glosario/economico.csv), or the
            closest ancestor's when MEF added the code after the published glossary (`heredado`)
  simple    our plain-language summary and examples, for top-level categories (glosario/simple.csv)
  en_que    what the money is spent on, from the data: the largest activities and projects
  como      how: the split by genérica (for a función) or by función (for a genérica)
  quien     who spends it: the largest executing units, and the split by level of government
plus json/glosario.json, the terms page (glosario/terminos.csv) with the función summaries.
Loaded on demand, one small file per category, when a reader asks "¿qué es esto?".
"""
import csv
import json
from pathlib import Path

import duckdb

from compare import DIMENSIONES, _id
from config import SERVING
from lake import register_views

GLOSARIO = Path(__file__).parent / "glosario"
TOP_EN_QUE, TOP_COMO, TOP_QUIEN = 8, 6, 6
FUENTES = {
    "funcion": "Clasificador Funcional del Sector Público (D.S. N° 068-2008-EF), glosario de términos",
    "generica": "Clasificadores Presupuestarios del MEF (clasificador económico de gastos)",
}


def _csv(nombre: str) -> list[dict]:
    with open(GLOSARIO / nombre, newline="") as f:
        return list(csv.DictReader(f))


def archivo(id_: str) -> str:
    """Node id -> file name: '22/047/0103' -> '22-047-0103' (ids never contain '-')."""
    return id_.replace("/", "-")


def _oficial(dim: str, id_: str, defs: dict[str, dict]) -> dict | None:
    """Exact definition, else the nearest ancestor's (marked heredado)."""
    if dim == "funcion":
        partes = id_.split("/")
        candidatos = [partes[i] for i in range(len(partes) - 1, -1, -1)]
    else:
        partes = id_.split(".")
        candidatos = [".".join(partes[:i]) for i in range(len(partes), 1, -1)]
    for i, c in enumerate(candidatos):
        d = defs.get(c)
        if d and d["definicion"]:
            return {"texto": d["definicion"], "nombre": d["nombre"], "heredado": i > 0, "fuente": FUENTES[dim]}
    return None


def _top(con, sql: str, n: int) -> dict[str, list[dict]]:
    """Rows of `sql` (first column id, ordered by pim) grouped by id, n per id."""
    out: dict[str, list[dict]] = {}
    cur = con.execute(f"SELECT * FROM ({sql}) QUALIFY row_number() OVER (PARTITION BY id ORDER BY pim DESC NULLS LAST) <= {n}")
    cols = [d[0] for d in cur.description]
    for r in cur.fetchall():
        fila = {c: (float(v) if hasattr(v, "is_finite") else v) for c, v in zip(cols, r)}
        out.setdefault(fila.pop("id"), []).append(fila)
    for filas in out.values():
        filas.sort(key=lambda f: -(f["pim"] or 0))
    return out


def explicar() -> None:
    out = SERVING / "json"
    simple = {(r["dimension"], r["codigo"]): r for r in _csv("simple.csv")}
    defs = {"funcion": {r["codigo"]: r for r in _csv("funcional.csv")},
            "generica": {r["codigo"]: r for r in _csv("economico.csv")}}

    con = duckdb.connect(str(SERVING / "serving.duckdb"), read_only=True)
    con.execute("SET enable_progress_bar = false")
    register_views(con)
    ano = con.execute("SELECT max(ANO_EJE) FROM gasto_wide").fetchone()[0]
    con.execute(f"""CREATE TEMP VIEW g AS SELECT *,
        CASE WHEN 'PROYECTO' IN (TIPO_ACT_PROY, TIPO_ACT_PROY_NOMBRE) THEN 'proyecto' ELSE 'actividad' END AS tipo,
        CASE WHEN 'PROYECTO' IN (TIPO_ACT_PROY, TIPO_ACT_PROY_NOMBRE) THEN PRODUCTO_PROYECTO_NOMBRE
             ELSE ACTIVIDAD_ACCION_OBRA_NOMBRE END AS item,
        CAST(MONTO_PIM AS DOUBLE) AS p, CAST(MONTO_DEVENGADO_ANUAL AS DOUBLE) AS d
        FROM gasto_wide WHERE ANO_EJE = {ano}""")

    n_archivos = 0
    for dim in ("funcion", "generica"):
        cfg = DIMENSIONES[dim]
        otro = ("GENERICA", "GENERICA_NOMBRE") if dim == "funcion" else ("FUNCION", "FUNCION_NOMBRE")
        for n, (nivel_nombre, col) in enumerate(cfg["niveles"], start=1):
            ident = _id(cfg, n)
            totales = {r[0]: r[1:] for r in con.execute(
                f"""SELECT {ident} id, any_value("{col}_NOMBRE"), sum(p), sum(d), count(DISTINCT SEC_EJEC)
                    FROM g GROUP BY 1""").fetchall()}
            en_que = _top(con, f"""SELECT {ident} id, any_value(item) nombre, tipo, sum(p) pim, sum(d) devengado,
                                          count(DISTINCT SEC_EJEC) entidades
                                   FROM g WHERE item IS NOT NULL GROUP BY {ident}, item, tipo""", TOP_EN_QUE)
            como = _top(con, f"""SELECT {ident} id, "{otro[0]}" codigo, any_value("{otro[1]}") nombre,
                                        sum(p) pim, sum(d) devengado FROM g GROUP BY 1, 2""", TOP_COMO)
            quien = _top(con, f"""SELECT {ident} id, SEC_EJEC sec_ejec, any_value(EJECUTORA_NOMBRE) nombre,
                                         any_value(NIVEL_GOBIERNO_NOMBRE) nivel, sum(p) pim, sum(d) devengado
                                  FROM g GROUP BY 1, 2""", TOP_QUIEN)
            por_nivel = _top(con, f"""SELECT {ident} id, NIVEL_GOBIERNO_NOMBRE nivel, sum(p) pim, sum(d) devengado
                                      FROM g GROUP BY 1, 2""", 3)
            for id_, (nombre, pim, dev, n_ent) in totales.items():
                codigo = id_.split("/")[-1] if dim == "funcion" else id_
                s = simple.get((dim, codigo)) if n == 1 else None
                payload = {
                    "dimension": dim, "id": id_, "nivel": nivel_nombre, "nombre": nombre, "ano": ano,
                    "pim": pim, "devengado": dev, "entidades": n_ent,
                    "oficial": _oficial(dim, id_, defs[dim]),
                    "simple": {"texto": s["simple"], "ejemplos": s["ejemplos"]} if s else None,
                    "en_que": en_que.get(id_, []), "como": como.get(id_, []),
                    "quien": quien.get(id_, []), "por_nivel": por_nivel.get(id_, []),
                }
                path = out / "explicar" / dim / f"{archivo(id_)}.json"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(payload, ensure_ascii=False))
                n_archivos += 1
    con.close()

    funciones = [{"codigo": c, "nombre": d["nombre"], "oficial": d["definicion"],
                  **({"simple": simple[("funcion", c)]["simple"], "ejemplos": simple[("funcion", c)]["ejemplos"]}
                     if ("funcion", c) in simple else {})}
                 for c, d in defs["funcion"].items() if d["nivel"] == "funcion"]
    genericas = [{"codigo": c, "nombre": defs["generica"][c]["nombre"], "oficial": defs["generica"][c]["definicion"],
                  "simple": simple[("generica", c)]["simple"], "ejemplos": simple[("generica", c)]["ejemplos"]}
                 for (dim, c) in simple if dim == "generica" and c in defs["generica"]]
    (out / "glosario.json").write_text(json.dumps(
        {"terminos": _csv("terminos.csv"), "funciones": funciones, "genericas": genericas,
         "fuentes": FUENTES}, ensure_ascii=False))
    print(f"  explicar: {n_archivos} categories; glosario.json ({len(_csv('terminos.csv'))} terms)")
