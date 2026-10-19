"""Alert engine — Etapa 1 rules from 'Problemática y Requisitos', plus change detection:

R1 PIM_CAMBIO     an entity's budget (PIM) changed sharply between two MEF publications
R2 RIESGO_EJEC    execution pace far below the calendar (risk of no ejecución)
R3 PIA_PIM        budget heavily restructured vs. its opening value
R4 CAMBIO_TEMA    a función / tipo de gasto / tema / departamento changed sharply between
                  two MEF publications (e.g. education cut, more money to contractors)
R5 CAMBIO_ANUAL   this year's approved budget (PIA) vs last year's, same categories
R6 OBRA_SIN_AVANCE a large investment project with no spending at all by mid-year
R7 GASTO_DICIEMBRE an entity spent an unusual share of last year's budget in December
                  (the classic year-end rush to avoid "losing" the money)

MEF files only carry the current PIM, so R1/R4 compare publication snapshots kept in the
lake (compare.py -> cmp_entidad / cmp_nodos). Thresholds are deliberately configurable
(pending working session with Miguel). Every alert carries a plain-language `mensaje` —
the benchmark's key insight: numbers must be interpretable and actionable.
"""
import hashlib
import json

import duckdb

from nombres import con_lugares, lugares, texto, titulo as nombre_propio

_SITIOS = None  # place names for project titles, loaded by compute_alerts()
from config import SERVING

# --- Thresholds (tune with the team) ---
UMBRAL_PIM_CAMBIO_PCT = 0.20      # entity PIM between publications (measured Jul->Sep 2026:
UMBRAL_PIM_CAMBIO_SOLES = 5_000_000   # 337 entities; 10%/S/1M would flag 1,009)
UMBRAL_PIM_CAMBIO_ALTA = 0.50
UMBRAL_RIESGO_GAP = 0.15          # 15 pp behind calendar pace
UMBRAL_RIESGO_GAP_ALTA = 0.25
UMBRAL_RIESGO_MES_MIN = 3         # don't flag pace before March
UMBRAL_PIM_MINIMO = 1_000_000     # ignore tiny budgets
UMBRAL_PIA_PIM_RATIO = 1.5        # PIM > 1.5×PIA or < PIA/1.5
PIA_CERO_PIM_MINIMO = 5_000_000   # "unplanned budget" special case
UMBRAL_TEMA_PCT = 0.05            # category PIM between publications (61 categories Jul->Sep 2026)
UMBRAL_TEMA_SOLES = 100_000_000
UMBRAL_TEMA_ALTA = 0.15
UMBRAL_ANUAL_PCT = 0.10           # category PIA year over year (64 categories 2025->2026)
UMBRAL_ANUAL_SOLES = 100_000_000
UMBRAL_ANUAL_ALTA = 0.25
UMBRAL_OBRA_SOLES = 5_000_000     # R6: 344 projects in 2026 (data to August), 125 of them
UMBRAL_OBRA_ALTA = 20_000_000     #     executed in 2025 and stopped
UMBRAL_DICIEMBRE = 0.35           # R7: national average is 13.6% (2025); 90 entities >= 35%
UMBRAL_DICIEMBRE_ALTA = 0.50
UMBRAL_DICIEMBRE_MINIMO = 5_000_000

MESES_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
DIMENSION_ES = {"funcion": "la función", "generica": "el gasto en", "etiqueta": "el rubro",
                "departamento": "el departamento de", "nivel": "el nivel"}
# nodes (alias n) that get category alerts: top levels of each hierarchy
NODOS_ALERTA = """((n.dimension IN ('funcion', 'generica') AND n.nivel <= 2)
                   OR (n.dimension IN ('etiqueta', 'departamento') AND n.nivel = 1))"""


def _fmt(v) -> str:
    v = float(v)
    if abs(v) >= 1e9:
        return f"S/ {v/1e9:,.2f} mil millones"
    if abs(v) >= 1e6:
        return f"S/ {v/1e6:,.1f} millones"
    return f"S/ {v:,.0f}"


def _fecha(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(d)} de {MESES_ES[int(m)]} de {y}"


