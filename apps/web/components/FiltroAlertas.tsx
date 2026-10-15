"use client";

import { useMemo, useState } from "react";
import type { Alerta } from "@/lib/types";
import { AlertaCard } from "@/components/AlertaCard";

const REGLAS: Record<string, string> = {
  TODAS: "Todas",
  CAMBIO_TEMA: "Cambios por tema",
  CAMBIO_ANUAL: "Frente al año anterior",
  PIM_CAMBIO: "Cambios por entidad",
  RIESGO_EJEC: "Ejecución lenta",
  PIA_PIM: "Muy distinto al inicial",
};

const LOTE = 30;

export function FiltroAlertas({ alertas }: { alertas: Alerta[] }) {
  const [regla, setReglaRaw] = useState("TODAS");
  const [dept, setDeptRaw] = useState("TODOS");
  const [soloAltas, setSoloAltasRaw] = useState(false);
  const [limite, setLimite] = useState(LOTE);

  // any filter change resets pagination
  const setRegla = (v: string) => { setReglaRaw(v); setLimite(LOTE); };
  const setDept = (v: string) => { setDeptRaw(v); setLimite(LOTE); };
  const setSoloAltas = (v: boolean) => { setSoloAltasRaw(v); setLimite(LOTE); };

  const departamentos = useMemo(
    () => ["TODOS", ...Array.from(new Set(alertas.map((a) => a.departamento).filter(Boolean))).sort()] as string[],
    [alertas],
  );

  const visibles = useMemo(
    () => alertas.filter(
      (a) =>
        (regla === "TODAS" || a.regla === regla) &&
        (dept === "TODOS" || a.departamento === dept) &&
        (!soloAltas || a.severidad === "alta"),
    ),
    [alertas, regla, dept, soloAltas],
  );

  const nAltas = useMemo(() => alertas.filter((a) => a.severidad === "alta").length, [alertas]);

  return (
    <>
      <div className="tabs">
        {Object.entries(REGLAS).map(([k, v]) => (
          <button key={k} className={`tab ${regla === k ? "activo" : ""}`} onClick={() => setRegla(k)}>
            {v}
          </button>
        ))}
        <button className={`tab ${soloAltas ? "activo" : ""}`} onClick={() => setSoloAltas(!soloAltas)}>
          Solo prioridad alta ({nAltas.toLocaleString("es-PE")})
        </button>
      </div>
      {departamentos.length > 2 ? (
        <select className="buscador" value={dept} onChange={(e) => setDept(e.target.value)}
                aria-label="Filtrar por departamento">
          {departamentos.map((d) => (
            <option key={d} value={d}>{d === "TODOS" ? "Todos los departamentos" : d}</option>
          ))}
        </select>
      ) : null}

      <p className="sub" aria-live="polite">
        {visibles.length.toLocaleString("es-PE")} alerta{visibles.length === 1 ? "" : "s"} con este filtro
      </p>

      {visibles.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {visibles.slice(0, limite).map((a, i) => (
            <AlertaCard key={`${a.sec_ejec}-${a.regla}-${a.mes}-${i}`} alerta={a} />
          ))}
          {visibles.length > limite ? (
            <button className="tab" style={{ justifySelf: "center" }}
                    onClick={() => setLimite(limite + LOTE)}>
              Mostrar {Math.min(LOTE, visibles.length - limite)} más
              ({(visibles.length - limite).toLocaleString("es-PE")} restantes)
            </button>
          ) : null}
        </div>
      ) : (
        <div className="tarjeta vacio">
          No hay alertas para este filtro. Eso también es información: no se detectaron
          señales de riesgo con las reglas actuales.
        </div>
      )}
    </>
  );
}
