"""Purchase and service orders: what each entity buys or pays for with an order instead of a signed
contract. Purchases up to 8 UIT, utilities, framework-agreement (catalogue) purchases, and the
orders that execute contracts. Each entity registers its orders, under its responsibility, in
SEACE's order module; OECE publishes them every month since 2018 (CONOSCE open data portal,
"Órdenes de Compra y/o Servicios").

They answer what the budget's catch-all lines cannot: "Locación de servicios realizados por persona
natural" (the largest goods-and-services line of 2026) is thousands of orders to named people for
named services; "Servicios diversos" or "Otros bienes" become a list of what was bought, from whom.

Limits, said on the site too: an order carries no budget code (no meta, no expense type). We infer
its expense type from its description (etiquetas/ordenes_gasto.csv, first rule that matches) and
tie it to a project when it cites the project's CUI. Amounts are the order's as registered;
cancelled orders ("Anulada") are left out.

  actualizar(anos)   update step: monthly xlsx -> lake/ordenes/<ano>/<mm>.parquet (a month is
                     downloaded again only when OECE republishes it)
  exportar(con, out) serving step, after contratos.exportar (reuses its buyer links):
                     json/ordenes/<sec>.json per executing unit; returns {sec: summary}
"""
import csv
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb
import requests

from config import LAKE, RAW
from nombres import texto

_ENIE = re.compile(r"(?<=[A-Za-zÁÉÍÓÚáéíóú])¿(?=[A-Za-záéíóú])")


def limpio(t: str | None, largo: int | None = None, nombre: bool = False) -> str | None:
    """SEACE's text minus its encoding damage ("SE¿ORIAL" is SEÑORIAL; an unclosed "¿" was a curly
    quote) and stray quotes around it; descriptions readable like the budget's names, a supplier's
    name as SEACE registers it (as the contracts show it)."""
    if not t:
        return None
    t = _ENIE.sub("Ñ", " ".join(t.split()))
    if "¿" in t and "?" not in t:
        t = t.replace("¿", '"')
    t = t.strip(' "\'')
    t = (t.upper() if nombre else texto(t)) or None
    return t if not t or not largo or len(t) <= largo else t[:largo - 1].rstrip() + "…"

FUENTE = ("https://conosce.osce.gob.pe/buscador/assets/67ae6c4a/reportes/ordenes/{ano}/"
          "CONOSCE_ORDENESCOMPRA{mes}{ano}_0.xlsx")
PORTAL = "https://www.gob.pe/14272-acceder-al-portal-de-datos-abiertos-del-oece"
MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE",
         "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]
CARPETA = LAKE / "ordenes"
REGLAS = Path(__file__).resolve().parent / "etiquetas" / "ordenes_gasto.csv"
CADENCIA_DIAS = {"actual": 7, "anterior": 30}  # how often a month is checked for a new version
UA = {"User-Agent": "Mozilla/5.0 (Presupuesto Abierto Peru; datos abiertos)"}
# rough soles per unit, for the few orders in another currency (0.04% of them)
CAMBIO = {"Dólar Norteamericano": 3.75, "Euro": 4.1, "Libra Esterlina": 4.8, "Dólar Canadiense": 2.7, "Yen Japonés": 0.025}
TOP_ORDENES = 40          # per unit on the site: its largest orders...
TOP_POR_GASTO = 3         # ...plus the largest of each expense type, for the budget's lines...
TOP_POR_CUI = 3           # ...and of each project that orders cite (every order stays in the lake)
TOP_PROVEEDORES = 10
LARGO = 160               # characters of an order's description on the site

# how the order came about, as OECE names it -> a short code
VIAS = {
    "Contrataciones hasta 8 UIT": "menor",
    "Otras contrataciones sin proceso": "sin_proceso",
    "Servicio Público": "servicio_publico",
    "Derivado de contratación por catálogo": "catalogo",
    "Deviene de Procesos de Selección": "proceso",
    "Deviene de Exoneraciones": "directa",
    "Deviene de Regimenes Especiales": "especial",
    "Convenio entre entidades": "convenio",
}
# orders that are not an executed contract: what SEACE's contracts never show
SIN_CONTRATO = ("menor", "sin_proceso", "servicio_publico", "catalogo", "convenio")
# an order for an investment project (its works, its studies, its supervision)
OBRA = r"\b(OBRA|PROYECTO|CUI|PIP|IOARR|EXPEDIENTE TECNICO)\b"