def _db() -> duckdb.DuckDBPyConnection:
    db = SERVING / "serving.duckdb"
    alt = SERVING / "serving.duckdb.new"
    if alt.exists() and (not db.exists() or alt.stat().st_mtime > db.stat().st_mtime):
        db = alt
    return duckdb.connect(str(db), read_only=True)


def _has(con, table: str) -> bool:
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
                            [table]).fetchone()[0])


def compute_alerts() -> list[dict]:
    con = _db()
    global _SITIOS
    _SITIOS = lugares(con) if con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'dim_entidad'").fetchone()[0] else None
    resumen_p = SERVING / "json" / "comparar" / "resumen.json"
    resumen = json.loads(resumen_p.read_text()) if resumen_p.exists() else None
    # expected execution: share of the year the data covers (daily files are published mid-month).
    # DOUBLE: DuckDB reads a literal like 0.7918 as DECIMAL, which Python can't mix with floats
    esperado = (f"CAST({resumen['avance_esperado']} AS DOUBLE)"
                if resumen and resumen.get("avance_esperado") is not None else "mes_ult / 12.0")
    # R2/R3 describe the year in progress (a closed year's "risk" is already a fact)
    base = """
        SELECT f.ano, f.mes, f.sec_ejec, e.nombre, e.nivel_nombre, e.dept_nombre,
               CAST(f.pia AS DOUBLE) AS pia, CAST(f.pim AS DOUBLE) AS pim,
               CAST(f.devengado AS DOUBLE) AS devengado
        FROM fact_entidad_mes f JOIN dim_entidad e USING (sec_ejec)
        WHERE f.ano = (SELECT max(ano) FROM fact_entidad_mes)
    """
    alerts: list[dict] = []

    # R2: execution risk at latest month of each year
    r2 = con.execute(f"""
        WITH m AS ({base}),
        ult AS (SELECT ano, max(mes) AS mes_ult FROM m GROUP BY ano),
        ytd AS (
            SELECT m.ano, u.mes_ult, m.sec_ejec, any_value(m.nombre) nombre,
                   any_value(m.nivel_nombre) nivel, any_value(m.dept_nombre) dept,
                   SUM(m.devengado) dev_ytd,
                   SUM(m.pim) FILTER (m.mes = u.mes_ult) pim
            FROM m JOIN ult u ON m.ano = u.ano
            GROUP BY m.ano, u.mes_ult, m.sec_ejec
        )
        SELECT ano, mes_ult, sec_ejec, nombre, nivel, dept, dev_ytd, pim,
               dev_ytd / pim AS avance, {esperado} AS esperado
        FROM ytd
        WHERE pim >= {UMBRAL_PIM_MINIMO} AND mes_ult >= {UMBRAL_RIESGO_MES_MIN}
          AND dev_ytd / pim < {esperado} - {UMBRAL_RIESGO_GAP}
    """).fetchall()
    for ano, mes, sec, nombre, nivel, dept, dev, pim, avance, esperado in r2:
        gap = esperado - avance
        # daily files stop mid-month: name the real cut ("al 17 de octubre"), not the month
        a_mitad_de_mes = bool(resumen and resumen.get("avance_esperado") is not None
                              and resumen["avance_esperado"] < mes / 12 - 1e-6)
        corte = f"al {_fecha(resumen['publicacion']['fecha'])}" if a_mitad_de_mes else f"a {MESES_ES[mes]} de {ano}"
        alerts.append({
            "regla": "RIESGO_EJEC", "severidad": "alta" if gap >= UMBRAL_RIESGO_GAP_ALTA else "media",
            "ano": ano, "mes": mes, "sec_ejec": sec, "entidad": nombre,
            "nivel": nivel, "departamento": dept,
            "titulo": f"{nombre_propio(nombre)} solo ha ejecutado {avance*100:.0f}% de su presupuesto {corte.rsplit(' de ', 1)[0]}",
            "mensaje": (
                f"{corte[0].upper() + corte[1:]}, esta entidad ha gastado {_fmt(dev)} de los {_fmt(pim)} "
                f"disponibles ({avance*100:.0f}%). Al ritmo del calendario debería ir cerca de "
                f"{esperado*100:.0f}%. Si el ritmo no mejora, parte del presupuesto podría quedar sin usar "
                f"— dinero que no se convierte en obras ni servicios."
            ),
            "datos": {"devengado_ytd": dev, "pim": pim, "avance_pct": round(avance * 100, 1),
                      "esperado_pct": round(esperado * 100, 1)},
        })

    # R3: PIA vs PIM restructuring (latest month per year)
    r3 = con.execute(f"""
        WITH m AS ({base}),
        ult AS (SELECT ano, max(mes) AS mes_ult FROM m GROUP BY ano),
        cur AS (
            SELECT m.* FROM m JOIN ult u ON m.ano = u.ano AND m.mes = u.mes_ult
        )
        SELECT ano, mes, sec_ejec, nombre, nivel_nombre, dept_nombre, pia, pim
        FROM cur
        WHERE pim >= {UMBRAL_PIM_MINIMO}
          AND (pia = 0 AND pim >= {PIA_CERO_PIM_MINIMO}
               OR pia > 0 AND (pim / pia >= {UMBRAL_PIA_PIM_RATIO} OR pim / pia <= 1.0/{UMBRAL_PIA_PIM_RATIO}))
    """).fetchall()
    for ano, mes, sec, nombre, nivel, dept, pia, pim in r3:
        if pia == 0:
            titulo = f"{nombre_propio(nombre)} maneja {_fmt(pim)} que no estaban en el presupuesto inicial"
            mensaje = (f"Esta entidad no tenía presupuesto de apertura (PIA) y ahora administra {_fmt(pim)}. "
                       f"Esto ocurre con transferencias durante el año; conviene revisar su origen y destino.")
            pct = None
        else:
            ratio = pim / pia
            crecio = ratio > 1
            pct = (ratio - 1) * 100
            titulo = (f"El presupuesto de {nombre_propio(nombre)} {'creció' if crecio else 'se redujo'} "
                      f"{abs(pct):.0f}% respecto al inicial")
            mensaje = (f"Comenzó el año con {_fmt(pia)} (PIA) y ahora tiene {_fmt(pim)} (PIM). "
                       + ("Un aumento grande puede reflejar nuevas obras o transferencias recibidas."
                          if crecio else
                          "Una reducción grande puede significar recortes o transferencias a otras entidades."))
        alerts.append({
            "regla": "PIA_PIM", "severidad": "media",
            "ano": ano, "mes": mes, "sec_ejec": sec, "entidad": nombre,
            "nivel": nivel, "departamento": dept, "titulo": titulo, "mensaje": mensaje,
            "datos": {"pia": pia, "pim": pim, "variacion_pct": round(pct, 1) if pct is not None else None},
        })

    if resumen and _has(con, "cmp_nodos"):
        alerts += _cambios_publicacion(con, resumen) + _cambios_anuales(con, resumen)
    if resumen and _has(con, "obras"):
        alerts += _obras_sin_avance(con, resumen)
    alerts += _gasto_diciembre(con)
    con.close()
    _persist(alerts, resumen["publicacion"]["id"] if resumen else None)
    return alerts


