/** MEF publishes names in unaccented capitals ("GESTION DE LA EDUCACION BASICA"). Citizens read
 *  "Gestión de la educación básica". Rules restore the accents Spanish always takes (-ción, -sión,
 *  esdrújulas in -ico/-ica); a dictionary covers the rest; acronyms stay as published. */

const ACRONIMOS = new Set([
  "MEF", "SUNAT", "ONP", "INPE", "UGEL", "SIS", "PNP", "ONPE", "JNE", "RENIEC", "SUNARP", "INEI", "PCM", "MINSA",
  "MINEDU", "MTC", "MIDIS", "MIMP", "MINAM", "MIDAGRI", "MINAGRI", "SENASA", "SERFOR", "OSCE", "SUNASS", "EPS",
  "FONCODES", "PRONIS", "PRONIED", "DEVIDA", "SERVIR", "INDECI", "CENEPRED", "PRONABEC", "OEFA", "OSINERGMIN",
  "OSIPTEL", "SUNEDU", "SUCAMEC", "DIRESA", "DRE", "GRE", "RED", "CAS", "PIA", "PIM", "CUI", "IE", "I.E.", "EE",
  "SA", "S.A.", "SAC", "S.A.C.", "VRAEM", "ANA", "SENAMHI", "INGEMMET", "PROINVERSION", "CONCYTEC", "INACAL",
  "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII", "XIII", "XIV", "XV", "UNSAAC", "UNMSM", "UNI",
]);

const DICC: Record<string, string> = {
  PERU: "Perú", AMBITO: "ámbito", AMBITOS: "ámbitos", AREA: "área", AREAS: "áreas", VIA: "vía", VIAS: "vías", INTERES: "interés", ENERGIA: "energía",
  MINERIA: "minería", POLICIA: "policía", CIUDADANIA: "ciudadanía", ECONOMIA: "economía", TECNOLOGIA: "tecnología",
  GANADERIA: "ganadería", INGENIERIA: "ingeniería", CONTRALORIA: "contraloría", DEFENSORIA: "defensoría",
  ASESORIA: "asesoría", AUDITORIA: "auditoría", CONSULTORIA: "consultoría", SECRETARIA: "secretaría",
  TESORERIA: "tesorería", ALCALDIA: "alcaldía", PROCURADURIA: "procuraduría", FISCALIA: "fiscalía",
  PESQUERIA: "pesquería", ACUICULTURA: "acuicultura", METEOROLOGIA: "meteorología", HIDROLOGIA: "hidrología",
  GEOLOGIA: "geología", ODONTOLOGIA: "odontología", PSICOLOGIA: "psicología", TOPOGRAFIA: "topografía",
  CARTOGRAFIA: "cartografía", BATERIA: "batería", MAS: "más", JUNIN: "Junín", ANCASH: "Áncash",
  APURIMAC: "Apurímac", HUANUCO: "Huánuco", MARTIN: "Martín", BOLIVAR: "Bolívar", RIMAC: "Rímac",
  CAÑETE: "Cañete", ESSALUD: "EsSalud", INFORMATICA: "informática", DEPOSITO: "depósito", CREDITO: "crédito",
  CREDITOS: "créditos", TRANSITO: "tránsito", TRAMITE: "trámite", TRAMITES: "trámites", NUMERO: "número",
  CODIGO: "código", INDICE: "índice", ORGANO: "órgano", ORGANOS: "órganos", ULTIMA: "última", ULTIMO: "último",
  ANALISIS: "análisis", DIAGNOSTICO: "diagnóstico", CATALOGO: "catálogo", METODO: "método", PERIODO: "período",
  CARCEL: "cárcel", CARCELES: "cárceles", ARBOL: "árbol", ARBOLES: "árboles", AEREO: "aéreo", AEREA: "aérea",
  AEREOS: "aéreos", HUMEDA: "húmeda", RAPIDO: "rápido", RAPIDA: "rápida", PUBLICIDAD: "publicidad",
  JOVENES: "jóvenes", ORIGEN: "origen", REGIMEN: "régimen", REGIMENES: "regímenes", EXAMEN: "examen",
  FACIL: "fácil", DIFICIL: "difícil", UTIL: "útil", UTILES: "útiles", MOVIL: "móvil", MOVILES: "móviles",
  SOTANO: "sótano", PUBLICOS: "públicos", PUBLICAS: "públicas",
};

const NO_ESDRUJULA = new Set(["RICO", "RICA", "CHICO", "CHICA", "PICO", "TICO", "MICO", "FICO", "MUNICIPAL", "ANTICO"]);
const CONECTORES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "para", "por", "a", "al", "o", "u", "con", "sin"]);
const VOCAL = "AEIOU";
const TILDE: Record<string, string> = { A: "á", E: "é", I: "í", O: "ó", U: "ú" };

function palabra(p: string): { texto: string; sigla: boolean } {
  if (ACRONIMOS.has(p)) return { texto: p, sigla: true };
  if (DICC[p]) return { texto: DICC[p], sigla: /^[A-Z][a-z]*[A-Z]/.test(DICC[p]) };
  if (/^[A-ZÑ]{2,}ION$/.test(p)) return { texto: p.toLowerCase().replace(/ion$/, "ión"), sigla: false };
  const m = p.match(/^([A-ZÑ]+?)(IC[OA]S?)$/);
  if (m && !NO_ESDRUJULA.has(p)) {
    const raiz = m[1];
    const i = Math.max(...[...VOCAL].map((v) => raiz.lastIndexOf(v)));
    if (i >= 0 && raiz.replace(/[^AEIOU]/g, "").length >= 1 && p.length > 5) {
      return { texto: (raiz.slice(0, i) + TILDE[raiz[i]] + raiz.slice(i + 1)).toLowerCase() + m[2].toLowerCase(), sigla: false };
    }
  }
  return { texto: p.toLowerCase(), sigla: false };
}

/** "GESTION DE LA EDUCACION BASICA" -> "Gestión de la educación básica" (oracion) or
 *  "Gestión de la Educación Básica" (titulo). Strings with lowercase letters pass through. */
export function textoMEF(s: string, modo: "oracion" | "titulo" = "oracion"): string {
  const t = (s ?? "").trim();
  if (!t || /[a-zà-ÿ]/.test(t)) return t;
  let primera = true;
  return t.replace(/[A-ZÑÁÉÍÓÚÜ.]+/g, (tok) => {
    const { texto, sigla } = palabra(tok.normalize("NFD").replace(/[̀-ͯ]/g, "") === tok ? tok : tok);
    const conMayus = sigla ? texto
      : (primera || (modo === "titulo" && !CONECTORES.has(texto))) ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
    primera = false;
    return conMayus;
  });
}
