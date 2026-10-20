"""MEF names in readable Spanish: "GESTION DE LA EDUCACION BASICA" -> "Gestión de la educación
básica". Same rules as apps/web/lib/nombres.ts (keep them in sync): -ión and esdrújulas in -ico/-ica
take their accent, a dictionary covers the rest, acronyms stay as published."""
import re

ACRONIMOS = {'I.E.', 'RENIEC', 'OSIPTEL', 'INGEMMET', 'CUI', 'II', 'SERVIR', 'UNSAAC', 'OSINERGMIN', 'MINAGRI', 'SA', 'PRONIED', 'XV', 'SENASA', 'VIII', 'INDECI', 'VI', 'UGEL', 'XIV', 'III', 'IX', 'OSCE', 'UNMSM', 'DRE', 'XI', 'SUCAMEC', 'CONCYTEC', 'IV', 'PRONABEC', 'MINEDU', 'PIM', 'PRONIS', 'SUNAT', 'FONCODES', 'MIDIS', 'JNE', 'MIDAGRI', 'EE', 'PCM', 'MTC', 'SIS', 'MINSA', 'DEVIDA', 'SUNEDU', 'SUNARP', 'INACAL', 'MEF', 'INEI', 'SENAMHI', 'UNI', 'CAS', 'SUNASS', 'SAC', 'MIMP', 'EPS', 'INPE', 'XIII', 'PIA', 'DIRESA', 'IE', 'SERFOR', 'PNP', 'PROINVERSION', 'ONP', 'S.A.', 'VII', 'XII', 'ANA', 'GRE', 'ONPE', 'OEFA', 'MINAM', 'CENEPRED', 'VRAEM', 'S.A.C.'}
NO_ESDRUJULA = {'MUNICIPAL', 'CHICA', 'CHICO', 'MICO', 'ANTICO', 'RICO', 'TICO', 'FICO', 'PICO', 'RICA', 'HUANCAVELICA'}
CONECTORES = {'la', 'y', 'el', 'al', 'del', 'los', 'sin', 'e', 'o', 'para', 'por', 'de', 'en', 'las', 'a', 'u', 'con'}
DICC = {'AMBITO': 'ámbito', 'AMBITOS': 'ámbitos', 'PERU': 'Perú', 'PROVIAS': 'Provías', 'AREA': 'área', 'AREAS': 'áreas', 'VIA': 'vía', 'VIAS': 'vías', 'INTERES': 'interés', 'ENERGIA': 'energía', 'MINERIA': 'minería', 'POLICIA': 'policía', 'CIUDADANIA': 'ciudadanía', 'ECONOMIA': 'economía', 'TECNOLOGIA': 'tecnología', 'GANADERIA': 'ganadería', 'INGENIERIA': 'ingeniería', 'CONTRALORIA': 'contraloría', 'DEFENSORIA': 'defensoría', 'ASESORIA': 'asesoría', 'AUDITORIA': 'auditoría', 'CONSULTORIA': 'consultoría', 'SECRETARIA': 'secretaría', 'TESORERIA': 'tesorería', 'ALCALDIA': 'alcaldía', 'PROCURADURIA': 'procuraduría', 'FISCALIA': 'fiscalía', 'PESQUERIA': 'pesquería', 'ACUICULTURA': 'acuicultura', 'METEOROLOGIA': 'meteorología', 'HIDROLOGIA': 'hidrología', 'GEOLOGIA': 'geología', 'ODONTOLOGIA': 'odontología', 'PSICOLOGIA': 'psicología', 'TOPOGRAFIA': 'topografía', 'CARTOGRAFIA': 'cartografía', 'BATERIA': 'batería', 'MAS': 'más', 'JUNIN': 'Junín', 'ANCASH': 'Áncash', 'APURIMAC': 'Apurímac', 'HUANUCO': 'Huánuco', 'MARTIN': 'Martín', 'BOLIVAR': 'Bolívar', 'RIMAC': 'Rímac', 'CAÑETE': 'Cañete', 'ESSALUD': 'EsSalud', 'INFORMATICA': 'informática', 'DEPOSITO': 'depósito', 'CREDITO': 'crédito', 'CREDITOS': 'créditos', 'TRANSITO': 'tránsito', 'TRAMITE': 'trámite', 'TRAMITES': 'trámites', 'NUMERO': 'número', 'CODIGO': 'código', 'INDICE': 'índice', 'ORGANO': 'órgano', 'ORGANOS': 'órganos', 'ULTIMA': 'última', 'ULTIMO': 'último', 'ANALISIS': 'análisis', 'DIAGNOSTICO': 'diagnóstico', 'CATALOGO': 'catálogo', 'METODO': 'método', 'PERIODO': 'período', 'CARCEL': 'cárcel', 'CARCELES': 'cárceles', 'ARBOL': 'árbol', 'ARBOLES': 'árboles', 'AEREO': 'aéreo', 'AEREA': 'aérea', 'AEREOS': 'aéreos', 'HUMEDA': 'húmeda', 'RAPIDO': 'rápido', 'RAPIDA': 'rápida', 'PUBLICIDAD': 'publicidad', 'JOVENES': 'jóvenes', 'ORIGEN': 'origen', 'REGIMEN': 'régimen', 'REGIMENES': 'regímenes', 'EXAMEN': 'examen', 'FACIL': 'fácil', 'DIFICIL': 'difícil', 'UTIL': 'útil', 'UTILES': 'útiles', 'MOVIL': 'móvil', 'MOVILES': 'móviles', 'SOTANO': 'sótano', 'PUBLICOS': 'públicos', 'PUBLICAS': 'públicas'}
TILDE = {"A": "á", "E": "é", "I": "í", "O": "ó", "U": "ú"}