def _corto(nombre: str, n: int = 90) -> str:
    """Project names run to 300 characters: keep the start, in sentence case."""
    s = con_lugares(nombre, _SITIOS)
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


def _obras_sin_avance(con, resumen: dict) -> list[dict]:
    """R6: big investment projects with no spending at all by mid-year (see compare._obras)."""
    ano, mes = resumen["ano"], resumen["mes_ult"]
    out = []
    rows = con.execute(f"""SELECT sec_ejec, cui, nombre, entidad, nivel, dept_nombre, pim, dev_ano_ant FROM obras
                           WHERE senal = 'sin_avance' AND pim >= {UMBRAL_OBRA_SOLES} ORDER BY pim DESC""").fetchall()
    for sec, cui, nombre, entidad, nivel, dept, pim, dev_ant in rows:
        venia = bool(dev_ant and dev_ant >= 0.05 * pim)  # was really moving last year, stopped now
        out.append({
            "regla": "OBRA_SIN_AVANCE", "severidad": "alta" if pim >= UMBRAL_OBRA_ALTA or venia else "media",
            "ano": ano, "mes": mes, "sec_ejec": sec, "entidad": entidad, "nivel": nivel,
            "departamento": (dept or "").strip() or None, "codigo": cui,
            "titulo": f"Proyecto de {_fmt(pim)} sin gasto a {MESES_ES[mes]}: {_corto(nombre)}",
            "mensaje": (
                f"{nombre_propio(entidad)} tiene {_fmt(pim)} para «{_corto(nombre, 160)}» (CUI {cui}), pero a {MESES_ES[mes]} "
                f"de {ano} no ha registrado ningún gasto. "
                + (f"El año pasado sí avanzó ({_fmt(dev_ant)} ejecutados): ¿está paralizada? " if venia else
                   "Los proyectos suelen gastar más a fin de año, pero a estas alturas conviene preguntar por su cronograma. ")
                + "Su ficha oficial está en el Sistema de Seguimiento de Inversiones del MEF."),
            "datos": {"pim": pim, "devengado": 0, "dev_ano_anterior": dev_ant},
        })
    return out


