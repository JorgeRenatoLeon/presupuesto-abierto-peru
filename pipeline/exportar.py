"""Final export step: what the site reads that combines serving tables, alerts and the lake.

Runs after aggregate -> compare -> alerts and writes, under data/serving/json/:
  entidades.json, entidad/<sec_ejec>.json   search index + one file per executing unit
                                            (series, funciones, genéricas, obras, alertas)
  localidad/index.json, localidad/<dep>.json "Tu región": who spends what in each department
  auditar.json                              the audit agenda: stalled projects, year-end rush,
                                            court and arbitration payouts, sharp changes
  alertas/resumen.json, alertas/<REGLA>.json, alertas/departamento/<dep>.json
                                            alert lists the alerts page loads on demand
  seguimiento/temas.json                    top-level categories for the watchlist
  feeds/*.xml                               RSS: follow alerts without an account
Small files fetched only when needed keep pages light on mobile data.
"""
import json
import os
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape

import duckdb

from config import SERVING
from lake import register_views

DEPARTAMENTOS = "BETWEEN '01' AND '25'"  # '0' = no location, '98' = abroad
TOP_OBRAS_ENTIDAD = 40


def _records(df):
    """DataFrame -> list of dicts with NaN/NaT converted to None (valid JSON)."""
    return df.astype(object).where(df.notnull(), None).to_dict(orient="records")


def _rows(con, sql: str, params=None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [{c: (float(v) if hasattr(v, "is_finite") else v) for c, v in zip(cols, r)} for r in cur.fetchall()]


def _write(path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, default=str))


def _compacta(a: dict) -> dict:
    """Alert without its raw numbers: what an alert card shows."""
    return {k: v for k, v in a.items() if k != "datos"}


def exportar() -> None:
    con = duckdb.connect(str(SERVING / "serving.duckdb"), read_only=True)
    con.execute("SET enable_progress_bar = false")
    register_views(con)
    out = SERVING / "json"
    resumen_p = out / "comparar" / "resumen.json"
    resumen = json.loads(resumen_p.read_text()) if resumen_p.exists() else None
    alertas = json.loads((out / "alertas.json").read_text())
    ano = con.execute("SELECT max(ano) FROM fact_entidad_mes").fetchone()[0]
    tiene_obras = bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'obras'")
                       .fetchone()[0])

    _entidades(con, out, alertas, tiene_obras)
    deps = _rows(con, f"""SELECT DEPARTAMENTO_META AS codigo, any_value(DEPARTAMENTO_META_NOMBRE) AS nombre
                         FROM gasto_wide WHERE ANO_EJE = ? AND DEPARTAMENTO_META {DEPARTAMENTOS}
                         GROUP BY 1 ORDER BY 1""", [ano])
    _localidad(con, out, alertas, resumen, ano, deps, tiene_obras)
    _auditar(con, out, alertas, resumen, ano, tiene_obras)
    _alertas_por_grupo(out, alertas, deps)
    _temas(con, out)
    _feeds(out, alertas, resumen, deps)
    con.close()


# --- entities -----------------------------------------------------------------------

