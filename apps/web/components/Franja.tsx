import { fmtNombre } from "@/lib/types";

/** Ink order validated for colour-blind separation of neighbours (dataviz validator, dark surface):
 *  fucsia, amarillo, verde, celeste, naranja; whatever is left is "otras" in the rule colour. */
export const TINTAS = ["fucsia", "amarillo", "verde", "celeste", "naranja"] as const;

export type Segmento = { id: string; nombre: string; monto: number };

/** A budget split as one stacked band of ink segments (the cartel's signature). Identity never
 *  rests on colour alone: each segment is labelled when wide enough and the rows below are its
 *  legend, each with its chip and share. */
export function Franja({ segmentos, etiqueta }: { segmentos: Segmento[]; etiqueta: string }) {
  const total = segmentos.reduce((a, s) => a + Math.max(s.monto, 0), 0) || 1;
  return (
    <div className="franja" role="img" aria-label={`${etiqueta}: ` + segmentos.map((s) =>
      `${fmtNombre(s.nombre)} ${Math.round((s.monto / total) * 100)}%`).join(", ")}>
      {segmentos.map((s, i) => {
        const pct = (Math.max(s.monto, 0) / total) * 100;
        return (
          <span key={s.id} className={`franja-seg ${TINTAS[i] ?? "otras"}`} style={{ flexGrow: pct, "--i": i } as React.CSSProperties}>
            {pct >= 9 ? <span className="franja-rotulo">{Math.round(pct)}%</span> : null}
          </span>
        );
      })}
    </div>
  );
}

export const tinta = (i: number) => TINTAS[i] ?? "otras";
