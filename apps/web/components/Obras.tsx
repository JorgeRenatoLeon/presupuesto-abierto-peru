import Link from "next/link";
import { fmtSoles, fmtPct, fichaInversion, type Obra } from "@/lib/types";
import { BarraProgreso } from "@/components/ui";

/** Signals computed by the pipeline (compare._obras): same words everywhere on the site. */
export const SENAL_OBRA: Record<string, { texto: string; clase: "alta" | "media" }> = {
  sin_avance: { texto: "Sin avance", clase: "alta" },
  avance_bajo: { texto: "Avance muy bajo", clase: "media" },
  recortada: { texto: "Presupuesto recortado", clase: "media" },
};

export function ListaObras({ obras, conEntidad = false, vacio }: {
  obras: Obra[]; conEntidad?: boolean; vacio?: string;
}) {
  if (!obras.length) return <div className="vacio">{vacio ?? "Sin proyectos de inversión registrados."}</div>;
  return (
    <ul className="obras">
      {obras.map((o) => {
        const avance = o.pim ? (o.devengado ?? 0) / o.pim : null;
        const s = o.senal ? SENAL_OBRA[o.senal] : null;
        return (
          <li key={`${o.sec_ejec ?? ""}-${o.cui}`} className="obra">
            <div className="obra-nombre">{o.nombre}</div>
            <div className="obra-meta">
              {s ? <span className={`badge ${s.clase}`}>{s.texto}</span> : null}
              {conEntidad && o.entidad
                ? (o.sec_ejec ? <Link href={`/entidad/${o.sec_ejec}/`}>{o.entidad}</Link> : <span>{o.entidad}</span>)
                : null}
              {o.funcion ? <span>{o.funcion}</span> : null}
            </div>
            <BarraProgreso avance={avance} tono={s?.clase === "alta" ? "bad" : undefined} />
            <div className="detalle">
              <span>{fmtPct(avance)} ejecutado de {fmtSoles(o.pim)}</span>
              <a href={fichaInversion(o.cui)} target="_blank" rel="noopener">Ficha oficial · CUI {o.cui} ↗</a>
            </div>
            {o.dev_ano_ant ? (
              <div className="detalle"><span>El año pasado ejecutó {fmtSoles(o.dev_ano_ant)}</span></div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