def _entidades(con, out, alertas: list[dict], tiene_obras: bool) -> None:
    """entidades.json (search index) + one JSON per entity with series, breakdowns, projects, alerts."""
    ent_dir = out / "entidad"
    ent_dir.mkdir(exist_ok=True)

    index = con.execute("""
        WITH ult AS (SELECT max(ano) AS ano FROM fact_entidad_mes),
        ytd AS (
            SELECT sec_ejec, SUM(devengado) dev,
                   SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_entidad_mes f2
                                           WHERE f2.ano = f.ano AND f2.sec_ejec = f.sec_ejec)) pim
            FROM fact_entidad_mes f WHERE ano = (SELECT ano FROM ult) GROUP BY sec_ejec
        )
        SELECT e.sec_ejec, any_value(e.nombre) AS nombre, any_value(e.nivel_nombre) AS nivel,
               any_value(e.dept_nombre) AS dept, any_value(e.pliego_nombre) AS pliego,
               any_value(e.prov_nombre) AS prov, any_value(e.dist_nombre) AS dist,
               any_value(y.dev) AS devengado, any_value(y.pim) AS pim
        FROM dim_entidad e LEFT JOIN ytd y USING (sec_ejec)
        GROUP BY e.sec_ejec ORDER BY any_value(y.dev) DESC NULLS LAST
    """).fetchdf()
    index = _records(index)
    _write(out / "entidades.json", index)
    print(f"  json: entidades.json ({len(index)} records)")

    series = con.execute(
        "SELECT sec_ejec, ano, mes, pia, pim, devengado FROM fact_entidad_mes ORDER BY ano, mes"
    ).fetchdf()
    funciones = con.execute("""
        SELECT SEC_EJEC AS sec_ejec, ANO_EJE AS ano, FUNCION_NOMBRE AS funcion,
               SUM(MONTO_DEVENGADO) AS devengado
        FROM gasto GROUP BY 1, 2, 3
    """).fetchdf()
    genericas = con.execute("""
        SELECT SEC_EJEC AS sec_ejec, ANO_EJE AS ano, GENERICA_NOMBRE AS generica,
               SUM(MONTO_DEVENGADO) AS devengado
        FROM gasto GROUP BY 1, 2, 3
    """).fetchdf()
    obras = con.execute(f"""SELECT sec_ejec, cui, nombre, funcion, dept_nombre AS dept, pim, devengado,
                                   pim_pub_ant, dev_ano_ant, senal FROM obras ORDER BY pim DESC NULLS LAST"""
                        ).fetchdf() if tiene_obras else None

    # group once (O(n)) instead of filtering the full frame per entity (O(n × entities));
    # secondary name key makes tie order deterministic across runs
    s_groups = dict(tuple(series.groupby("sec_ejec")))
    f_groups = dict(tuple(funciones.sort_values(["devengado", "funcion"], ascending=[False, True]).groupby("sec_ejec")))
    g_groups = dict(tuple(genericas.sort_values(["devengado", "generica"], ascending=[False, True]).groupby("sec_ejec")))
    o_groups = dict(tuple(obras.groupby("sec_ejec"))) if obras is not None else {}
    a_groups: dict[str, list] = {}
    for a in alertas:
        if a.get("sec_ejec"):
            a_groups.setdefault(a["sec_ejec"], []).append(_compacta(a))

    for ent in index:
        sec = ent["sec_ejec"]
        s = s_groups.get(sec, series.iloc[0:0])
        f = f_groups.get(sec, funciones.iloc[0:0])
        g = g_groups.get(sec, genericas.iloc[0:0])
        o = o_groups.get(sec)
        payload = {
            "info": ent,
            "series": _records(s.drop(columns=["sec_ejec"])),
            "funciones": _records(f.drop(columns=["sec_ejec"]).head(10)),
            "genericas": _records(g.drop(columns=["sec_ejec"]).head(10)),
            "obras": _records(o.drop(columns=["sec_ejec"]).head(TOP_OBRAS_ENTIDAD)) if o is not None else [],
            "n_obras": 0 if o is None else len(o),
            "alertas": a_groups.get(sec, [])[:10],
        }
        _write(ent_dir / f"{sec}.json", payload)
    print(f"  json: entidad/*.json ({len(index)} files)")


# --- departments ("Tu región") ------------------------------------------------------