def _metadatos() -> dict:
    p = CARPETA / "fuente.json"
    return json.loads(p.read_text()) if p.exists() else {}


def url(ano: int, mes: int) -> str:
    return FUENTE.format(ano=ano, mes=MESES[mes - 1])


def _fecha(c: str) -> str:
    """OECE's dates arrive as Excel day numbers ('46268') or as text ('2026-08-18 00:00:00')."""
    return (f"coalesce(DATE '1899-12-30' + TRY_CAST(TRY_CAST({c} AS DOUBLE) AS INTEGER), "
            f"TRY_CAST(TRY_CAST({c} AS TIMESTAMP) AS DATE), TRY_CAST({c} AS DATE))")


def convertir(origen: Path, destino: Path, ano: int, mes: int) -> tuple[int, float]:
    """One month's xlsx -> parquet with typed columns. Returns (orders, soles)."""
    con = duckdb.connect()
    con.execute("INSTALL excel; LOAD excel")
    con.execute(f"CREATE TABLE x AS SELECT * FROM read_xlsx('{origen}', all_varchar = true)")
    cols = {c.lower(): c for (c,) in con.execute("SELECT column_name FROM (DESCRIBE x)").fetchall()}
    col = lambda *nombres: next((f'"{cols[n]}"' for n in nombres if n in cols), "NULL")
    via = "CASE " + " ".join(f"WHEN {col('tipodecontratacion')} ILIKE '{k}%' THEN '{v}'" for k, v in VIAS.items()) + " END"
    cambio = "CASE " + " ".join(f"WHEN m = '{k}' THEN {v}" for k, v in CAMBIO.items()) + " END"
    con.execute(f"""COPY (
        SELECT {ano} AS ano, {mes} AS mes, trim(entidad) AS entidad, trim(ruc_entidad) AS ruc_entidad,
               trim(departamento) AS departamento, tipo, orden, descripcion, objeto, estado, via,
               monto_original, m AS moneda, CASE WHEN m IS NULL OR m ILIKE '%soles%' THEN monto_original
                                               ELSE monto_original * {cambio} END AS monto,
               ruc_proveedor, proveedor, emision, registro, compromiso
        FROM (SELECT {col('entidad')} AS entidad, {col('ruc_entidad')} AS ruc_entidad,
                     {col('departamento_entidad')} AS departamento,
                     CASE WHEN {col('tipoorden')} ILIKE '%compra%' THEN 'c' ELSE 's' END AS tipo,
                     trim({col('orden')}) AS orden, nullif(trim(regexp_replace({col('descripcion_orden')}, '\\s+', ' ', 'g')), '') AS descripcion,
                     upper(trim({col('objetocontractual')})) AS objeto, trim({col('estadocontratacion')}) AS estado,
                     {via} AS via, TRY_CAST(replace({col('monto_total_orden_original')}, ',', '') AS DOUBLE) AS monto_original,
                     trim({col('moneda')}) AS m, trim({col('ruc_contratista')}) AS ruc_proveedor,
                     nullif(trim({col('nombre_razon_contratista')}), '') AS proveedor,
                     {_fecha(col('fecha_de_emision'))} AS emision, {_fecha(col('fecha_registro'))} AS registro,
                     {_fecha(col('fecha_compromiso_presupuestal'))} AS compromiso
              FROM x)
        ORDER BY ruc_entidad, emision) TO '{destino}' (FORMAT parquet, COMPRESSION zstd)""")
    n, monto = con.execute(f"SELECT count(*), coalesce(sum(monto), 0) FROM '{destino}' WHERE estado <> 'Anulada'").fetchone()
    return n, float(monto)


