"""Comparisons behind the /comparar pages and the change alerts.

For every node of each dimension's hierarchy (función > división > grupo, genérica > ... >
específica detalle, etiqueta, departamento, nivel de gobierno), three comparisons of the
current year's spending:
  aprobado     PIA -> PIM: how the budget changed since Congress approved it
  publicacion  PIM in the previous MEF publication -> PIM now: what the last update changed
  anual        previous year -> this year: PIA vs PIA, and devengado over the same months
Writes json/comparar/<dimension>.json + resumen.json, and the tables cmp_nodos and
cmp_entidad into serving.duckdb for alerts.py. Amounts are nominal soles.
"""
import json

import duckdb

import etiquetas
import lake
from config import SERVING, MESES

CLAS = ["GENERICA", "SUBGENERICA", "SUBGENERICA_DET", "ESPECIFICA", "ESPECIFICA_DET"]
DIMENSIONES = {
    "funcion": {"titulo": "Función", "sep": "/", "base": [],
                "niveles": [("Función", "FUNCION"), ("División funcional", "DIVISION_FUNCIONAL"),
                            ("Grupo funcional", "GRUPO_FUNCIONAL")]},
    "generica": {"titulo": "Tipo de gasto", "sep": ".", "base": ["TIPO_TRANSACCION"],
                 "niveles": [("Genérica", "GENERICA"), ("Subgenérica", "SUBGENERICA"),
                             ("Subgenérica detalle", "SUBGENERICA_DET"), ("Específica", "ESPECIFICA"),
                             ("Específica detalle", "ESPECIFICA_DET")]},
    "etiqueta": {"titulo": "Temas", "niveles": [("Tema", "etiqueta")]},
    "departamento": {"titulo": "Departamento", "sep": "/", "base": [],
                     "niveles": [("Departamento (dónde se gasta)", "DEPARTAMENTO_META")]},
    "nivel": {"titulo": "Nivel de gobierno", "sep": "/", "base": [],
              "niveles": [("Nivel de gobierno", "NIVEL_GOBIERNO")]},
}
MEDIDAS = ["pia", "pim", "devengado", "pim_pub_ant", "pia_ano_ant", "pim_ano_ant",
           "dev_ano_ant_periodo", "dev_ano_ant"]


def _id(dim: dict, n: int) -> str:
    cols = dim["base"] + [c for _, c in dim["niveles"][:n]]
    return f" || '{dim['sep']}' || ".join(f'"{c}"' for c in cols)


def _nodos(con, dim_id: str, dim: dict) -> list[dict]:
    """All nodes of one dimension with the three comparisons."""
    out = []
    for n, (_, col) in enumerate(dim["niveles"], start=1):
        if dim_id == "etiqueta":
            ident, padre, nombre, frm = "e.etiqueta", "NULL", "any_value(d.nombre)", \
                "{src} s JOIN etiqueta_clasificador e USING (TIPO_TRANSACCION, GENERICA, SUBGENERICA, " \
                "SUBGENERICA_DET, ESPECIFICA, ESPECIFICA_DET) JOIN _etq d ON d.etiqueta = e.etiqueta"
        else:
            ident, nombre, frm = _id(dim, n), f'any_value("{col}_NOMBRE")', "{src}"
            padre = _id(dim, n - 1) if n > 1 else "NULL"
        agg = lambda src: f"""SELECT {ident} AS id, {padre} AS padre, {nombre} AS nombre,
            sum(MONTO_PIA) AS pia, sum(MONTO_PIM) AS pim, sum(MONTO_DEVENGADO_ANUAL) AS dev,
            sum(dev_periodo) AS dev_periodo FROM {frm.format(src=src)} GROUP BY 1, 2"""
        rows = con.execute(f"""
            WITH c AS ({agg('cur')}), p AS ({agg('prv')}), a AS ({agg('ant')})
            SELECT coalesce(c.id, p.id, a.id) AS id, coalesce(c.padre, p.padre, a.padre) AS padre,
                   coalesce(c.nombre, p.nombre, a.nombre) AS nombre,
                   c.pia, c.pim, c.dev, p.pim, a.pia, a.pim, a.dev_periodo, a.dev
            FROM c FULL OUTER JOIN p ON c.id = p.id
                   FULL OUTER JOIN a ON coalesce(c.id, p.id) = a.id
            ORDER BY c.pim DESC NULLS LAST, 1""").fetchall()
        for r in rows:
            vals = [int(round(float(v))) if v is not None else None for v in r[3:]]  # whole soles
            if not any(vals):
                continue
            out.append({"id": r[0], "padre": r[1], "nivel": n, "nombre": r[2] or "(sin nombre)",
                        **dict(zip(MEDIDAS, vals))})
    return out


