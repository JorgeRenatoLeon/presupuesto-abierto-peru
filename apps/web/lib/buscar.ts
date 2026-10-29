import { urlDatos } from "@/lib/types";
import { cargarDatos } from "@/lib/contratos";

/** buscar/obras-<k>.json (pipeline exportar._buscar_obras): every project with money this year,
 *  split by unit. Function and department are positions in `f` and `d`. */
export type FilaObra = [cui: string, sec: string, nombre: string, funcion: number | null, dept: number | null,
  pim: number | null, devengado: number | null, pim_pub_ant: number | null, dev_ano_ant: number | null,
  senal: string | null];
export type ParteObras = { f: string[]; d: string[]; e: Record<string, string>; o: FilaObra[] };

export const PARTES_OBRAS = 16;
export const parteDe = (sec: string) => Number(sec) % PARTES_OBRAS;
export const cargarParte = (k: number) => cargarDatos<ParteObras>(urlDatos(`buscar/obras-${k}.json`));

/** A project's own page: its unit and CUI (the same CUI can be budgeted by several units). */
export const urlObra = (sec: string, cui: string) => `/obra/?sec=${encodeURIComponent(sec)}&cui=${encodeURIComponent(cui)}`;

/** Lower case, no accents, MEF's abbreviations spelled out, punctuation as spaces:
 *  "M. DE SALUD" -> "ministerio de salud", "U.N. DE INGENIERÍA" -> "universidad nacional de ingenieria". */
export function normalizar(s: string | null | undefined): string {
  return ` ${(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()} `
    .replace(/\bm\.\s*/g, "ministerio ")
    .replace(/\bu\.\s*n\.\s*/g, "universidad nacional ")
    .replace(/\bg\.\s*r\.\s*/g, "gobierno regional ")
    .replace(/\bmun\.\s*/g, "municipalidad ")
    .replace(/[^a-z0-9ñ]+/g, " ");
}

/** What people call an entity versus what MEF names it. Keys and phrases already normalized. */
const ALIAS: Record<string, string[]> = {
  palacio: ["despacho presidencial"],
  presidente: ["despacho presidencial"],
  presidencia: ["despacho presidencial", "presidencia del consejo"],
  minsa: ["ministerio de salud"],
  minedu: ["ministerio de educacion"],
  mtc: ["transportes y comunicaciones", "mtc"],
  mef: ["economia y finanzas"],
  mininter: ["ministerio del interior"],
  mindef: ["ministerio de defensa"],
  midis: ["desarrollo e inclusion social"],
  mimp: ["de la mujer y poblaciones vulnerables"],
  minam: ["ministerio del ambiente"],
  midagri: ["desarrollo agrario"],
  minagri: ["desarrollo agrario"],
  minem: ["energia y minas"],
  produce: ["de la produccion"],
  mincetur: ["comercio exterior y turismo"],
  minjus: ["justicia y derechos humanos"],
  minjusdh: ["justicia y derechos humanos"],
  mvcs: ["vivienda construccion y saneamiento"],
  mtpe: ["trabajo y promocion del empleo"],
  mincul: ["ministerio de cultura"],
  rree: ["relaciones exteriores"],
  cancilleria: ["relaciones exteriores"],
  pcm: ["presidencia del consejo de ministros", "pcm"],
  pnp: ["policia nacional", "pnp"],
  provias: ["pro vias", "provias"],
  sunat: ["administracion tributaria", "sunat"],
  reniec: ["registro nacional de identificacion", "reniec"],
  onpe: ["procesos electorales", "onpe"],
  jne: ["jurado nacional de elecciones"],
  inpe: ["instituto nacional penitenciario", "inpe"],
  sis: ["seguro integral de salud"],
  minsalud: ["ministerio de salud"],
  petroperu: ["petroleos del peru"],
  sedapal: ["servicio de agua potable y alcantarillado de lima", "sedapal"],
};
const VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "a", "al", "e", "o"]);

/** The query as tokens, each with the phrases that count as a match for it. */
export type Consulta = { texto: string; tokens: string[][] };
export function consulta(q: string): Consulta {
  const texto = normalizar(q).trim();
  const palabras = texto.split(" ").filter((t) => t && !VACIAS.has(t));
  return { texto, tokens: palabras.map((t) => [t, ...(ALIAS[t] ?? [])]) };
}

/** How well a normalized text (padded with spaces) answers the query: 0 the name starts with it,
 *  1 every word starts a word of the name, 2 every word is somewhere inside, null no match. */
export function puntaje(c: Consulta, nombre: string): number | null {
  if (!c.tokens.length) return null;
  if (!c.tokens.every((alts) => alts.some((a) => nombre.includes(a)))) return null;
  if (nombre.startsWith(` ${c.texto}`)) return 0;
  return c.tokens.every((alts) => alts.some((a) => nombre.includes(` ${a}`))) ? 1 : 2;
}
