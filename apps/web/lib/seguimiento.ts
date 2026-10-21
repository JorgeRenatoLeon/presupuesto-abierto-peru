/** Watchlist kept in this browser (localStorage): no accounts, nothing leaves the device.
 *  Every access is wrapped: storage can be blocked (private mode, disabled site data). */
export type Seguido = {
  tipo: "entidad" | "departamento" | "tema" | "proveedor" | "producto";
  id: string;
  nombre: string;
  /** for temas: funcion | etiqueta | departamento (pipeline compare.py dimensions) */
  dimension?: string;
  /** what "Siguiendo" showed last time, to tell what is new: the latest contract or purchase date
   *  seen and, for a product, its usual price then */
  visto?: { hasta?: string; precio?: number };
};

const CLAVE = "pap:seguidos:v1";
const CLAVE_VISTA = "pap:ultima-publicacion:v1";

export function leerSeguidos(): Seguido[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function guardarSeguidos(xs: Seguido[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(xs));
  } catch {
    /* storage unavailable: following just won't persist */
  }
}

export const mismo = (a: Seguido, b: Seguido) =>
  a.tipo === b.tipo && a.id === b.id && (a.dimension ?? "") === (b.dimension ?? "");

/** The MEF publication the user last saw in "Siguiendo": alerts from newer ones are "nuevas". */
export function ultimaPublicacionVista(): string | null {
  try {
    return localStorage.getItem(CLAVE_VISTA);
  } catch {
    return null;
  }
}

export function marcarPublicacionVista(id: string): void {
  try {
    localStorage.setItem(CLAVE_VISTA, id);
  } catch {
    /* ignore */
  }
}

const CLAVE_ALERTAS = "pap:alertas-vistas:v1";

/** Identity of an alert across MEF publications (its id changes with each publication). */
export const claveAlerta = (a: { regla: string; sec_ejec?: string | null; codigo?: string; ano: number }) =>
  `${a.regla}|${a.sec_ejec ?? ""}|${a.codigo ?? ""}|${a.ano}`;

/** Alerts already shown in "Siguiendo"; null on the first visit (nothing is marked new then). */
export function leerAlertasVistas(): Set<string> | null {
  try {
    const v = localStorage.getItem(CLAVE_ALERTAS);
    return v ? new Set(JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

export function guardarAlertasVistas(claves: Iterable<string>): void {
  try {
    localStorage.setItem(CLAVE_ALERTAS, JSON.stringify(Array.from(claves).slice(-3000)));
  } catch {
    /* ignore */
  }
}

/** Remember what "Siguiendo" just showed for an item (see Seguido.visto). */
export function marcarVisto(s: Seguido, visto: NonNullable<Seguido["visto"]>): void {
  guardarSeguidos(leerSeguidos().map((x) => (mismo(x, s) ? { ...x, visto } : x)));
}
