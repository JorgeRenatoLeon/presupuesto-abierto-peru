"use client";

// A client component only so the page payload carries its props, not its whole element tree
// (2,900 entity pages); it has no state and renders on the server like any other.
import Link from "next/link";
import { fmtSoles, fmtPct, fichaInversion, type Obra, fmtNombre } from "@/lib/types";
import { BarraProgreso } from "@/components/ui";
import { ContratosDeObra } from "@/components/Contratos";

/** Signals computed by the pipeline (compare._obras): same words everywhere on the site. */
export const SENAL_OBRA: Record<string, { texto: string; clase: "alta" | "media" }> = {
  sin_avance: { texto: "Sin avance", clase: "alta" },
  avance_bajo: { texto: "Avance muy bajo", clase: "media" },
  recortada: { texto: "Presupuesto recortado", clase: "media" },
};

/** sec: the entity whose page this is; its projects then open the contracts that carry their CUI. */
export function ListaObras({ obras, conEntidad = false, vacio, sec }: {
  obras: Obra[]; conEntidad?: boolean; vacio?: string; sec?: string;
}) {
  if (!obras.length) return <div className="vacio">{vacio ?? "Sin proyectos de inversión registrados."}</div>;
  return (
    <ul className="obras">
      {obras.map((o) => {
        const avance = o.pim ? (o.devengado ?? 0) / o.pim : null;
        const s = o.senal ? SENAL_OBRA[o.senal] : null;
        return (
          <li key={`${o.sec_ejec ?? ""}-${o.cui}`} className="obra">
            <div className="obra-nombre">{fmtNombre(o.nombre)}</div>
            <div className="obra-meta">
              {s ? <span className={`badge ${s.clase}`}>{s.texto}</span> : null}
              {conEntidad && o.entidad
                ? (o.sec_ejec ? <Link href={`/entidad/${o.sec_ejec}/`}>{o.entidad}</Link> : <span>{o.entidad}</span>)
                : null}
              {o.funcion ? <span>{o.funcion}</span> : null}
            </div>
            <BarraProgreso avance={avance} tono={s?.clase === "alta" ? "bad" : undefined} />
            <div className="detalle">
              <span>Este año: {fmtPct(avance)} gastado de {fmtSoles(o.pim)}</span>
              <a href={fichaInversion(o.cui)} target="_blank" rel="noopener">Ficha oficial · CUI {o.cui} ↗</a>
            </div>
            {o.dev_ano_ant ? (
              <div className="detalle"><span>El año pasado ejecutó {fmtSoles(o.dev_ano_ant)}</span></div>
            ) : null}
            {o.t?.[0] ? (
              <div className="detalle obra-total">
                <span>
                  Obra completa: {fmtSoles(o.t[0])}
                  {o.t[1] && o.t[0] / o.t[1] >= 1.3 ? <b className="sube"> (+{fmtPct(o.t[0] / o.t[1] - 1)} sobre lo aprobado)</b> : null}
                  {o.t[2] != null ? ` · gastado desde el inicio: ${fmtPct(o.t[2] / o.t[0])}` : ""}
                  {o.t[3] != null ? ` · avance físico ${fmtPct(o.t[3] / 100)}` : ""}
                </span>
              </div>
            ) : null}
            {sec && (o.c || o.t) ? <ContratosDeObra sec={sec} cui={o.cui} n={o.c?.[0] ?? 0} monto={o.c?.[1] ?? null} anual={o.pim} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