def _gasto_diciembre(con) -> list[dict]:
    """R7: entities that spent an unusual share of the last closed year in December."""
    ant = con.execute("SELECT max(ano) FROM fact_entidad_mes WHERE mes = 12").fetchone()[0]
    if not ant:
        return []
    nac = con.execute("SELECT sum(devengado) FILTER (mes = 12) / sum(devengado) FROM fact_nacional_mes "
                      "WHERE ano = ?", [ant]).fetchone()[0] or 0
    rows = con.execute(f"""
        WITH e AS (
            SELECT f.sec_ejec, any_value(d.nombre) AS nombre, any_value(d.nivel_nombre) AS nivel,
                   any_value(d.dept_nombre) AS dept,
                   CAST(sum(f.devengado) FILTER (f.mes = 12) AS DOUBLE) AS dic, CAST(sum(f.devengado) AS DOUBLE) AS dev
            FROM fact_entidad_mes f JOIN dim_entidad d USING (sec_ejec)
            WHERE f.ano = {ant} GROUP BY 1)
        SELECT * FROM e WHERE dev >= {UMBRAL_DICIEMBRE_MINIMO} AND dic / dev >= {UMBRAL_DICIEMBRE}
        ORDER BY dic / dev DESC""").fetchall()
    out = []
    for sec, nombre, nivel, dept, dic, dev in rows:
        share = dic / dev
        out.append({
            "regla": "GASTO_DICIEMBRE", "severidad": "alta" if share >= UMBRAL_DICIEMBRE_ALTA else "media",
            "ano": ant, "mes": 12, "sec_ejec": sec, "entidad": nombre, "nivel": nivel, "departamento": dept,
            "titulo": f"{nombre_propio(nombre)} concentró en diciembre el {share*100:.0f}% de todo su gasto de {ant}",
            "mensaje": (
                f"De los {_fmt(dev)} que ejecutó en {ant}, {_fmt(dic)} se gastaron en diciembre "
                f"({share*100:.0f}%; el promedio del Estado es {nac*100:.0f}%). Gastar tanto al cierre del año "
                f"suele indicar compras y pagos apresurados para no perder el presupuesto: vale la pena revisar "
                f"qué se compró, a quién y si se recibió."),
            "datos": {"devengado_diciembre": dic, "devengado_anual": dev, "porcentaje": round(share * 100, 1)},
        })
    return out


