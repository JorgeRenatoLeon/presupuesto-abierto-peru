"use client";

import { useEffect, useState, type ReactNode } from "react";

type Vista = "funcion" | "tipo";
/** the second panel keeps the id of the section it replaced, so old links still land on it */
const PANEL: Record<Vista, string> = { funcion: "por-area", tipo: "tipo-de-gasto" };

/** The same budget seen two ways, in one place: by area of work (función) or by what it buys or
 *  pays (expense type). Links to #tipo-de-gasto (the old section) open the second view. */
export function VistasGasto({ porFuncion, porTipo }: { porFuncion: ReactNode; porTipo: ReactNode }) {
  const [vista, setVistaActual] = useState<Vista>("funcion");
  // the second view is drawn the first time it is asked for: 2,900 pages need not carry it twice
  const [tipoVisto, setTipoVisto] = useState(false);
  const setVista = (v: Vista) => { setVistaActual(v); if (v === "tipo") setTipoVisto(true); };
  useEffect(() => {
    const alLlegar = () => {
      if (location.hash === "#tipo-de-gasto") {
        setVista("tipo");
        requestAnimationFrame(() => document.getElementById("en-que")?.scrollIntoView());
      }
    };
    alLlegar();
    window.addEventListener("hashchange", alLlegar);
    return () => window.removeEventListener("hashchange", alLlegar);
  }, []);
  const pestana = (v: Vista, texto: string) => (
    <button type="button" role="tab" id={`vista-${v}`} aria-controls={PANEL[v]} aria-selected={vista === v}
            tabIndex={vista === v ? 0 : -1} className="tab" onClick={() => setVista(v)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                const otra: Vista = v === "funcion" ? "tipo" : "funcion";
                setVista(otra);
                document.getElementById(`vista-${otra}`)?.focus();
              }
            }}>
      {texto}
    </button>
  );
  return (
    <>
      <div className="tabs vistas" role="tablist" aria-label="Ver el presupuesto">
        {pestana("funcion", "Por área")}
        {pestana("tipo", "Por tipo de gasto")}
      </div>
      <p className="vistas-nota">
        {vista === "funcion"
          ? "Las áreas de trabajo del Estado (funciones): ambiente, transporte, salud… Abre una para ver sus actividades y obras."
          : "Lo que se compra o se paga con el mismo dinero: sueldos, bienes y servicios, obras… Abre uno para ver qué incluye."}
      </p>
      <div role="tabpanel" id={PANEL.funcion} aria-labelledby="vista-funcion" hidden={vista !== "funcion"}>{porFuncion}</div>
      <div role="tabpanel" id={PANEL.tipo} aria-labelledby="vista-tipo" hidden={vista !== "tipo"}>{tipoVisto ? porTipo : null}</div>
    </>
  );
}
