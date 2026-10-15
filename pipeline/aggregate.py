"""Build the serving layer from Parquet: DuckDB tables + JSON extracts for the web app.

Aggregation semantics (per official dictionary):
- FLOWS (comprometido, devengado, girado): monthly amounts -> SUM freely.
- STOCKS (pia, pim, certificado, comprometido_anual): annual values repeated on each
  month's rows -> SUM only *within* a month; across time use the latest month.
"""
import json
import os
import time

import duckdb

import lake
from config import LAKE, SERVING
from lake import register_views

def _records(df):
    """DataFrame -> list of dicts with NaN/NaT converted to None (valid JSON)."""
    return df.astype(object).where(df.notnull(), None).to_dict(orient="records")


FLOWS = "SUM(MONTO_COMPROMETIDO) AS comprometido, SUM(MONTO_DEVENGADO) AS devengado, SUM(MONTO_GIRADO) AS girado"
STOCKS = ("SUM(MONTO_PIA) AS pia, SUM(MONTO_PIM) AS pim, SUM(MONTO_CERTIFICADO) AS certificado, "
          "SUM(MONTO_COMPROMETIDO_ANUAL) AS comprometido_anual, SUM(MONTO_GIRADO_ANUAL) AS girado_anual")

DIMS = {
    "dim_entidad": """
        SELECT DISTINCT SEC_EJEC AS sec_ejec, EJECUTORA AS ejecutora,
               EJECUTORA_NOMBRE AS nombre, PLIEGO AS pliego, PLIEGO_NOMBRE AS pliego_nombre,
               SECTOR AS sector, SECTOR_NOMBRE AS sector_nombre,
               NIVEL_GOBIERNO AS nivel, NIVEL_GOBIERNO_NOMBRE AS nivel_nombre,
               DEPARTAMENTO_EJECUTORA AS dept, DEPARTAMENTO_EJECUTORA_NOMBRE AS dept_nombre,
               PROVINCIA_EJECUTORA AS prov, PROVINCIA_EJECUTORA_NOMBRE AS prov_nombre,
               DISTRITO_EJECUTORA AS dist, DISTRITO_EJECUTORA_NOMBRE AS dist_nombre
        FROM gasto""",
    "dim_clasificador": """
        SELECT DISTINCT GENERICA AS generica, GENERICA_NOMBRE AS generica_nombre,
               SUBGENERICA AS subgenerica, SUBGENERICA_NOMBRE AS subgenerica_nombre,
               ESPECIFICA AS especifica, ESPECIFICA_NOMBRE AS especifica_nombre
        FROM gasto""",
}

FACTS = {
    "fact_nacional_mes": "ANO_EJE AS ano, MES_EJE AS mes, NIVEL_GOBIERNO_NOMBRE AS nivel",
    "fact_entidad_mes": "ANO_EJE AS ano, MES_EJE AS mes, SEC_EJEC AS sec_ejec",
    "fact_funcion_mes": "ANO_EJE AS ano, MES_EJE AS mes, FUNCION AS funcion, FUNCION_NOMBRE AS funcion_nombre",
    "fact_dept_mes": "ANO_EJE AS ano, MES_EJE AS mes, DEPARTAMENTO_META AS dept, DEPARTAMENTO_META_NOMBRE AS dept_nombre",
    "fact_programa_mes": "ANO_EJE AS ano, MES_EJE AS mes, PROGRAMA_PPTO AS programa, PROGRAMA_PPTO_NOMBRE AS programa_nombre",
    "fact_generica_mes": "ANO_EJE AS ano, MES_EJE AS mes, CATEGORIA_GASTO_NOMBRE AS categoria, GENERICA_NOMBRE AS generica",
}


def aggregate() -> None:
    db_path = SERVING / "serving.duckdb"
    # Build in a local temp dir (avoids WAL issues on mounted/synced filesystems), then copy.
    import tempfile, shutil
    tmp_dir = tempfile.mkdtemp(prefix="presupuesto_")
    tmp_db = f"{tmp_dir}/serving.duckdb"
    con = duckdb.connect(tmp_db)
    found = register_views(con)  # gasto/ingreso (one row per line-month) over the lake's latest files
    if "gasto" not in found:
        raise SystemExit(f"No gasto data in {LAKE}. Run `python run.py update` (or `normalize`) first.")
    ingreso_files = found.get("ingreso")

    for name, sql in DIMS.items():
        con.execute(f"CREATE OR REPLACE TABLE {name} AS {sql}")
    for name, dims in FACTS.items():
        con.execute(f"""
            CREATE OR REPLACE TABLE {name} AS
            SELECT {dims}, {STOCKS}, {FLOWS}, count(*) AS n_lineas
            FROM gasto GROUP BY ALL ORDER BY ano, mes""")

    if ingreso_files:
        _build_ingreso_tables(con)

    # "Current" year snapshot: stocks at latest month + YTD flows
    con.execute("""
        CREATE OR REPLACE TABLE resumen_anual AS
        WITH ultimo AS (SELECT ano, max(mes) AS mes_ult FROM fact_nacional_mes GROUP BY ano)
        SELECT f.ano, u.mes_ult,
               SUM(f.pia) FILTER (f.mes = u.mes_ult) AS pia,
               SUM(f.pim) FILTER (f.mes = u.mes_ult) AS pim,
               SUM(f.certificado) FILTER (f.mes = u.mes_ult) AS certificado,
               SUM(f.devengado) AS devengado_ytd,
               COALESCE(SUM(f.girado), SUM(f.girado_anual) FILTER (f.mes = u.mes_ult)) AS girado_ytd
        FROM fact_nacional_mes f JOIN ultimo u ON f.ano = u.ano
        GROUP BY f.ano, u.mes_ult ORDER BY f.ano""")

    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    for t in tables:
        n = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n:,} rows")

    _export_json(con)
    con.execute("CHECKPOINT")
    con.close()
    target = db_path
    try:
        shutil.copyfile(tmp_db, target)  # truncate-overwrite; no unlink (synced-folder friendly)
    except (PermissionError, OSError):
        target = db_path.with_suffix(".duckdb.new")
        shutil.copyfile(tmp_db, target)
        print(f"  note: {db_path.name} was locked; wrote {target.name} instead")
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"Serving DB -> {target}")