def _cambios_publicacion(con, resumen: dict) -> list[dict]:
    """R1 + R4: what changed between the last two MEF publications of the current year."""
    prev = resumen.get("publicacion_anterior")
    if not prev:
        return []
    ano, mes = resumen["ano"], resumen["mes_ult"]
    desde, hasta = _fecha(prev["fecha"]), _fecha(resumen["publicacion"]["fecha"])
    out = []

    r1 = con.execute(f"""
        SELECT sec_ejec, nombre, nivel, dept, pim_pub_ant, pim FROM cmp_entidad
        WHERE pim_pub_ant > 0 AND pim IS NOT NULL
          AND abs(pim - pim_pub_ant) >= {UMBRAL_PIM_CAMBIO_SOLES}
          AND abs(pim - pim_pub_ant) / pim_pub_ant >= {UMBRAL_PIM_CAMBIO_PCT}""").fetchall()
    for sec, nombre, nivel, dept, prev_pim, cur in r1:
        delta, pct = cur - prev_pim, (cur - prev_pim) / prev_pim * 100
        subio = delta > 0
        out.append({
            "regla": "PIM_CAMBIO", "severidad": "alta" if abs(pct) >= UMBRAL_PIM_CAMBIO_ALTA * 100 else "media",
            "ano": ano, "mes": mes, "sec_ejec": sec, "entidad": nombre, "nivel": nivel, "departamento": dept,
            "titulo": f"El presupuesto de {nombre_propio(nombre)} {'subió' if subio else 'bajó'} {abs(pct):.0f}% en la última actualización",
            "mensaje": (
                f"Entre la publicación del MEF del {desde} y la del {hasta}, su presupuesto modificado (PIM) "
                f"pasó de {_fmt(prev_pim)} a {_fmt(cur)} ({'+' if subio else '−'}{_fmt(abs(delta))}). "
                + ("Un aumento así suele venir de transferencias; vale la pena preguntar a qué se destinará."
                   if subio else "Un recorte así puede afectar servicios ya planificados.")),
            "datos": {"pim_anterior": prev_pim, "pim_actual": cur, "variacion_pct": round(pct, 1)},
        })

    for n in _nodos(con, "pim_pub_ant", "pim", UMBRAL_TEMA_PCT, UMBRAL_TEMA_SOLES):
        delta, pct = n["despues"] - n["antes"], (n["despues"] - n["antes"]) / n["antes"] * 100
        subio = delta > 0
        que = _que(n)
        out.append({
            "regla": "CAMBIO_TEMA", "severidad": "alta" if abs(pct) >= UMBRAL_TEMA_ALTA * 100 else "media",
            "ano": ano, "mes": mes, "sec_ejec": None, "entidad": n["nombre"], "nivel": None,
            "departamento": n["nombre"] if n["dimension"] == "departamento" else None,
            "dimension": n["dimension"], "codigo": n["id"], "enlace": f"/comparar/{n['dimension']}/",
            "titulo": f"{que[0].upper() + que[1:]} {'aumentó' if subio else 'se redujo'} "
                      f"{_fmt(abs(delta))} ({pct:+.1f}%) en la última actualización",
            "mensaje": (
                f"Sumando todas las entidades del Estado, el presupuesto vigente (PIM) {_de(que)} pasó de "
                f"{_fmt(n['antes'])} a {_fmt(n['despues'])} entre la publicación del MEF del {desde} y la del "
                f"{hasta}. Estos cambios se hacen con decretos y transferencias durante el año; "
                + ("¿de dónde salió el dinero y a qué se destinará?" if subio
                   else "¿qué se dejó de financiar y a dónde fue el dinero?")),
            "datos": {"antes": n["antes"], "despues": n["despues"], "variacion_pct": round(pct, 1)},
        })
    return out


def _cambios_anuales(con, resumen: dict) -> list[dict]:
    """R5: this year's approved budget (PIA) vs last year's, by category."""
    ant = resumen.get("ano_anterior")
    if not ant:
        return []
    ano = resumen["ano"]
    out = []
    for n in _nodos(con, "pia_ano_ant", "pia", UMBRAL_ANUAL_PCT, UMBRAL_ANUAL_SOLES):
        delta, pct = n["despues"] - n["antes"], (n["despues"] - n["antes"]) / n["antes"] * 100
        subio = delta > 0
        que = _que(n)
        out.append({
            "regla": "CAMBIO_ANUAL", "severidad": "alta" if abs(pct) >= UMBRAL_ANUAL_ALTA * 100 else "media",
            "ano": ano, "mes": None, "sec_ejec": None, "entidad": n["nombre"], "nivel": None,
            "departamento": n["nombre"] if n["dimension"] == "departamento" else None,
            "dimension": n["dimension"], "codigo": n["id"], "enlace": f"/comparar/{n['dimension']}/",
            "titulo": f"El presupuesto aprobado para {que} en {ano} es {abs(pct):.0f}% "
                      f"{'mayor' if subio else 'menor'} que en {ant['ano']}",
            "mensaje": (
                f"El Presupuesto Institucional de Apertura (PIA) {_de(que)} pasó de {_fmt(n['antes'])} en "
                f"{ant['ano']} a {_fmt(n['despues'])} en {ano} ({'+' if subio else '−'}{_fmt(abs(delta))}). "
                f"Son soles corrientes, sin descontar la inflación"
                + (": un aumento pequeño puede ser, en realidad, un recorte." if subio
                   else ". Una reducción así suele reflejar prioridades distintas en la Ley de Presupuesto.")),
            "datos": {"antes": n["antes"], "despues": n["despues"], "variacion_pct": round(pct, 1)},
        })
    return out