def actualizar(anos: list[int], forzar: bool = False) -> list[Path]:
    """Refresh lake/ordenes/<ano>/<mm>.parquet for the given years. OECE republishes the current and
    previous year's months together (late registrations, orders that move from committed to paid):
    a month is checked at most every CADENCIA_DIAS and downloaded again only when its file changed.
    Returns the lake files written (to push to Hugging Face)."""
    CARPETA.mkdir(parents=True, exist_ok=True)
    meta = _metadatos()
    hoy = date.today()
    escritos = []
    for ano in anos:
        cadencia = CADENCIA_DIAS["actual" if ano >= hoy.year else "anterior"]
        for mes in range(1, (12 if ano < hoy.year else hoy.month) + 1):
            clave, destino = f"{ano}-{mes:02d}", CARPETA / str(ano) / f"{mes:02d}.parquet"
            info = meta.get(clave) or {}
            dias = (time.time() - info.get("revisado_ts", 0)) / 86400
            # in the lake here or, as the metadata pulled from Hugging Face says, there
            conocido = destino.exists() or bool(info.get("publicado"))
            if not forzar and conocido and dias < cadencia:
                continue
            try:
                h = requests.head(url(ano, mes), headers=UA, timeout=60, allow_redirects=True)
            except requests.RequestException as e:
                print(f"  órdenes {clave}: sin respuesta ({e.__class__.__name__})")
                continue
            if h.status_code == 404:
                continue  # not published yet
            h.raise_for_status()
            publicado = h.headers.get("Last-Modified")
            if not forzar and conocido and publicado == info.get("publicado"):
                info["revisado_ts"] = time.time()
                meta[clave] = info
                continue
            origen = RAW / "ordenes" / f"{ano}-{mes:02d}.xlsx"
            origen.parent.mkdir(parents=True, exist_ok=True)
            print(f"  órdenes {clave}: descargando {url(ano, mes)}", flush=True)
            with requests.get(url(ano, mes), headers=UA, stream=True, timeout=300) as r:
                r.raise_for_status()
                with open(origen.with_suffix(".part"), "wb") as f:
                    for trozo in r.iter_content(chunk_size=1 << 20):
                        f.write(trozo)
            origen.with_suffix(".part").rename(origen)
            destino.parent.mkdir(parents=True, exist_ok=True)
            n, monto = convertir(origen, destino, ano, mes)
            origen.unlink(missing_ok=True)
            meta[clave] = {"publicado": publicado, "revisado_ts": time.time(),
                           "descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                           "ordenes": n, "monto": round(monto, 2), "fuente": url(ano, mes)}
            print(f"  órdenes {clave}: {n:,} órdenes, S/ {monto / 1e6:,.1f} M -> {destino.relative_to(LAKE)} "
                  f"({destino.stat().st_size / 1e6:.1f} MB)")
            escritos.append(destino)
    (CARPETA / "fuente.json").write_text(json.dumps(meta, indent=1, sort_keys=True))
    return escritos + ([CARPETA / "fuente.json"] if escritos else [])


# --- serving ------------------------------------------------------------------------------

def _sql(s: str) -> str:
    return s.replace("'", "''")


def _reglas_sql() -> str:
    """etiquetas/ordenes_gasto.csv as one CASE: the first rule whose contractual object, kind of
    supplier and description pattern match gives the expense type."""
    casos = []
    for r in csv.DictReader(open(REGLAS, encoding="utf-8")):
        cond = []
        if r["objeto"] == "B":
            cond.append("objeto = 'BIENES'")
        elif r["objeto"] == "S":
            cond.append("objeto NOT IN ('BIENES') AND objeto NOT LIKE 'CONSULTOR%'")
        elif r["objeto"] == "C":
            cond.append("objeto LIKE 'CONSULTOR%'")
        if r["proveedor"] == "persona":
            cond.append("persona")
        elif r["proveedor"] == "empresa":
            cond.append("NOT persona")
        if r["patron"] != ".":
            cond.append(f"regexp_matches(t, '{_sql(r['patron'])}')")
        casos.append(f"WHEN {' AND '.join(cond) or 'true'} THEN '{r['clasificador']}'")
    return "CASE " + " ".join(casos) + " END"


def _hay(con, nombre: str) -> bool:
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [nombre]).fetchone()[0])


