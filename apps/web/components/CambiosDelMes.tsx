"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmtSoles, fmtPct, urlDatos, MESES } from "@/lib/types";
import { cargarDatos } from "@/lib/contratos";

/** mes/<sec>.json (pipeline exportar._meses): month by month per expense type, January to the
 *  month of the data. dev: accrued (devengado); comp: annual commitments registered that month
 *  (obligations signed); mens: monthly commitment (SIAF's "compromiso mensual"). */
type Linea = [string, number, number[], number[], number[]];
type ArchivoMes = {
  corte: string; transcurridos: number; restantes: number; m: number;
  t: [number, number[], number[], number[]]; l: Linea[];
  /** the smaller lines, summed: [how many, budget, dev, comp, mens] */
  o?: [number, number, number[], number[], number[]];
};
type Clasificador = { especificas: Record<string, [string, string | null]> };

const MES = (m: number) => MESES[m].charAt(0) + MESES[m].slice(1).toLowerCase();
const suma = (xs: number[], hasta?: number) => xs.slice(0, hasta ?? xs.length).reduce((a, x) => a + x, 0);
const veces = (r: number) => `${r.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces`;

/** A commitment in monthly terms: what is committed and not yet spent, spread over the months left
 *  in the year, against what was spent per month so far. A contract signed for the whole year is
 *  not a month's spending: this is what it means for the months ahead. */
function efecto(comp: number[], dev: number[], d: ArchivoMes) {
  const comprometido = suma(comp), gastado = suma(dev);
  const pendiente = Math.max(comprometido - gastado, 0);
  const porMes = d.restantes > 0.2 ? pendiente / d.restantes : null;
  const promedio = d.transcurridos > 0 ? gastado / d.transcurridos : null;
  return { comprometido, gastado, pendiente, porMes, promedio, ratio: porMes && promedio ? porMes / promedio : null };
}

function Efecto({ e, pim }: { e: ReturnType<typeof efecto>; pim?: number }) {
  if (!e.comprometido) return null;
  return (
    <p className="efecto">
      Lleva comprometidos {fmtSoles(e.comprometido)}{pim ? ` de ${fmtSoles(pim)} del año (${fmtPct(e.comprometido / pim)})` : ""} y gastó{" "}
      {fmtSoles(e.gastado)}.{" "}
      {e.pendiente > 0 && e.porMes != null ? (
        <>
          Le falta pagar <b>{fmtSoles(e.pendiente)}</b>: unos <b>{fmtSoles(e.porMes)} por mes</b> hasta diciembre
          {e.promedio ? <>, {e.ratio && e.ratio >= 1.15 ? <strong>{veces(e.ratio)}</strong> : e.ratio && e.ratio <= 0.85 ? "menos que" : "parecido a"}{" "}
            lo que gastó por mes en promedio ({fmtSoles(e.promedio)})</> : null}.
        </>
      ) : e.pendiente > 0 ? <>Le falta pagar {fmtSoles(e.pendiente)} antes de fin de año.</> : "No le queda nada comprometido por pagar."}
    </p>
  );
}

