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

  actualizar(anos)  update step: download (weekly), flatten -> lake/contratos/<ano>.parquet and
                    lake/contratos_items/<ano>.parquet (what was bought, line by line)
  exportar(con, out) serving step: link buyers to executing units, give each contract the budget's
                    expense type (etiquetas/bienes_gasto.csv) -> json/contratos/<sec>.json,
                    json/proveedor/<id>.json (one per supplier), json/proveedores/indice.json
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

from compare import ES_PROYECTO
from config import LAKE, RAW
from nombres import con_lugares, texto, lugares as lugares_conocidos

FUENTE = "https://data.open-contracting.org/en/publication/135/download?name={ano}.jsonl.gz"
DOC = "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/"  # + document id: signed contract, amendments
CARPETA = LAKE / "contratos"
CARPETA_ITEMS = LAKE / "contratos_items"
CARPETA_PROCESOS = LAKE / "procesos"  # procedures with no signed contract yet: open, awarded, deserted...
BIENES_GASTO = Path(__file__).resolve().parent / "etiquetas" / "bienes_gasto.csv"
CADENCIA_DIAS = 7       # the mirror changes monthly; checking weekly is plenty
UMBRAL_NOMBRE = 90      # rapidfuzz score to accept a buyer <-> executing unit match
TOP_CONTRATOS = 250     # per entity on the site; every contract stays in the lake / Hugging Face

COLUMNAS = ["ocid", "contrato_id", "contrato", "fecha", "ano", "comprador_id", "comprador_ruc", "comprador",
            "comprador_dep", "comprador_prov", "comprador_loc", "metodo", "categoria", "postores", "objeto", "proveedor",
            "proveedor_ruc", "monto", "monto_final", "valor_referencial", "moneda", "plazo_dias", "cui",
            "doc_contrato", "eventos"]

COLUMNAS_ITEMS = ["ocid", "contrato_id", "pos", "cubso", "cubso_desc", "unspsc", "unspsc_desc", "descripcion",
                  "cantidad", "unidad", "total"]

COLUMNAS_PROCESOS = ["ocid", "ano", "comprador_id", "comprador_ruc", "comprador", "comprador_dep", "comprador_prov",
                     "comprador_loc", "titulo", "objeto", "metodo", "categoria", "valor", "publicado", "cierre", "estado",
                     "postores", "cui", "docs", "ganador", "ganador_ruc", "monto_adjudicado", "adjudicado"]
# the bidding documents a reader wants first, by SEACE title
_DOCS_PROCESO = ("bases integradas", "bases administrativas", "resumen ejecutivo", "otorgamiento", "absoluci")

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


def _item(it: dict, tv: dict, i: int) -> dict:
    """A line of what was bought: catalogue codes (CUBSO, whose first 8 digits are the UNSPSC
    commodity), the line as the entity wrote it, quantity, unit and amount in soles."""
    cl = it.get("classification") or {}
    un = next((a for a in it.get("additionalClassifications") or [] if a.get("scheme") == "UNSPSC"), {})
    cubso = cl.get("id") if cl.get("scheme") == "CUBSO" else None
    return {"pos": str(it.get("position") or i), "cubso": cubso, "cubso_desc": cl.get("description"),
            "unspsc": un.get("id") or (cubso[:8] if cubso else None), "unspsc_desc": un.get("description"),
            "descripcion": " ".join((it.get("description") or "").split())[:300] or None,
            "cantidad": it.get("quantity"), "unidad": (it.get("unit") or {}).get("name"),
            "total": _monto_pen(it.get("totalValue") or {}, tv)}


def _proceso(r: dict, buyer: dict, ruc: str | None, dire: dict) -> dict:
    """A procedure with no signed contract yet: what is being bought, by when, for how much, its state
    (SEACE's, as its items carry it: CONVOCADO, ADJUDICADO, CONSENTIDO, DESIERTO, NULO...), the
    bidding documents and, once awarded, to whom."""
    t = r.get("tender") or {}
    estados: dict[str, int] = {}
    for it in t.get("items") or []:
        if it.get("statusDetails"):
            estados[it["statusDetails"]] = estados.get(it["statusDetails"], 0) + 1
    docs = [d for d in t.get("documents") or [] if d.get("url")]
    docs.sort(key=lambda d: next((i for i, k in enumerate(_DOCS_PROCESO) if k in (d.get("title") or "").lower()), 99))
    premios = r.get("awards") or []
    ganadores = [s for a in premios for s in a.get("suppliers") or []]
    publicado = (t.get("datePublished") or "")[:10] or None
    cui = str(((r.get("planning") or {}).get("budget") or {}).get("projectID") or "")
    adj = [_monto_pen(a.get("value") or {}, t.get("value") or {}) for a in premios]
    estado = max(estados, key=estados.get) if estados else None
    # SEACE sometimes leaves the items "CONVOCADO" while publishing the report that declares it deserted
    if not premios and any(re.search(r"declarator\w* de(l)? desiert", d.get("title") or "", re.I) for d in t.get("documents") or []):
        estado = "DESIERTO"
    return {
        "ocid": r.get("ocid"), "ano": int(publicado[:4]) if publicado else None,
        "comprador_id": buyer.get("id"), "comprador_ruc": ruc, "comprador": buyer.get("name"),
        "comprador_dep": dire.get("department"), "comprador_prov": dire.get("region"), "comprador_loc": dire.get("locality"),
        "titulo": t.get("title"), "objeto": (t.get("description") or t.get("title") or "").strip(),
        "metodo": t.get("procurementMethodDetails"), "categoria": t.get("mainProcurementCategory"),
        "valor": _monto_pen(t.get("value") or {}, t.get("value") or {}) or None, "publicado": publicado,
        "cierre": ((t.get("tenderPeriod") or {}).get("endDate") or "")[:16] or None,
        "estado": estado, "postores": t.get("numberOfTenderers"),
        "cui": ",".join(re.findall(r"\d{7}", cui)) or None,
        "docs": json.dumps([[d.get("title") or "Documento", d["url"]] for d in docs[:4]], ensure_ascii=False) if docs else None,
        "ganador": " / ".join(s.get("name") or "" for s in ganadores) or None,
        "ganador_ruc": (ganadores[0].get("id") or "").replace("PE-RUC-", "") if ganadores else None,
        "monto_adjudicado": sum(a for a in adj if a) or None,
        "adjudicado": min(((a.get("date") or "")[:10] for a in premios if a.get("date")), default=None),
    }