ING_FLOW = "SUM(MONTO_RECAUDADO) AS recaudado"
ING_STOCKS = "SUM(MONTO_PIA) AS pia, SUM(MONTO_PIM) AS pim"

ING_FACTS = {
    "fact_ing_nacional_mes": "ANO_EJE AS ano, MES_EJE AS mes, NIVEL_GOBIERNO_NOMBRE AS nivel",
    "fact_ing_fuente_mes": "ANO_EJE AS ano, MES_EJE AS mes, RUBRO AS rubro, RUBRO_NOMBRE AS rubro_nombre",
    "fact_ing_generica_mes": "ANO_EJE AS ano, MES_EJE AS mes, GENERICA AS generica, GENERICA_NOMBRE AS generica_nombre",
    "fact_ing_dept_mes": "ANO_EJE AS ano, MES_EJE AS mes, DEPARTAMENTO_EJECUTORA AS dept, DEPARTAMENTO_EJECUTORA_NOMBRE AS dept_nombre",
}


def _build_ingreso_tables(con: duckdb.DuckDBPyConnection) -> None:
    for name, dims in ING_FACTS.items():
        con.execute(f"""
            CREATE OR REPLACE TABLE {name} AS
            SELECT {dims}, {ING_STOCKS}, {ING_FLOW}, count(*) AS n_lineas
            FROM ingreso GROUP BY ALL ORDER BY ano, mes""")
    con.execute("""
        CREATE OR REPLACE TABLE resumen_ing_anual AS
        WITH ultimo AS (SELECT ano, max(mes) AS mes_ult FROM fact_ing_nacional_mes GROUP BY ano)
        SELECT f.ano, u.mes_ult,
               SUM(f.pia) FILTER (f.mes = u.mes_ult) AS pia,
               SUM(f.pim) FILTER (f.mes = u.mes_ult) AS pim,
               SUM(f.recaudado) AS recaudado_ytd
        FROM fact_ing_nacional_mes f JOIN ultimo u ON f.ano = u.ano
        GROUP BY f.ano, u.mes_ult ORDER BY f.ano""")