def _localidad(con, out, alertas, resumen, ano: int, deps: list[dict], tiene_obras: bool) -> None:
    loc = out / "localidad"
    nombre_a_codigo = {d["nombre"].strip().upper(): d["codigo"] for d in deps}

    gasto = {r["codigo"]: r for r in _rows(con, f"""
        SELECT DEPARTAMENTO_META AS codigo, sum(MONTO_PIA) pia, sum(MONTO_PIM) pim, sum(MONTO_DEVENGADO_ANUAL) devengado
        FROM gasto_wide WHERE ANO_EJE = ? AND DEPARTAMENTO_META {DEPARTAMENTOS} GROUP BY 1""", [ano])}
    por_nivel, por_funcion = {}, {}
    for r in _rows(con, f"""SELECT DEPARTAMENTO_META AS codigo, NIVEL_GOBIERNO_NOMBRE AS nivel, sum(MONTO_PIM) pim,
                                 sum(MONTO_DEVENGADO_ANUAL) devengado FROM gasto_wide
                            WHERE ANO_EJE = ? AND DEPARTAMENTO_META {DEPARTAMENTOS} GROUP BY 1, 2 ORDER BY pim DESC""", [ano]):
        por_nivel.setdefault(r.pop("codigo"), []).append(r)
    for r in _rows(con, f"""SELECT DEPARTAMENTO_META AS codigo, FUNCION_NOMBRE AS funcion, sum(MONTO_PIM) pim,
                                 sum(MONTO_DEVENGADO_ANUAL) devengado FROM gasto_wide
                            WHERE ANO_EJE = ? AND DEPARTAMENTO_META {DEPARTAMENTOS} GROUP BY 1, 2 ORDER BY pim DESC""", [ano]):
        por_funcion.setdefault(r.pop("codigo"), []).append(r)
    cambios = {r["id"]: r for r in _rows(con, """SELECT id, pim_pub_ant, pia_ano_ant, pim_ano_ant, dev_ano_ant_periodo
                                                 FROM cmp_nodos WHERE dimension = 'departamento'""")}

    n_alertas: dict[str, dict] = {}
    for a in alertas:
        if a.get("sec_ejec"):
            c = n_alertas.setdefault(a["sec_ejec"], {"total": 0, "alta": 0})
            c["total"] += 1
            c["alta"] += a["severidad"] == "alta"
    obras_ent = {r["sec_ejec"]: r for r in _rows(con, """SELECT sec_ejec, count(*) n, count(*) FILTER (senal = 'sin_avance') sin_avance
                                                       FROM obras GROUP BY 1""")} if tiene_obras else {}
    entidades = _rows(con, """
        WITH u AS (SELECT sec_ejec, max(mes) m FROM fact_entidad_mes WHERE ano = ? GROUP BY 1)
        SELECT e.sec_ejec, any_value(e.nombre) nombre, any_value(e.nivel) nivel, any_value(e.dept) dept,
               any_value(e.prov_nombre) provincia, any_value(e.dist_nombre) distrito,
               sum(f.pim) FILTER (f.mes = u.m) pim, sum(f.devengado) devengado
        FROM fact_entidad_mes f JOIN u USING (sec_ejec) JOIN dim_entidad e USING (sec_ejec)
        WHERE f.ano = ? GROUP BY e.sec_ejec""", [ano, ano])
    por_dep_ent: dict[str, list] = {}
    for e in entidades:
        e["alertas"] = n_alertas.get(e["sec_ejec"], {"total": 0, "alta": 0})
        e["obras_sin_avance"] = obras_ent.get(e["sec_ejec"], {}).get("sin_avance", 0)
        por_dep_ent.setdefault(e["dept"], []).append(e)
    obras_dep: dict[str, list] = {}
    if tiene_obras:
        for r in _rows(con, f"""SELECT dept, sec_ejec, cui, nombre, entidad, funcion, pim, devengado, pim_pub_ant,
                                      dev_ano_ant, senal FROM obras WHERE dept {DEPARTAMENTOS} ORDER BY pim DESC"""):
            obras_dep.setdefault(r.pop("dept"), []).append(r)
    alertas_dep: dict[str, list] = {}
    for a in alertas:
        c = nombre_a_codigo.get((a.get("departamento") or "").strip().upper())
        if c:
            alertas_dep.setdefault(c, []).append(a)

    indice = []
    for d in deps:
        c = d["codigo"]
        ents = sorted(por_dep_ent.get(c, []), key=lambda e: -(e["pim"] or 0))
        obs = obras_dep.get(c, [])
        sin_avance = [o for o in obs if o["senal"] == "sin_avance"]
        als = alertas_dep.get(c, [])
        g = gasto.get(c, {})
        payload = {
            **d, "ano": ano, "mes_ult": resumen["mes_ult"] if resumen else None,
            "avance_esperado": resumen.get("avance_esperado") if resumen else None,
            "publicacion": resumen["publicacion"] if resumen else None,
            "gasto": {k: g.get(k) for k in ("pia", "pim", "devengado")},
            "cambios": {k: v for k, v in cambios.get(c, {}).items() if k != "id"},
            "por_nivel": por_nivel.get(c, []),
            "por_funcion": por_funcion.get(c, [])[:12],
            "gobierno_regional": [e for e in ents if e["nivel"] == "R"],
            "municipalidades": sorted([e for e in ents if e["nivel"] == "M"],
                                      key=lambda e: ((e["provincia"] or ""), -(e["pim"] or 0))),
            "nacional_con_sede": [e for e in ents if e["nivel"] == "E"][:15],
            "obras": {"n": len(obs), "n_sin_avance": len(sin_avance),
                      "pim_sin_avance": sum(o["pim"] or 0 for o in sin_avance),
                      "top": obs[:15], "sin_avance": sin_avance[:20]},
            "alertas": {"total": len(als), "alta": sum(a["severidad"] == "alta" for a in als),
                        "por_regla": {r: sum(a["regla"] == r for a in als) for r in sorted({a["regla"] for a in als})},
                        "top": [_compacta(a) for a in als[:8]]},
        }
        _write(loc / f"{c}.json", payload)
        indice.append({**d, "pim": g.get("pim"), "devengado": g.get("devengado"),
                       "pim_pub_ant": payload["cambios"].get("pim_pub_ant"),
                       "pia": g.get("pia"), "pia_ano_ant": payload["cambios"].get("pia_ano_ant"),
                       "n_municipalidades": len(payload["municipalidades"]),
                       "n_sin_avance": len(sin_avance), "alertas_alta": payload["alertas"]["alta"]})
    _write(loc / "index.json", indice)
    print(f"  json: localidad/*.json ({len(indice)} departamentos)")