def _palabra(p: str) -> tuple[str, bool]:
    if p in ACRONIMOS:
        return p, True
    if p in DICC:
        return DICC[p], bool(re.match(r"^[A-Z][a-z]*[A-Z]", DICC[p]))
    if re.fullmatch(r"[A-ZÑ]{2,}ION", p):
        return p.lower()[:-3] + "ión", False
    m = re.fullmatch(r"([A-ZÑ]+?)(IC[OA]S?)", p)
    if m and p not in NO_ESDRUJULA and len(p) > 5:
        raiz = m.group(1)
        i = max(raiz.rfind(v) for v in "AEIOU")
        if i >= 0:
            return (raiz[:i] + TILDE[raiz[i]] + raiz[i + 1:]).lower() + m.group(2).lower(), False
    return p.lower(), False


def texto(s: str | None, modo: str = "oracion") -> str:
    t = " ".join((s or "").split())
    if not t or re.search(r"[a-zà-ÿ]", t):
        return t
    primera = True

    def rep(mt):
        nonlocal primera
        # part of a code: road "PE-1NR", "3S" stays as published
        if re.search(r"\d$", t[:mt.start()]) or re.match(r"-?\d", t[mt.end():mt.end() + 2]):
            primera = False
            return mt.group(0)
        txt, sigla = _palabra(mt.group(0))
        if not sigla and (primera or (modo == "titulo" and txt not in CONECTORES)):
            txt = txt[:1].upper() + txt[1:]
        primera = False
        return txt
    return re.sub(r"[A-ZÑÁÉÍÓÚÜ]+", rep, t)


def titulo(s: str | None) -> str:
    return texto(s, "titulo")


# --- place names inside project and activity titles -------------------------------------
# "mejoramiento de la vía en mascabamba - distrito de ollantaytambo" -> "... en Mascabamba -
# distrito de Ollantaytambo": known places (every district, province and region of the
# executing units) plus the words that follow a locality marker ("localidad de X", "sector X").
_COMUNES = {"ALTO", "ALTA", "BAJO", "BAJA", "NUEVO", "NUEVA", "SAN", "SANTA", "SANTO", "RIO", "PUERTO", "GRANDE",
            "VILLA", "PAMPA", "PAMPAS", "CHICO", "CERRO", "PUENTE", "LAGUNA", "UNION", "PROGRESO", "INDEPENDENCIA",
            "CENTRO", "LA", "LAS", "LOS", "EL", "DE", "DEL", "Y", "E", "MAYO", "ESPERANZA", "PAZ", "VICTORIA", "LIBERTAD",
            "PROVINCIA", "DISTRITO"} | {c.upper() for c in CONECTORES}
_MARCAS = {"LOCALIDAD", "LOCALIDADES", "CASERIO", "CASERIOS", "ANEXO", "ANEXOS", "SECTOR", "SECTORES", "BARRIO",
           "COMUNIDAD", "POBLADO", "POBLADOS", "CIUDAD", "DISTRITO", "PROVINCIA", "DEPARTAMENTO", "CALLE", "CALLES",
           "DISTRITAL", "PROVINCIAL",
           "JR", "JIRON", "AV", "AVENIDA", "PASAJE", "URBANIZACION", "ASENTAMIENTO", "RIO", "QUEBRADA", "LAGUNA",
           "CERRO", "CANAL", "VIAS", "TRAMO", "VECINAL", "SECTORES", "PUENTE", "PUENTES"}
