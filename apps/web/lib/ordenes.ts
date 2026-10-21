import { urlDatos } from "@/lib/types";
import { cargarDatos } from "@/lib/contratos";

/** ordenes/<sec>.json (pipeline ordenes.py): a unit's purchase and service orders this year. */
export type ResumenOrdenes = {
  n: number; monto: number;
  /** orders that are not an executed contract: small purchases, utilities, catalogue... */
  sin_contrato: number; n_sin_contrato?: number;
  /** how many people (RUC 10) it paid with orders, in how many orders, how much */
  personas: number; n_personas?: number; monto_personas: number;
  desde?: string | null; hasta?: string | null; ano?: number;
  por_via?: [string, number, number][];
  /** [expense type, orders, soles], works orders excluded (they belong to their project) */
  por_gasto?: [string, number, number][];
  /** largest suppliers: [RUC, name, orders, soles] */
  top?: [string, string, number, number][];
};
/** [date, description, supplier index, soles, "c" compra | "s" servicio, via, expense type, CUI,
 *  1 = for a project, state: C comprometida | D devengada | E emitida] */
export type FilaOrden = [string | null, string | null, number, number, "c" | "s", string | null, string | null, string | null, 0 | 1, string | null];
export type ArchivoOrdenes = { r: ResumenOrdenes; p: [string, string | null][]; o: FilaOrden[] };
export type FuenteOrdenes = { ano: number; meses: number; ordenes: number; monto: number; monto_vinculado: number; entidades: number; hasta?: string };

export const cargarOrdenes = (sec: string) => cargarDatos<ArchivoOrdenes>(urlDatos(`ordenes/${sec}.json`));

/** How an order came about, in the words the site uses everywhere. */
export const VIA_ORDEN: Record<string, { texto: string; explica: string; sinContrato: boolean }> = {
  menor: { texto: "Compra menor (hasta 8 UIT)", sinContrato: true,
           explica: "Compras y servicios pequeños, de hasta 8 UIT, que la ley permite hacer sin concurso: la entidad elige al proveedor." },
  sin_proceso: { texto: "Sin concurso", sinContrato: true,
                 explica: "Otras compras que la ley permite sin un procedimiento de selección (supuestos excluidos de la ley de contrataciones)." },
  servicio_publico: { texto: "Servicio público", sinContrato: true,
                      explica: "Luz, agua, teléfono o internet: se pagan a la empresa que presta el servicio." },
  catalogo: { texto: "Catálogo electrónico", sinContrato: true,
              explica: "Compra en los catálogos de Perú Compras (acuerdos marco): proveedores y precios elegidos antes." },
  convenio: { texto: "Convenio entre entidades", sinContrato: true, explica: "Pago a otra entidad pública por un convenio." },
  proceso: { texto: "Paga un contrato", sinContrato: false,
             explica: "La orden paga un contrato ganado en un concurso: ese contrato está en «¿A quién le contrata?»." },
  directa: { texto: "Paga una contratación directa", sinContrato: false, explica: "La orden paga un contrato firmado sin concurso." },
  especial: { texto: "Régimen especial", sinContrato: false, explica: "La orden viene de un régimen especial de contratación." },
};
export const viaOrden = (v: string | null) => VIA_ORDEN[v ?? ""] ?? { texto: "Otra", explica: "", sinContrato: true };

/** E: issued; C: the money is reserved for it; D: the good or service was received and the debt recorded */
export const ESTADO_ORDEN: Record<string, string> = { E: "Emitida", C: "Comprometida", D: "Devengada" };

/** RUC 10/15/17: a person, not a company. */
export const esPersona = (ruc: string) => /^(10|15|17)\d{9}$/.test(ruc);
