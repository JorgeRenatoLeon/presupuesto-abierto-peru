import { textoMEF } from "./nombres";
export type ResumenAnual = {
  ano: number; mes_ult: number; pia: number | null; pim: number | null;
  certificado: number | null; devengado_ytd: number | null; girado_ytd: number | null;
};
export type SerieNacional = { ano: number; mes: number; devengado: number; pim: number | null };
export type PorFuncion = { ano: number; funcion: string; funcion_nombre: string; devengado: number; pim: number | null };
export type PorDepartamento = { ano: number; dept: string; dept_nombre: string; devengado: number; pim: number | null };
export type TopEntidad = { ano: number; sec_ejec: string; nombre: string; nivel: string; devengado: number; pim: number | null };
export type EntidadIndex = {
  sec_ejec: string; nombre: string; nivel: string | null; dept: string | null;
  pliego: string | null; devengado: number | null; pim: number | null;
  prov?: string | null; dist?: string | null;
};
export type Alerta = {
  regla: string; severidad: "alta" | "media"; ano: number; mes: number | null;
  /** null for category alerts (CAMBIO_TEMA, CAMBIO_ANUAL): they are about a función/tema, not one entity */
  sec_ejec: string | null; entidad: string | null; nivel: string | null; departamento: string | null;
  titulo: string; mensaje: string; datos: Record<string, number | null>;
  dimension?: string; codigo?: string; enlace?: string;
  /** stable per rule/subject/MEF publication: lets the watchlist mark what is new */
  id?: string; publicacion?: string | null;
};
/** Plain-language names of the alert rules (pipeline/alerts.py). */
export const REGLAS_ALERTA: Record<string, string> = {
  CAMBIO_TEMA: "Cambios por tema",
  CAMBIO_ANUAL: "Frente al año anterior",
  OBRA_SIN_AVANCE: "Proyectos sin avance",
  SIN_DESCRIPCION: "Sin descripción",
  PIM_CAMBIO: "Cambios por entidad",
  GASTO_DICIEMBRE: "Gasto de fin de año",
  RIESGO_EJEC: "Ejecución lenta",
  PIA_PIM: "Muy distinto al inicial",
};
export type Meta = {
  generated_at?: string; source_last_modified?: string; years?: number[];
  hf_dataset?: string | null;
  publicaciones?: { dataset: string; ano: number; id: string; fecha: string; mes_ult: number }[];
};

// --- Comparisons (pipeline compare.py -> comparar/*.json) ---
export type Publicacion = { id: string; fecha: string; mes_ult?: number };
export type Medida =
  | "pia" | "pim" | "devengado" | "pim_pub_ant" | "pia_ano_ant" | "pim_ano_ant"
  | "dev_ano_ant_periodo" | "dev_ano_ant";
export type NodoComparacion = {
  id: string; padre: string | null; nivel: number; nombre: string;
} & Record<Medida, number | null>;
export type EtiquetaDef = { etiqueta: string; nombre: string; descripcion: string; confianza: string };
export type ComparacionDimension = {
  dimension: string; titulo: string; niveles: string[]; nodos: NodoComparacion[];
  definiciones?: EtiquetaDef[];
};
export type ComparacionResumen = {
  ano: number; mes_ult: number;
  /** share of the year the data covers: daily files are published mid-month */
  avance_esperado?: number;
  publicacion: Publicacion;
  publicacion_anterior: Publicacion | null;
  ano_anterior: { ano: number; publicacion: Publicacion } | null;
  dimensiones: { id: string; titulo: string; niveles: string[] }[];
  totales: Record<Medida, number | null>;
};
// --- Projects, departments, audit agenda (pipeline exportar.py) ---
export type Obra = {
  cui: string; nombre: string; funcion?: string | null; dept?: string | null;
  /** contracts that carry its CUI (pipeline contratos.py), on its entity's page: [n, amount] */
  c?: [number, number | null];
  /** the project as a whole (MEF Banco de Inversiones): [updated cost, approved cost, spent in all years, physical progress %] */
  t?: [number | null, number | null, number | null, number | null];
  entidad?: string | null; sec_ejec?: string;
  pim: number | null; devengado: number | null; pim_pub_ant: number | null; dev_ano_ant: number | null;
  /** sin_avance | avance_bajo | recortada | null (pipeline compare._obras) */
  senal: string | null;
};
export type EntidadResumen = {
  sec_ejec: string; nombre: string; nivel: string; provincia: string | null; distrito: string | null;
  pim: number | null; devengado: number | null; alertas: { total: number; alta: number }; obras_sin_avance: number;
};
export type Localidad = {
  codigo: string; nombre: string; ano: number; mes_ult: number | null; publicacion: Publicacion | null;
  avance_esperado?: number | null;
  gasto: { pia: number | null; pim: number | null; devengado: number | null };
  cambios: { pim_pub_ant?: number | null; pia_ano_ant?: number | null; pim_ano_ant?: number | null; dev_ano_ant_periodo?: number | null };
  por_nivel: { nivel: string; pim: number; devengado: number }[];
  por_funcion: { id?: string; funcion: string; pim: number; devengado: number }[];
  provincias?: ProvinciaResumen[];
  gobierno_regional: EntidadResumen[]; municipalidades: EntidadResumen[]; nacional_con_sede: EntidadResumen[];
  obras: { n: number; n_sin_avance: number; pim_sin_avance: number; top: Obra[]; sin_avance: Obra[] };
  alertas: { total: number; alta: number; por_regla: Record<string, number>; top: Alerta[] };
};
export type LocalidadIndice = {
  codigo: string; nombre: string; pim: number | null; devengado: number | null; pim_pub_ant: number | null;
  pia: number | null; pia_ano_ant: number | null; n_municipalidades: number; n_sin_avance: number; alertas_alta: number;
};
export type Auditoria = {
  ano: number; mes_ult: number | null; publicacion: Publicacion | null;
  obras_sin_avance?: {
    n: number; pim: number; n_grandes: number; n_paralizadas: number;
    por_departamento: { codigo: string; nombre: string; n: number; pim: number }[];
    top: (Obra & { entidad: string; sec_ejec: string })[];
  };
  gasto_diciembre?: {
    ano: number; promedio: number; n_25: number; n_35: number;
    top: { sec_ejec: string; nombre: string; dept: string | null; nivel: string | null; dic: number; dev: number; pct: number }[];
  };
  laudos: {
    pim: number | null; devengado: number | null; a_empresas: number | null; entidades: number;
    top: { sec_ejec: string; nombre: string; dept: string | null; pim: number; devengado: number; a_empresas: number | null }[];
  };
  /** budget MEF publishes without saying what it is for (pipeline compare.SIN_DESCRIPCION) */
  sin_descripcion?: {
    n: number; pim: number; devengado: number;
    top: { sec_ejec: string; nombre: string; funcion: string | null; lineas: number; pim: number; devengado: number }[];
  };
  conteos: Record<string, { total: number; alta: number }>;
  destacadas: Alerta[];
};
export type AlertasResumen = {
  total: number; alta: number;
  por_regla: Record<string, { total: number; alta: number }>;
  departamentos: { codigo: string; nombre: string; total: number }[];
  top: Alerta[];
};
export type TemaSeguible = { id: string; nombre: string; pia: number | null; pim: number | null;
  devengado: number | null; pim_pub_ant: number | null; pia_ano_ant: number | null };

