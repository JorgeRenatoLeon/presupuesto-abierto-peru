import { fmtSoles, fmtPct } from "@/lib/types";
import { Explicable } from "@/components/Explicacion";
import { ItemsAlAbrir } from "@/components/ItemsAlAbrir";

export type ItemEntidad = { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null };
export type FuncionEntidad = { codigo: string; funcion: string; devengado: number };

const oracion = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** Spending by función (or genérica). Each row opens, with no JavaScript, what this entity itself
 *  pays for there and what the category means; both load on demand, so the page stays light. */
export function DesgloseFunciones({ funciones, sec, dimension = "funcion" }:
  { funciones: FuncionEntidad[]; sec?: string; dimension?: "funcion" | "generica" }) {
  if (!funciones.length) return <div className="vacio">Sin gasto registrado todavía este año.</div>;
  const total = funciones.reduce((a, f) => a + (f.devengado ?? 0), 0) || 1;
  const max = Math.max(...funciones.map((f) => f.devengado ?? 0), 1);
  return (
    <ul className="desglose">
      {funciones.map((f) => {
        return (
          <li key={f.codigo}>
            <details>
              <summary className="desglose-fila">
                <span className="linea1">
                  <span className="nombre">{oracion(f.funcion)}</span>
                  <span className="cifra">{fmtSoles(f.devengado)}</span>
                </span>
                <span className="barra"><span style={{ width: `${((f.devengado ?? 0) / max) * 100}%` }} /></span>
                <span className="detalle">
                  <span>{fmtPct((f.devengado ?? 0) / total)} de lo gastado</span>
                  <span className="desglose-accion">{sec && dimension === "funcion" ? "¿En qué?" : "¿Qué es?"}</span>
                </span>
              </summary>
              <div className="desglose-panel">
                {sec && dimension === "funcion" ? <ItemsAlAbrir sec={sec} codigo={f.codigo} /> : null}
                <Explicable dimension={dimension} id={f.codigo} nombre={oracion(f.funcion)} soloDefinicion
                            texto={`¿Qué es «${oracion(f.funcion)}»? Definición oficial`} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
