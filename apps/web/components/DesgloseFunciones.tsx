"use client";

// A client component only so the page payload carries its props, not its whole element tree
// (2,900 entity pages); it has no state and renders on the server like any other.
import { ChevronDown } from "lucide-react";
import { fmtSoles, fmtNombre } from "@/lib/types";
import { Explicable } from "@/components/Explicacion";
import { ItemsAlAbrir } from "@/components/ItemsAlAbrir";
import { Franja, tinta } from "@/components/Franja";
import { MontoPar, LeyendaBarra } from "@/components/MontoPar";
import { ContratosDeGasto } from "@/components/Contratos";
import { CerrarPanel } from "@/components/CerrarPanel";

export type FuncionEntidad = { codigo: string; funcion: string; pim?: number | null; devengado: number };

/** Budget by función (or genérica): one ink band for the split, then a row per category with its
 *  budget and spending labelled. Each row opens, with no JavaScript, what the entity itself pays for
 *  there (activities and projects, each with "¿En qué exactamente?") and the MEF definition. */
export function DesgloseFunciones({ funciones, sec, dimension = "funcion", esperado, contratos = false }: {
  funciones: FuncionEntidad[]; sec?: string; dimension?: "funcion" | "generica"; esperado?: number | null;
  /** the site has SEACE contracts: rows show the unit's contracts behind their spending */
  contratos?: boolean;
}) {
  if (!funciones.length) return <div className="vacio">Sin presupuesto registrado este año.</div>;
  const conPim = funciones.some((f) => f.pim != null);
  const base = (f: FuncionEntidad) => (conPim ? f.pim ?? 0 : f.devengado ?? 0);
  const orden = [...funciones].sort((a, b) => base(b) - base(a));
  const total = orden.reduce((a, f) => a + base(f), 0) || 1;
  const segs = orden.slice(0, 5).map((f) => ({ id: f.codigo, nombre: f.funcion, monto: base(f) }));
  if (orden.length > 5) segs.push({ id: "resto", nombre: "Las demás", monto: orden.slice(5).reduce((a, f) => a + base(f), 0) });
  const conItems = !!sec && dimension === "funcion";
  return (
    <>
      <Franja segmentos={segs} etiqueta={conPim ? "Reparto del presupuesto" : "Reparto de lo gastado"} />
      {conPim ? <LeyendaBarra esperado={esperado} /> : null}
      <ul className="desglose">
        {orden.map((f, i) => (
          <li key={f.codigo}>
            <details>
              <summary className="desglose-fila">
                <span className="linea1">
                  <span className="nombre"><span className={`chip ${i < 5 ? tinta(i) : "otras"}`} aria-hidden />{fmtNombre(f.funcion)}</span>
                  <span className="cuota">{Math.round((base(f) / total) * 100)}% del {conPim ? "presupuesto" : "gasto"}</span>
                </span>
                {conPim ? <MontoPar pim={f.pim} devengado={f.devengado} esperado={esperado} />
                  : <span className="cifra">Gastado {fmtSoles(f.devengado)}</span>}
                <span className="desglose-accion">
                  {conItems ? "Ver en qué se usa" : sec && contratos ? "Qué es y qué contrató" : "¿Qué es?"}{" "}
                  <ChevronDown className="icono-linea" aria-hidden />
                </span>
              </summary>
              <div className="desglose-panel">
                {conItems ? <ItemsAlAbrir sec={sec!} codigo={f.codigo} nombre={fmtNombre(f.funcion)} total={f.pim ?? null}
                                          esperado={esperado} contratos={contratos} /> : null}
                {sec && contratos && dimension === "generica" ? <ContratosDeGasto sec={sec} prefijo={f.codigo} /> : null}
                <Explicable dimension={dimension} id={f.codigo} nombre={fmtNombre(f.funcion)} soloDefinicion
                            texto={`¿Qué es «${fmtNombre(f.funcion)}»? Definición oficial`} />
                <CerrarPanel texto={`Cerrar «${fmtNombre(f.funcion)}»`} />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