def filas(path: Path, procesos: list | None = None):
    """One row per signed contract of an OCDS JSONL file (compiled releases), with its lines of
    what was bought under "_items" (the contract's own, else its award's, else the tender's).
    Procedures with no contract yet go to `procesos`, when given."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for linea in f:
            r = json.loads(linea)
            r = r.get("compiledRelease", r)
            contratos = r.get("contracts") or []
            if not contratos and procesos is None:
                continue
            buyer = r.get("buyer") or {}
            parte = next((p for p in r.get("parties") or [] if p.get("id") == buyer.get("id")), {})
            ruc = next((i.get("id") for i in parte.get("additionalIdentifiers") or [] if i.get("scheme") == "PE-RUC"), None)
            dire = parte.get("address") or {}
            if not contratos:
                procesos.append(_proceso(r, buyer, ruc, dire))
                continue
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
                lineas = c.get("items") or (premios.get(c.get("awardID")) or {}).get("items") or t.get("items") or []
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
                    "_items": [_item(it, t.get("value") or {}, i) for i, it in enumerate(lineas, 1)],
                }


def actualizar(anos: list[int], forzar: bool = False) -> list[Path]:
    """Refresh lake/contratos/<ano>.parquet and lake/contratos_items/<ano>.parquet for each year, at
    most every CADENCIA_DIAS. Returns the lake files written (to push to Hugging Face)."""
    import pandas as pd
    CARPETA.mkdir(parents=True, exist_ok=True)
    CARPETA_ITEMS.mkdir(parents=True, exist_ok=True)
    CARPETA_PROCESOS.mkdir(parents=True, exist_ok=True)
    meta = _metadatos()
    escritos = []
    for ano in anos:
        info = meta.get(str(ano)) or {}
        dias = (time.time() - info.get("descargado_ts", 0)) / 86400
        destino, destino_items = CARPETA / f"{ano}.parquet", CARPETA_ITEMS / f"{ano}.parquet"
        destino_procesos = CARPETA_PROCESOS / f"{ano}.parquet"
        if not forzar and destino.exists() and destino_items.exists() and destino_procesos.exists() and dias < CADENCIA_DIAS:
            print(f"  contratos {ano}: al día (descargado hace {dias:.1f} días)")
            continue
        print(f"  contratos {ano}: descargando {FUENTE.format(ano=ano)}", flush=True)
        origen = descargar(ano)
        en_proceso: list[dict] = []
        contratos = list(filas(origen, en_proceso))
        df = pd.DataFrame(contratos, columns=COLUMNAS)
        procesos = pd.DataFrame(en_proceso, columns=COLUMNAS_PROCESOS)
        items = pd.DataFrame([dict(it, ocid=c["ocid"], contrato_id=c["contrato_id"]) for c in contratos for it in c["_items"]],
                             columns=COLUMNAS_ITEMS)
        con = duckdb.connect()
        con.register("df", df)
        con.register("items", items)
        con.register("procesos", procesos)
        con.execute(f"COPY (SELECT * FROM procesos ORDER BY comprador_id, publicado) TO '{destino_procesos}' (FORMAT parquet, COMPRESSION zstd)")
        con.execute(f"COPY (SELECT * FROM df ORDER BY comprador_id, fecha) TO '{destino}' (FORMAT parquet, COMPRESSION zstd)")
        con.execute(f"COPY (SELECT * FROM items ORDER BY ocid, contrato_id) TO '{destino_items}' (FORMAT parquet, COMPRESSION zstd)")
        meta[str(ano)] = {"descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                          "descargado_ts": time.time(), "contratos": len(df), "items": len(items), "procesos": len(procesos),
                          "fuente": FUENTE.format(ano=ano)}
        print(f"  contratos {ano}: {len(df):,} contratos, {len(items):,} líneas -> {destino.name} "
              f"({(destino.stat().st_size + destino_items.stat().st_size) / 1e6:.1f} MB)")
        origen.unlink(missing_ok=True)
        escritos += [destino, destino_items, destino_procesos]
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


# --- serving: contracts per executing unit and per supplier -------------------------------

# competitive procedures, direct awards (no competition) and special regimes (agreements between
# public entities, international organisations): "a single bidder" only means something for the first
VIA = """CASE WHEN regexp_matches(coalesce(metodo, ''), '^(Contratación Directa|Exoneración)') THEN 'directo'
              WHEN regexp_matches(coalesce(metodo, ''), '^(Convenio|Reg[ií]men Especial|Contratación Internacional|Contratos Estandarizados|Adjudicación para Contrato Marco)') THEN 'especial'
              ELSE 'competitivo' END"""
_CATEGORIA = {"works": "o", "goods": "b", "services": "s"}
LARGO_OBJETO = 300
ITEMS_POR_CONTRATO = 3         # lines of what was bought shown per contract; the rest are counted
TOP_CONTRATOS_PROVEEDOR = 300  # per supplier page, by amount
INDICE_PROVEEDORES = 12000     # suppliers searchable by name, by amount; any other one by its RUC
PRODUCTO_MIN_COMPRAS = 5       # a catalogue item gets its page with this many priced purchases (same unit)...
PRODUCTO_MIN_COMPRADORES = 2   # ...by this many buyers
TOP_COMPRAS_PRODUCTO = 120     # purchases listed on a product's page, the most recent first
CLAS = ("TIPO_TRANSACCION || '.' || GENERICA || '.' || SUBGENERICA || '.' || SUBGENERICA_DET || '.' "
        "|| ESPECIFICA || '.' || ESPECIFICA_DET")


def texto_objeto(s: str | None, lugares=None, largo: int = LARGO_OBJETO) -> str:
    """A contract's object as SEACE wrote it, minus encoding damage (curly quotes arrive as "¿";
    the real "¿...?" always closes with "?") and, when written in capitals, readable like the
    budget's names: "Mejoramiento de la vía ... distrito de Ollantaytambo"."""
    t = " ".join((s or "").split())
    if "¿" in t and "?" not in t:
        t = t.replace("¿", '"')
    t = con_lugares(t, lugares) if lugares else t
    return t if len(t) <= largo else t[:largo - 1].rstrip() + "…"


def tipo_proveedor(id_: str) -> str:
    """RUC 10/15/17: a person with a business; 20: a company; SEACE's own code: a consortium."""
    if re.fullmatch(r"\d{11}", id_ or ""):
        return "persona" if id_[:2] in ("10", "15", "17") else "empresa"
    return "consorcio"


def _hay(con, nombre: str) -> bool:
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [nombre]).fetchone()[0])