_PUENTE = {"DE", "DEL", "LA", "LAS", "LOS", "EL", "CAMPESINA", "NATIVA", "HUMANO", "C.P."}
_FIN = {"DEL", "EN", "Y", "E", "PARA", "CON", "A", "AL", "DISTRITO", "PROVINCIA", "DEPARTAMENTO", "REGION"}


def lugares_de(nombres: list[str]) -> tuple[set[str], set[tuple[str, ...]]]:
    """(one-word place names, multi-word place names) from upper-case place names."""
    solos, compuestos = set(), set()
    for n in nombres:
        toks = re.findall(r"[A-ZÑ]+", (n or "").upper())
        if len(toks) == 1 and toks[0] not in _COMUNES and len(toks[0]) > 2:
            solos.add(toks[0])
        elif len(toks) > 1:
            compuestos.add(tuple(toks))
    return solos, compuestos


def con_lugares(s: str | None, lugares: tuple[set[str], set[tuple[str, ...]]] | None) -> str:
    """Sentence-case `s` (texto) and capitalise the places it names."""
    t = " ".join((s or "").split())
    if not t or not lugares or re.search(r"[a-zà-ÿ]", t):
        return texto(t)
    solos, compuestos = lugares
    toks = re.findall(r"[A-ZÑÁÉÍÓÚÜ]+|[^A-ZÑÁÉÍÓÚÜ]+", t)
    pal = [i for i, x in enumerate(toks) if re.match(r"[A-ZÑ]", x)]
    sep = lambda k: toks[pal[k] + 1] if pal[k] + 1 < len(toks) else ""   # text after word k
    propio: set[int] = set()
    largo = max((len(c) for c in compuestos), default=0)
    for k, i in enumerate(pal):
        for n in range(min(largo, len(pal) - k), 1, -1):  # multi-word places, longest first
            if tuple(toks[j] for j in pal[k:k + n]) in compuestos:
                propio.update(j for j in pal[k:k + n] if toks[j] not in _PUENTE or j == pal[k])
                break
        if toks[i] in solos:
            propio.add(i)
    plurales = {"CALLES", "SECTORES", "LOCALIDADES", "CASERIOS", "ANEXOS", "POBLADOS", "PUENTES", "BARRIOS"}
    for k, i in enumerate(pal):
        if toks[i] not in _MARCAS:
            continue
        if toks[i] in plurales:  # "calles A, B y C": every name in the list
            m = k + 1
            while m < len(pal) and toks[pal[m]] not in _MARCAS and not (toks[pal[m]] in _FIN and toks[pal[m]] not in ("Y", "E")):
                if toks[pal[m]] not in _PUENTE and toks[pal[m]] not in ("Y", "E"):
                    propio.add(pal[m])
                m += 1
            continue
        m = k + 1
        while m < len(pal) and toks[pal[m]] in _PUENTE:  # "localidad DE LA ..."
            m += 1
        # the place segment(s): words up to a connector; " - " joins further short segments
        while m < len(pal) and toks[pal[m]] not in _FIN and toks[pal[m]] not in _MARCAS:
            ini = m
            while m < len(pal) and toks[pal[m]] not in _FIN and toks[pal[m]] not in _MARCAS and not any(c in sep(m - 1) for c in ",-/(") if m > ini else True:
                if toks[pal[m]] not in _PUENTE:
                    propio.add(pal[m])
                m += 1
                if m < len(pal) and any(c in sep(m - 1) for c in ",-/("):
                    break
            if m >= len(pal) or "-" not in sep(m - 1):
                break
            # continue across " - " only into another short segment (≤ 3 words) that is itself
            # followed by " - ", a connector or the end
            fin = m
            while fin < len(pal) and fin - m < 4 and toks[pal[fin]] not in _FIN and toks[pal[fin]] not in _MARCAS \
                    and not any(c in sep(fin) for c in ",-/("):
                fin += 1
            corto = fin - m < 3 or (fin < len(pal) and any(c in sep(fin) for c in "-"))
            if not corto or (fin < len(pal) and toks[pal[fin]] in _MARCAS and fin == m):
                break
    salida = texto(t)
    out = re.findall(r"[A-Za-zÑñÁÉÍÓÚÜáéíóúü]+|[^A-Za-zÑñÁÉÍÓÚÜáéíóúü]+", salida)
    if len(out) != len(toks):
        return salida
    return "".join(w[:1].upper() + w[1:] if i in propio else w for i, w in enumerate(out))


def lugares(con) -> tuple[set[str], set[tuple[str, ...]]]:
    """Place names known to the serving database (seats of the executing units)."""
    filas = con.execute("SELECT DISTINCT unnest([dept_nombre, prov_nombre, dist_nombre]) FROM dim_entidad").fetchall()
    return lugares_de([f[0] for f in filas])
