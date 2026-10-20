"""Who the State contracts with: OECE's open contracting data joined to the budget's entities.

Source: OECE (Organismo Especializado para las Contrataciones Públicas Eficientes, formerly OSCE),
published in the Open Contracting Data Standard (OCDS) and mirrored as yearly files by the Open
Contracting Partnership (data.open-contracting.org/en/publication/135, CC BY 4.0, refreshed
monthly). OECE's own download page refuses scripted access.

What it adds below the budget's expense types: for each executing unit, the contracts it signed
(object, supplier and RUC, amount, date, procedure, number of bidders) with links to the signed
contract and its amendments in SEACE; the final amount after adicionales; whether it was
terminated or annulled; and, for investment projects, the CUI that ties a contract to a project of
the budget. Limits, said on the site too: it records what was contracted, not what was paid (no
payment transactions are published), and only purchases that went through a SEACE procedure.

  actualizar(anos)  update step: download (weekly), flatten -> lake/contratos/<ano>.parquet
  exportar(con, out) serving step: link buyers to executing units -> json/contratos/<sec>.json
"""
import gzip
import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests
from rapidfuzz import fuzz

from config import LAKE, RAW
from nombres import con_lugares, lugares as lugares_conocidos

FUENTE = "https://data.open-contracting.org/en/publication/135/download?name={ano}.jsonl.gz"
DOC = "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/"  # + document id: signed contract, amendments
CARPETA = LAKE / "contratos"
CADENCIA_DIAS = 7       # the mirror changes monthly; checking weekly is plenty
UMBRAL_NOMBRE = 90      # rapidfuzz score to accept a buyer <-> executing unit match
TOP_CONTRATOS = 250     # per entity on the site; every contract stays in the lake / Hugging Face

COLUMNAS = ["ocid", "contrato_id", "contrato", "fecha", "ano", "comprador_id", "comprador_ruc", "comprador",
            "comprador_dep", "comprador_prov", "comprador_loc", "metodo", "categoria", "postores", "objeto", "proveedor",
            "proveedor_ruc", "monto", "monto_final", "valor_referencial", "moneda", "plazo_dias", "cui",
            "doc_contrato", "eventos"]

# what happened to a contract after signing, from the titles of its SEACE documents
EVENTOS = [("nulidad", r"nulidad"), ("intervencion", r"intervenci[oó]n"), ("resolucion", r"resoluci[oó]n"),
           ("adicional", r"adicional|complementari"), ("reduccion", r"reducci[oó]n"),
           ("ampliacion", r"ampliaci[oó]n|pr[oó]rroga")]


# --- download and flatten -----------------------------------------------------------------

def _metadatos() -> dict:
    p = CARPETA / "fuente.json"
    return json.loads(p.read_text()) if p.exists() else {}


