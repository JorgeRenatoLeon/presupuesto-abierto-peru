/** producto/<cubso>.json (pipeline contratos._productos): a catalogue item the State buys often, in
 *  its most used unit. Prices are per unit, from the contracts' lines (goods, quantity 2 or more). */
export type ArchivoProducto = {
  id: string; nombre: string | null; familia: string | null; unidad: string;
  r: {
    n: number; compradores: number; proveedores: number;
    mediana: number; q1: number; q3: number; min: number; max: number;
    total: number; cantidad: number; desde: string; hasta: string;
    /** prices similar enough across purchases to flag a contract that pays far more */
    comparable: boolean;
    /** purchases more than 10x away from the usual price (likely a quantity or unit typed wrong),
     *  left out of the lowest and highest */
    revisar?: number;
  };
  /** by month: [YYYY-MM, median unit price, purchases, lowest, highest] */
  s: [string, number, number, number, number][];
  /** purchases spread over the period, for the chart: [date, unit price] */
  x?: [string, number][];
  /** who sells it: [RUC, name, purchases, median unit price, soles] */
  v: [string, string | null, number, number, number][];
  /** who buys it: [sec or null, name, purchases, median unit price, soles] */
  e: [string | null, string, number, number, number][];
  /** latest purchases: [date, sec, entity, RUC, supplier, quantity, unit price, total, contract document, line] */
  c: [string, string | null, string, string | null, string | null, number, number, number, string | null, string | null][];
};
/** productos/indice.json: [cubso, name, unit, median unit price, purchases, soles] */
export type IndiceProductos = { total: number; p: [string, string | null, string, number, number, number][] };

export const urlProducto = (id: string) => `/producto/?id=${encodeURIComponent(id)}`;

/** S/ with cents for small unit prices (a bag of cement), rounded like everything else above. */
export const fmtPrecio = (v: number | null | undefined) =>
  v == null ? "—" : v < 1000 ? `S/ ${v.toLocaleString("es-PE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`
    : `S/ ${Math.round(v).toLocaleString("es-PE")}`;

/** SEACE writes units without accents ("galon", "metro cubico"). */
const ACENTOS: Record<string, string> = { galon: "galón", "metro cubico": "metro cúbico", cubico: "cúbico", rollo: "rollo", cientos: "cientos" };
export const unidadLegible = (u: string) => ACENTOS[u.toLowerCase()] ?? u.toLowerCase().replace(/\bgalon\b/, "galón");
