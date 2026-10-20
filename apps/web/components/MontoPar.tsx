import { fmtSoles } from "@/lib/types";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** How far along the spending is, in words, against what the calendar expects by now. */
function ritmo(avance: number, esperado: number): { texto: string; tono: "ok" | "warn" | "bad" | "neutro" } {
  const d = Math.round((avance - esperado) * 100);
  if (d > 15) return { texto: `${d} puntos por encima de lo esperado a la fecha (${pct(esperado)})`, tono: "neutro" };
  if (d >= -5) return { texto: `Al ritmo esperado a la fecha (${pct(esperado)})`, tono: "ok" };
  if (d >= -15) return { texto: `Algo atrasado: ${-d} puntos por debajo de lo esperado (${pct(esperado)})`, tono: "warn" };
  return { texto: `Atrasado: ${-d} puntos por debajo de lo esperado (${pct(esperado)})`, tono: "bad" };
}

/** Budget and spending, never as a bare line: labelled amounts, a bar that carries its own
 *  percentage, a tick where the calendar says spending should be by now and, on main rows, what is
 *  left to spend and a verdict in words. No hooks: works in server and client components. */
export function MontoPar({ pim, devengado, esperado, compacto = false }: {
  pim: number | null | undefined; devengado: number | null | undefined; esperado?: number | null; compacto?: boolean;
}) {
  const avance = pim ? Math.max(0, (devengado ?? 0) / pim) : null;
  const falta = pim != null ? Math.max(pim - (devengado ?? 0), 0) : null;
  const veredicto = avance != null && esperado != null ? ritmo(avance, esperado) : null;
  return (
    <span className={`monto-par ${compacto ? "compacto" : ""}`}>
      <span className="mp-cifras">
        <span className="mp-cifra"><span className="mp-etq">Presupuesto</span> <b>{fmtSoles(pim)}</b></span>
        <span className="mp-cifra"><span className="mp-etq">Gastado</span> <b>{fmtSoles(devengado)}</b></span>
        {!compacto && falta != null ? <span className="mp-cifra"><span className="mp-etq">Falta gastar</span> <b>{fmtSoles(falta)}</b></span> : null}
      </span>
      {avance != null ? (
        <span className="mp-medidor">
          <span className={`mp-barra ${veredicto?.tono ?? ""}`} role="img"
                aria-label={`Gastado ${pct(avance)} del presupuesto${esperado != null ? `; lo esperado a la fecha es ${pct(esperado)}` : ""}`}>
            <span className="mp-lleno" style={{ width: `${Math.min(avance, 1) * 100}%` }} />
            {esperado != null ? <i className="mp-marca" style={{ left: `${Math.min(esperado, 1) * 100}%` }} /> : null}
          </span>
          <span className="mp-valor">{pct(avance)}<small> gastado</small></span>
        </span>
      ) : null}
      {!compacto && veredicto ? <span className={`mp-ritmo ${veredicto.tono}`}>{veredicto.texto}</span> : null}
    </span>
  );
}

/** One line explaining the bars of a section, so the reader never has to infer it. */
export function LeyendaBarra({ esperado }: { esperado?: number | null }) {
  return (
    <p className="leyenda-barra">
      <span className="lb-lleno" aria-hidden /> parte del presupuesto ya gastada (el % está al lado)
      {esperado != null ? <> · <span className="lb-marca" aria-hidden /> lo que debería llevar gastado a la fecha ({pct(esperado)})</> : null}
    </p>
  );
}