def _vinculos(con) -> dict[str, str]:
    """{entity RUC: sec_ejec}. First the links contracts already made (a SEACE buyer and its RUC);
    then, for entities that only issue orders, the same name matching contracts use."""
    import contratos
    mapa: dict[str, str] = {}
    if _hay(con, "_enl") and _hay(con, "_todos"):
        for ruc, sec in con.execute("""SELECT comprador_ruc, arg_max(sec_ejec, n) FROM (
                SELECT comprador_ruc, sec_ejec, count(*) AS n FROM _todos JOIN _enl USING (comprador_id)
                WHERE comprador_ruc IS NOT NULL GROUP BY 1, 2) GROUP BY 1""").fetchall():
            mapa[ruc] = sec
    faltan = [f for f in con.execute("""SELECT ruc_entidad, arg_max(entidad, n), arg_max(departamento, n) FROM (
                SELECT ruc_entidad, entidad, departamento, count(*) AS n FROM _o GROUP BY ALL) GROUP BY 1""").fetchall()
              if f[0] not in mapa and not contratos.fuera_del_presupuesto(f[1])]
    usados = set(mapa.values())
    entidades = [e for e in con.execute("""SELECT sec_ejec, any_value(nombre), any_value(dept_nombre), any_value(prov_nombre),
                                                  any_value(dist_nombre), any_value(nivel) FROM dim_entidad GROUP BY 1""").fetchall()
                 if e[0] not in usados]
    for ruc, (sec, _) in contratos.vincular(entidades, [(ruc, nombre, dep, None) for ruc, nombre, dep in faltan]).items():
        mapa[ruc] = sec
    return mapa


