import { fmtSoles, fmtPct, fmtNombre } from "@/lib/types";
import { Explicable } from "@/components/Explicacion";
import { ItemsAlAbrir } from "@/components/ItemsAlAbrir";
import { Franja, tinta } from "@/components/Franja";

export type ItemEntidad = { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null };
export type FuncionEntidad = { codigo: string; funcion: string; devengado: number };


/** Spending by función (or genérica). Each row opens, with no JavaScript, what this entity itself
 *  pays for there and what the category means; both load on demand, so the page stays light. */
export function DesgloseFunciones({ funciones, sec, dimension = "funcion" }:
  { funciones: FuncionEntidad[]; sec?: string; dimension?: "funcion" | "generica" }) {
  if (!funciones.length) return <div className="vacio">Sin gasto registrado todavía este año.</div>;
  const total = funciones.reduce((a, f) => a + (f.devengado ?? 0), 0) || 1;
  const orden = [...funciones].sort((a, b) => (b.devengado ?? 0) - (a.devengado ?? 0));
  const segs = orden.slice(0, 5).map((f) => ({ id: f.codigo, nombre: f.funcion, monto: f.devengado ?? 0 }));
  if (orden.length > 5) segs.push({ id: "resto", nombre: "Las demás", monto: orden.slice(5).reduce((a, f) => a + (f.devengado ?? 0), 0) });
  return (
    <>
    <Franja segmentos={segs} etiqueta="Reparto de lo gastado" />
    <ul className="desglose">
      {orden.map((f, i) => {
        return (
          <li key={f.codigo}>
            <details>
              <summary className="desglose-fila">
                <span className="linea1">
                  <span className="nombre"><span className={`chip ${i < 5 ? tinta(i) : "otras"}`} aria-hidden />{fmtNombre(f.funcion)}</span>
                  <span className="cifra">{fmtSoles(f.devengado)}</span>
                </span>
                <span className="detalle">
                  <span>{fmtPct((f.devengado ?? 0) / total)} de lo gastado</span>
                  <span className="desglose-accion">{sec && dimension === "funcion" ? "¿En qué?" : "¿Qué es?"}</span>
                </span>
              </summary>
              <div className="desglose-panel">
                {sec && dimension === "funcion" ? <ItemsAlAbrir sec={sec} codigo={f.codigo} /> : null}
                <Explicable dimension={dimension} id={f.codigo} nombre={fmtNombre(f.funcion)} soloDefinicion
                            texto={`¿Qué es «${fmtNombre(f.funcion)}»? Definición oficial`} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
    </>
  );
}
