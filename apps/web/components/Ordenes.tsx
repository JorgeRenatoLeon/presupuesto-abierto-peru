"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { fmtSoles, fmtPct, fichaInversion, urlDatos } from "@/lib/types";
import { cargarDatos, coincideGasto, plano } from "@/lib/contratos";
import {
  ESTADO_ORDEN, VIA_ORDEN, cargarOrdenes, esPersona, viaOrden,
  type ArchivoOrdenes, type FilaOrden, type ResumenOrdenes,
} from "@/lib/ordenes";
import { KpiCard } from "@/components/ui";

const PAGINA = 15;
const MESES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fecha = (iso: string | null) => {
  if (!iso) return "Sin fecha";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m]} ${y}`;
};
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

type Clasificador = { especificas: Record<string, [string, string | null]> };
const cargarClasificador = () => cargarDatos<Clasificador>(urlDatos("clasificador.json"));
/** "Alquileres de muebles e inmuebles: de vehículos" */
function nombreGasto(cod: string | null, c: Clasificador | null): string | null {
  if (!cod || !c) return null;
  const [nombre, contexto] = c.especificas[cod] ?? [null, null];
  if (!nombre) return null;
  return contexto && !/^otr|divers/i.test(nombre) ? `${contexto}: ${nombre.charAt(0).toLowerCase()}${nombre.slice(1)}` : nombre;
}

/** The orders file and the expense type names, loaded once when first needed. */
function useOrdenes(sec: string, activo: boolean) {
  const [d, setD] = useState<ArchivoOrdenes | null | undefined>(undefined);
  const [c, setC] = useState<Clasificador | null>(null);
  useEffect(() => {
    if (activo && d === undefined) {
      cargarOrdenes(sec).then(setD);
      cargarClasificador().then(setC);
    }
  }, [activo, d, sec]);
  return { d, c };
}

/** The figures that open the section: part of the page, no hooks. */
export function CifrasOrdenes({ r }: { r: ResumenOrdenes }) {
  return (
    <div className="kpis">
      <KpiCard etiqueta="En órdenes" valor={fmtSoles(r.monto)} nota={plural(r.n, "orden de compra o servicio", "órdenes de compra y servicio")} />
      <KpiCard etiqueta="Sin contrato ni concurso" valor={fmtSoles(r.sin_contrato)}
               nota={r.monto ? `${fmtPct(r.sin_contrato / r.monto)} de sus órdenes: compras menores, servicios, catálogo` : undefined} />
      <KpiCard etiqueta="A personas" valor={fmtSoles(r.monto_personas)}
               nota={`${plural(r.personas, "persona contratada", "personas contratadas")} por servicios o compras`} />
      <KpiCard etiqueta="Promedio por orden" valor={fmtSoles(r.n ? r.monto / r.n : null)} nota="La mayoría son compras pequeñas" />
    </div>
  );
}

/** One order as every list shows it. */
function Orden({ f, p, c, compacto = false }: { f: FilaOrden; p: ArchivoOrdenes["p"]; c: Clasificador | null; compacto?: boolean }) {
  const [emision, desc, ip, monto, tipo, via, gasto, cui, , estado] = f;
  const [ruc, nombre] = p[ip] ?? ["", null];
  const v = viaOrden(via);
  const tipoGasto = nombreGasto(gasto, c);
  return (
    <li className="contrato orden">
      <div className="ct-cab">
        <time dateTime={emision ?? undefined}>{fecha(emision)}</time>
        <span className="etiqueta-tipo">{tipo === "c" ? "Compra" : "Servicio"}</span>
        <span className="badge neutro">{v.texto}</span>
        {estado && ESTADO_ORDEN[estado] ? <span className="ct-estado">{ESTADO_ORDEN[estado]}</span> : null}
      </div>
      <p className="ct-objeto">{desc || "Sin descripción en el SEACE"}</p>
      <div className="ct-cifras">
        <span className="ct-quien">
          <span className="mp-etq">{esPersona(ruc) ? "Persona" : "Proveedor"}</span>
          <b>{nombre || "Sin nombre en el SEACE"}</b>
          <span className="ct-ruc">RUC {ruc}</span>
        </span>
        <span className="ct-cuanto"><span className="mp-etq">Monto</span><b>{fmtSoles(monto)}</b></span>
      </div>
      {tipoGasto && !compacto ? <p className="ct-gasto"><span className="mp-etq">Tipo de gasto probable</span> {tipoGasto}</p> : null}
      {cui ? (
        <div className="ct-docs"><a href={fichaInversion(cui)} target="_blank" rel="noopener">Obra CUI {cui} ↗</a></div>
      ) : null}
    </li>
  );
}

/** "Qué compra en el día a día": how it buys, what, from whom and its largest orders, searchable.
 *  Loaded when the reader reaches the section. */
export function PanelOrdenes({ sec }: { sec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { d, c } = useOrdenes(sec, visible);
  const [q, setQ] = useState("");
  const [gasto, setGasto] = useState("todos");
  const [via, setVia] = useState("todas");
  const [ver, setVer] = useState(PAGINA);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { obs.disconnect(); setVisible(true); } }, { rootMargin: "400px 0px" });
    obs.observe(el.closest("section") ?? el);
    return () => obs.disconnect();
  }, []);
  const buscable = useMemo(() => (d ? d.o.map((f) => plano(`${f[1] ?? ""} ${d.p[f[2]]?.[1] ?? ""} ${d.p[f[2]]?.[0] ?? ""} ${f[7] ?? ""}`)) : []), [d]);
  const filas = useMemo(() => {
    if (!d) return [];
    const t = plano(q.trim());
    return d.o.map((_, i) => i).filter((i) => {
      const f = d.o[i];
      return (gasto === "todos" || (f[6] === gasto && !f[8])) && (via === "todas" || f[5] === via) && (!t || buscable[i].includes(t));
    });
  }, [d, q, gasto, via, buscable]);
  useEffect(() => setVer(PAGINA), [q, gasto, via]);

  const r = d?.r;
  const maxVia = Math.max(...(r?.por_via ?? []).map(([, , m]) => m), 1);
  const maxGasto = Math.max(...(r?.por_gasto ?? []).map(([, , m]) => m), 1);
  const filtrar = (g: string) => {
    setGasto(g);
    document.getElementById("ordenes-lista")?.scrollIntoView({ block: "start" });
  };
  return (
    <div ref={ref}>
      {visible && d === undefined ? <p className="explica cargando">Cargando órdenes…</p> : null}
      {d === null ? <p className="vacio">No se pudieron cargar las órdenes. Vuelve a intentarlo recargando la página.</p> : null}
      {r ? (
        <>
          <h3 className="ct-h3">Cómo compra</h3>
          <ul className="ct-gastos">
            {(r.por_via ?? []).map(([v, n, monto]) => (
              <li key={v}>
                <button type="button" className="ct-gasto-fila" onClick={() => { setVia(v); document.getElementById("ordenes-lista")?.scrollIntoView({ block: "start" }); }}>
                  <span className="ct-top-cab"><span className="ct-top-nombre">{viaOrden(v).texto}</span><span className="cifra">{fmtSoles(monto)}</span></span>
                  <span className="reparto-barra"><span style={{ width: `${(monto / maxVia) * 100}%` }} /></span>
                  <span className="detalle"><span>{plural(n, "orden", "órdenes")} · {viaOrden(v).explica}</span><span>Ver las órdenes</span></span>
                </button>
              </li>
            ))}
          </ul>
          {r.por_gasto?.length ? (
            <>
              <h3 className="ct-h3">Qué compra o paga con órdenes</h3>
              <p className="ct-nota-gasto">
                Por tipo de gasto del presupuesto, deducido de la descripción de cada orden (las de obras están en cada obra).
                Toca uno para ver sus órdenes.
              </p>
              <ul className="ct-gastos">
                {r.por_gasto.slice(0, 8).map(([g, n, monto]) => (
                  <li key={g}>
                    <button type="button" className="ct-gasto-fila" onClick={() => filtrar(g)}>
                      <span className="ct-top-cab"><span className="ct-top-nombre">{nombreGasto(g, c) ?? g}</span><span className="cifra">{fmtSoles(monto)}</span></span>
                      <span className="reparto-barra"><span style={{ width: `${(monto / maxGasto) * 100}%` }} /></span>
                      <span className="detalle"><span>{plural(n, "orden", "órdenes")}</span><span>Ver las órdenes</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {r.top?.length ? (
            <>
              <h3 className="ct-h3">A quién le compra más con órdenes</h3>
              <ol className="ct-top">
                {r.top.map(([ruc, nombre, n, monto]) => (
                  <li key={ruc}>
                    <div className="ct-top-cab"><span className="ct-top-nombre">{nombre}</span><span className="cifra">{fmtSoles(monto)}</span></div>
                    <span className="reparto-barra"><span style={{ width: `${r.monto ? Math.min(1, monto / r.monto) * 100 : 0}%` }} /></span>
                    <div className="detalle">
                      <span>RUC {ruc}{esPersona(ruc) ? " · persona" : ""} · {plural(n, "orden", "órdenes")}</span>
                      <span>{r.monto ? fmtPct(monto / r.monto) : "—"} de sus órdenes</span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          <div className="ct-lista" id="ordenes-lista">
            <h3 className="ct-h3">Sus órdenes más grandes</h3>
            <div className="ct-controles">
              <input type="search" className="buscador" value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder="Busca qué se compró, proveedor, RUC u obra" aria-label="Buscar en las órdenes" />
              <select className="buscador" value={gasto} onChange={(e) => setGasto(e.target.value)} aria-label="Tipo de gasto de la orden">
                <option value="todos">Todo tipo de gasto</option>
                {(r.por_gasto ?? []).map(([g]) => <option key={g} value={g}>{nombreGasto(g, c) ?? g}</option>)}
              </select>
              <select className="buscador" value={via} onChange={(e) => setVia(e.target.value)} aria-label="Cómo se compró">
                <option value="todas">Toda forma de compra</option>
                {(r.por_via ?? []).map(([v]) => <option key={v} value={v}>{viaOrden(v).texto}</option>)}
              </select>
            </div>
            <p className="ct-cuenta" aria-live="polite">
              {plural(filas.length, "orden", "órdenes")}: las de mayor monto y las mayores de cada tipo de gasto
              (de {r.n.toLocaleString("es-PE")} en total; todas están en los datos abiertos).
            </p>
            {filas.length ? (
              <ol className="contratos">
                {filas.slice(0, ver).map((i) => <Orden key={i} f={d!.o[i]} p={d!.p} c={c} />)}
              </ol>
            ) : <p className="vacio">Ninguna orden coincide. Prueba sin tildes, con el RUC o con otro tipo de gasto.</p>}
            {filas.length > ver ? (
              <button type="button" className="tab" style={{ marginTop: 10 }} onClick={() => setVer((v) => v + PAGINA)}>
                Ver {Math.min(PAGINA, filas.length - ver)} órdenes más
              </button>
            ) : null}
            <details className="ct-glosario">
              <summary>¿Qué es una orden de compra o de servicio, y cómo se elige al proveedor?</summary>
              <dl>
                <div>
                  <dt>Orden de compra o de servicio</dt>
                  <dd>
                    El documento con el que una entidad compra un bien o contrata un servicio y reserva el dinero para pagarlo.
                    Cada entidad registra sus órdenes en el SEACE, bajo su responsabilidad. Las compras grandes salen de un
                    concurso y un contrato; las pequeñas, solo de una orden.
                  </dd>
                </div>
                {Object.entries(VIA_ORDEN).map(([k, x]) => <div key={k}><dt>{x.texto}</dt><dd>{x.explica}</dd></div>)}
                <div>
                  <dt>Emitida, comprometida, devengada</dt>
                  <dd>
                    Emitida: la orden existe. Comprometida: el dinero quedó reservado para ella. Devengada: el bien o servicio
                    se recibió y la deuda quedó registrada (lo que el sitio llama «gastado»).
                  </dd>
                </div>
                <div>
                  <dt>Tipo de gasto probable</dt>
                  <dd>
                    Las órdenes no dicen qué partida del presupuesto las paga. Lo deducimos de su descripción (combustible,
                    alquiler de vehículos, servicios de una persona…): es una estimación, no un registro contable.
                  </dd>
                </div>
              </dl>
            </details>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Next to an expense type of an activity: the unit's orders of that type (not those for projects). */
export function OrdenesDeTipo({ sec, clas }: { sec: string; clas: string }) {
  const [abierto, setAbierto] = useState(false);
  const { d, c } = useOrdenes(sec, true);
  const grupos = useMemo(() => (d?.r.por_gasto ?? []).filter(([g]) => coincideGasto(clas, g)), [d, clas]);
  if (!d || !grupos.length) return null;
  const n = grupos.reduce((a, [, x]) => a + x, 0);
  const monto = grupos.reduce((a, [, , m]) => a + m, 0);
  const tipos = new Set(grupos.map(([g]) => g));
  const filas = d.o.filter((f) => !f[8] && f[6] && tipos.has(f[6])).slice(0, 8);
  return (
    <div className="ct-tipo">
      <button type="button" className="ct-obra-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {plural(n, "orden", "órdenes")} de este tipo · {fmtSoles(monto)}
        <ChevronDown size={15} aria-hidden />
      </button>
      {abierto ? (
        <>
          <p className="explica-nota">
            Órdenes de compra y de servicio de toda la entidad de este tipo de gasto en {d.r.ano}, las de mayor monto. Las
            órdenes no dicen qué actividad las paga: el tipo se deduce de su descripción.
          </p>
          <ol className="contratos compacto">
            {filas.map((f, i) => <Orden key={i} f={f} p={d.p} c={c} compacto />)}
          </ol>
          {n > filas.length ? <p className="explica-nota">Y {plural(n - filas.length, "orden más", "órdenes más")} en «¿Qué compra en el día a día?».</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** Inside a project's detail: the orders that cite its CUI (materials, labour, studies...). */
export function OrdenesDelProyecto({ sec, cui }: { sec: string; cui: string }) {
  const { d, c } = useOrdenes(sec, true);
  const filas = useMemo(() => (d ? d.o.filter((f) => f[7] === cui) : []), [d, cui]);
  if (!d || !filas.length) return null;
  return (
    <section className="ct-del-proyecto">
      <h5>Órdenes que citan este proyecto (CUI {cui})</h5>
      <ol className="contratos compacto">
        {filas.map((f, i) => <Orden key={i} f={f} p={d.p} c={c} compacto />)}
      </ol>
      <p className="explica-nota">Las de mayor monto entre las órdenes cuya descripción menciona el CUI del proyecto.</p>
    </section>
  );
}
