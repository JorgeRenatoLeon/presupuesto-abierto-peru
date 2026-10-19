import { MESES, fmtSoles } from "@/lib/types";

/** Paired bars: ingreso recaudado vs gasto devengado per month (the two sides of the coin). */
export function GraficoContraste({
  puntos,
}: {
  puntos: { mes: number; ingreso: number | null; gasto: number | null }[];
}) {
  if (!puntos.length) return <div className="vacio">Aún no hay datos de ambos lados para comparar.</div>;
  const W = 720, H = 220, padL = 8, padB = 26, padT = 14;
  const max = Math.max(...puntos.flatMap((p) => [p.ingreso ?? 0, p.gasto ?? 0]), 1);
  const bw = (W - padL * 2) / 12;
  const plotH = H - padB - padT;
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
         aria-label="Ingresos recaudados frente a gasto devengado por mes">
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padL} y1={padT + plotH * (1 - t)} y2={padT + plotH * (1 - t)}
              className="eje" strokeDasharray="3 4" />
      ))}
      {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
        const p = puntos.find((x) => x.mes === mes);
        const hi = p?.ingreso ? (plotH * p.ingreso) / max : 0;
        const hg = p?.gasto ? (plotH * p.gasto) / max : 0;
        return (
          <g key={mes}>
            {hi > 0 ? (
              <rect x={padL + (mes - 1) * bw + bw * 0.12} y={H - padB - hi}
                    width={bw * 0.34} height={Math.max(hi, 2)} className="serie-ingreso">
                <title>{`${MESES[mes]} — Ingresos: ${fmtSoles(p!.ingreso)}`}</title>
              </rect>
            ) : null}
            {hg > 0 ? (
              <rect x={padL + (mes - 1) * bw + bw * 0.52} y={H - padB - hg}
                    width={bw * 0.34} height={Math.max(hg, 2)} className="serie-gasto">
                <title>{`${MESES[mes]} — Gasto: ${fmtSoles(p!.gasto)}`}</title>
              </rect>
            ) : null}
            <text x={padL + (mes - 1) * bw + bw / 2} y={H - 22} textAnchor="middle"
                  fontSize="11" className={`rotulo ${mes % 2 === 0 ? "mes-par" : ""}`}>{MESES[mes].slice(0, 3)}</text>
          </g>
        );
      })}
    </svg>
    <p className="leyenda-html">
      <span><span className="chip verde" aria-hidden />Ingresos (recaudado)</span>
      <span><span className="chip amarillo" aria-hidden />Gasto (devengado)</span>
    </p>
    </>
  );
}

/** Monthly execution bar chart, dependency-free SVG. */
export function GraficoMensual({ puntos }: { puntos: { mes: number; valor: number }[] }) {
  if (!puntos.length) return <div className="vacio">Aún no hay serie mensual para mostrar.</div>;
  const W = 720, H = 220, padL = 8, padB = 26, padT = 14;
  const max = Math.max(...puntos.map((p) => p.valor), 1);
  const bw = (W - padL * 2) / 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
         aria-label="Gasto devengado por mes">
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padL} y1={padT + (H - padB - padT) * (1 - t)}
              y2={padT + (H - padB - padT) * (1 - t)} className="eje" strokeDasharray="3 4" />
      ))}
      {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
        const p = puntos.find((x) => x.mes === mes);
        const h = p ? ((H - padB - padT) * p.valor) / max : 0;
        return (
          <g key={mes}>
            {p ? (
              <rect x={padL + (mes - 1) * bw + bw * 0.18} y={H - padB - h}
                    width={bw * 0.64} height={Math.max(h, 2)} className="serie-gasto">
                <title>{`${MESES[mes]}: ${fmtSoles(p.valor)}`}</title>
              </rect>
            ) : null}
            <text x={padL + (mes - 1) * bw + bw / 2} y={H - 8} textAnchor="middle"
                  fontSize="11" className={`rotulo ${mes % 2 === 0 ? "mes-par" : ""}`}>{MESES[mes].slice(0, 3)}</text>
          </g>
        );
      })}
    </svg>
  );
}
