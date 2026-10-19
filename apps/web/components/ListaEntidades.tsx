"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EntidadResumen } from "@/lib/types";
import { fmtSoles, fmtPct, fmtLugar } from "@/lib/types";
import { BarraProgreso } from "@/components/ui";

type Orden = "provincia" | "avance" | "monto" | "alertas";

/** accent-insensitive match: "huanuco" finds "HUÁNUCO" */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Executing units of a department (municipalidades, gobierno regional), searchable and sortable. */
export function ListaEntidades({ entidades, esperado, porProvincia = false, buscador = true }: {
  /** esperado: share of the year the data covers (expected execution pace) */
  entidades: EntidadResumen[]; esperado: number | null; porProvincia?: boolean; buscador?: boolean;
}) {
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState<Orden>(porProvincia ? "provincia" : "monto");
  const avance = (e: EntidadResumen) => (e.pim ? (e.devengado ?? 0) / e.pim : null);

  const visibles = useMemo(() => {
    const t = norm(q.trim());
    const xs = entidades.filter((e) => !t || norm(`${e.nombre} ${e.provincia ?? ""} ${e.distrito ?? ""}`).includes(t));
    const por: Record<Orden, (a: EntidadResumen, b: EntidadResumen) => number> = {
      provincia: (a, b) => (a.provincia ?? "").localeCompare(b.provincia ?? "") || (b.pim ?? 0) - (a.pim ?? 0),
      avance: (a, b) => (avance(a) ?? 2) - (avance(b) ?? 2),
      monto: (a, b) => (b.pim ?? 0) - (a.pim ?? 0),
      alertas: (a, b) => b.alertas.alta - a.alertas.alta || b.alertas.total - a.alertas.total,
    };
    return [...xs].sort(por[orden]);
  }, [entidades, q, orden]);

  const tono = (e: EntidadResumen): "ok" | "warn" | "bad" | undefined => {
    const a = avance(e);
    if (a == null || esperado == null) return undefined;
    const gap = esperado - a;
    return gap <= 0.05 ? "ok" : gap <= 0.15 ? "warn" : "bad";
  };

  let provinciaActual: string | null = null;
  return (
    <>
      {buscador ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <input className="buscador" style={{ flex: "1 1 200px" }} value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Busca tu distrito o municipalidad…" aria-label="Buscar entidad" />
          <select className="buscador" style={{ width: "auto" }} value={orden}
                  onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar">
            {porProvincia ? <option value="provincia">Agrupar por provincia</option> : null}
            <option value="monto">Mayor presupuesto</option>
            <option value="avance">Menor avance primero</option>
            <option value="alertas">Más alertas</option>
          </select>
        </div>
      ) : null}
      {visibles.length ? (
        <ul className="cmp-lista">
          {visibles.map((e) => {
            const cabecera = orden === "provincia" && e.provincia !== provinciaActual;
            provinciaActual = e.provincia;
            return (
              <li key={e.sec_ejec}>
                {cabecera ? <div className="grupo-titulo">Provincia de {fmtLugar(e.provincia ?? "—")}</div> : null}
                <Link href={`/entidad/${e.sec_ejec}/`} className="fila-lista">
                  <div className="linea1">
                    <span className="nombre">{fmtLugar(e.nombre)}</span>
                    <span className="monto">{fmtSoles(e.pim)}</span>
                  </div>
                  <BarraProgreso avance={avance(e)} tono={tono(e)} />
                  <div className="detalle">
                    <span>
                      {e.alertas.alta ? <span className="badge alta" style={{ marginRight: 6 }}>{e.alertas.alta} alertas altas</span> : null}
                      {e.obras_sin_avance ? <span className="badge media">{e.obras_sin_avance} proyectos sin avance</span> : null}
                    </span>
                    <span>{fmtPct(avance(e))} ejecutado{esperado ? ` (esperado ${fmtPct(esperado)})` : ""}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="vacio">{q ? `Nada coincide con “${q}”.` : "Sin entidades registradas."}</div>
      )}
    </>
  );
}
