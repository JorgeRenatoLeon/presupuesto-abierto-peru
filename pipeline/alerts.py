"""Alert engine — Etapa 1 rules from 'Problemática y Requisitos', plus change detection:

R1 PIM_CAMBIO     an entity's budget (PIM) changed sharply between two MEF publications
R2 RIESGO_EJEC    execution pace far below the calendar (risk of no ejecución)
R3 PIA_PIM        budget heavily restructured vs. its opening value
R4 CAMBIO_TEMA    a función / tipo de gasto / tema / departamento changed sharply between
                  two MEF publications (e.g. education cut, more money to contractors)
R5 CAMBIO_ANUAL   this year's approved budget (PIA) vs last year's, same categories

MEF files only carry the current PIM, so R1/R4 compare publication snapshots kept in the
lake (compare.py -> cmp_entidad / cmp_nodos). Thresholds are deliberately configurable
(pending working session with Miguel). Every alert carries a plain-language `mensaje` —
the benchmark's key insight: numbers must be interpretable and actionable.
"""
import json
import time

import duckdb

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
               dev_ytd / pim AS avance, mes_ult / 12.0 AS esperado
        FROM ytd
        WHERE pim >= {UMBRAL_PIM_MINIMO} AND mes_ult >= {UMBRAL_RIESGO_MES_MIN}
          AND dev_ytd / pim < mes_ult / 12.0 - {UMBRAL_RIESGO_GAP}
    """).fetchall()
    for ano, mes, sec, nombre, nivel, dept, dev, pim, avance, esperado in r2:
        gap = esperado - avance
        alerts.append({
            "regla": "RIESGO_EJEC", "severidad": "alta" if gap >= UMBRAL_RIESGO_GAP_ALTA else "media",
            "ano": ano, "mes": mes, "sec_ejec": sec, "entidad": nombre,
            "nivel": nivel, "departamento": dept,
            "titulo": f"{nombre} solo ha ejecutado {avance*100:.0f}% de su presupuesto a {MESES_ES[mes]}",
            "mensaje": (
                f"A {MESES_ES[mes]} de {ano}, esta entidad ha gastado {_fmt(dev)} de los {_fmt(pim)} "
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
            titulo = f"{nombre} maneja {_fmt(pim)} que no estaban en el presupuesto inicial"
            mensaje = (f"Esta entidad no tenía presupuesto de apertura (PIA) y ahora administra {_fmt(pim)}. "
                       f"Esto ocurre con transferencias durante el año; conviene revisar su origen y destino.")
            pct = None
        else:
            ratio = pim / pia
            crecio = ratio > 1
            pct = (ratio - 1) * 100
            titulo = (f"El presupuesto de {nombre} {'creció' if crecio else 'se redujo'} "
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

    resumen_p = SERVING / "json" / "comparar" / "resumen.json"
    if resumen_p.exists() and _has(con, "cmp_nodos"):
        resumen = json.loads(resumen_p.read_text())
        alerts += _cambios_publicacion(con, resumen) + _cambios_anuales(con, resumen)
    con.close()
    _persist(alerts)
    return alerts


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
            "titulo": f"El presupuesto de {nombre} {'subió' if subio else 'bajó'} {abs(pct):.0f}% en la última actualización",
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
    """'CONSTRUCCION DE EDIFICIOS' -> 'Construccion de edificios' (MEF names are upper case)."""
    s = " ".join(s.split())
    return s[:1].upper() + s[1:].lower()


def _que(n: dict) -> str:
    """How to name a category inside a sentence, e.g. 'la función «Saneamiento»'."""
    nombre = _frase(n["nombre"])
    if n["dimension"] == "departamento":
        return f"el departamento de {n['nombre'].strip().title()}"
    if n["dimension"] == "etiqueta":
        return f"«{n['nombre'].strip()}»"
    que = {"funcion": f"la función «{nombre}»", "generica": f"el gasto en «{nombre}»"}[n["dimension"]]
    if n.get("padre"):  # a sub-level: say which parent it belongs to
        que = que.replace("la función", "la división funcional") + f" (dentro de «{_frase(n['padre'])}»)"
    return que


def _de(frase: str) -> str:
    """Spanish contraction: 'de el gasto' -> 'del gasto'."""
    return "del " + frase[3:] if frase.startswith("el ") else "de " + frase


PRIORIDAD = {"CAMBIO_TEMA": 0, "CAMBIO_ANUAL": 1, "PIM_CAMBIO": 2, "RIESGO_EJEC": 3, "PIA_PIM": 4}


def _persist(alerts: list[dict]) -> None:
    out = SERVING / "json"
    out.mkdir(exist_ok=True)
    magnitud = lambda a: abs((a["datos"].get("despues") or a["datos"].get("pim_actual") or 0)
                             - (a["datos"].get("antes") or a["datos"].get("pim_anterior") or 0))
    ordered = sorted(alerts, key=lambda a: (a["severidad"] != "alta", PRIORIDAD.get(a["regla"], 9),
                                            -(a["ano"] or 0), -magnitud(a)))
    (out / "alertas.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=1, default=str))
    n_alta = sum(1 for a in alerts if a["severidad"] == "alta")
    por_regla = {r: sum(1 for a in alerts if a["regla"] == r) for r in PRIORIDAD}
    print(f"  alertas: {len(alerts)} total ({n_alta} alta) {por_regla} -> json/alertas.json")