def exportar(con, out: Path) -> dict:
    """json/ordenes/<sec>.json for each executing unit with orders this year:
      r: summary (how many, how much; by how the order came about; by expense type; how much went
         to people (RUC 10) and how many; its largest suppliers)
      p: suppliers [ruc, name]; o: orders [date, description, supplier, soles, c|s, via, expense
         type, CUI, state] (its largest, plus the largest of each expense type)
    Returns {sec: {n, monto, sin_contrato, personas}} for the entity pages."""
    carpeta = out / "ordenes"
    for viejo in carpeta.glob("*.json"):
        viejo.unlink()
    ano = con.execute("SELECT max(ano) FROM fact_entidad_mes").fetchone()[0]
    archivos = sorted((CARPETA / str(ano)).glob("*.parquet"))
    if not archivos:
        return {}
    lista = ", ".join(f"'{a}'" for a in archivos)
    # an order is registered once; a republished month may repeat one already in another file
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _o AS
        SELECT DISTINCT ON (ruc_entidad, tipo, orden) * REPLACE (monto::DOUBLE AS monto),
               upper(strip_accents(coalesce(descripcion, ''))) AS t,
               left(ruc_proveedor, 2) IN ('10', '15', '17') AS persona
        FROM read_parquet([{lista}], union_by_name = true)
        WHERE coalesce(estado, '') <> 'Anulada' AND monto > 0 AND ruc_entidad IS NOT NULL
        ORDER BY ruc_entidad, tipo, orden, mes DESC""")
    t0 = time.time()
    mapa = _vinculos(con)
    print(f"  ordenes: {len(mapa):,} entity RUCs linked ({time.time() - t0:.0f} s)")
    con.execute("CREATE OR REPLACE TEMP TABLE _or (ruc_entidad VARCHAR, sec_ejec VARCHAR)")
    con.executemany("INSERT INTO _or VALUES (?, ?)", [[r, s] for r, s in mapa.items()] or [["", ""]])
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _og AS
        SELECT r.sec_ejec, o.*, {_reglas_sql()} AS gasto,
               nullif(regexp_extract(t, 'C\\.?U\\.?I\\.?\\D{{0,12}}(\\d{{7}})', 1), '') AS cui,
               regexp_matches(t, '{OBRA}') AS obra
        FROM _o o JOIN _or r USING (ruc_entidad)""")
    tot, vinc = con.execute("SELECT (SELECT sum(monto) FROM _o), sum(monto) FROM _og").fetchone()
    print(f"  ordenes: classified ({time.time() - t0:.0f} s)")
    resumen: dict[str, dict] = {}
    for (sec, n, monto, sin_c, n_sin, personas, n_personas, monto_personas, desde, hasta) in con.execute(f"""
            SELECT sec_ejec, count(*), sum(monto), sum(monto) FILTER (WHERE via IN {SIN_CONTRATO}),
                   count(*) FILTER (WHERE via IN {SIN_CONTRATO}),
                   count(DISTINCT ruc_proveedor) FILTER (WHERE persona), count(*) FILTER (WHERE persona),
                   sum(monto) FILTER (WHERE persona), min(emision), max(emision)
            FROM _og GROUP BY 1""").fetchall():
        resumen[sec] = {"n": n, "monto": round(monto), "sin_contrato": round(sin_c or 0), "n_sin_contrato": n_sin,
                        "personas": personas, "n_personas": n_personas, "monto_personas": round(monto_personas or 0),
                        "desde": str(desde) if desde else None, "hasta": str(hasta) if hasta else None}
    vias = {}
    for sec, via, n, monto in con.execute("SELECT sec_ejec, via, count(*), sum(monto) FROM _og GROUP BY 1, 2 ORDER BY 1, 4 DESC").fetchall():
        vias.setdefault(sec, []).append([via, n, round(monto)])
    gastos = {}
    for sec, g, n, monto in con.execute("""SELECT sec_ejec, gasto, count(*), sum(monto) FROM _og WHERE NOT obra
                                           GROUP BY 1, 2 ORDER BY 1, 4 DESC""").fetchall():
        gastos.setdefault(sec, []).append([g, n, round(monto)])
    tops = {}
    for sec, ruc, nombre, n, monto in con.execute(f"""
            SELECT sec_ejec, ruc_proveedor, arg_max(proveedor, monto), count(*), sum(monto) FROM _og
            GROUP BY 1, 2 QUALIFY row_number() OVER (PARTITION BY sec_ejec ORDER BY sum(monto) DESC) <= {TOP_PROVEEDORES}
            ORDER BY 1, 5 DESC""").fetchall():
        tops.setdefault(sec, []).append([ruc, limpio(nombre, nombre=True) or ruc, n, round(monto)])
    filas: dict[str, list] = {}
    for sec, *f in con.execute(f"""
            SELECT sec_ejec, emision, descripcion, ruc_proveedor, proveedor, monto, tipo, via, gasto, cui, obra, estado FROM (
                SELECT *, row_number() OVER (PARTITION BY sec_ejec ORDER BY monto DESC) AS k,
                          row_number() OVER (PARTITION BY sec_ejec, gasto, obra ORDER BY monto DESC) AS kg,
                          row_number() OVER (PARTITION BY sec_ejec, cui ORDER BY monto DESC) AS kc
                FROM _og) WHERE k <= {TOP_ORDENES} OR kg <= {TOP_POR_GASTO} OR (cui IS NOT NULL AND kc <= {TOP_POR_CUI})
            ORDER BY sec_ejec, monto DESC""").fetchall():
        filas.setdefault(sec, []).append(f)
    carpeta.mkdir(parents=True, exist_ok=True)
    for sec, r in resumen.items():
        prov: dict[str, int] = {}
        p, o = [], []
        for emision, desc, ruc, nombre, monto, tipo, via, gasto, cui, obra, estado in filas.get(sec, []):
            if ruc not in prov:
                prov[ruc] = len(p)
                p.append([ruc, limpio(nombre, nombre=True)])
            o.append([str(emision) if emision else None, limpio(desc, LARGO), prov[ruc], round(monto, 2), tipo,
                      via, gasto, cui, 1 if obra else 0, (estado or "")[:1] or None])
        r.update(por_via=vias.get(sec, []), por_gasto=gastos.get(sec, []), top=tops.get(sec, []), ano=ano)
        (carpeta / f"{sec}.json").write_text(json.dumps({"r": r, "p": p, "o": o}, ensure_ascii=False, separators=(",", ":")))
    (carpeta / "fuente.json").write_text(json.dumps({
        "ano": ano, "fuente": PORTAL, "meses": len(archivos), "ordenes": con.execute("SELECT count(*) FROM _o").fetchone()[0],
        "monto": round(tot or 0), "monto_vinculado": round(vinc or 0), "entidades": len(resumen),
        "hasta": str(con.execute("SELECT max(emision) FROM _o WHERE emision <= current_date").fetchone()[0]),
    }, ensure_ascii=False))
    print(f"  json: ordenes/*.json ({len(resumen)} units; S/ {(vinc or 0) / 1e9:,.2f} bn of S/ {(tot or 0) / 1e9:,.2f} bn linked)")
    return {sec: {k: r[k] for k in ("n", "monto", "sin_contrato", "personas", "monto_personas")} for sec, r in resumen.items()}
