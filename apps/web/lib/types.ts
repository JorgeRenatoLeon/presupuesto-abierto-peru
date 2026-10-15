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
};
export type Alerta = {
  regla: string; severidad: "alta" | "media"; ano: number; mes: number | null;
  /** null for category alerts (CAMBIO_TEMA, CAMBIO_ANUAL): they are about a función/tema, not one entity */
  sec_ejec: string | null; entidad: string | null; nivel: string | null; departamento: string | null;
  titulo: string; mensaje: string; datos: Record<string, number | null>;
  dimension?: string; codigo?: string; enlace?: string;
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
  publicacion: Publicacion;
  publicacion_anterior: Publicacion | null;
  ano_anterior: { ano: number; publicacion: Publicacion } | null;
  dimensiones: { id: string; titulo: string; niveles: string[] }[];
  totales: Record<Medida, number | null>;
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

/** "2026-09-03" -> "3 de septiembre de 2026" */
export const fmtFecha = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m].toLowerCase()} de ${y}`;
};

export const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export function latestYear<T extends { ano: number }>(rows: T[]): T | null {
  return rows.length ? rows.reduce((a, b) => (b.ano > a.ano ? b : a)) : null;
}

/** Plain-language interpretation of execution pace — the benchmark insight. */
export function interpretarAvance(avance: number | null, mes: number): { texto: string; tono: "ok" | "warn" | "bad" } {
  if (avance == null || !isFinite(avance)) return { texto: "Sin datos suficientes para evaluar el avance.", tono: "warn" };
  const esperado = mes / 12;
  const gap = esperado - avance;
  if (gap <= 0.05) return { texto: "El gasto avanza al ritmo esperado para esta altura del año.", tono: "ok" };
  if (gap <= 0.15) return { texto: "El gasto avanza algo más lento de lo esperado; aún es recuperable.", tono: "warn" };
  return { texto: "El gasto va muy por detrás del calendario: hay riesgo de que parte del presupuesto no se use.", tono: "bad" };
}