def descargar(ano: int) -> Path:
    destino = RAW / "ocds" / f"{ano}.jsonl.gz"
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".part")
    with requests.get(FUENTE.format(ano=ano), stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for trozo in r.iter_content(chunk_size=1 << 20):
                f.write(trozo)
    tmp.rename(destino)
    return destino


def _monto_pen(v: dict, tv: dict) -> float | None:
    """Contract value in soles: as published, its PEN equivalent, or converted with the tender's rate."""
    if not v or v.get("amount") is None:
        return None
    if v.get("currency") == "PEN":
        return float(v["amount"])
    if v.get("amount_PEN") is not None:
        return float(v["amount_PEN"])
    if tv and tv.get("currency") == v.get("currency") and tv.get("amount") and tv.get("amount_PEN"):
        return float(v["amount"]) * float(tv["amount_PEN"]) / float(tv["amount"])
    return None


def filas(path: Path):
    """One row per signed contract of an OCDS JSONL file (compiled releases)."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for linea in f:
            r = json.loads(linea)
            r = r.get("compiledRelease", r)
            contratos = r.get("contracts") or []
            if not contratos:
                continue
            buyer = r.get("buyer") or {}
            parte = next((p for p in r.get("parties") or [] if p.get("id") == buyer.get("id")), {})
            ruc = next((i.get("id") for i in parte.get("additionalIdentifiers") or [] if i.get("scheme") == "PE-RUC"), None)
            dire = parte.get("address") or {}
            t = r.get("tender") or {}
            premios = {a.get("id"): a for a in r.get("awards") or []}
            for c in contratos:
                fecha = (c.get("dateSigned") or "")[:10] or None
                prov = (premios.get(c.get("awardID")) or {}).get("suppliers") or []
                docs = c.get("documents") or []
                firmado = next((d.get("id") for d in docs if d.get("documentType") == "contractSigned"), None)
                eventos = []  # "tipo:document id", in publication order
                for d in docs:
                    if d.get("documentType") == "contractAnnexe" and d.get("id"):
                        tipo = next((t for t, patron in EVENTOS if re.search(patron, d.get("title") or "", re.I)), None)
                        if tipo:
                            eventos.append(f"{tipo}:{d['id']}")
                cui = str(((r.get("planning") or {}).get("budget") or {}).get("projectID") or "")
                yield {
                    "ocid": r.get("ocid"), "contrato_id": str(c.get("id")), "contrato": c.get("title"),
                    "fecha": fecha, "ano": int(fecha[:4]) if fecha else None,
                    "comprador_id": buyer.get("id"), "comprador_ruc": ruc, "comprador": buyer.get("name"),
                    "comprador_dep": dire.get("department"), "comprador_prov": dire.get("region"),
                    "comprador_loc": dire.get("locality"),
                    "metodo": t.get("procurementMethodDetails"), "categoria": t.get("mainProcurementCategory"),
                    "postores": t.get("numberOfTenderers"),
                    "objeto": (c.get("description") or t.get("description") or t.get("title") or "").strip(),
                    "proveedor": " / ".join(s.get("name") or "" for s in prov) or None,
                    "proveedor_ruc": (prov[0].get("id") or "").replace("PE-RUC-", "") if prov else None,
                    "monto": _monto_pen(c.get("value") or {}, t.get("value") or {}),
                    "monto_final": _monto_pen((c.get("implementation") or {}).get("finalValue") or {}, t.get("value") or {}),
                    "valor_referencial": _monto_pen(t.get("value") or {}, t.get("value") or {}),
                    "moneda": (c.get("value") or {}).get("currency"),
                    "plazo_dias": (c.get("period") or {}).get("durationInDays"),
                    "cui": ",".join(x for x in re.findall(r"\d{7}", cui)) or None,
                    "doc_contrato": firmado, "eventos": ",".join(eventos) or None,
                }


def actualizar(anos: list[int], forzar: bool = False) -> list[Path]:
    """Refresh lake/contratos/<ano>.parquet for each year, at most every CADENCIA_DIAS.
    Returns the lake files written (to push to Hugging Face)."""
    import pandas as pd
    CARPETA.mkdir(parents=True, exist_ok=True)
    meta = _metadatos()
    escritos = []
    for ano in anos:
        info = meta.get(str(ano)) or {}
        dias = (time.time() - info.get("descargado_ts", 0)) / 86400
        destino = CARPETA / f"{ano}.parquet"
        if not forzar and destino.exists() and dias < CADENCIA_DIAS:
            print(f"  contratos {ano}: al día (descargado hace {dias:.1f} días)")
            continue
        print(f"  contratos {ano}: descargando {FUENTE.format(ano=ano)}", flush=True)
        origen = descargar(ano)
        df = pd.DataFrame(filas(origen), columns=COLUMNAS)
        con = duckdb.connect()
        con.register("df", df)
        con.execute(f"COPY (SELECT * FROM df ORDER BY comprador_id, fecha) TO '{destino}' (FORMAT parquet, COMPRESSION zstd)")
        meta[str(ano)] = {"descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                          "descargado_ts": time.time(), "contratos": len(df), "fuente": FUENTE.format(ano=ano)}
        print(f"  contratos {ano}: {len(df):,} contratos -> {destino.name} ({destino.stat().st_size / 1e6:.1f} MB)")
        origen.unlink(missing_ok=True)
        escritos.append(destino)
    if escritos:
        (CARPETA / "fuente.json").write_text(json.dumps(meta, indent=1))
        escritos.append(CARPETA / "fuente.json")
    return escritos


# --- buyers <-> executing units ------------------------------------------------------------

_ABREVIATURAS = [
    (r"\bGOB\.?\s*REG\.?(?=\s|$)", "GOBIERNO REGIONAL"), (r"^REGION\b(?! (POLICIAL|MILITAR|NAVAL|AEREA))", "GOBIERNO REGIONAL"),
    (r"\bDPTO\.?(?=\s|$)", " "), (r"\bMUNIC(IP)?\.?(?=\s|$)", "MUNICIPALIDAD"),
    (r"^M\.?\s*E\.?\s*-", "MINISTERIO DE EDUCACION -"), (r"\bHOSP\.?(?=\s|$)", "HOSPITAL"),
    (r"\bUNIDAD EJECUTORA\b(\s*N\W{0,2}\s*\d+)?(\s*\d+)?", " "), (r"\bU\.?\s*E\.?\s*\d+\b", " "),
    (r"\bN\W{0,2}\s*(?=\d)", " "),
    # a regional sector directorate is "REGION X - EDUCACION" in MEF, "DIRECCION REGIONAL DE EDUCACION"
    # or "GERENCIA REGIONAL DE ..." in SEACE; a UGEL is also "USE" or spelled out (and see _como_educacion)
    (r"\bAGRARIA\b", "AGRICULTURA"), (r"\bDRE\b", "EDUCACION"), (r"\bDIRESA\b|\bGERESA\b", "SALUD"),
    (r"\b(DIREC(CION)?|GERENCIA)\.? (SUB ?)?REG(IONAL)?\.?( SECTORIAL)?( DE( LA)?)? (?=(EDUCACION|SALUD|AGRICULTURA|TRANSPORTES|VIVIENDA|TRABAJO|PRODUCCION|ENERGIA|COMERCIO)\b)", " "),
    (r"\bUNIDAD DE GESTION EDUCATIVA LOCAL\b|\bUSE\b", "UGEL"),
    # ministries and agencies MEF abbreviates and SEACE spells out (or the other way round)
    (r"\bMEF\b", "MINISTERIO ECONOMIA FINANZAS"), (r"\bMTC\b", "MINISTERIO TRANSPORTES COMUNICACIONES"),
    (r"\bMEM\b|\bMINEM\b", "MINISTERIO ENERGIA MINAS"), (r"\bPNP\b", "POLICIA NACIONAL PERU"),
    (r"\bMINSA\b", "MINISTERIO SALUD"), (r"\bMIDIS\b", "MINISTERIO DESARROLLO INCLUSION SOCIAL"),
    (r"\bMVCS\b", "MINISTERIO VIVIENDA CONSTRUCCION SANEAMIENTO"), (r"\bMININTER\b", "MINISTERIO INTERIOR"),
    (r"\bMINDEF\b", "MINISTERIO DEFENSA"), (r"\bMIDAGRI\b|\bMINAGRI\b", "MINISTERIO DESARROLLO AGRARIO RIEGO"),
    (r"\bMIMP\b", "MINISTERIO MUJER POBLACIONES VULNERABLES"), (r"\bMINJUS(DH)?\b", "MINISTERIO JUSTICIA DERECHOS HUMANOS"),
    # administrative suffixes MEF adds to a ministry's main unit
    (r"\b(OFICINA GENERAL DE |GESTION Y )?ADM(INISTRACION)?\.?\s+(NIVEL( CENTRAL)?|GENERAL|CENTRAL)\b", " "),
    (r"\bGERENCIA GENERAL\b", " "),
]
_VACIAS = r"\b(DE|DEL|LA|LAS|LOS|EL|Y|E|EN|PARA|SEDE|CENTRAL)\b"
_DEPARTAMENTOS = {"PROVINCIA CONSTITUCIONAL CALLAO": "CALLAO", "LIMA METROPOLITANA": "LIMA", "LIMA PROVINCIAS": "LIMA"}


def normalizar(s: str | None) -> str:
    t = (s or "").upper().replace("¥", "Ñ")  # MEF names carry "¥" for "Ñ" (BA¥OS DEL INCA)
    t = unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode()  # accents first: the patterns are plain
    t = " ".join(t.split())  # "DIRECCION  REGIONAL": MEF names carry double spaces
    for patron, rep in _ABREVIATURAS:
        t = re.sub(patron, rep, t)
    t = re.sub(r"[^A-Z0-9]+", " ", t)
    return " ".join(dict.fromkeys(re.sub(_VACIAS, " ", t).split()))  # words once, in order


# the sector a unit belongs to: a health network and an education unit of the same place are
# different buyers ("REGION CUSCO - SALUD LA CONVENCION" is not "UGEL LA CONVENCION")
_SECTORES = {"SALUD": "salud", "HOSPITAL": "salud", "RED": "salud", "MICRORED": "salud",
             "EDUCACION": "educacion", "EDUCATIVA": "educacion", "UGEL": "educacion", "COLEGIO": "educacion",
             "AGRICULTURA": "agricultura", "TRANSPORTES": "transportes",
             "VIVIENDA": "vivienda", "TRABAJO": "trabajo", "PRODUCCION": "produccion", "UNIVERSIDAD": "universidad"}


def _sectores(nombre_normalizado: str) -> set[str]:
    return {_SECTORES[w] for w in nombre_normalizado.split() if w in _SECTORES}


def _como_educacion(t: str) -> str:
    """MEF names many UGELs "EDUCACION <province>": the same unit as SEACE's "UGEL <province>"."""
    return " ".join(dict.fromkeys(t.replace("UGEL", "EDUCACION").split()))


def _crudo(s: str | None) -> str:
    """The name with accents and punctuation gone and nothing else touched: breaks exact ties."""
    t = unicodedata.normalize("NFD", (s or "").upper()).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", t).split())


def _departamento(s: str | None) -> str:
    d = normalizar(s)
    return _DEPARTAMENTOS.get(d, d)


def _lugares_en(nombre: str, lugares: set[str]) -> set[str]:
    """The place names (whole words, possibly several) that appear in a normalized name."""
    t = f" {nombre} "
    return {p for p in lugares if f" {p} " in t}


def vincular(entidades: list[tuple], compradores: list[tuple], apoyo: set | None = None) -> dict[str, tuple[str, int]]:
    """{comprador_id: (sec_ejec, score)}. entidades: (sec, nombre, dept, prov, dist, nivel);
    compradores: (id, nombre, dep, loc[, prov]); apoyo: (comprador_id, sec) pairs other evidence
    supports (the buyer contracts that unit's projects). Within a department, the best order-aware name match,
    optionally with the province or district appended (SEACE adds it to tell same-named
    municipalities apart). National units (nivel E) are searched in every department and may also
    match as a strict subset ("PODER JUDICIAL" in "GERENCIA GENERAL DEL PODER JUDICIAL"). Each
    executing unit and each buyer is used at most once; the best score wins."""
    por_dep: dict[str, list] = {}
    todos = []
    apoyo = apoyo or set()
    for cid, nombre, dep, loc, *prov in compradores:
        b = normalizar(nombre)
        fila = (cid, b, normalizar(loc), _departamento(dep), _como_educacion(b), _crudo(nombre),
                normalizar(prov[0]) if prov else "")
        por_dep.setdefault(fila[3], []).append(fila)
        todos.append(fila)
    # the provinces and districts of each department: a unit named after a place of its department
    # that the other name lacks is a sibling unit ("EDUCACION JAUJA" is the UGEL, not the regional
    # "EDUCACION" directorate; "RED DE SALUD - TARMA" is not the DIRESA in Huancayo)
    lugares: dict[str, set[str]] = {}
    for _, _, dept, prov, dist, *_ in entidades:
        lugares.setdefault(_departamento(dept), set()).update(x for x in (normalizar(prov), normalizar(dist)) if x)
    candidatos = []
    for sec, nombre, dept, prov, dist, *nivel in entidades:
        nacional = bool(nivel) and nivel[0] == "E"
        a = normalizar(nombre)
        sede = {normalizar(prov), normalizar(dist), _departamento(dept)}
        variantes = [a, f"{a} {normalizar(prov)}", f"{a} {normalizar(dist)}", f"{a} {_departamento(dept)}"]
        educacion = [_como_educacion(v) for v in variantes] if "UGEL" in a else None
        crudo = _crudo(nombre)
        for cid, b, loc, dep, b_educacion, b_crudo, b_prov in (todos if nacional else por_dep.get(_departamento(dept), [])):
            if nacional and b.startswith(("GOBIERNO REGIONAL", "MUNICIPALIDAD")):
                continue  # a regional or municipal buyer is never a national unit
            s = max(fuzz.token_sort_ratio(v, b) for v in variantes)
            if educacion or b_educacion != b:  # UGEL <-> EDUCACION: the same unit, ranked just below an exact name
                s = max(s, max(fuzz.token_sort_ratio(v, b_educacion) for v in (educacion or variantes))
                        - (1 if educacion and b_educacion != b else 2))
            if s < UMBRAL_NOMBRE and nacional and min(len(a.split()), len(b.split())) >= 3:
                s = max(s, fuzz.token_set_ratio(a, b) - 4)  # subset match, ranked below an exact one
            if UMBRAL_NOMBRE <= s < 97:
                en_a, en_b = _lugares_en(a, lugares.get(dep, set())), _lugares_en(b, lugares.get(dep, set()))
                if en_a - en_b - {loc} or en_b - en_a - sede or _sectores(a) != _sectores(b):
                    continue  # one names a place or a sector the other lacks: a sibling unit, not this one
            if s >= UMBRAL_NOMBRE:
                # namesakes (MIRAFLORES in Lima and in Yauyos; two units MEF names alike): same district,
                # same province, the buyer contracts its projects, then the closer spelling
                bonus = (1 if loc and loc == normalizar(dist) else 0) + (0.5 if b_prov and b_prov == normalizar(prov) else 0) \
                    + (0.5 if (cid, sec) in apoyo else 0) + fuzz.ratio(crudo, b_crudo) / 1e4
                candidatos.append((s + bonus, sec, cid))
    candidatos.sort(reverse=True)
    usados_sec, usados_cid, out = set(), set(), {}
    for s, sec, cid in candidatos:
        if sec in usados_sec or cid in usados_cid:
            continue
        usados_sec.add(sec); usados_cid.add(cid)
        out[cid] = (sec, int(s))
    return out


# --- buyers <-> executing units, by the projects they contract ----------------------------

CUI_GENERICO = 3   # a CUI budgeted by more units than this is a generic code ("ESTUDIOS DE PRE-INVERSION")
PARTE_CUI = 0.6    # share of a buyer's project codes one unit must budget to link the buyer to it
# off-budget buyers (state companies, water utilities, municipal funds, savings banks): their
# contracts reach a unit's page only through that unit's own project codes, never as a whole
_FUERA_DEL_PRESUPUESTO = re.compile(r"\bS\.\s?A\b|\bS\.?A\.?[AC]\b|\bSA[AC]?\b|\bEMPRESA\b|ENTIDAD PRESTADORA|\bEPS\b|"
                                    r"AGUA POTABLE|FONDO (METROPOLITANO|MUNICIPAL) DE INVERSIONES|CAJA MUNICIPAL")


def fuera_del_presupuesto(nombre: str | None) -> bool:
    return bool(_FUERA_DEL_PRESUPUESTO.search((nombre or "").upper()))


def enlazar(con, vista: str = "_c") -> dict[str, tuple[str, str]]:
    """{comprador_id: (sec_ejec, "nombre" | "cui")}. Names first (vincular); then the project codes
    (CUI) of a buyer's contracts: the unit that budgets most of them is that buyer. A strong name
    match stands; the codes link buyers whose names differ (KIMBIRI / QUIMBIRI, renamed or merged
    entities) and overrule a borderline name match they clearly contradict."""
    entidades = con.execute("""SELECT sec_ejec, any_value(nombre), any_value(dept_nombre), any_value(prov_nombre),
                                      any_value(dist_nombre), any_value(nivel) FROM dim_entidad GROUP BY 1""").fetchall()
    compradores = con.execute(f"""SELECT comprador_id, arg_max(comprador, fecha), arg_max(comprador_dep, fecha),
                                         arg_max(comprador_loc, fecha), arg_max(comprador_prov, fecha)
                                  FROM {vista} GROUP BY 1""").fetchall()
    pares = con.execute(f"""
        WITH x AS (SELECT DISTINCT comprador_id, unnest(string_split(cui, ',')) AS cui FROM {vista} WHERE cui IS NOT NULL),
             o AS (SELECT DISTINCT cui, sec_ejec FROM obras WHERE cui IN
                     (SELECT cui FROM obras GROUP BY cui HAVING count(DISTINCT sec_ejec) <= {CUI_GENERICO})),
             j AS (SELECT comprador_id, sec_ejec, count(DISTINCT cui) AS n FROM x JOIN o USING (cui) GROUP BY comprador_id, sec_ejec)
        SELECT comprador_id, sec_ejec, n, n / sum(n) OVER (PARTITION BY comprador_id),
               row_number() OVER (PARTITION BY comprador_id ORDER BY n DESC, sec_ejec) FROM j""").fetchall()
    votos = {cid: (sec, n, parte) for cid, sec, n, parte, rk in pares if rk == 1}
    por_nombre = vincular(entidades, compradores, apoyo={(cid, sec) for cid, sec, *_ in pares})
    nombre_ent = {e[0]: e[1] for e in entidades}
    out = {}
    for cid, nombre, *_ in compradores:
        por_cui = None
        if cid in votos and not fuera_del_presupuesto(nombre):
            sec, n, parte = votos[cid]
            # a single shared project is weak evidence: then the sector must agree too
            if parte >= PARTE_CUI and (n >= 3 or _sectores(normalizar(nombre)) == _sectores(normalizar(nombre_ent[sec]))):
                por_cui = (sec, n, parte)
        m = por_nombre.get(cid)
        if m and (m[1] >= 97 or not por_cui or por_cui[0] == m[0] or por_cui[1] < 3 or por_cui[2] < 0.8):
            out[cid] = (m[0], "nombre")
        elif por_cui:
            out[cid] = (por_cui[0], "cui")
    return out


# --- serving: contracts per executing unit ------------------------------------------------

# competitive procedures, direct awards (no competition) and special regimes (agreements between
# public entities, international organisations): "a single bidder" only means something for the first
VIA = """CASE WHEN regexp_matches(coalesce(metodo, ''), '^(Contratación Directa|Exoneración)') THEN 'directo'
              WHEN regexp_matches(coalesce(metodo, ''), '^(Convenio|Reg[ií]men Especial|Contratación Internacional|Contratos Estandarizados|Adjudicación para Contrato Marco)') THEN 'especial'
              ELSE 'competitivo' END"""
_CATEGORIA = {"works": "o", "goods": "b", "services": "s"}
LARGO_OBJETO = 300


def texto_objeto(s: str | None, lugares=None) -> str:
    """A contract's object as SEACE wrote it, minus encoding damage (curly quotes arrive as "¿";
    the real "¿...?" always closes with "?") and, when written in capitals, readable like the
    budget's names: "Mejoramiento de la vía ... distrito de Ollantaytambo"."""
    t = " ".join((s or "").split())
    if "¿" in t and "?" not in t:
        t = t.replace("¿", '"')
    t = con_lugares(t, lugares) if lugares else t
    return t if len(t) <= LARGO_OBJETO else t[:LARGO_OBJETO - 1].rstrip() + "…"


def exportar(con, out: Path) -> tuple[dict, dict]:
    """json/contratos/<sec>.json per executing unit (+ fuente.json). Returns ({sec: summary},
    {(sec, cui): [contracts, amount]}) for the entity files; empty when the lake has no contracts."""
    archivos = sorted(CARPETA.glob("*.parquet"))
    carpeta = out / "contratos"
    for viejo in carpeta.glob("*.json"):
        viejo.unlink()  # derived output: a unit that lost its contracts must not keep a stale file
    if not archivos:
        return {}, {}
    ano = con.execute("SELECT max(ano) FROM fact_entidad_mes").fetchone()[0]
    hoy = datetime.now(timezone.utc).date().isoformat()
    lista = ", ".join(f"'{a}'" for a in archivos)
    # each yearly file holds the records last updated that year: every contract signed in the site's
    # years, plus older ones amended since (often works still under way: kept for their projects)
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _todos AS
        SELECT DISTINCT ON (ocid, contrato_id) *, {VIA} AS via FROM read_parquet([{lista}], union_by_name = true)
        WHERE ano BETWEEN {ano - 10} AND {ano} AND fecha <= '{hoy}'""")  # no typo'd future dates
    con.execute(f"CREATE OR REPLACE TEMP VIEW _c AS SELECT * FROM _todos WHERE ano >= {ano - 1}")
    enlace = enlazar(con, "_todos")
    con.execute("CREATE OR REPLACE TEMP TABLE _enl (comprador_id VARCHAR, sec_ejec VARCHAR, como VARCHAR)")
    con.executemany("INSERT INTO _enl VALUES (?, ?, ?)", [[c, s, h] for c, (s, h) in enlace.items()])
    # a unit's contracts: those its own buyers signed, plus those any buyer signed for one of its
    # projects (a municipal company paving the municipality's road, a ministry office contracting
    # for a project its agency budgets)
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _cx AS
        WITH o AS (SELECT DISTINCT cui, sec_ejec FROM obras WHERE cui IN
                     (SELECT cui FROM obras GROUP BY cui HAVING count(DISTINCT sec_ejec) <= {CUI_GENERICO}))
        SELECT DISTINCT x.ocid, x.contrato_id, o.sec_ejec, o.cui
        FROM (SELECT ocid, contrato_id, unnest(string_split(cui, ',')) AS cui FROM _todos WHERE cui IS NOT NULL) x
        JOIN o USING (cui)""")
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _ct AS
        WITH k AS (SELECT ocid, contrato_id, sec_ejec, bool_or(propio) AS propio FROM (
                     SELECT ocid, contrato_id, sec_ejec, true AS propio FROM _todos JOIN _enl USING (comprador_id)
                     UNION ALL SELECT ocid, contrato_id, sec_ejec, false FROM _cx) GROUP BY ocid, contrato_id, sec_ejec)
        SELECT k.sec_ejec, k.propio, c.* FROM k JOIN _todos c USING (ocid, contrato_id)""")
    con.execute(f"CREATE OR REPLACE TEMP VIEW _cs AS SELECT * FROM _ct WHERE ano >= {ano - 1}")  # the summary's period

    resumen = {}
    for (sec, n, monto, extra, proveedores, comp, un_postor, directo, resueltos, intervenidos, nulos, adicionales,
         de_otros, monto_otros, desde, hasta, o, b, s_) in con.execute("""
        SELECT sec_ejec, count(*), sum(monto), sum(greatest(coalesce(monto_final, monto) - monto, 0)),
               count(DISTINCT proveedor_ruc), count(*) FILTER (via = 'competitivo' AND postores IS NOT NULL),
               count(*) FILTER (via = 'competitivo' AND postores = 1), sum(monto) FILTER (via = 'directo'),
               count(*) FILTER (eventos LIKE '%resolucion%'), count(*) FILTER (eventos LIKE '%intervencion%'),
               count(*) FILTER (eventos LIKE '%nulidad%'),
               count(*) FILTER (eventos LIKE '%adicional%' OR monto_final > monto * 1.005),
               count(*) FILTER (NOT propio), sum(monto) FILTER (NOT propio), min(fecha), max(fecha),
               sum(monto) FILTER (categoria = 'works'), sum(monto) FILTER (categoria = 'goods'),
               sum(monto) FILTER (categoria = 'services')
        FROM _cs GROUP BY sec_ejec""").fetchall():
        resumen[sec] = {"n": n, "monto": monto, "extra": extra or None, "proveedores": proveedores,
                        "competitivos": comp, "un_postor": un_postor, "directo": directo, "resueltos": resueltos,
                        "intervenidos": intervenidos, "nulos": nulos, "con_adicionales": adicionales,
                        "de_otros": de_otros, "monto_otros": monto_otros, "desde": str(desde), "hasta": str(hasta),
                        "por_tipo": {"o": o, "b": b, "s": s_}, "top": []}
    for sec, ruc, nombre, n, monto in con.execute("""
        SELECT sec_ejec, proveedor_ruc, arg_max(proveedor, monto), count(*), sum(monto) FROM _cs
        WHERE proveedor_ruc IS NOT NULL AND proveedor_ruc <> '' GROUP BY sec_ejec, proveedor_ruc
        QUALIFY row_number() OVER (PARTITION BY sec_ejec ORDER BY sum(monto) DESC NULLS LAST, proveedor_ruc) <= 10
        ORDER BY sec_ejec, sum(monto) DESC NULLS LAST""").fetchall():
        resumen[sec]["top"].append([ruc, nombre, n, monto])
    por_obra = {(sec, cui): [n, monto] for sec, cui, n, monto in con.execute(
        "SELECT x.sec_ejec, x.cui, count(*), sum(c.monto) FROM _cx x JOIN _todos c USING (ocid, contrato_id) GROUP BY 1, 2").fetchall()}

    # the file: the period's largest contracts and every one tied to the unit's projects (any year:
    # who builds each obra); the rest is in the summary and in the Hugging Face dataset
    filas_ = con.execute(f"""
        SELECT * FROM (
            SELECT c.sec_ejec, c.fecha, c.objeto, c.proveedor, c.proveedor_ruc, c.monto, c.monto_final, c.metodo,
                   c.categoria, c.postores, c.cui, c.doc_contrato, c.eventos, c.comprador, c.comprador_ruc, e.como,
                   row_number() OVER (PARTITION BY c.sec_ejec ORDER BY (c.ano >= {ano - 1}) DESC, c.monto DESC NULLS LAST,
                                      c.fecha DESC, c.ocid, c.contrato_id) AS k,
                   c.ano >= {ano - 1} AS en_periodo,
                   EXISTS (SELECT 1 FROM _cx x WHERE x.ocid = c.ocid AND x.contrato_id = c.contrato_id
                                                AND x.sec_ejec = c.sec_ejec) AS de_obra
            FROM _ct c LEFT JOIN _enl e ON e.comprador_id = c.comprador_id AND e.sec_ejec = c.sec_ejec)
        WHERE (en_periodo AND k <= {TOP_CONTRATOS}) OR de_obra ORDER BY sec_ejec, k""").fetchall()
    por_sec: dict[str, list] = {}
    for f in filas_:
        por_sec.setdefault(f[0], []).append(f)
    carpeta.mkdir(parents=True, exist_ok=True)
    lugares = lugares_conocidos(con)
    for sec, rows in por_sec.items():
        if sec not in resumen:  # only older contracts, for its projects: no summary for the period
            resumen[sec] = {"n": 0, "monto": None, "top": [], "desde": None, "hasta": None}
        prov, metodos, comp = {}, {}, {}
        c = []
        for (_, fecha, objeto, proveedor, ruc, monto, final, metodo, categoria, postores, cui, doc, eventos,
             comprador, comprador_ruc, como, *_) in rows:
            p = prov.setdefault((ruc or "", proveedor or ""), len(prov)) if (ruc or proveedor) else None
            m = metodos.setdefault(metodo or "", len(metodos))
            b = comp.setdefault((comprador or "", comprador_ruc or "", como), len(comp))
            c.append([str(fecha), texto_objeto(objeto, lugares), p, monto, final if final is not None and monto and abs(final - monto) > 0.005 * monto else None,
                      m, _CATEGORIA.get(categoria), postores, cui, doc, eventos, b])
        r = dict(resumen[sec], mostrados=sum(1 for x in c if x[0] >= f"{ano - 1}"), desde_ano=ano - 1)
        datos = {"r": r, "p": [list(k) for k in prov], "m": list(metodos),
                 "b": [[con_lugares(n, lugares), ruc, como] for n, ruc, como in comp], "c": c}
        (carpeta / f"{sec}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":"), default=str))
    meta = _metadatos()
    (carpeta / "fuente.json").write_text(json.dumps({
        "descargado": max((v.get("descargado") for v in meta.values() if isinstance(v, dict)), default=None),
        "anos": [ano - 1, ano], "hasta": str(con.execute("SELECT max(fecha) FROM _c").fetchone()[0]),
        "contratos": con.execute("SELECT count(*) FROM _c").fetchone()[0],
        "vinculados": con.execute("SELECT count(*) FROM _c WHERE comprador_id IN (SELECT comprador_id FROM _enl)").fetchone()[0],
        "monto": con.execute("SELECT sum(monto) FROM _c").fetchone()[0],
        "monto_vinculado": con.execute("SELECT sum(monto) FROM _c WHERE comprador_id IN (SELECT comprador_id FROM _enl)").fetchone()[0],
        "compradores": con.execute("SELECT count(DISTINCT comprador_id) FROM _c").fetchone()[0],
        "compradores_vinculados": len(enlace), "por_cui": sum(1 for _, h in enlace.values() if h == "cui"),
    }, ensure_ascii=False))
    print(f"  json: contratos/*.json ({len(por_sec)} units, {sum(len(v) for v in por_sec.values()):,} contracts shown)")
    return {sec: dict(r, top=r["top"][:5]) for sec, r in resumen.items()}, por_obra