# --- audit agenda --------------------------------------------------------------------

def _auditar(con, out, alertas, resumen, ano: int, tiene_obras: bool) -> None:
    datos: dict = {"ano": ano, "mes_ult": resumen["mes_ult"] if resumen else None,
                   "publicacion": resumen["publicacion"] if resumen else None}
    if tiene_obras:
        n, pim = con.execute("SELECT count(*), sum(pim) FROM obras WHERE senal = 'sin_avance'").fetchone()
        datos["obras_sin_avance"] = {
            "n": n, "pim": pim,
            "n_grandes": sum(a["regla"] == "OBRA_SIN_AVANCE" for a in alertas),
            "n_paralizadas": con.execute("SELECT count(*) FROM obras WHERE senal = 'sin_avance' "
                                         "AND dev_ano_ant >= 0.05 * pim").fetchone()[0],
            "por_departamento": _rows(con, f"""SELECT dept AS codigo, any_value(dept_nombre) AS nombre, count(*) n,
                                                     sum(pim) pim FROM obras WHERE senal = 'sin_avance'
                                                     AND dept {DEPARTAMENTOS} GROUP BY 1 ORDER BY pim DESC"""),
            "top": _rows(con, """SELECT sec_ejec, cui, nombre, entidad, dept_nombre AS dept, funcion, pim, dev_ano_ant
                                 FROM obras WHERE senal = 'sin_avance' ORDER BY pim DESC LIMIT 30"""),
        }
    ant = con.execute("SELECT max(ano) FROM fact_entidad_mes WHERE mes = 12").fetchone()[0]
    if ant:
        dic = _rows(con, """
            WITH e AS (SELECT f.sec_ejec, any_value(d.nombre) nombre, any_value(d.dept_nombre) dept,
                              any_value(d.nivel_nombre) nivel,
                              sum(f.devengado) FILTER (f.mes = 12) dic, sum(f.devengado) dev
                       FROM fact_entidad_mes f JOIN dim_entidad d USING (sec_ejec) WHERE f.ano = ? GROUP BY 1)
            SELECT *, dic / dev AS pct FROM e WHERE dev >= 5e6 ORDER BY pct DESC""", [ant])
        nac = con.execute("SELECT sum(devengado) FILTER (mes = 12) / sum(devengado) FROM fact_nacional_mes "
                          "WHERE ano = ?", [ant]).fetchone()[0]
        datos["gasto_diciembre"] = {"ano": ant, "promedio": nac,
                                    "n_25": sum(r["pct"] >= 0.25 for r in dic), "n_35": sum(r["pct"] >= 0.35 for r in dic),
                                    "top": dic[:30]}
    laudo = ("TIPO_TRANSACCION = '2' AND GENERICA = '5' AND SUBGENERICA = '5' AND SUBGENERICA_DET = '1'")
    tot = _rows(con, f"""SELECT sum(MONTO_PIM) pim, sum(MONTO_DEVENGADO_ANUAL) devengado,
                                sum(MONTO_PIM) FILTER (ESPECIFICA_DET_NOMBRE = 'A PERSONAS JURIDICAS') a_empresas,
                                count(DISTINCT SEC_EJEC) entidades
                         FROM gasto_wide WHERE ANO_EJE = ? AND {laudo}""", [ano])[0]
    datos["laudos"] = {**tot, "top": _rows(con, f"""
        SELECT SEC_EJEC sec_ejec, any_value(EJECUTORA_NOMBRE) nombre, any_value(DEPARTAMENTO_EJECUTORA_NOMBRE) dept,
               sum(MONTO_PIM) pim, sum(MONTO_DEVENGADO_ANUAL) devengado,
               sum(MONTO_PIM) FILTER (ESPECIFICA_DET_NOMBRE = 'A PERSONAS JURIDICAS') a_empresas
        FROM gasto_wide WHERE ANO_EJE = ? AND {laudo} GROUP BY 1 ORDER BY pim DESC LIMIT 20""", [ano])}
    contar = lambda regla, sev=None: sum(a["regla"] == regla and (sev is None or a["severidad"] == sev) for a in alertas)
    datos["conteos"] = {r: {"total": contar(r), "alta": contar(r, "alta")}
                        for r in ("CAMBIO_TEMA", "CAMBIO_ANUAL", "PIM_CAMBIO", "OBRA_SIN_AVANCE",
                                  "GASTO_DICIEMBRE", "RIESGO_EJEC", "PIA_PIM")}
    datos["destacadas"] = [_compacta(a) for a in alertas if a["regla"] in ("CAMBIO_TEMA", "CAMBIO_ANUAL")][:4]
    _write(out / "auditar.json", datos)
    print("  json: auditar.json")


