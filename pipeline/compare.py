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
import calendar
import json
from datetime import datetime

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

# Investment projects (obras): one row per executing unit x CUI. Signals for citizens,
# measured 2026 (data to August): 2,077 projects >= S/1M with no spending at all (S/ 6.7 bn).
OBRA_MINIMO = 1_000_000       # smaller projects are listed but not flagged
OBRA_MES_MIN = 6              # execution is back-loaded: don't judge it before mid-year
OBRA_AVANCE_BAJO = 0.10       # < 10% executed by mid-year
OBRA_RECORTE = 0.30           # budget cut >= 30% since the previous MEF publication
# Devengado-Mensual files put the label in TIPO_ACT_PROY; the diario format uses the code '2'
ES_PROYECTO = "('PROYECTO' IN (TIPO_ACT_PROY, TIPO_ACT_PROY_NOMBRE))"
# Budget MEF publishes without saying what it is for: the generic project code 2999999 ("PROYECTOS",
# or blank in the daily files) and lines with no project, activity or meta name. Oct 2026: S/ 2,651 M,
# almost all defence investment (Fuerza Aérea, Marina, Ejército).
SIN_DESCRIPCION = (f"(PRODUCTO_PROYECTO = '2999999' OR ({ES_PROYECTO} AND trim(coalesce(PRODUCTO_PROYECTO_NOMBRE, '')) = '')"
                   " OR trim(coalesce(ACTIVIDAD_ACCION_OBRA_NOMBRE, '')) = '' OR trim(coalesce(META_NOMBRE, '')) = '')")


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


def _obras(con, mes_ult: int) -> None:
    """Table `obras`: every investment project of the current year with its execution,
    its budget in the previous publication and what it executed last year, plus a signal."""
    juzgar = mes_ult >= OBRA_MES_MIN
    con.execute(f"""
        CREATE OR REPLACE TABLE obras AS
        WITH c AS (
            SELECT SEC_EJEC AS sec_ejec, PRODUCTO_PROYECTO AS cui,
                   any_value(PRODUCTO_PROYECTO_NOMBRE) AS nombre, any_value(EJECUTORA_NOMBRE) AS entidad,
                   any_value(NIVEL_GOBIERNO_NOMBRE) AS nivel,
                   arg_max(DEPARTAMENTO_META, MONTO_PIM) AS dept, arg_max(DEPARTAMENTO_META_NOMBRE, MONTO_PIM) AS dept_nombre,
                   arg_max(FUNCION_NOMBRE, MONTO_PIM) AS funcion,
                   CAST(sum(MONTO_PIA) AS DOUBLE) AS pia, CAST(sum(MONTO_PIM) AS DOUBLE) AS pim,
                   CAST(sum(MONTO_CERTIFICADO_ANUAL) AS DOUBLE) AS certificado,
                   CAST(sum(MONTO_DEVENGADO_ANUAL) AS DOUBLE) AS devengado
            FROM cur WHERE {ES_PROYECTO} GROUP BY 1, 2),
        p AS (SELECT SEC_EJEC AS sec_ejec, PRODUCTO_PROYECTO AS cui, CAST(sum(MONTO_PIM) AS DOUBLE) AS pim
              FROM prv WHERE {ES_PROYECTO} GROUP BY 1, 2),
        a AS (SELECT SEC_EJEC AS sec_ejec, PRODUCTO_PROYECTO AS cui, CAST(sum(MONTO_DEVENGADO_ANUAL) AS DOUBLE) AS dev
              FROM ant WHERE {ES_PROYECTO} GROUP BY 1, 2)
        SELECT c.*, p.pim AS pim_pub_ant, a.dev AS dev_ano_ant,
               CASE WHEN {juzgar} AND c.pim >= {OBRA_MINIMO} AND c.devengado = 0 THEN 'sin_avance'
                    WHEN {juzgar} AND c.pim >= {OBRA_MINIMO} AND c.devengado / c.pim < {OBRA_AVANCE_BAJO} THEN 'avance_bajo'
                    WHEN p.pim >= {OBRA_MINIMO} AND c.pim <= p.pim * (1 - {OBRA_RECORTE}) THEN 'recortada'
               END AS senal
        FROM c LEFT JOIN p USING (sec_ejec, cui) LEFT JOIN a USING (sec_ejec, cui)""")
    n, sin_avance = con.execute("SELECT count(*), count(*) FILTER (senal = 'sin_avance') FROM obras").fetchone()
    print(f"  obras: {n:,} proyectos ({sin_avance:,} sin avance)")