def _gastos(con) -> None:
    """_gasto (ocid, contrato_id, gasto): the budget expense type a contract corresponds to, by what
    it buys: the catalogue code of its largest line (etiquetas/bienes_gasto.csv, the longest prefix
    wins). A project's contracts (CUI) are investment: the table's own column for them and, when it
    only says "construction", the line the project itself budgets (road, school, water...).
    The line matches how it is bought: a works contract the project's "por contrata" line, goods
    its "bienes" line, services its "servicios" one (obras por administración directa).
    A correspondence, not a record: SEACE does not say which budget line pays a contract."""
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _reglas AS SELECT prefijo, clasificador, nullif(clasificador_obra, '') AS obra
                    FROM read_csv('{BIENES_GASTO}', header = true, all_varchar = true)""")
    con.execute("""CREATE OR REPLACE TEMP TABLE _cg AS
        SELECT ocid, contrato_id, base, obra FROM (
            SELECT i.ocid, i.contrato_id, i.pos, i.total, r.clasificador AS base, r.obra,
                   row_number() OVER (PARTITION BY i.ocid, i.contrato_id, i.pos ORDER BY length(r.prefijo) DESC) AS rk
            FROM _it i JOIN _reglas r ON starts_with(i.unspsc, r.prefijo))
        WHERE rk = 1
        QUALIFY row_number() OVER (PARTITION BY ocid, contrato_id ORDER BY total DESC NULLS LAST, pos) = 1""")
    estudio = "(g.base LIKE '2.3.2.7%' OR g.obra LIKE '2.6.8%')"
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _gasto0 AS
        SELECT c.ocid, c.contrato_id, coalesce(
            CASE WHEN c.cui IS NULL THEN g.base
                 WHEN {estudio} AND regexp_matches(upper(c.objeto), 'EXPEDIENTE') THEN '2.6.8.1.3.1'
                 WHEN {estudio} AND regexp_matches(upper(c.objeto), 'PRE ?-?INVERSI|PERFIL|FICHA T[EÉ]CNICA') THEN '2.6.8.1.2.1'
                 ELSE coalesce(g.obra, CASE WHEN g.base LIKE '2.6%' THEN g.base WHEN g.base LIKE '2.3.1%' THEN '2.6.8.1.4.2'
                                            WHEN g.base LIKE '2.3.2%' THEN '2.6.8.1.4.3' END) END,
            CASE WHEN c.categoria = 'works' THEN CASE WHEN c.cui IS NULL THEN '2.3.2.4' ELSE '2.6.2' END END) AS gasto
        FROM _todos c LEFT JOIN _cg g USING (ocid, contrato_id)""")
    if not _hay(con, "gasto_wide"):
        con.execute("CREATE OR REPLACE TEMP TABLE _gasto1 AS SELECT * FROM _gasto0")
        _por_texto(con)
        return
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _plin AS
        SELECT PRODUCTO_PROYECTO AS cui, {CLAS} AS clas, any_value(ESPECIFICA_DET_NOMBRE) AS nombre,
               sum(CAST(MONTO_PIM AS DOUBLE)) AS pim
        FROM gasto_wide WHERE ANO_EJE = (SELECT max(ANO_EJE) FROM gasto_wide) AND {ES_PROYECTO} AND GENERICA = '6'
        GROUP BY 1, 2""")
    con.execute("""CREATE OR REPLACE TEMP TABLE _gasto1 AS
        SELECT g.ocid, g.contrato_id, coalesce(b.clas, g.gasto) AS gasto FROM _gasto0 g LEFT JOIN (
            SELECT g.ocid, g.contrato_id, p.clas FROM _gasto0 g JOIN _todos c USING (ocid, contrato_id)
            JOIN _plin p ON p.cui = split_part(c.cui, ',', 1) AND (starts_with(p.clas, g.gasto || '.')
                 -- no line of that branch: goods and services go where the project budgets its purchases
                 OR (c.categoria = 'goods' AND p.nombre LIKE '%BIENES%') OR (c.categoria = 'services' AND p.nombre LIKE '%SERVICIOS%'))
            WHERE g.gasto LIKE '2.6%' AND length(g.gasto) - length(replace(g.gasto, '.', '')) < 5
            QUALIFY row_number() OVER (PARTITION BY g.ocid, g.contrato_id ORDER BY starts_with(p.clas, g.gasto || '.') DESC,
                        p.nombre LIKE CASE c.categoria WHEN 'goods' THEN '%BIENES%' WHEN 'services' THEN '%SERVICIOS%'
                                                       ELSE '%CONTRATA%' END DESC, p.pim DESC, p.clas) = 1
        ) b USING (ocid, contrato_id)""")
    _por_texto(con)


# what a contract builds or maintains, from its own words, when neither its catalogue code nor its
# project's budget lines say it: [(within, code, pattern on the object)], the first match wins
_OBRA_POR_TEXTO = [
    ("2.6.2", "2.6.2.3.2", r"CARRETER|VIAL|TRANSITABILIDAD|MOVILIDAD|PISTA|VEREDA|PUENTE|CAMINO|TROCHA|PAVIMENT|AVENIDA|AV\. |CALLE|JIR[OÓ]N|JR\. "),
    ("2.6.2", "2.6.2.3.5", r"AGUA POTABLE|SANEAMIENTO|ALCANTARILLADO|DESAG|AGUAS RESIDUALES"),
    ("2.6.2", "2.6.2.3.4", r"RIEGO|IRRIGACI|CANAL|REPRESA|RESERVORIO|QOCHA"),
    ("2.6.2", "2.6.2.3.3", r"ELECTRIFICACI|ELECTRIC|ALUMBRADO"),
    ("2.6.2", "2.6.2.3.6", r"PARQUE|PLAZA|ESPACIOS? P[UÚ]BLICOS?|[AÁ]REAS? VERDES?|ALAMEDA"),
    ("2.6.2", "2.6.2.2.2", r"EDUCATIV|COLEGIO|ESCUELA|I\.E\.|INICIAL|PRIMARIA|SECUNDARIA"),
    ("2.6.2", "2.6.2.2.3", r"SALUD|HOSPITAL|POSTA|CL[IÍ]NICA"),
    ("2.6.2", "2.6.2.2.4", r"DEPORTIV|LOSA|COLISEO|ESTADIO|CULTURAL|COMUNAL|MERCADO|BIBLIOTECA"),
    ("2.3.2.4", "2.3.2.4.3.1", r"CARRETER|VIAL|TRANSITABILIDAD|MOVILIDAD|PISTA|VEREDA|PUENTE|CAMINO|TROCHA"),
    ("2.3.2.4", "2.3.2.4.2.1", r"LOCAL|EDIFICI|OFICINA|INSTITUCI|INSTALACI|INFRAESTRUCTURA"),
]


def _por_texto(con) -> None:
    """_gasto: _gasto1 with the broad construction and maintenance types narrowed by the object's
    words ("MEJORAMIENTO DE LA CARRETERA..." is road infrastructure), never outside their branch."""
    casos = " ".join(f"WHEN g.gasto IN ('{dentro}', '{'.'.join(cod.split('.')[:4])}') AND regexp_matches(upper(c.objeto), '{patron}') "
                     f"AND starts_with('{cod}', g.gasto) THEN '{cod}'" for dentro, cod, patron in _OBRA_POR_TEXTO)
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _gasto AS
        SELECT g.ocid, g.contrato_id, CASE {casos} ELSE g.gasto END AS gasto
        FROM _gasto1 g JOIN _todos c USING (ocid, contrato_id)""")


# Unit prices compared across the State: the same catalogue item (16-digit CUBSO) and unit, goods
# bought by the unit (2 or more), not land, vouchers or lump sums. An item counts when at least
# PRECIO_MIN_COMPRAS purchases by PRECIO_MIN_COMPRADORES buyers exist and its usual prices are
# close together (the middle half within 3x): a generic code covering different sizes or specs
# ("DRONE", "JAULA ... APROX.") would compare apples and pears.
PRECIO_MIN_COMPRAS, PRECIO_MIN_COMPRADORES = 8, 4