# --- alerts split for on-demand loading ----------------------------------------------

def _alertas_por_grupo(out, alertas, deps: list[dict]) -> None:
    d = out / "alertas"
    nombre_a_codigo = {x["nombre"].strip().upper(): x["codigo"] for x in deps}
    por_regla: dict[str, list] = {}
    por_dep: dict[str, list] = {}
    for a in alertas:
        c = _compacta(a)
        por_regla.setdefault(a["regla"], []).append(c)
        cod = nombre_a_codigo.get((a.get("departamento") or "").strip().upper())
        if cod:
            por_dep.setdefault(cod, []).append(c)
    for r, xs in por_regla.items():
        _write(d / f"{r}.json", xs)
    for cod, xs in por_dep.items():
        _write(d / "departamento" / f"{cod}.json", xs)
    _write(d / "resumen.json", {
        "total": len(alertas), "alta": sum(a["severidad"] == "alta" for a in alertas),
        "por_regla": {r: {"total": len(xs), "alta": sum(x["severidad"] == "alta" for x in xs)} for r, xs in por_regla.items()},
        "departamentos": [{**x, "total": len(por_dep.get(x["codigo"], []))} for x in deps],
        "top": [_compacta(a) for a in alertas[:60]],
    })
    print(f"  json: alertas/ ({len(por_regla)} reglas, {len(por_dep)} departamentos)")


