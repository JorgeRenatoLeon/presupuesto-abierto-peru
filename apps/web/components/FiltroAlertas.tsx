"use client";

import { useEffect, useMemo, useState } from "react";
import type { Alerta, AlertasResumen } from "@/lib/types";
import { REGLAS_ALERTA, fmtLugar, urlDatos } from "@/lib/types";
import { AlertaCard } from "@/components/AlertaCard";

const LOTE = 30;

/** The page ships only a summary (+ top alerts); a rule's or a department's full list is
 *  fetched when chosen, so mobile users don't download thousands of alerts up front. */
export function FiltroAlertas({ resumen }: { resumen: AlertasResumen }) {
  const [regla, setRegla] = useState("TODAS");
  const [dep, setDep] = useState("TODOS");
  const [soloAltas, setSoloAltas] = useState(false);
  const [limite, setLimite] = useState(LOTE);
  const [lista, setLista] = useState<Alerta[] | null>(resumen.top);
  const [cargando, setCargando] = useState(false);

  // deep links: /alertas/?regla=OBRA_SIN_AVANCE&dep=08
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("regla") && REGLAS_ALERTA[q.get("regla")!]) setRegla(q.get("regla")!);
    if (q.get("dep") && resumen.departamentos.some((d) => d.codigo === q.get("dep"))) setDep(q.get("dep")!);
  }, [resumen.departamentos]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (regla !== "TODAS") q.set("regla", regla);
    if (dep !== "TODOS") q.set("dep", dep);
    const query = q.toString();  // (URLSearchParams.size is missing in older mobile browsers)
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    setLimite(LOTE);
    if (regla === "TODAS" && dep === "TODOS") {
      setLista(resumen.top);
      return;
    }
    const ruta = dep !== "TODOS" ? `alertas/departamento/${dep}.json` : `alertas/${regla}.json`;
    let vigente = true;
    setCargando(true);
    fetch(urlDatos(ruta))
      .then((r) => (r.ok ? r.json() : []))
      .then((xs: Alerta[]) => vigente && setLista(xs))
      .catch(() => vigente && setLista([]))
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [regla, dep, resumen.top]);

  const visibles = useMemo(
    () => (lista ?? []).filter((a) => (regla === "TODAS" || a.regla === regla) && (!soloAltas || a.severidad === "alta")),
    [lista, regla, soloAltas]);
  const muestra = regla === "TODAS" && dep === "TODOS";

  return (
    <>
      <div className="tabs">
        <button className={`tab ${regla === "TODAS" ? "activo" : ""}`} onClick={() => setRegla("TODAS")}>
          Todas ({resumen.total.toLocaleString("es-PE")})
        </button>
        {Object.entries(REGLAS_ALERTA).filter(([k]) => resumen.por_regla[k]).map(([k, v]) => (
          <button key={k} className={`tab ${regla === k ? "activo" : ""}`} onClick={() => setRegla(k)}>
            {v} ({resumen.por_regla[k].total.toLocaleString("es-PE")})
          </button>
        ))}
        <button className={`tab ${soloAltas ? "activo" : ""}`} onClick={() => setSoloAltas(!soloAltas)}>
          Solo prioridad alta ({resumen.alta.toLocaleString("es-PE")})
        </button>
      </div>
      <select className="buscador" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Filtrar por departamento">
        <option value="TODOS">Todos los departamentos</option>
        {[...resumen.departamentos].sort((a, b) => fmtLugar(a.nombre).localeCompare(fmtLugar(b.nombre))).map((d) => (
          <option key={d.codigo} value={d.codigo}>{fmtLugar(d.nombre)} ({d.total})</option>
        ))}
      </select>

      <p className="sub" aria-live="polite">
        {cargando ? "Cargando…" : muestra
          ? `Las ${visibles.length} alertas más importantes. Elige un tipo o un departamento para ver la lista completa.`
          : `${visibles.length.toLocaleString("es-PE")} alerta${visibles.length === 1 ? "" : "s"} con este filtro`}
      </p>

      {visibles.length ? (
        <div style={{ display: "grid", gap: 10, opacity: cargando ? 0.5 : 1 }}>
          {visibles.slice(0, limite).map((a, i) => <AlertaCard key={a.id ?? i} alerta={a} />)}
          {visibles.length > limite ? (
            <button className="tab" style={{ justifySelf: "center" }} onClick={() => setLimite(limite + LOTE)}>
              Mostrar {Math.min(LOTE, visibles.length - limite)} más
              ({(visibles.length - limite).toLocaleString("es-PE")} restantes)
            </button>
          ) : null}
        </div>
      ) : cargando ? null : (
        <div className="tarjeta vacio">
          No hay alertas para este filtro. Eso también es información: no se detectaron
          señales de riesgo con las reglas actuales.
        </div>
      )}
    </>
  );
}