/** Files under public/data, fetched by the browser (GitHub Pages serves the site under a base path). */
export const urlDatos = (ruta: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/${ruta}`;
/** A site path with the base path GitHub Pages serves it under (for links built outside <Link>). */
export const withBase = (ruta: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${ruta}`;
/** Official record of an investment project (MEF, Sistema de Seguimiento de Inversiones). */
export const fichaInversion = (cui: string) => `https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${cui}&tipo=2`;
/** Where citizens act on what they find (verified 2026-10-15). */
export const ACCIONES = {
  transparencia: "https://www.transparencia.gob.pe/",
  denuncia: "https://www.gob.pe/9260",
};

export type IngresoResumen = {
  ano: number; mes_ult: number; pia: number | null; pim: number | null; recaudado_ytd: number | null;
};
export type IngresoPorFuente = { ano: number; rubro: string; rubro_nombre: string; recaudado: number; pim: number | null };
export type IngresoPorGenerica = { ano: number; generica: string; generica_nombre: string; recaudado: number; pim: number | null };
export type IngresoPorNivel = { ano: number; nivel: string; recaudado: number; pim: number | null };
export type ContrasteMensual = { ano: number; mes: number; gasto_devengado: number | null; ingreso_recaudado: number | null };


export const fmtSoles = (v: number | null | undefined): string => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `S/ ${(v / 1e9).toLocaleString("es-PE", { maximumFractionDigits: 1 })} mil millones`;
  if (abs >= 1e6) return `S/ ${(v / 1e6).toLocaleString("es-PE", { maximumFractionDigits: 1 })} millones`;
  return `S/ ${v.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;
};

export const fmtPct = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? "—" : `${(v * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`;

/** Signed change: "+S/ 1,2 mil millones", "−S/ 350 millones". */
export const fmtDelta = (v: number | null | undefined): string =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtSoles(Math.abs(v))}`;

/** Signed percentage change between two amounts ("+12,5%"), or "nuevo" when there was nothing before. */
export const fmtVariacion = (antes: number | null | undefined, despues: number | null | undefined): string => {
  if (antes == null || despues == null) return "—";
  if (antes === 0) return despues === 0 ? "0%" : "nuevo";
  const p = ((despues - antes) / Math.abs(antes)) * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toLocaleString("es-PE", { maximumFractionDigits: 1 })}%`;
};

/** MEF place names are upper case: "MADRE DE DIOS" -> "Madre de Dios". */
export const fmtLugar = (s: string): string => {
  const t = (s ?? "").trim();
  if (t === "PROVINCIA CONSTITUCIONAL DEL CALLAO") return "Callao";
  return textoMEF(t, "titulo");
};
/** A budget category, activity or project name as a sentence: "Gestión de la educación básica". */
export const fmtNombre = (s: string): string => textoMEF(s, "oracion");

/** "2026-09-03" -> "3 de septiembre de 2026" */
export const fmtFecha = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m].toLowerCase()} de ${y}`;
};

export const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** How far the data goes. MEF's daily files are published mid-month: "al 17 de octubre";
 *  a month-end file, published the month after: "a agosto" (pipeline compare.dias_cubiertos). */
export function corteDatos(mesUlt: number, fecha?: string | null, ano?: number): string {
  const mes = MESES[mesUlt]?.toLowerCase() ?? "";
  const [y, m, d] = (fecha ?? "").split("-").map(Number);
  return y === (ano ?? y) && m === mesUlt ? `al ${d} de ${mes}` : `a ${mes}`;
}

/** Share of the year elapsed at that cut: what "on schedule" means (pipeline compare.avance_esperado). */
export function fraccionAno(mesUlt: number, fecha?: string | null, ano?: number): number {
  const [y, m, d] = (fecha ?? "").split("-").map(Number);
  if (!y || y > (ano ?? y)) return mesUlt / 12;
  const inicio = Date.UTC(y, 0, 1);
  const transcurrido = (Date.UTC(y, m - 1, d) - inicio) / (Date.UTC(y + 1, 0, 1) - inicio);
  return Math.min(mesUlt / 12, Math.max(transcurrido, 0));
}

export function latestYear<T extends { ano: number }>(rows: T[]): T | null {
  return rows.length ? rows.reduce((a, b) => (b.ano > a.ano ? b : a)) : null;
}

/** Plain-language interpretation of execution pace — the benchmark insight. */
/** `esperado`: share of the year the data covers (pipeline compare.avance_esperado); defaults to mes/12. */
export function interpretarAvance(avance: number | null, mes: number, esperado?: number | null): { texto: string; tono: "ok" | "warn" | "bad" } {
  if (avance == null || !isFinite(avance)) return { texto: "Sin datos suficientes para evaluar el avance.", tono: "warn" };
  esperado = esperado ?? mes / 12;
  const gap = esperado - avance;
  if (gap <= 0.05) return { texto: "El gasto avanza al ritmo esperado para esta altura del año.", tono: "ok" };
  if (gap <= 0.15) return { texto: "El gasto avanza algo más lento de lo esperado; aún es recuperable.", tono: "warn" };
  return { texto: "El gasto va muy por detrás del calendario: hay riesgo de que parte del presupuesto no se use.", tono: "bad" };
}

// --- Explanations (pipeline explicar.py -> explicar/<dimension>/<id>.json, glosario.json) ---
export type Explicacion = {
  dimension: "funcion" | "generica"; id: string; nivel: string; nombre: string; ano: number;
  pim: number | null; devengado: number | null; entidades: number;
  /** MEF's official definition; `heredado` when it belongs to the nearest parent category */
  oficial: { texto: string; nombre: string; heredado: boolean; fuente: string } | null;
  simple: { texto: string; ejemplos: string } | null;
  /** sd: published without a description (generic project code, blank names) */
  en_que: { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null; entidades: number; sd?: boolean }[];
  como: { codigo: string; nombre: string; pim: number | null; devengado: number | null }[];
  quien: { sec_ejec: string; nombre: string; nivel: string; pim: number | null; devengado: number | null }[];
  por_nivel: { nivel: string; pim: number | null; devengado: number | null }[];
};
export const archivoExplicacion = (id: string) => id.replace(/\//g, "-");
export const DIMENSIONES_EXPLICADAS = new Set(["funcion", "generica"]);

export type Termino = { clave: string; termino: string; simple: string; detalle: string; grupo: string };
export type Glosario = {
  terminos: Termino[];
  funciones: { codigo: string; nombre: string; oficial: string; simple?: string; ejemplos?: string }[];
  genericas: { codigo: string; nombre: string; oficial: string; simple: string; ejemplos: string }[];
  fuentes: Record<string, string>;
};

// --- Provinces and districts (pipeline exportar._provincias) ---
export type EntidadLugar = EntidadResumen & { prov?: string; dist?: string };
export type Distrito = { ubigeo: string; nombre: string; municipalidad: EntidadLugar | null; otras: EntidadLugar[] };
export type Provincia = {
  codigo: string; nombre: string; dept: string; dept_nombre: string | null; ano: number; mes_ult: number | null;
  avance_esperado?: number | null; publicacion: Publicacion | null;
  gasto: { pim: number; devengado: number };
  por_funcion: { id: string; funcion: string; pim: number | null; devengado: number | null }[];
  municipalidad_provincial: EntidadLugar | null;
  distritos: Distrito[];
  obras: { n: number; n_sin_avance: number; pim_sin_avance: number; top: Obra[]; sin_avance: Obra[] };
  alertas: { total: number; alta: number; top: Alerta[] };
};
export type ProvinciaResumen = { codigo: string; nombre: string; pim: number; devengado: number; n_municipalidades: number };
/** localidad/distritos.json: u ubigeo, d distrito, p provincia, r región, s municipality sec_ejec, n its name */
export type DistritoIndice = { u: string; d: string; p: string; r: string | null; s: string | null; n: string | null };
