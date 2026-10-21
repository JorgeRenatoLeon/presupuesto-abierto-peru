import { fmtSoles, fmtPct, fmtNombre } from "@/lib/types";
import { TINTAS } from "@/components/Franja";

/** A step's bar: the parts of the budget it is about, in ink order (decorative: the note says it). */
type Tramo = { parte: number; tinta: string };
export type Paso = { href: string; verbo: string; cifra: string; nota?: string | null; tramos?: Tramo[] };

/** The page's map: how the money goes from the budget to the areas it is split into, to the
 *  activities and projects that use it and, in part, to the suppliers it is contracted with. Each
 *  step links to its section, so "what is part of what" is the first thing the page says. */
export function RutaDinero({ pasos }: { pasos: Paso[] }) {
  return (
    <nav className="ruta" aria-label="De dónde a dónde va su presupuesto">
      <ol>
        {pasos.map((p, i) => (
          <li key={p.href + i}>
            <a href={p.href}>
              <span className="paso-num" aria-hidden>{i + 1}</span>
              <span className="ruta-texto">
                <span className="ruta-verbo">{p.verbo}</span>
                <b>{p.cifra}</b>
                {p.tramos?.length ? (
                  <span className="ruta-barra" aria-hidden>
                    {p.tramos.map((t, k) => <span key={k} className={t.tinta} style={{ flexGrow: t.parte }} />)}
                  </span>
                ) : null}
                {p.nota ? <small>{p.nota}</small> : null}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

/** The steps of an entity, from its figures; a step without data is left out. */
export function pasosEntidad({ pim, avance, ano, funciones, items, contratos }: {
  pim: number | null; avance: number | null; ano: number;
  /** its areas (funciones), largest first, with their budget */
  funciones: { nombre: string; pim: number }[];
  /** [activities, projects, budget of the activities, budget of the projects] */
  items: [number, number, number, number];
  contratos?: { n: number; monto: number | null; proveedores: number | null; periodo: string } | null;
}): Paso[] {
  const total = funciones.reduce((a, f) => a + Math.max(f.pim, 0), 0) || pim || 0;
  const mayor = funciones[0];
  const pasos: Paso[] = [{
    href: "#resumen", verbo: `Tiene para ${ano}`, cifra: fmtSoles(pim),
    nota: avance != null ? `Lleva gastado el ${fmtPct(avance)}` : null,
    tramos: avance != null ? [{ parte: Math.min(avance, 1), tinta: "verde" }, { parte: Math.max(1 - avance, 0), tinta: "otras" }] : undefined,
  }];
  if (funciones.length && total) {
    const tramos: Tramo[] = funciones.slice(0, 5).map((f, i) => ({ parte: Math.max(f.pim, 0) / total, tinta: TINTAS[i] }));
    const resto = funciones.slice(5).reduce((a, f) => a + Math.max(f.pim, 0), 0);
    if (resto > 0) tramos.push({ parte: resto / total, tinta: "otras" });
    pasos.push({
      href: "#en-que", verbo: "Lo reparte en", cifra: plural(funciones.length, "área", "áreas"),
      nota: mayor ? `La mayor: ${fmtNombre(mayor.nombre)} (${Math.round((mayor.pim / total) * 100)}%)` : null, tramos,
    });
  }
  const [actividades, proyectos, enActividades, enProyectos] = items;
  if (actividades || proyectos) {
    const suma = enActividades + enProyectos || 1;
    pasos.push({
      href: proyectos ? "#obras" : "#en-que", verbo: "Lo usa en",
      cifra: [actividades ? plural(actividades, "actividad", "actividades") : null, proyectos ? plural(proyectos, "obra", "obras") : null]
        .filter(Boolean).join(" y "),
      nota: proyectos
        ? `${fmtSoles(enActividades)} en su trabajo de cada año y ${fmtSoles(enProyectos)} en obras (${Math.round((enProyectos / suma) * 100)}%)`
        : "Su trabajo de cada año: no tiene obras este año",
      tramos: proyectos ? [{ parte: enActividades / suma, tinta: "amarillo" }, { parte: enProyectos / suma, tinta: "verde" }] : undefined,
    });
  }
  if (contratos?.n) {
    pasos.push({
      href: "#contratos", verbo: "Contrata a", cifra: plural(contratos.proveedores ?? 0, "proveedor", "proveedores"),
      nota: `${fmtSoles(contratos.monto)} firmados en ${plural(contratos.n, "contrato", "contratos")} (${contratos.periodo})`,
    });
  }
  return pasos;
}