def _precios(con, desde: int) -> None:
    """_precios (cubso, unidad, mediana, n): the usual unit price of each comparable item. _pp: every
    priced line of goods (quantity of 2 or more, a real unit), the base of the product pages; _prod:
    the items that get one (enough purchases by enough buyers, in their most used unit)."""
    con.execute("""CREATE OR REPLACE TEMP TABLE _pp AS
        SELECT i.ocid, i.contrato_id, i.pos, i.cubso, i.cubso_desc, i.unspsc_desc, i.descripcion, lower(i.unidad) AS unidad,
               i.cantidad, i.total, i.total / i.cantidad AS pu, c.comprador_id, c.comprador, c.proveedor_ruc, c.proveedor,
               c.fecha, c.ano, c.doc_contrato
        FROM _it i JOIN _todos c USING (ocid, contrato_id)
        WHERE c.categoria = 'goods' AND i.cubso IS NOT NULL AND i.cantidad >= 2 AND i.total > 0
          AND NOT starts_with(coalesce(i.unspsc, ''), '95')
          AND NOT regexp_matches(lower(coalesce(i.unidad, '')), 'servicio|global|lote')
          AND NOT regexp_matches(upper(coalesce(i.cubso_desc, '')), 'VALE|TARJETA|CUP[OÓ]N|BONO|TICKET')""")
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _prod AS
        SELECT cubso, unidad FROM (
            SELECT cubso, unidad, count(*) AS n, count(DISTINCT comprador_id) AS b,
                   row_number() OVER (PARTITION BY cubso ORDER BY count(*) DESC, unidad) AS k
            FROM _pp WHERE ano >= {desde} GROUP BY 1, 2)
        WHERE k = 1 AND n >= {PRODUCTO_MIN_COMPRAS} AND b >= {PRODUCTO_MIN_COMPRADORES}""")
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _lpu AS
        SELECT ocid, contrato_id, pos, cubso, unidad, pu, comprador_id FROM _pp WHERE ano >= {desde}""")
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _precios AS
        SELECT cubso, unidad, median(pu) AS mediana, count(*) AS n FROM _lpu GROUP BY 1, 2
        HAVING count(*) >= {PRECIO_MIN_COMPRAS} AND count(DISTINCT comprador_id) >= {PRECIO_MIN_COMPRADORES}
           AND quantile_cont(pu, 0.75) <= 3 * quantile_cont(pu, 0.25)""")
    # each contract's worst line: 2-10x the usual price is a signal; beyond, more likely a typo in
    # the quantity or the unit than a price (diesel "at S/ 522 a gallon")
    con.execute("""CREATE OR REPLACE TEMP TABLE _ratio AS
        SELECT l.ocid, l.contrato_id, max(l.pu / p.mediana) AS ratio
        FROM _lpu l JOIN _precios p USING (cubso, unidad) GROUP BY 1, 2""")


def _items_por_contrato(con, tabla: str, lugares) -> dict[tuple, list]:
    """(ocid, contrato_id) -> [n lines, [[line, quantity, unit, amount, usual unit price, purchases
    it comes from], ...]]: the lines of what each contract of `tabla` bought, as the entity wrote
    them (else the catalogue's name); lines priced far above the usual first, then the largest."""
    out: dict[tuple, list] = {}
    for ocid, cid, desc, cat_desc, cant, unidad, total, mediana, n_precio, producto, n in con.execute(f"""
            SELECT i.ocid, i.contrato_id, i.descripcion, i.cubso_desc, i.cantidad, i.unidad, i.total,
                   CASE WHEN l.pu IS NOT NULL THEN p.mediana END, CASE WHEN l.pu IS NOT NULL THEN p.n END,
                   d.cubso, count(*) OVER (PARTITION BY i.ocid, i.contrato_id) AS n
            FROM _it i JOIN (SELECT DISTINCT ocid, contrato_id FROM {tabla}) k USING (ocid, contrato_id)
            LEFT JOIN _lpu l ON l.ocid = i.ocid AND l.contrato_id = i.contrato_id AND l.pos = i.pos
            LEFT JOIN _precios p ON p.cubso = l.cubso AND p.unidad = l.unidad
            LEFT JOIN (SELECT DISTINCT cubso FROM _prod) d ON d.cubso = i.cubso
            QUALIFY row_number() OVER (PARTITION BY i.ocid, i.contrato_id
                                       ORDER BY coalesce(l.pu / p.mediana >= 2, false) DESC, i.total DESC NULLS LAST, i.pos)
                    <= {ITEMS_POR_CONTRATO}""").fetchall():
        lst = out.setdefault((ocid, cid), [])
        lst.append([texto_objeto(desc or cat_desc, lugares, 160) or None, cant, unidad, total,
                    round(mediana, 2) if mediana else None, n_precio, *([producto] if producto else [])])
        if len(lst) == 1:
            lst.insert(0, n)  # first element: how many lines in all
    return {k: [v[0], v[1:]] for k, v in out.items()}


def _nombres_gasto(con, codigos: set[str]) -> dict[str, list]:
    """[name, context] of each expense type code the contracts use, at any level (2.3.1 ... 2.3.1.6.1.1):
    the context is the closest broader level with a different name ("De vehículos" in maintenance,
    rentals or spare parts)."""
    if not _hay(con, "gasto_wide"):
        return {}
    nombre: dict[str, str] = {}
    for fila in con.execute("""SELECT DISTINCT TIPO_TRANSACCION, GENERICA, SUBGENERICA, SUBGENERICA_DET, ESPECIFICA,
                                      ESPECIFICA_DET, GENERICA_NOMBRE, SUBGENERICA_NOMBRE, SUBGENERICA_DET_NOMBRE,
                                      ESPECIFICA_NOMBRE, ESPECIFICA_DET_NOMBRE
                               FROM gasto_wide WHERE GENERICA IN ('3', '6')""").fetchall():
        for k in range(2, 7):
            nombre.setdefault(".".join(fila[:k]), fila[4 + k])
    out = {}
    for c in codigos:
        partes = c.split(".")
        for k in range(3, len(partes) + 1):  # the code and its broader levels (summaries group by them)
            cod = ".".join(partes[:k])
            if cod in out or cod not in nombre:
                continue
            propio = (nombre[cod] or "").strip()
            ctx = next((nombre[".".join(partes[:j])] for j in range(k - 1, 2, -1)
                        if (nombre.get(".".join(partes[:j])) or "").strip().upper() not in ("", propio.upper())), None)
            out[cod] = [texto(propio), texto(ctx) if ctx else None]
    return out


def _grupo(gasto: str | None) -> str | None:
    """The 4-level group of an expense type (2.3.2.4: maintenance), what summaries add up by."""
    return ".".join(gasto.split(".")[:4]) if gasto else None


def exportar(con, out: Path) -> tuple[dict, dict]:
    """json/contratos/<sec>.json per executing unit, json/proveedor/<id>.json per supplier, the
    supplier index and the names of the expense types. Returns ({sec: summary}, {(sec, cui):
    [contracts, amount]}) for the entity files; empty when the lake has no contracts."""
    archivos = sorted(CARPETA.glob("*.parquet"))
    carpeta, carpeta_prov = out / "contratos", out / "proveedor"
    for viejo in [*carpeta.glob("*.json"), *carpeta_prov.glob("*.json"), *(out / "proveedores").glob("*.json"),
                  *(out / "producto").glob("*.json"), *(out / "productos").glob("*.json")]:
        viejo.unlink()  # derived output: a unit or supplier that lost its contracts must not keep a stale file
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
    items = sorted(CARPETA_ITEMS.glob("*.parquet"))
    if items:
        con.execute(f"""CREATE OR REPLACE TEMP TABLE _it AS SELECT i.* FROM read_parquet([{", ".join(f"'{a}'" for a in items)}]) i
                        JOIN (SELECT DISTINCT ocid, contrato_id FROM _todos) k USING (ocid, contrato_id)""")
    else:
        con.execute("""CREATE OR REPLACE TEMP TABLE _it (ocid VARCHAR, contrato_id VARCHAR, pos VARCHAR, cubso VARCHAR,
                       cubso_desc VARCHAR, unspsc VARCHAR, unspsc_desc VARCHAR, descripcion VARCHAR, cantidad DOUBLE,
                       unidad VARCHAR, total DOUBLE)""")
    _gastos(con)
    _precios(con, ano - 1)
    _cargar_procesos(con, ano)
    # buyers that so far only ran procedures are linked too: what they are buying now shows on their page
    con.execute("""CREATE OR REPLACE TEMP VIEW _cb AS
        SELECT comprador_id, comprador, comprador_dep, comprador_loc, comprador_prov, fecha, cui FROM _todos
        UNION ALL SELECT comprador_id, comprador, comprador_dep, comprador_loc, comprador_prov, publicado, cui FROM _procesos""")
    enlace = enlazar(con, "_cb")
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
    con.execute("""CREATE OR REPLACE TEMP TABLE _ct AS
        WITH k AS (SELECT ocid, contrato_id, sec_ejec, bool_or(propio) AS propio FROM (
                     SELECT ocid, contrato_id, sec_ejec, true AS propio FROM _todos JOIN _enl USING (comprador_id)
                     UNION ALL SELECT ocid, contrato_id, sec_ejec, false FROM _cx) GROUP BY ocid, contrato_id, sec_ejec)
        SELECT k.sec_ejec, k.propio, c.*, g.gasto, r.ratio FROM k JOIN _todos c USING (ocid, contrato_id)
        LEFT JOIN _gasto g USING (ocid, contrato_id) LEFT JOIN _ratio r USING (ocid, contrato_id)""")
    con.execute(f"CREATE OR REPLACE TEMP VIEW _cs AS SELECT * FROM _ct WHERE ano >= {ano - 1}")  # the summary's period
    lugares = lugares_conocidos(con)

    resumen = {}
    for (sec, n, monto, extra, proveedores, comp, un_postor, directo, resueltos, intervenidos, nulos, adicionales,
         de_otros, monto_otros, desde, hasta, o, b, s_, caros) in con.execute("""
        SELECT sec_ejec, count(*), sum(monto), sum(greatest(coalesce(monto_final, monto) - monto, 0)),
               count(DISTINCT proveedor_ruc), count(*) FILTER (via = 'competitivo' AND postores IS NOT NULL),
               count(*) FILTER (via = 'competitivo' AND postores = 1), sum(monto) FILTER (via = 'directo'),
               count(*) FILTER (eventos LIKE '%resolucion%'), count(*) FILTER (eventos LIKE '%intervencion%'),
               count(*) FILTER (eventos LIKE '%nulidad%'),
               count(*) FILTER (eventos LIKE '%adicional%' OR monto_final > monto * 1.005),
               count(*) FILTER (NOT propio), sum(monto) FILTER (NOT propio), min(fecha), max(fecha),
               sum(monto) FILTER (categoria = 'works'), sum(monto) FILTER (categoria = 'goods'),
               sum(monto) FILTER (categoria = 'services'), count(*) FILTER (ratio BETWEEN 2 AND 10)
        FROM _cs GROUP BY sec_ejec""").fetchall():
        resumen[sec] = {"n": n, "monto": monto, "extra": extra or None, "proveedores": proveedores, "precio_alto": caros,
                        "competitivos": comp, "un_postor": un_postor, "directo": directo, "resueltos": resueltos,
                        "intervenidos": intervenidos, "nulos": nulos, "con_adicionales": adicionales,
                        "de_otros": de_otros, "monto_otros": monto_otros, "desde": str(desde), "hasta": str(hasta),
                        "por_tipo": {"o": o, "b": b, "s": s_}, "top": [], "por_gasto": []}
    for sec, ruc, nombre, n, monto in con.execute("""
        SELECT sec_ejec, proveedor_ruc, arg_max(proveedor, monto), count(*), sum(monto) FROM _cs
        WHERE proveedor_ruc IS NOT NULL AND proveedor_ruc <> '' GROUP BY sec_ejec, proveedor_ruc
        QUALIFY row_number() OVER (PARTITION BY sec_ejec ORDER BY sum(monto) DESC NULLS LAST, proveedor_ruc) <= 10
        ORDER BY sec_ejec, sum(monto) DESC NULLS LAST""").fetchall():
        resumen[sec]["top"].append([ruc, nombre, n, monto])
    # what the contracts buy, by the budget's expense groups (maintenance, fuel, construction...)
    for sec, grupo, n, monto in con.execute("""
        SELECT sec_ejec, array_to_string(string_split(gasto, '.')[1:4], '.') AS grupo, count(*), sum(monto) FROM _cs
        WHERE gasto IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 4 DESC NULLS LAST""").fetchall():
        resumen[sec]["por_gasto"].append([grupo, n, monto])
    proc_resumen, proc_filas = _procesos_por_unidad(con, hoy)
    for sec, r in proc_resumen.items():
        resumen.setdefault(sec, {"n": 0, "monto": None, "top": [], "por_gasto": [], "desde": None, "hasta": None})["procesos"] = r
    por_obra = {(sec, cui): [n, monto] for sec, cui, n, monto in con.execute(
        "SELECT x.sec_ejec, x.cui, count(*), sum(c.monto) FROM _cx x JOIN _todos c USING (ocid, contrato_id) GROUP BY 1, 2").fetchall()}

    # the file: the period's largest contracts and every one tied to the unit's projects (any year:
    # who builds each obra); the rest is in the summary and in the Hugging Face dataset
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _fe AS
        SELECT * FROM (
            SELECT c.sec_ejec, c.fecha, c.objeto, c.proveedor, c.proveedor_ruc, c.monto, c.monto_final, c.metodo,
                   c.categoria, c.postores, c.cui, c.doc_contrato, c.eventos, c.comprador, c.comprador_ruc, e.como,
                   c.gasto, c.ocid, c.contrato_id,
                   row_number() OVER (PARTITION BY c.sec_ejec ORDER BY (c.ano >= {ano - 1}) DESC, c.monto DESC NULLS LAST,
                                      c.fecha DESC, c.ocid, c.contrato_id) AS k,
                   c.ano >= {ano - 1} AS en_periodo,
                   EXISTS (SELECT 1 FROM _cx x WHERE x.ocid = c.ocid AND x.contrato_id = c.contrato_id
                                                AND x.sec_ejec = c.sec_ejec) AS de_obra
            FROM _ct c LEFT JOIN _enl e ON e.comprador_id = c.comprador_id AND e.sec_ejec = c.sec_ejec)
        WHERE (en_periodo AND k <= {TOP_CONTRATOS}) OR de_obra""")
    lineas = _items_por_contrato(con, "_fe", lugares)
    por_sec: dict[str, list] = {}
    for f in con.execute("SELECT * EXCLUDE (k, en_periodo, de_obra) FROM _fe ORDER BY sec_ejec, k").fetchall():
        por_sec.setdefault(f[0], []).append(f)
    carpeta.mkdir(parents=True, exist_ok=True)
    usados: set[str] = set()
    for sec in sorted(set(por_sec) | set(proc_filas)):
        rows = por_sec.get(sec, [])
        if sec not in resumen:  # only older contracts, for its projects: no summary for the period
            resumen[sec] = {"n": 0, "monto": None, "top": [], "por_gasto": [], "desde": None, "hasta": None}
        prov, metodos, comp = {}, {}, {}
        c = []
        for (_, fecha, objeto, proveedor, ruc, monto, final, metodo, categoria, postores, cui, doc, eventos,
             comprador, comprador_ruc, como, gasto, ocid, cid) in rows:
            p = prov.setdefault((ruc or "", proveedor or ""), len(prov)) if (ruc or proveedor) else None
            m = metodos.setdefault(metodo or "", len(metodos))
            b = comp.setdefault((comprador or "", comprador_ruc or "", como), len(comp))
            usados.add(gasto) if gasto else None
            c.append([str(fecha), texto_objeto(objeto, lugares), p, monto,
                      final if final is not None and monto and abs(final - monto) > 0.005 * monto else None,
                      m, _CATEGORIA.get(categoria), postores, cui, doc, eventos, b, gasto, lineas.get((ocid, cid))])
        # procedures under way: [published, closes, object, method, category, reference value, state,
        # participants, CUI, documents [[title, url]], winner, winner's RUC, amount awarded]
        a = [[pub, cierre, texto_objeto(objeto, lugares), metodos.setdefault(metodo or "", len(metodos)),
              _CATEGORIA.get(categoria), valor, estado, postores, cui, json.loads(docs) if docs else None, ganador, ganador_ruc,
              adjudicado] for pub, cierre, objeto, metodo, categoria, valor, estado, postores, cui, docs, ganador, ganador_ruc,
                                adjudicado in proc_filas.get(sec, [])]
        r = dict(resumen[sec], mostrados=sum(1 for x in c if x[0] >= f"{ano - 1}"), desde_ano=ano - 1)
        datos = {"r": r, "p": [list(k) for k in prov], "m": list(metodos),
                 "b": [[con_lugares(n, lugares), ruc, como] for n, ruc, como in comp], "c": c, "a": a}
        (carpeta / f"{sec}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":"), default=str))
    n_prov = _proveedores(con, out, lugares, ano, usados)
    n_prod = _productos(con, out, lugares, ano - 1)
    usados |= {g for r in resumen.values() for g, *_ in r.get("por_gasto", [])}
    (carpeta / "gastos.json").write_text(json.dumps(_nombres_gasto(con, usados), ensure_ascii=False, separators=(",", ":")))
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
        "con_tipo_de_gasto": con.execute("SELECT count(*) FROM _c JOIN _gasto g USING (ocid, contrato_id) WHERE g.gasto IS NOT NULL").fetchone()[0],
        "precios_comparables": con.execute("SELECT count(*) FROM _precios").fetchone()[0],
        "precio_alto": con.execute("SELECT count(*) FROM _c JOIN _ratio USING (ocid, contrato_id) WHERE ratio BETWEEN 2 AND 10").fetchone()[0],
        "proveedores": n_prov, "productos": n_prod,
    }, ensure_ascii=False))
    print(f"  json: contratos/*.json ({len(por_sec)} units, {sum(len(v) for v in por_sec.values()):,} contracts shown), "
          f"proveedor/*.json ({n_prov:,} suppliers), producto/*.json ({n_prod:,} items)")
    return {sec: dict(r, top=r["top"][:5]) for sec, r in resumen.items()}, por_obra


def _proveedores(con, out: Path, lugares, ano: int, usados: set[str]) -> int:
    """proveedor/<id>.json: everything a supplier signed with the State in the period, with which
    units, of which expense types; proveedores/indice.json: the largest ones, for the search box."""
    carpeta = out / "proveedor"
    carpeta.mkdir(parents=True, exist_ok=True)
    nombres = dict(con.execute("""SELECT proveedor_ruc, arg_max(proveedor, fecha) FROM _c
                                  WHERE proveedor_ruc <> '' GROUP BY 1""").fetchall())
    ent = dict(con.execute("SELECT sec_ejec, any_value(nombre) FROM dim_entidad GROUP BY 1").fetchall())
    con.execute("""CREATE OR REPLACE TEMP TABLE _cp AS
        SELECT c.*, e.sec_ejec, g.gasto, r.ratio FROM _c c LEFT JOIN _enl e USING (comprador_id)
        LEFT JOIN _gasto g USING (ocid, contrato_id) LEFT JOIN _ratio r USING (ocid, contrato_id)
        WHERE c.proveedor_ruc IS NOT NULL AND c.proveedor_ruc <> ''""")
    lineas = _items_por_contrato(con, "_cp", lugares)
    indice = []
    filas_ = con.execute("""SELECT proveedor_ruc, fecha, objeto, monto, monto_final, metodo, categoria, postores, cui,
                                   doc_contrato, eventos, gasto, sec_ejec, comprador, via, ocid, contrato_id, ratio
                            FROM _cp ORDER BY proveedor_ruc, monto DESC NULLS LAST, fecha DESC, ocid, contrato_id""").fetchall()
    grupo: list = []
    for k, fila in enumerate(filas_ + [None]):
        if grupo and (fila is None or fila[0] != grupo[0][0]):
            id_ = grupo[0][0]
            if re.fullmatch(r"[0-9A-Za-z-]{1,40}", id_):
                indice.append(_archivo_proveedor(carpeta, id_, nombres.get(id_), grupo, ent, lineas, lugares, ano, usados))
            grupo = []
        if fila is not None:
            grupo.append(fila)
    indice.sort(key=lambda x: -(x[3] or 0))
    (out / "proveedores").mkdir(parents=True, exist_ok=True)
    (out / "proveedores" / "indice.json").write_text(json.dumps(
        {"total": len(indice), "desde_ano": ano - 1, "p": indice[:INDICE_PROVEEDORES]},
        ensure_ascii=False, separators=(",", ":")))
    return len(indice)


EN_CURSO = ("CONVOCADO", "ADJUDICADO", "CONSENTIDO", "APELADO", "SUSPENDIDO", "RETROTRAIDO_POR_RESOLUCION")
TOP_PROCESOS = 40              # procedures under way per unit on the site


def _cargar_procesos(con, ano: int) -> None:
    """_procesos: the site's years' procedures with no signed contract, each once (its latest record)."""
    archivos = sorted(CARPETA_PROCESOS.glob("*.parquet"))
    if not archivos:
        con.execute(f"CREATE OR REPLACE TEMP TABLE _procesos ({', '.join(f'{c} VARCHAR' for c in COLUMNAS_PROCESOS)})")
        con.execute("ALTER TABLE _procesos ALTER valor TYPE DOUBLE; ALTER TABLE _procesos ALTER monto_adjudicado TYPE DOUBLE")
        return
    lista = ", ".join(f"'{a}'" for a in archivos)
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _procesos AS
        SELECT * EXCLUDE (filename) FROM (
            SELECT DISTINCT ON (ocid) * FROM read_parquet([{lista}], union_by_name = true, filename = true)
            ORDER BY ocid, filename DESC)
        WHERE try_cast(ano AS INTEGER) BETWEEN {ano - 1} AND {ano}
          AND ocid NOT IN (SELECT ocid FROM _todos)""")  # signed since: it is a contract now