def compare() -> dict | None:
    m = lake.load_manifest()
    anos = lake.years(m, "gasto")
    if not anos:
        print("  compare: no gasto data in the lake")
        return None
    ano = anos[-1]
    pubs = lake.publications(m, "gasto", ano)
    pub, prev = pubs[-1], (pubs[-2] if len(pubs) > 1 else None)
    mes_ult = m["datasets"]["gasto"][str(ano)]["publications"][pub]["mes_ult"]
    ant = ano - 1 if (ano - 1) in anos else None

    con = duckdb.connect(str(SERVING / "serving.duckdb"))
    con.execute("SET enable_progress_bar = false")
    periodo = " + ".join(f'coalesce("MONTO_DEVENGADO_{mm}", 0)' for mm in MESES[:mes_ult]) or "0"
    fuentes = {"cur": lake.latest_path("gasto", ano),
               "prv": lake.snapshot_path("gasto", ano, prev) if prev else None,
               "ant": lake.latest_path("gasto", ant) if ant else None}
    for name, path in fuentes.items():
        src = path or lake.latest_path("gasto", ano)  # missing comparison -> same schema, no rows
        con.execute(f"""CREATE OR REPLACE TEMP VIEW {name} AS
            SELECT *, {periodo} AS dev_periodo FROM read_parquet('{src}') {'' if path else 'WHERE false'}""")
    con.execute("CREATE OR REPLACE TEMP VIEW _todas AS SELECT * FROM cur UNION ALL BY NAME "
                "SELECT * FROM prv UNION ALL BY NAME SELECT * FROM ant")
    etiquetas.register(con, "_todas")
    con.execute("CREATE OR REPLACE TEMP TABLE _etq(etiqueta VARCHAR, nombre VARCHAR)")
    con.executemany("INSERT INTO _etq VALUES (?, ?)", [(d["etiqueta"], d["nombre"]) for d in etiquetas.definiciones()])

    out_dir = SERVING / "json" / "comparar"
    out_dir.mkdir(parents=True, exist_ok=True)
    todos = []
    for dim_id, dim in DIMENSIONES.items():
        nodos = _nodos(con, dim_id, dim)
        payload = {"dimension": dim_id, "titulo": dim["titulo"], "niveles": [t for t, _ in dim["niveles"]],
                   "nodos": nodos}
        if dim_id == "etiqueta":
            payload["definiciones"] = etiquetas.definiciones()
        (out_dir / f"{dim_id}.json").write_text(json.dumps(payload, ensure_ascii=False))
        todos += [{"dimension": dim_id, **n} for n in nodos]
        print(f"  comparar: {dim_id}.json ({len(nodos)} nodos)")

    con.execute("CREATE OR REPLACE TABLE cmp_nodos (dimension VARCHAR, id VARCHAR, padre VARCHAR, nivel INTEGER, "
                "nombre VARCHAR, " + ", ".join(f"{c} DOUBLE" for c in MEDIDAS) + ")")
    con.executemany(f"INSERT INTO cmp_nodos VALUES ({', '.join(['?'] * (5 + len(MEDIDAS)))})",
                    [[n["dimension"], n["id"], n["padre"], n["nivel"], n["nombre"], *[n[c] for c in MEDIDAS]]
                     for n in todos])
    con.execute("""CREATE OR REPLACE TABLE cmp_entidad AS
        WITH c AS (SELECT SEC_EJEC, any_value(EJECUTORA_NOMBRE) nombre, any_value(NIVEL_GOBIERNO_NOMBRE) nivel,
                          any_value(DEPARTAMENTO_EJECUTORA_NOMBRE) dept, sum(MONTO_PIA) pia, sum(MONTO_PIM) pim
                   FROM cur GROUP BY 1),
             p AS (SELECT SEC_EJEC, any_value(EJECUTORA_NOMBRE) nombre, sum(MONTO_PIM) pim FROM prv GROUP BY 1)
        SELECT coalesce(c.SEC_EJEC, p.SEC_EJEC) AS sec_ejec, coalesce(c.nombre, p.nombre) AS nombre,
               c.nivel, c.dept, CAST(c.pia AS DOUBLE) AS pia, CAST(c.pim AS DOUBLE) AS pim,
               CAST(p.pim AS DOUBLE) AS pim_pub_ant
        FROM c FULL OUTER JOIN p ON c.SEC_EJEC = p.SEC_EJEC""")

    pub_info = lambda p: {"id": p, "fecha": lake.pub_date(p),
                          "mes_ult": m["datasets"]["gasto"][str(ano)]["publications"][p]["mes_ult"]}
    resumen = {
        "ano": ano, "mes_ult": mes_ult,
        "publicacion": pub_info(pub),
        "publicacion_anterior": pub_info(prev) if prev else None,
        "ano_anterior": {"ano": ant, "publicacion": {"id": lake.latest_pub(m, "gasto", ant),
                                                     "fecha": lake.pub_date(lake.latest_pub(m, "gasto", ant))}}
        if ant else None,
        "dimensiones": [{"id": k, "titulo": d["titulo"], "niveles": [t for t, _ in d["niveles"]]}
                        for k, d in DIMENSIONES.items()],
        "totales": {c: v for c, v in zip(MEDIDAS, [round(float(x), 2) if x is not None else None for x in con.execute(
            "SELECT sum(pia), sum(pim), sum(devengado), sum(pim_pub_ant), sum(pia_ano_ant), sum(pim_ano_ant), "
            "sum(dev_ano_ant_periodo), sum(dev_ano_ant) FROM cmp_nodos WHERE dimension = 'nivel'").fetchone()])},
    }
    (out_dir / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False))
    con.close()
    return resumen