def _nodos(con, antes: str, despues: str, pct: float, soles: float) -> list[dict]:
    """Top-level category nodes whose value moved past both thresholds; a child identical
    to its parent (e.g. a división that is the whole función) is skipped as a duplicate."""
    rows = con.execute(f"""
        SELECT n.dimension, n.id, n.nombre, n.{antes}, n.{despues}, p.nombre
        FROM cmp_nodos n LEFT JOIN cmp_nodos p
          ON p.dimension = n.dimension AND p.id = n.padre
        WHERE {NODOS_ALERTA}
          AND n.{antes} > 0 AND n.{despues} IS NOT NULL
          AND abs(n.{despues} - n.{antes}) >= {soles}
          AND abs(n.{despues} - n.{antes}) / n.{antes} >= {pct}
          AND NOT (p.id IS NOT NULL AND p.{antes} = n.{antes} AND p.{despues} = n.{despues})
        ORDER BY abs(n.{despues} - n.{antes}) DESC""").fetchall()
    return [{"dimension": d, "id": i, "nombre": nm, "antes": a, "despues": b, "padre": pn}
            for d, i, nm, a, b, pn in rows]


def _frase(s: str) -> str:
    """'CONSTRUCCION DE EDIFICIOS' -> 'Construcción de edificios' (MEF names are upper case)."""
    return texto(s)


def _que(n: dict) -> str:
    """How to name a category inside a sentence, e.g. 'la función «Saneamiento»'."""
    nombre = _frase(n["nombre"])
    if n["dimension"] == "departamento":
        return f"el departamento de {nombre_propio(n["nombre"])}"
    if n["dimension"] == "etiqueta":
        return f"«{n['nombre'].strip()}»"
    que = {"funcion": f"la función «{nombre_propio(nombre)}»", "generica": f"el gasto en «{nombre_propio(nombre)}»"}[n["dimension"]]
    if n.get("padre"):  # a sub-level: say which parent it belongs to
        que = que.replace("la función", "la división funcional") + f" (dentro de «{_frase(n['padre'])}»)"
    return que


def _de(frase: str) -> str:
    """Spanish contraction: 'de el gasto' -> 'del gasto'."""
    return "del " + frase[3:] if frase.startswith("el ") else "de " + frase


PRIORIDAD = {"CAMBIO_TEMA": 0, "CAMBIO_ANUAL": 1, "OBRA_SIN_AVANCE": 2, "PIM_CAMBIO": 3,
             "GASTO_DICIEMBRE": 4, "RIESGO_EJEC": 5, "PIA_PIM": 6}


def _persist(alerts: list[dict], publicacion: str | None = None) -> None:
    out = SERVING / "json"
    out.mkdir(exist_ok=True)
    magnitud = lambda a: abs((a["datos"].get("despues") or a["datos"].get("pim_actual") or a["datos"].get("pim") or 0)
                             - (a["datos"].get("antes") or a["datos"].get("pim_anterior") or 0))
    for a in alerts:
        # stable across reruns of the same MEF publication: feeds and "nuevo" badges rely on it
        a["publicacion"] = publicacion
        clave = "|".join(str(a.get(k)) for k in ("regla", "sec_ejec", "codigo", "ano", "mes", "publicacion"))
        a["id"] = hashlib.sha1(clave.encode()).hexdigest()[:12]
    ordered = sorted(alerts, key=lambda a: (a["severidad"] != "alta", PRIORIDAD.get(a["regla"], 9),
                                            -(a["ano"] or 0), -magnitud(a)))
    (out / "alertas.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=1, default=str))
    n_alta = sum(1 for a in alerts if a["severidad"] == "alta")
    por_regla = {r: sum(1 for a in alerts if a["regla"] == r) for r in PRIORIDAD}
    print(f"  alertas: {len(alerts)} total ({n_alta} alta) {por_regla} -> json/alertas.json")