def _procesos_por_unidad(con, hoy: str) -> tuple[dict, dict]:
    """Per unit: counts of its procedures with no contract in the period (under way, awarded and not
    signed, deserted, annulled, cancelled) and the rows of those under way, the latest first."""
    hace_un_ano = str(int(hoy[:4]) - 1) + hoy[4:]
    con.execute("CREATE OR REPLACE TEMP TABLE _pe AS SELECT e.sec_ejec, p.* FROM _procesos p JOIN _enl e USING (comprador_id)")
    en_curso = ", ".join(f"'{e}'" for e in EN_CURSO)
    resumen = {}
    for sec, total, convocados, abiertos, por_firmar, valor, desiertos, nulos, cancelados in con.execute(f"""
            SELECT sec_ejec, count(*),
                   count(*) FILTER (estado = 'CONVOCADO' AND publicado >= '{hace_un_ano}'),
                   count(*) FILTER (estado = 'CONVOCADO' AND cierre >= '{hoy}'),
                   count(*) FILTER (estado IN ('ADJUDICADO', 'CONSENTIDO', 'APELADO') AND publicado >= '{hace_un_ano}'),
                   sum(valor) FILTER (estado = 'CONVOCADO' AND publicado >= '{hace_un_ano}'),
                   count(*) FILTER (estado = 'DESIERTO'), count(*) FILTER (estado = 'NULO'), count(*) FILTER (estado = 'CANCELADO')
            FROM _pe GROUP BY 1""").fetchall():
        resumen[sec] = {"total": total, "convocados": convocados, "abiertos": abiertos, "por_firmar": por_firmar, "valor_convocado": valor,
                        "desiertos": desiertos, "nulos": nulos, "cancelados": cancelados}
    filas_: dict[str, list] = {}
    for sec, *f in con.execute(f"""
            SELECT sec_ejec, publicado, cierre, objeto, metodo, categoria, valor, estado, postores, cui, docs, ganador,
                   ganador_ruc, monto_adjudicado FROM _pe
            WHERE publicado >= '{hace_un_ano}' AND estado IN ({en_curso})
            QUALIFY row_number() OVER (PARTITION BY sec_ejec ORDER BY publicado DESC, ocid) <= {TOP_PROCESOS}
            ORDER BY sec_ejec, publicado DESC, ocid""").fetchall():
        filas_.setdefault(sec, []).append(f)
    return resumen, filas_