def _temas(con, out) -> None:
    temas = {dim: _rows(con, """SELECT id, nombre, pia, pim, devengado, pim_pub_ant, pia_ano_ant FROM cmp_nodos
                                WHERE dimension = ? AND nivel = 1 ORDER BY pim DESC NULLS LAST""", [dim])
             for dim in ("funcion", "etiqueta", "departamento")}
    _write(out / "seguimiento" / "temas.json", temas)


# --- RSS feeds -----------------------------------------------------------------------

def rss(titulo: str, descripcion: str, enlace: str, items: list[dict]) -> str:
    """RSS 2.0 document; items: title, link, guid, pubDate (datetime), description."""
    cuerpo = "".join(
        f"<item><title>{escape(i['title'])}</title><link>{escape(i['link'])}</link>"
        f"<guid isPermaLink=\"false\">{escape(i['guid'])}</guid>"
        f"<pubDate>{format_datetime(i['pubDate'])}</pubDate>"
        f"<description>{escape(i['description'])}</description></item>" for i in items)
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
            f"<title>{escape(titulo)}</title><link>{escape(enlace)}</link>"
            f"<description>{escape(descripcion)}</description><language>es-pe</language>{cuerpo}</channel></rss>\n")


def _fecha_pub(pub: str | None) -> datetime:
    if not pub:
        return datetime.now(timezone.utc)
    return datetime.strptime(pub, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def _enlace(a: dict) -> str:
    if a.get("enlace"):
        return a["enlace"]
    if a.get("sec_ejec"):
        return f"/entidad/{a['sec_ejec']}/" + ("#obras" if a["regla"] == "OBRA_SIN_AVANCE" else "")
    return "/alertas/"


def _feeds(out, alertas, resumen, deps: list[dict]) -> None:
    sitio = os.environ.get("SITE_URL", "").rstrip("/")
    items = lambda xs: [{"title": a["titulo"], "link": sitio + _enlace(a), "guid": a.get("id") or a["titulo"],
                         "pubDate": _fecha_pub(a.get("publicacion")), "description": a["mensaje"]} for a in xs]
    d = out / "feeds"
    d.mkdir(parents=True, exist_ok=True)
    canales = {
        "alertas.xml": ("Presupuesto Abierto Perú — alertas de prioridad alta",
                        [a for a in alertas if a["severidad"] == "alta"][:50]),
        "cambios.xml": ("Presupuesto Abierto Perú — cambios fuertes por tema",
                        [a for a in alertas if a["regla"] in ("CAMBIO_TEMA", "CAMBIO_ANUAL")][:150]),
        "obras.xml": ("Presupuesto Abierto Perú — proyectos sin avance",
                      [a for a in alertas if a["regla"] == "OBRA_SIN_AVANCE"][:50]),
    }
    nombre_a_codigo = {x["nombre"].strip().upper(): x["codigo"] for x in deps}
    for x in deps:
        canales[f"departamento/{x['codigo']}.xml"] = (
            f"Presupuesto Abierto Perú — {x['nombre'].title()}",
            [a for a in alertas if nombre_a_codigo.get((a.get("departamento") or "").strip().upper()) == x["codigo"]][:50])
    for nombre, (titulo, xs) in canales.items():
        p = d / nombre
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(rss(titulo, "Alertas automáticas sobre el presupuesto público del Perú, con datos oficiales del MEF.",
                         sitio + "/", items(xs)))
    print(f"  feeds: {len(canales)} RSS")