def _export_json(con: duckdb.DuckDBPyConnection) -> None:
    """Small JSON extracts so the web app can render without a DB connection (MVP)."""
    out = SERVING / "json"
    out.mkdir(exist_ok=True)
    exports = {
        "resumen_anual": "SELECT * FROM resumen_anual",
        "serie_nacional": "SELECT ano, mes, SUM(devengado) devengado, SUM(pim) pim FROM fact_nacional_mes GROUP BY ano, mes ORDER BY ano, mes",
        "por_funcion": """SELECT ano, funcion, funcion_nombre, SUM(devengado) devengado,
                          SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_funcion_mes f2 WHERE f2.ano=f1.ano)) pim
                          FROM fact_funcion_mes f1 GROUP BY ano, funcion, funcion_nombre ORDER BY devengado DESC""",
        "por_departamento": """SELECT ano, dept, dept_nombre, SUM(devengado) devengado,
                               SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_dept_mes f2 WHERE f2.ano=f1.ano)) pim
                               FROM fact_dept_mes f1 GROUP BY ano, dept, dept_nombre ORDER BY devengado DESC""",
        "top_entidades": """SELECT f.ano, f.sec_ejec, any_value(e.nombre) nombre, any_value(e.nivel_nombre) nivel,
                            SUM(f.devengado) devengado,
                            SUM(f.pim) FILTER (f.mes = (SELECT max(mes) FROM fact_entidad_mes f2 WHERE f2.ano=f.ano)) pim
                            FROM fact_entidad_mes f JOIN dim_entidad e USING (sec_ejec)
                            GROUP BY f.ano, f.sec_ejec ORDER BY devengado DESC LIMIT 500""",
    }
    for name, sql in exports.items():
        rows = _records(con.execute(sql).fetchdf())
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, default=str))
        print(f"  json: {name}.json ({len(rows)} records)")

    _export_entidades(con, out)

    has_ingreso = bool(con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'resumen_ing_anual'"
    ).fetchone()[0])
    if has_ingreso:
        ing_exports = {
            "ingreso_resumen_anual": "SELECT * FROM resumen_ing_anual",
            "serie_ingreso_nacional": """SELECT ano, mes, SUM(recaudado) recaudado
                                         FROM fact_ing_nacional_mes GROUP BY ano, mes ORDER BY ano, mes""",
            "ingreso_por_fuente": """SELECT ano, rubro, rubro_nombre, SUM(recaudado) recaudado,
                                     SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_ing_fuente_mes f2 WHERE f2.ano=f1.ano)) pim
                                     FROM fact_ing_fuente_mes f1 GROUP BY ano, rubro, rubro_nombre ORDER BY recaudado DESC""",
            "ingreso_por_generica": """SELECT ano, generica, generica_nombre, SUM(recaudado) recaudado,
                                       SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_ing_generica_mes f2 WHERE f2.ano=f1.ano)) pim
                                       FROM fact_ing_generica_mes f1 GROUP BY ano, generica, generica_nombre ORDER BY recaudado DESC""",
            "ingreso_por_nivel": """SELECT ano, nivel, SUM(recaudado) recaudado,
                                    SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_ing_nacional_mes f2 WHERE f2.ano=f1.ano)) pim
                                    FROM fact_ing_nacional_mes f1 GROUP BY ano, nivel ORDER BY recaudado DESC""",
            # The two sides of the coin, joined by month
            "contraste_mensual": """
                SELECT COALESCE(g.ano, i.ano) AS ano, COALESCE(g.mes, i.mes) AS mes,
                       g.devengado AS gasto_devengado, i.recaudado AS ingreso_recaudado
                FROM (SELECT ano, mes, SUM(devengado) devengado FROM fact_nacional_mes GROUP BY ano, mes) g
                FULL OUTER JOIN (SELECT ano, mes, SUM(recaudado) recaudado FROM fact_ing_nacional_mes GROUP BY ano, mes) i
                  ON g.ano = i.ano AND g.mes = i.mes
                ORDER BY ano, mes""",
        }
        for name, sql in ing_exports.items():
            rows = _records(con.execute(sql).fetchdf())
            (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, default=str))
            print(f"  json: {name}.json ({len(rows)} records)")

    years = [r[0] for r in con.execute("SELECT DISTINCT ano FROM fact_nacional_mes ORDER BY ano").fetchall()]
    m = lake.load_manifest()
    publicaciones = [
        {"dataset": ds, "ano": y, "id": p, "fecha": lake.pub_date(p),
         "mes_ult": m["datasets"][ds][str(y)]["publications"][p]["mes_ult"]}
        for ds in lake.DATASETS for y in lake.years(m, ds) if y in years for p in [lake.latest_pub(m, ds, y)]]
    (out / "meta.json").write_text(json.dumps({
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "years": years,
        "hf_dataset": os.environ.get("HF_DATASET") or None,  # where the full history can be downloaded
        "publicaciones": publicaciones,                      # which MEF files the site reflects
    }))


def _export_entidades(con: duckdb.DuckDBPyConnection, out) -> None:
    """entidades.json (search index) + one JSON per entity with series and breakdowns."""
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
        SELECT e.sec_ejec, e.nombre, e.nivel_nombre AS nivel, e.dept_nombre AS dept,
               e.pliego_nombre AS pliego, y.dev AS devengado, y.pim
        FROM dim_entidad e LEFT JOIN ytd y USING (sec_ejec)
        ORDER BY y.dev DESC NULLS LAST
    """).fetchdf()
    index = _records(index)
    (out / "entidades.json").write_text(json.dumps(index, ensure_ascii=False, default=str))
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

    # group once (O(n)) instead of filtering the full frame per entity (O(n × entities));
    # secondary name key makes tie order deterministic across runs
    s_groups = dict(tuple(series.groupby("sec_ejec")))
    f_groups = dict(tuple(funciones.sort_values(["devengado", "funcion"], ascending=[False, True]).groupby("sec_ejec")))
    g_groups = dict(tuple(genericas.sort_values(["devengado", "generica"], ascending=[False, True]).groupby("sec_ejec")))
    empty = series.iloc[0:0]

    n = 0
    for ent in index:
        sec = ent["sec_ejec"]
        s = s_groups.get(sec, empty)
        f = f_groups.get(sec, funciones.iloc[0:0])
        g = g_groups.get(sec, genericas.iloc[0:0])
        payload = {
            "info": ent,
            "series": _records(s.drop(columns=["sec_ejec"])),
            "funciones": _records(f.drop(columns=["sec_ejec"]).head(10)),
            "genericas": _records(g.drop(columns=["sec_ejec"]).head(10)),
        }
        (ent_dir / f"{sec}.json").write_text(json.dumps(payload, ensure_ascii=False, default=str))
        n += 1
    print(f"  json: entidad/*.json ({n} files)")