/** The months of one line, as SIAF records them: to check a figure against the Consulta Amigable. */
function TablaMeses({ dev, comp, mens, hasta }: { dev: number[]; comp: number[]; mens: number[]; hasta: number }) {
  return (
    <div className="tabla-meses-caja">
      <table className="tabla-meses">
        <thead>
          <tr><th scope="col">Mes</th><th scope="col">Gastado (devengado)</th><th scope="col">Compromiso anual</th><th scope="col">Compromiso mensual</th></tr>
        </thead>
        <tbody>
          {dev.slice(0, hasta).map((_, i) => (
            <tr key={i}>
              <th scope="row">{MES(i + 1)}</th>
              <td>{fmtSoles(dev[i])}</td><td>{comp[i] ? fmtSoles(comp[i]) : "—"}</td><td>{mens[i] ? fmtSoles(mens[i]) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fila({ nombre, l, mes, d, tipo }: { nombre: string; l: Linea; mes: number; d: ArchivoMes; tipo: "gasto" | "compromiso" }) {
  const [abierto, setAbierto] = useState(false);
  const [, pim, dev, comp, mens] = l;
  const i = mes - 1;
  const antes = i > 0 ? dev[i - 1] : null;
  // a percentage over almost nothing (S/ 250 -> S/ 147,000) says nothing: then the change in soles
  const base = antes != null && antes >= Math.max(1000, Math.abs(dev[i]) * 0.1);
  const cambio = antes && base ? dev[i] / antes - 1 : null;
  const e = efecto(comp, dev, d);
  // the monthly commitment against the last month that had one: the figure a news story quotes
  const previo = [...Array(i).keys()].reverse().find((j) => mens[j] > 0);
  const salto = previo != null && mens[i] >= 2 * mens[previo] ? mens[i] / mens[previo] : null;
  return (
    <li className="cambio-fila">
      <div className="ct-top-cab">
        <span className="ct-top-nombre">{nombre}</span>
        <span className="cifra">{tipo === "gasto" ? fmtSoles(dev[i]) : fmtSoles(comp[i] > 0 ? comp[i] : mens[i])}</span>
      </div>
      <div className="detalle">
        {tipo === "gasto" ? (
          <span>
            Gastado en {MES(mes).toLowerCase()}; en {i > 0 ? MES(mes - 1).toLowerCase() : "el mes anterior"}: {fmtSoles(antes)}
            {cambio != null && Math.abs(cambio) >= 0.05 ? <b> ({cambio > 0 ? "+" : "−"}{fmtPct(Math.abs(cambio))})</b>
              : antes != null && !base && dev[i] !== antes ? <b> ({dev[i] > antes ? "+" : "−"}{fmtSoles(Math.abs(dev[i] - antes))})</b> : null}
          </span>
        ) : (
          <span>
            Compromiso anual registrado: {fmtSoles(comp[i])} · compromiso mensual: {fmtSoles(mens[i])}
            {i > 0 ? ` (en ${MES(mes - 1).toLowerCase()}: ${fmtSoles(comp[i - 1])} y ${fmtSoles(mens[i - 1])})` : ""}
            {salto ? <b>. El compromiso mensual es {veces(salto)} el de {MES(previo! + 1).toLowerCase()}</b> : null}
          </span>
        )}
      </div>
      {tipo === "compromiso" ? <Efecto e={e} pim={pim} /> : null}
      <button type="button" className="enlace-explicar abre" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? "Ocultar mes a mes" : "Ver mes a mes"}<ChevronDown className="icono-linea" aria-hidden />
      </button>
      {abierto ? <TablaMeses dev={dev} comp={comp} mens={mens} hasta={d.m} /> : null}
    </li>
  );
}

/** "¿Qué cambió este mes?": spending month against month, the commitments registered in the month
 *  and, for each, what it means per month for the rest of the year. Loaded when reached. */
export function CambiosDelMes({ sec }: { sec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [d, setD] = useState<ArchivoMes | null | undefined>(undefined);
  const [c, setC] = useState<Clasificador | null>(null);
  const [mes, setMes] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([x]) => {
      if (!x.isIntersecting) return;
      obs.disconnect();
      cargarDatos<ArchivoMes>(urlDatos(`mes/${sec}.json`)).then(setD);
      cargarDatos<Clasificador>(urlDatos("clasificador.json")).then(setC);
    }, { rootMargin: "400px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [sec]);
  // the month shown first: the last complete one (the current month is still running)
  const completo = d ? (d.transcurridos >= d.m - 0.05 ? d.m : d.m - 1) : null;
  const m = mes ?? (completo && completo >= 1 ? completo : d?.m ?? null);
  const nombre = (clas: string) => c?.especificas[clas]?.[0] ?? clas;
  const { gastos, compromisos } = useMemo(() => {
    if (!d || !m) return { gastos: [], compromisos: [] };
    const i = m - 1;
    const gastos = [...d.l].filter((l) => l[2][i] || (i > 0 && l[2][i - 1]))
      .sort((a, b) => Math.abs(b[2][i] - (i > 0 ? b[2][i - 1] : 0)) - Math.abs(a[2][i] - (i > 0 ? a[2][i - 1] : 0))).slice(0, 6);
    // new obligations signed in the month, or a monthly commitment that jumped; not the payroll
    // committed again every month
    const peso = (l: Linea) => Math.max(l[3][i], l[4][i] - (i > 0 ? l[4][i - 1] : 0));
    const compromisos = [...d.l].filter((l) => peso(l) > 0).sort((a, b) => peso(b) - peso(a)).slice(0, 6);
    return { gastos, compromisos };
  }, [d, m]);

  if (d === null) return <div ref={ref} className="vacio">No hay datos mes a mes de esta entidad.</div>;
  if (!d || !m) return <div ref={ref}>{d === undefined ? <p className="explica cargando">Cargando…</p> : null}</div>;
  const [pimTotal, devT, compT] = d.t;
  const i = m - 1;
  const parcial = m === d.m && d.transcurridos < d.m - 0.05;
  const cambio = i > 0 && devT[i - 1] ? devT[i] / devT[i - 1] - 1 : null;
  const total = efecto(compT, devT, d);
  const dia = Number(d.corte.slice(8, 10));
  return (
    <div ref={ref} className="cambios-mes">
      <Efecto e={total} pim={pimTotal} />
      <div className="tabs vistas" role="group" aria-label="Mes">
        {[d.m - 2, d.m - 1, d.m].filter((x) => x >= 1).map((x) => (
          <button key={x} type="button" className="tab" aria-pressed={x === m} onClick={() => setMes(x)}>
            {MES(x)}{x === d.m && parcial ? ` (al ${dia})` : ""}
          </button>
        ))}
      </div>
      <p className="cambios-resumen">
        En {MES(m).toLowerCase()}{parcial ? ` (hasta el ${dia})` : ""} gastó <b>{fmtSoles(devT[i])}</b>
        {cambio != null ? <> ({cambio >= 0 ? "+" : "−"}{fmtPct(Math.abs(cambio))} frente a {MES(m - 1).toLowerCase()}{parcial ? ", que fue un mes completo" : ""})</> : null}
        {" "}y registró compromisos anuales por <b>{fmtSoles(compT[i])}</b>.
      </p>
      {gastos.length ? (
        <>
          <h4 className="ct-h3">Lo que más cambió en lo gastado</h4>
          <ol className="ct-top">{gastos.map((l) => <Fila key={l[0]} nombre={nombre(l[0])} l={l} mes={m} d={d} tipo="gasto" />)}</ol>
        </>
      ) : null}
      {compromisos.length ? (
        <>
          <h4 className="ct-h3">Compromisos del mes</h4>
          <p className="ct-nota-gasto">
            Un compromiso no es gasto del mes: un contrato o una orden para varios meses se compromete completo el mes en que se
            firma. Por eso, junto a cada uno, cuánto falta pagar de lo comprometido en el año y cuánto significa por mes hasta
            diciembre.
          </p>
          <ol className="ct-top">{compromisos.map((l) => <Fila key={l[0]} nombre={nombre(l[0])} l={l} mes={m} d={d} tipo="compromiso" />)}</ol>
        </>
      ) : null}
      <details className="ct-glosario">
        <summary>¿Qué es gastado, compromiso anual y compromiso mensual?</summary>
        <dl>
          <div><dt>Gastado (devengado)</dt><dd>El bien o servicio se recibió y la deuda quedó reconocida: es lo que el sitio llama «gastado».</dd></div>
          <div><dt>Compromiso anual</dt><dd>Las obligaciones que la entidad firmó: contratos, órdenes, planillas. Se registran completas el mes en que se firman, aunque se paguen en varios meses.</dd></div>
          <div><dt>Compromiso mensual</dt><dd>La parte de esos compromisos que la entidad afecta a un mes. En la Consulta Amigable del MEF figura como «Atención de compromiso mensual».</dd></div>
          <div><dt>Lo que falta pagar por mes</dt><dd>Lo comprometido en el año menos lo ya gastado, dividido entre los meses que quedan hasta diciembre (datos al {d.corte.split("-").reverse().join("/")}). Supone que se paga dentro del año, como manda el presupuesto anual.</dd></div>
        </dl>
      </details>
    </div>
  );
}