def _sin_descripcion(con) -> None:
    """sin_descripcion: per entity, the current-year budget published with no description, and the
    only thing that is public about it: its largest expense types (alert R8, audit agenda)."""
    con.execute(f"""CREATE OR REPLACE TABLE sin_descripcion AS
        WITH l AS (SELECT * FROM cur WHERE {SIN_DESCRIPCION}),
        e AS (SELECT SEC_EJEC, ESPECIFICA_DET_NOMBRE AS n, sum(MONTO_PIM) AS p FROM l GROUP BY 1, 2)
        SELECT l.SEC_EJEC AS sec_ejec, any_value(EJECUTORA_NOMBRE) AS entidad, any_value(NIVEL_GOBIERNO_NOMBRE) AS nivel,
               any_value(DEPARTAMENTO_EJECUTORA_NOMBRE) AS dept, any_value(FUNCION_NOMBRE) AS funcion,
               count(*) AS lineas, CAST(sum(MONTO_PIM) AS DOUBLE) AS pim, CAST(sum(MONTO_DEVENGADO_ANUAL) AS DOUBLE) AS devengado,
               (SELECT list(n ORDER BY p DESC)[1:3] FROM e WHERE e.SEC_EJEC = l.SEC_EJEC) AS especificas
        FROM l GROUP BY l.SEC_EJEC""")
    n, pim = con.execute("SELECT count(*), sum(pim) FROM sin_descripcion").fetchone()
    print(f"  sin descripción: {n} entities, S/ {(pim or 0)/1e6:,.1f} M")


def avance_esperado(pub: str, ano: int, mes_ult: int) -> float:
    """Share of the year the data covers: the end of mes_ult for monthly files, or the
    publication date for the daily Diario files (published mid-month: on 17 Oct the data
    covers 79% of the year, not 10/12 = 83%)."""
    fecha = datetime.strptime(pub, "%Y%m%dT%H%M%SZ")
    if fecha.year > ano:
        return mes_ult / 12
    transcurrido = (fecha - datetime(ano, 1, 1)).days / (366 if calendar.isleap(ano) else 365)
    return round(min(mes_ult / 12, max(transcurrido, 0.0)), 4)


def dias_cubiertos(pub: str, ano: int, mes_ult: int) -> tuple[int, int]:
    """(days of mes_ult the data covers, days in mes_ult): a Diario file published on 17 Oct
    covers 16 of October's 31 days; a monthly file, published the month after, all of it."""
    fecha = datetime.strptime(pub, "%Y%m%dT%H%M%SZ")
    dias = calendar.monthrange(ano, mes_ult)[1]
    return (fecha.day - 1, dias) if (fecha.year, fecha.month) == (ano, mes_ult) else (dias, dias)


def compare() -> dict | None:
    m = lake.load_manifest()
    anos = lake.years(m, "gasto")
    if not anos:
        print("  compare: no gasto data in the lake")
        return None
    ano = anos[-1]
    pubs = lake.publications(m, "gasto", ano)
    # "since the last update": the snapshot kept at least a week before the latest publication
    pub, prev = pubs[-1], lake.base_comparacion(m, "gasto", ano)
    mes_ult = m["datasets"]["gasto"][str(ano)]["publications"][pub]["mes_ult"]
    ant = ano - 1 if (ano - 1) in anos else None

    con = duckdb.connect(str(SERVING / "serving.duckdb"))
    con.execute("SET enable_progress_bar = false")
    # previous year "to the same date" (only read from `ant`): with a mid-month cut its last
    # month is prorated by the days covered, assuming even spending within the month. Counting
    # all of October 2025 against 1-16 October 2026 showed national spending +3.8% instead of +9%.
    cubiertos, dias = dias_cubiertos(pub, ano, mes_ult)
    meses = [f'coalesce("MONTO_DEVENGADO_{mm}", 0)' for mm in MESES[:mes_ult]]
    if meses and cubiertos < dias:
        meses[-1] = f"round({meses[-1]} * {cubiertos} / {dias}, 2)"
    periodo = " + ".join(meses) or "0"
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
    _obras(con, mes_ult)
    _sin_descripcion(con)

    pub_info = lambda p: {"id": p, "fecha": lake.pub_date(p),
                          "mes_ult": m["datasets"]["gasto"][str(ano)]["publications"][p]["mes_ult"]}
    resumen = {
        "ano": ano, "mes_ult": mes_ult, "avance_esperado": avance_esperado(pub, ano, mes_ult),
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
