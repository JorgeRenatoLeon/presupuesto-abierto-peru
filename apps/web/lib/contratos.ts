/** Who the State contracts with (pipeline contratos.py): OECE's open contracting data (SEACE),
 *  linked to the budget's executing units. Types of the files and the words the site uses. */

/** entidad/<sec>.json "contratos" and contratos/<sec>.json "r": contracts signed in the period */
export type ContratosResumen = {
  n: number; monto: number | null;
  /** added after signing (adicionales, complementary contracts): final amount above the signed one */
  extra?: number | null;
  proveedores?: number;
  /** competitive procedures with a known number of bidders, and those with a single one */
  competitivos?: number; un_postor?: number;
  /** amount awarded without competition (contratación directa, exoneración) */
  directo?: number | null;
  resueltos?: number; intervenidos?: number; nulos?: number; con_adicionales?: number;
  /** contracts another entity signed for one of this one's projects (CUI) */
  de_otros?: number; monto_otros?: number | null;
  desde: string | null; hasta: string | null;
  por_tipo?: { o: number | null; b: number | null; s: number | null };
  /** largest suppliers: [RUC or SEACE code, name, contracts, amount] */
  top: [string, string, number, number | null][];
  mostrados?: number; desde_ano?: number;
};

/** [date, object, supplier, amount, final amount, method, category, bidders, CUIs, signed contract,
 *  events "type:document,…", buyer] — indexes into the file's lists */
export type FilaContrato = [string, string, number | null, number | null, number | null, number,
  "o" | "b" | "s" | null, number | null, string | null, string | null, string | null, number];

export type ArchivoContratos = {
  r: ContratosResumen;
  /** suppliers: [RUC (11 digits) or SEACE code of a consortium, name] */
  p: [string, string][];
  /** procurement methods, as SEACE names them */
  m: string[];
  /** buyers: [name, RUC, how linked: "nombre" | "cui" | null = another entity, for a project of this one] */
  b: [string, string, "nombre" | "cui" | null][];
  c: FilaContrato[];
};

/** A document of the contract in SEACE (signed contract, amendments): downloads the PDF. */
export const urlDocumento = (id: string) => `https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/${id}`;

/** A consortium has no RUC of its own in SEACE: an internal code instead. */
export const esRuc = (id: string | null | undefined) => !!id && /^\d{11}$/.test(id);

export const CATEGORIA: Record<string, string> = { o: "Obra", b: "Bien", s: "Servicio" };

export type Via = "competitivo" | "directo" | "especial";

/** How the supplier was chosen, in plain words. Same grouping as the pipeline (contratos.VIA). */
export function metodoInfo(metodo: string): { via: Via; explica: string } {
  const m = metodo.toLowerCase();
  if (/^contratación directa/.test(m)) {
    return { via: "directo", explica: "Sin competencia: la ley la permite solo en casos puntuales (emergencias, proveedor único, entre entidades públicas). Su sustento debe ser público." };
  }
  if (/^exoneración/.test(m)) return { via: "directo", explica: "Sin competencia, con las reglas anteriores a 2019: la entidad se exoneró de convocar un concurso." };
  if (/^convenio/.test(m)) return { via: "especial", explica: "Acuerdo con otra entidad pública o con un organismo internacional, no un concurso entre empresas." };
  if (/^reg[ií]men especial/.test(m)) return { via: "especial", explica: "Contratación con reglas propias que fija una ley especial." };
  if (/^contratación internacional/.test(m)) return { via: "especial", explica: "Compra en el extranjero o a proveedores extranjeros." };
  if (/contrato marco|estandarizad/.test(m)) return { via: "especial", explica: "Compra mediante un acuerdo marco: proveedores y precios elegidos antes por Perú Compras." };
  if (/subasta inversa/.test(m)) return { via: "competitivo", explica: "Subasta en línea para bienes y servicios comunes: gana el precio más bajo." };
  if (/comparación de precios/.test(m)) return { via: "competitivo", explica: "Para bienes y servicios comunes de poco monto: se comparan cotizaciones." };
  if (/^licitación pública abreviada/.test(m)) return { via: "competitivo", explica: "Licitación con plazos más cortos, para montos medianos." };
  if (/^licitación pública/.test(m)) return { via: "competitivo", explica: "Concurso abierto para obras y bienes de monto alto: cualquier empresa puede presentarse." };
  if (/^concurso público abreviado/.test(m)) return { via: "competitivo", explica: "Concurso con plazos más cortos, para servicios de monto mediano." };
  if (/^concurso público/.test(m)) return { via: "competitivo", explica: "Concurso abierto para servicios y consultorías de monto alto." };
  if (/^adjudicación simplificada/.test(m)) return { via: "competitivo", explica: "Procedimiento con competencia y plazos cortos, para montos medianos." };
  if (/competencia (menor|mayor)|proceso por competencia/.test(m)) return { via: "competitivo", explica: "Procedimiento con competencia de la nueva ley de contrataciones (Ley 32069)." };
  if (/^procedimiento especial/.test(m)) return { via: "competitivo", explica: "Procedimiento con plazos reducidos que permite una norma especial (por ejemplo, la reconstrucción)." };
  if (/consultores individuales/.test(m)) return { via: "competitivo", explica: "Selección de un consultor, por lo general en proyectos con préstamos internacionales." };
  if (/adjudicación/.test(m)) return { via: "competitivo", explica: "Procedimiento con competencia de las reglas anteriores, para montos pequeños o medianos." };
  return { via: "competitivo", explica: "Procedimiento de selección registrado en el SEACE." };
}

/** What happened to a contract after it was signed, from its documents in SEACE. */
export const EVENTOS: Record<string, { texto: string; explica: string; tono: "alta" | "media" | "neutro" }> = {
  nulidad: { texto: "Declarado nulo", explica: "La entidad declaró nulo el contrato, por ejemplo por documentos falsos o vicios en el proceso.", tono: "alta" },
  resolucion: { texto: "Resuelto", explica: "El contrato terminó antes de cumplirse, por incumplimiento u otra causa.", tono: "alta" },
  intervencion: { texto: "Obra intervenida", explica: "La entidad tomó el control económico de la obra por atrasos o problemas del contratista.", tono: "alta" },
  adicional: { texto: "Adicional", explica: "Se aprobó pagar más de lo firmado (adicional de obra o contrato complementario).", tono: "media" },
  reduccion: { texto: "Reducción", explica: "Se redujo lo contratado.", tono: "neutro" },
  ampliacion: { texto: "Más plazo", explica: "Se amplió el plazo para cumplir el contrato.", tono: "neutro" },
};

export function eventosDe(s: string | null): { tipo: string; doc: string }[] {
  return (s ?? "").split(",").filter(Boolean).map((x) => {
    const i = x.indexOf(":");
    return { tipo: x.slice(0, i), doc: x.slice(i + 1) };
  });
}

/** Accent- and case-insensitive text for the search box. */
export const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