PUNTOS_PRODUCTO = 400          # purchases drawn on a product's price chart, spread over the period


def _productos(con, out: Path, lugares, desde: int) -> int:
    """producto/<cubso>.json: each catalogue item the State buys often, in its most used unit, over
    the site's period (from `desde`, like the contracts): what it pays per unit over time (a sample of
    purchases spread over the period and the month's median), who sells it at what price, who buys
    it, its latest purchases; productos/indice.json: every such item, for the search box."""
    carpeta = out / "producto"
    carpeta.mkdir(parents=True, exist_ok=True)
    ent = dict(con.execute("SELECT sec_ejec, any_value(nombre) FROM dim_entidad GROUP BY 1").fetchall())
    con.execute(f"""CREATE OR REPLACE TEMP TABLE _pc AS
        SELECT p.*, e.sec_ejec FROM _pp p JOIN _prod USING (cubso, unidad) LEFT JOIN _enl e USING (comprador_id)
        WHERE p.ano >= {desde}""")
    # lowest and highest price leave out the ones off by more than 10x: a quantity or unit typed
    # wrong ("diesel at S/ 17,338 a gallon"), counted apart as "revisar"
    resumen = {cubso: r for cubso, *r in con.execute("""
        WITH m AS (SELECT cubso, median(pu) AS med FROM _pc GROUP BY 1)
        SELECT cubso, coalesce(arg_max(cubso_desc, fecha), arg_max(descripcion, fecha), cubso), any_value(unspsc_desc),
               any_value(unidad), count(*),
               count(DISTINCT comprador_id), count(DISTINCT proveedor_ruc), any_value(med), quantile_cont(pu, 0.25),
               quantile_cont(pu, 0.75), min(pu) FILTER (WHERE pu BETWEEN med / 10 AND med * 10),
               max(pu) FILTER (WHERE pu BETWEEN med / 10 AND med * 10), sum(total), sum(cantidad), min(fecha), max(fecha),
               count(*) FILTER (WHERE pu NOT BETWEEN med / 10 AND med * 10)
        FROM _pc JOIN m USING (cubso) GROUP BY 1""").fetchall()}
    comparables = {c for (c,) in con.execute("SELECT DISTINCT cubso FROM _precios").fetchall()}
    serie, vend, comp, compras = {}, {}, {}, {}
    for cubso, mes, med, n, lo, hi in con.execute("""
            SELECT cubso, left(fecha, 7), median(pu), count(*), min(pu), max(pu) FROM _pc GROUP BY 1, 2 ORDER BY 1, 2""").fetchall():
        serie.setdefault(cubso, []).append([mes, round(med, 2), n, round(lo, 2), round(hi, 2)])
    for cubso, ruc, nombre, n, med, total in con.execute("""
            SELECT cubso, proveedor_ruc, arg_max(proveedor, fecha), count(*), median(pu), sum(total) FROM _pc
            WHERE coalesce(proveedor_ruc, '') <> '' GROUP BY 1, 2
            QUALIFY row_number() OVER (PARTITION BY cubso ORDER BY count(*) DESC, sum(total) DESC, proveedor_ruc) <= 15
            ORDER BY 1, 4 DESC, 6 DESC""").fetchall():
        vend.setdefault(cubso, []).append([ruc, nombre, n, round(med, 2), round(total)])
    for cubso, sec, nombre, n, med, total in con.execute("""
            SELECT cubso, sec_ejec, arg_max(comprador, fecha), count(*), median(pu), sum(total) FROM _pc
            GROUP BY 1, 2, comprador_id
            QUALIFY row_number() OVER (PARTITION BY cubso ORDER BY count(*) DESC, sum(total) DESC, comprador_id) <= 15
            ORDER BY 1, 4 DESC, 6 DESC""").fetchall():
        comp.setdefault(cubso, []).append([sec, con_lugares(ent.get(sec) or nombre or "", lugares), n, round(med, 2), round(total)])
    for cubso, fecha, sec, comprador, ruc, proveedor, cant, pu, total, doc, desc in con.execute(f"""
            SELECT cubso, fecha, sec_ejec, comprador, proveedor_ruc, proveedor, cantidad, pu, total, doc_contrato, descripcion
            FROM _pc QUALIFY row_number() OVER (PARTITION BY cubso ORDER BY fecha DESC, total DESC, ocid, pos) <= {TOP_COMPRAS_PRODUCTO}
            ORDER BY cubso, fecha DESC, total DESC""").fetchall():
        compras.setdefault(cubso, []).append([str(fecha), sec, con_lugares(ent.get(sec) or comprador or "", lugares), ruc, proveedor,
                                              cant, round(pu, 4), round(total, 2), doc,
                                              texto_objeto(desc, lugares, 120) if desc else None])
    puntos: dict[str, list] = {}
    for cubso, fecha, pu in con.execute(f"""
            SELECT cubso, fecha, pu FROM (
                SELECT cubso, fecha, pu, row_number() OVER (PARTITION BY cubso ORDER BY fecha, ocid, pos) AS k,
                       count(*) OVER (PARTITION BY cubso) AS n FROM _pc)
            WHERE n <= {PUNTOS_PRODUCTO} OR k % ceil(n / {PUNTOS_PRODUCTO}.0)::INTEGER = 0
            ORDER BY cubso, fecha""").fetchall():
        puntos.setdefault(cubso, []).append([str(fecha), round(pu, 4)])
    indice = []
    for cubso, (nombre, unspsc, unidad, n, b, v, med, q1, q3, lo, hi, total, cant, primera, ultima, raros) in resumen.items():
        if not re.fullmatch(r"\d{8,16}", cubso or ""):
            continue
        datos = {"id": cubso, "nombre": nombre, "familia": unspsc, "unidad": unidad,
                 "r": {"n": n, "compradores": b, "proveedores": v, "mediana": round(med, 4), "q1": round(q1, 4),
                       "q3": round(q3, 4), "min": round(lo, 4), "max": round(hi, 4), "total": round(total),
                       "cantidad": cant, "desde": str(primera), "hasta": str(ultima), "comparable": cubso in comparables,
                       "revisar": raros},
                 "s": serie.get(cubso, []), "x": puntos.get(cubso, []), "v": vend.get(cubso, []), "e": comp.get(cubso, []),
                 "c": compras.get(cubso, [])}
        (carpeta / f"{cubso}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":"), default=str))
        indice.append([cubso, nombre, unidad, round(med, 2), n, round(total)])
    indice.sort(key=lambda x: (-x[4], x[0]))
    (out / "productos").mkdir(parents=True, exist_ok=True)
    (out / "productos" / "indice.json").write_text(json.dumps({"total": len(indice), "p": indice},
                                                              ensure_ascii=False, separators=(",", ":")))
    return len(indice)


def _archivo_proveedor(carpeta: Path, id_: str, nombre: str | None, filas_: list, ent: dict, lineas: dict,
                       lugares, ano: int, usados: set[str]) -> list:
    entidades: dict[tuple, list] = {}  # (sec or None, name) -> [contracts, amount]
    metodos: dict[str, int] = {}
    por_gasto: dict[str, list] = {}
    c = []
    n = monto = extra = comp = un_postor = directo = resueltos = nulos = intervenidos = adicionales = caros = 0
    fechas = []
    for (_, fecha, objeto, m_, final, metodo, categoria, postores, cui, doc, eventos, gasto, sec, comprador,
         via, ocid, cid, ratio) in filas_:
        caros += ratio is not None and 2 <= ratio <= 10
        clave = (sec, ent.get(sec) or comprador or "") if sec else (None, comprador or "")
        e = entidades.setdefault(clave, [len(entidades), 0, 0.0])
        e[1] += 1; e[2] += m_ or 0
        n += 1; monto += m_ or 0; fechas.append(str(fecha))
        if final is not None and m_ is not None and final > m_:
            extra += final - m_
        if via == "competitivo" and postores is not None:
            comp += 1; un_postor += postores == 1
        if via == "directo":
            directo += m_ or 0
        ev = eventos or ""
        resueltos += "resolucion" in ev; nulos += "nulidad" in ev; intervenidos += "intervencion" in ev
        adicionales += "adicional" in ev or (final is not None and m_ is not None and final > m_ * 1.005)
        if gasto:
            usados.add(gasto)
            g = por_gasto.setdefault(_grupo(gasto), [0, 0.0]); g[0] += 1; g[1] += m_ or 0
        if len(c) < TOP_CONTRATOS_PROVEEDOR:
            c.append([str(fecha), texto_objeto(objeto, lugares), e[0], m_,
                      final if final is not None and m_ and abs(final - m_) > 0.005 * m_ else None,
                      metodos.setdefault(metodo or "", len(metodos)), _CATEGORIA.get(categoria), postores, cui, doc,
                      eventos, gasto, lineas.get((ocid, cid))])
    lista_ent = sorted(([s, con_lugares(nom, lugares), k, a] for (s, nom), (_, k, a) in entidades.items()),
                       key=lambda x: -x[3])
    orden = {(s, nom): i for i, (s, nom, *_) in enumerate(lista_ent)}
    # contracts point at entities by their position in the (re-sorted) list
    viejo_a_nuevo = {v[0]: orden[(k[0], con_lugares(k[1], lugares))] for k, v in entidades.items()}
    for fila in c:
        fila[2] = viejo_a_nuevo[fila[2]]
    tipo = tipo_proveedor(id_)
    datos = {
        "id": id_, "nombre": nombre, "tipo": tipo, "desde_ano": ano - 1,
        "r": {"n": n, "monto": monto, "extra": extra or None, "entidades": len(entidades), "competitivos": comp,
              "un_postor": un_postor, "directo": directo or None, "resueltos": resueltos, "nulos": nulos,
              "intervenidos": intervenidos, "con_adicionales": adicionales, "precio_alto": caros,
              "desde": min(fechas), "hasta": max(fechas),
              "mostrados": len(c)},
        "e": lista_ent, "g": sorted(([k, v[0], v[1]] for k, v in por_gasto.items()), key=lambda x: -x[2]),
        "m": list(metodos), "c": c,
    }
    (carpeta / f"{id_}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":"), default=str))
    return [id_, nombre, n, monto, len(entidades), tipo]
