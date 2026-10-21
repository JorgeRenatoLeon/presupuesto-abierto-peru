"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, FileText } from "lucide-react";
import { fmtSoles, fmtPct, fmtNombre, fichaInversion, urlDatos } from "@/lib/types";
import {
  CATEGORIA, EVENTOS, cargarDatos, coincideGasto, comparaPrecio, esRuc, etiquetaGasto, eventosDe, grupoGasto, metodoInfo,
  mismoGasto, plano, urlDocumento,
  type ArchivoContratos, type ArchivoProveedor, type ContratosResumen, type FilaContrato, type Lineas, type NombresGasto, type Via,
} from "@/lib/contratos";
import { KpiCard } from "@/components/ui";
import { ObraCompleta } from "@/components/ObraCompleta";

const PAGINA = 15;
const MESES_CORTOS = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES_CORTOS[m]} ${y}`;
};
export const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;
const numero = (v: number) => v.toLocaleString("es-PE", { maximumFractionDigits: 2 });
const IRREGULARES: Record<string, string> = { mes: "meses", dia: "dias", día: "días", vez: "veces" };
/** "179 100 unidades", "3 250 galones": SEACE writes units in the singular. */
function unidades(unidad: string | null, n: number): string {
  const t = (unidad ?? "").toLowerCase().trim();
  if (n === 1 || !t) return t;
  return t.split(/\s+/).map((w) => IRREGULARES[w] ?? (w.length <= 2 || /\d|s$/.test(w) || ["de", "del", "por", "con"].includes(w) ? w
    : /[aeiouáéó]$/.test(w) ? `${w}s` : /z$/.test(w) ? `${w.slice(0, -1)}ces` : /[ndlrj]$/.test(w) ? `${w}es` : w)).join(" ");
}

export const cargarContratos = (sec: string) => cargarDatos<ArchivoContratos>(urlDatos(`contratos/${sec}.json`));
export const cargarGastos = () => cargarDatos<NombresGasto>(urlDatos("contratos/gastos.json"));
export const urlProveedor = (id: string) => `/proveedor/?id=${encodeURIComponent(id)}`;

/** One contract as every list shows it, whichever file it comes from. */
export type Vista = {
  fecha: string; objeto: string; monto: number | null; final: number | null; metodo: string; via: Via;
  cat: "o" | "b" | "s" | null; postores: number | null; cui: string | null; doc: string | null; eventos: string | null;
  gasto: string | null; lineas: Lineas | null;
  /** on a unit's page: who was contracted (linked when it has a page: contracts of the period) */
  proveedor: { id: string; nombre: string; enlace: boolean } | null;
  /** on a supplier's page: which unit contracted it */
  entidad: { sec: string | null; nombre: string } | null;
  nota: string | null;
};

export function vistaEntidad(c: FilaContrato, d: ArchivoContratos): Vista {
  const [fecha, objeto, p, monto, final, m, cat, postores, cui, doc, eventos, b, gasto, lineas] = c;
  const prov = p != null ? d.p[p] : null;
  const comprador = d.b[b];
  const propios = d.b.filter((x) => x[2] !== null).length;
  const metodo = d.m[m] ?? "";
  return {
    fecha, objeto, monto, final, metodo, via: metodoInfo(metodo).via, cat, postores, cui, doc, eventos,
    gasto: gasto ?? null, lineas: lineas ?? null, entidad: null,
    proveedor: prov ? { id: prov[0], nombre: prov[1], enlace: !!prov[0] && fecha >= String(d.r.desde_ano ?? "") } : null,
    nota: comprador && comprador[2] === null ? `Lo firmó ${fmtNombre(comprador[0])}, para una obra de esta entidad.`
      : propios > 1 && comprador ? `Comprador en el SEACE: ${fmtNombre(comprador[0])}` : null,
  };
}

export function vistaProveedor(c: ArchivoProveedor["c"][number], d: ArchivoProveedor): Vista {
  const [fecha, objeto, e, monto, final, m, cat, postores, cui, doc, eventos, gasto, lineas] = c;
  const ent = d.e[e];
  const metodo = d.m[m] ?? "";
  return {
    fecha, objeto, monto, final, metodo, via: metodoInfo(metodo).via, cat, postores, cui, doc, eventos, gasto, lineas,
    proveedor: null, entidad: ent ? { sec: ent[0], nombre: ent[1] } : null, nota: null,
  };
}

/** The period's contracts in figures: how much, with how many suppliers, how they were chosen, what
 *  went wrong after signing and what they buy. No hooks: part of the static page. */
export function ResumenContratos({ r, nombres }: { r: ContratosResumen; nombres?: NombresGasto }) {
  const unPostor = r.competitivos ? (r.un_postor ?? 0) / r.competitivos : null;
  const sinCompetencia = r.monto ? (r.directo ?? 0) / r.monto : null;
  const mayor = r.top[0];
  const senales: { tono: "alta" | "media" | "info"; texto: string }[] = [];
  if (r.resueltos) senales.push({ tono: "alta", texto: `${plural(r.resueltos, "contrato resuelto", "contratos resueltos")}: terminaron antes de cumplirse.` });
  if (r.nulos) senales.push({ tono: "alta", texto: `${plural(r.nulos, "contrato declarado nulo", "contratos declarados nulos")}.` });
  if (r.intervenidos) senales.push({ tono: "alta", texto: `${plural(r.intervenidos, "obra intervenida", "obras intervenidas")}: la entidad tomó el control por problemas del contratista.` });
  if (r.extra) senales.push({ tono: "media", texto: `${fmtSoles(r.extra)} más de lo firmado, por adicionales en ${plural(r.con_adicionales ?? 0, "contrato", "contratos")}.` });
  if (r.precio_alto) senales.push({ tono: "media", texto: `${plural(r.precio_alto, "contrato pagó", "contratos pagaron")} por algún producto entre 2 y 10 veces lo que el Estado suele pagar por él.` });
  if (r.de_otros) senales.push({ tono: "info", texto: `${plural(r.de_otros, "contrato lo firmó", "contratos los firmó")} otra entidad para obras de esta (${fmtSoles(r.monto_otros)}).` });
  const grupos = (r.por_gasto ?? []).filter(([g]) => nombres?.[g]);
  const maxGrupo = Math.max(...grupos.map(([, , m]) => m ?? 0), 1);
  return (
    <>
      <div className="kpis">
        <KpiCard etiqueta="Contratado" valor={fmtSoles(r.monto)} nota={`en ${plural(r.n, "contrato", "contratos")}`} />
        <KpiCard etiqueta="Proveedores" valor={(r.proveedores ?? 0).toLocaleString("es-PE")}
                 nota={mayor && r.monto ? `El principal se llevó ${fmtPct((mayor[3] ?? 0) / r.monto)}` : undefined} />
        <KpiCard etiqueta="Un solo participante" valor={fmtPct(unPostor)}
                 nota={r.competitivos ? `de ${plural(r.competitivos, "concurso", "concursos")} con competencia` : "Sin concursos con competencia"} />
        <KpiCard etiqueta="Sin competencia" valor={fmtPct(sinCompetencia)} nota="del monto, por contratación directa" />
      </div>
      {senales.length ? (
        <ul className="ct-senales">
          {senales.map((s) => <li key={s.texto} className={s.tono}>{s.texto}</li>)}
        </ul>
      ) : null}
      {grupos.length ? (
        <>
          <h3 className="ct-h3">Qué compra o paga con estos contratos</h3>
          <p className="ct-nota-gasto">
            Por tipo de gasto del presupuesto, según el bien o servicio de cada contrato. Toca uno para ver sus contratos.
          </p>
          <ul className="ct-gastos">
            {grupos.slice(0, 8).map(([g, n, monto]) => (
              <li key={g}>
                <button type="button" className="ct-gasto-fila" onClick={() => filtrarContratos(g)}>
                  <span className="ct-top-cab">
                    <span className="ct-top-nombre">{nombres![g][0]}</span>
                    <span className="cifra">{fmtSoles(monto)}</span>
                  </span>
                  <span className="reparto-barra"><span style={{ width: `${((monto ?? 0) / maxGrupo) * 100}%` }} /></span>
                  <span className="detalle"><span>{plural(n, "contrato", "contratos")}</span><span>Ver los contratos</span></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {r.top.length ? (
        <>
          <h3 className="ct-h3">Sus principales proveedores</h3>
          <ol className="ct-top">
            {r.top.map(([id, nombre, n, monto]) => (
              <li key={id}>
                <div className="ct-top-cab">
                  <Link className="ct-top-nombre ct-enlace-proveedor" href={urlProveedor(id)}>{nombre}</Link>
                  <span className="cifra">{fmtSoles(monto)}</span>
                </div>
                <span className="reparto-barra"><span style={{ width: `${r.monto ? Math.min(1, (monto ?? 0) / r.monto) * 100 : 0}%` }} /></span>
                <div className="detalle">
                  <span>{esRuc(id) ? `RUC ${id}` : "Consorcio"} · {plural(n, "contrato", "contratos")}</span>
                  <span>{r.monto ? fmtPct((monto ?? 0) / r.monto) : "—"} de lo contratado</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </>
  );
}

/** "Show me those contracts": a summary row filters the list below and brings it into view. */
function filtrarContratos(gasto: string) {
  window.dispatchEvent(new CustomEvent("contratos:filtrar", { detail: gasto }));
  document.getElementById("contratos-lista")?.scrollIntoView({ block: "start" });
}

type Senal = "todas" | "un_postor" | "directo" | "adicional" | "problemas" | "precio";

function cumple(v: Vista, senal: Senal): boolean {
  const ev = v.eventos ?? "";
  if (senal === "un_postor") return v.via === "competitivo" && v.postores === 1;
  if (senal === "directo") return v.via === "directo";
  if (senal === "adicional") return ev.includes("adicional") || (v.final != null && v.monto != null && v.final > v.monto);
  if (senal === "problemas") return /resolucion|nulidad|intervencion/.test(ev);
  if (senal === "precio") return precioDe(v.lineas) === "alto";
  return true;
}

/** Every contract of the period on the page, searchable: loaded when the section comes into view. */
export function ListaContratos({ sec }: { sec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [d, setD] = useState<ArchivoContratos | null | undefined>(undefined);
  const [nombres, setNombres] = useState<NombresGasto | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [gasto, setGasto] = useState("todos");
  const [senal, setSenal] = useState<Senal>("todas");
  const [orden, setOrden] = useState<"monto" | "fecha">("monto");
  const [ver, setVer] = useState(PAGINA);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cargar = () => { cargarContratos(sec).then(setD); cargarGastos().then(setNombres); };
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { obs.disconnect(); cargar(); }
    }, { rootMargin: "400px 0px" });
    obs.observe(el.closest("section") ?? el);  // as soon as the reader reaches the section, not the list below its summary
    const filtrar = (e: Event) => { setGasto((e as CustomEvent<string>).detail); cargar(); };
    window.addEventListener("contratos:filtrar", filtrar);
    return () => { obs.disconnect(); window.removeEventListener("contratos:filtrar", filtrar); };
  }, [sec]);

  const vistas = useMemo(() => (d ? d.c.map((c) => vistaEntidad(c, d)) : []), [d]);
  const buscable = useMemo(() => vistas.map((v) => plano(
    `${v.objeto} ${v.proveedor?.nombre ?? ""} ${v.proveedor?.id ?? ""} ${v.cui ?? ""} ${(v.lineas?.[1] ?? []).map((l) => l[0]).join(" ")}`)), [vistas]);
  const grupos = useMemo(() => {
    const g = new Map<string, number>();
    for (const v of vistas) {
      const k = grupoGasto(v.gasto);
      if (k && v.fecha >= String(d?.r.desde_ano ?? "")) g.set(k, (g.get(k) ?? 0) + (v.monto ?? 0));
    }
    return [...g.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [vistas, d]);
  const filas = useMemo(() => {
    if (!d) return [];
    const desde = String(d.r.desde_ano ?? "");
    const t = plano(q.trim());
    const f = vistas.map((_, i) => i).filter((i) => {
      const v = vistas[i];
      return v.fecha >= desde && (tipo === "todos" || v.cat === tipo) && cumple(v, senal)
        && (gasto === "todos" || (!!v.gasto && mismoGasto(v.gasto, gasto)))
        && (!t || buscable[i].includes(t));
    });
    return orden === "fecha" ? f.sort((a, b) => vistas[b].fecha.localeCompare(vistas[a].fecha)) : f;
  }, [d, vistas, q, tipo, gasto, senal, orden, buscable]);
  useEffect(() => setVer(PAGINA), [q, tipo, gasto, senal, orden]);

  const filtrado = !!q.trim() || tipo !== "todos" || senal !== "todas" || gasto !== "todos";
  return (
    <div ref={ref} className="ct-lista" id="contratos-lista">
      <h3 className="ct-h3">Todos sus contratos</h3>
      {d === undefined ? <p className="explica cargando">Cargando contratos…</p> : null}
      {d === null ? <p className="vacio">No se pudieron cargar los contratos. Vuelve a intentarlo recargando la página.</p> : null}
      {d ? (
        <>
          <div className="ct-controles">
            <input type="search" className="buscador" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Busca proveedor, RUC, obra u objeto" aria-label="Buscar en los contratos" />
            <select className="buscador" value={gasto} onChange={(e) => setGasto(e.target.value)} aria-label="Tipo de gasto">
              <option value="todos">Todo tipo de gasto</option>
              {grupos.map((g) => <option key={g} value={g}>{nombres?.[g]?.[0] ?? g}</option>)}
              {gasto !== "todos" && !grupos.includes(gasto) ? <option value={gasto}>{nombres?.[gasto]?.[0] ?? gasto}</option> : null}
            </select>
            <select className="buscador" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de contrato">
              <option value="todos">Obras, bienes y servicios</option>
              <option value="o">Solo obras</option>
              <option value="b">Solo bienes</option>
              <option value="s">Solo servicios</option>
            </select>
            <select className="buscador" value={senal} onChange={(e) => setSenal(e.target.value as Senal)} aria-label="Señal">
              <option value="todas">Todas las señales</option>
              <option value="un_postor">Un solo participante</option>
              <option value="precio">Precio muy por encima de lo usual</option>
              <option value="directo">Sin competencia</option>
              <option value="adicional">Con adicionales</option>
              <option value="problemas">Resueltos, nulos o intervenidos</option>
            </select>
            <select className="buscador" value={orden} onChange={(e) => setOrden(e.target.value as "monto" | "fecha")} aria-label="Orden">
              <option value="monto">Mayor monto primero</option>
              <option value="fecha">Más recientes primero</option>
            </select>
          </div>
          <p className="ct-cuenta" aria-live="polite">
            {filtrado ? plural(filas.length, "contrato coincide", "contratos coinciden") : plural(filas.length, "contrato", "contratos")}
            {(d.r.mostrados ?? 0) < d.r.n
              ? `${filtrado ? ", entre" : ":"} los ${d.r.mostrados?.toLocaleString("es-PE")} de mayor monto (de ${d.r.n.toLocaleString("es-PE")} en total)`
              : ""}
          </p>
          {filas.length ? (
            <ol className="contratos">
              {filas.slice(0, ver).map((i) => <Contrato key={i} v={vistas[i]} nombres={nombres} />)}
            </ol>
          ) : <p className="vacio">Ningún contrato coincide. Prueba sin tildes, con el RUC o con otra señal.</p>}
          {filas.length > ver ? (
            <button type="button" className="tab" style={{ marginTop: 10 }} onClick={() => setVer((v) => v + PAGINA)}>
              Ver {Math.min(PAGINA, filas.length - ver)} contratos más
            </button>
          ) : null}
          <SignificadoSenales metodos={d.m} />
        </>
      ) : null}
    </div>
  );
}

/** The words the rows use, explained once instead of on every row: the signals, how expense types
 *  are worked out, and the ways suppliers were chosen. */
export function SignificadoSenales({ metodos }: { metodos: string[] }) {
  const senales: [string, string, string][] = [
    ["media", "Un solo participante", "Se convocó un concurso y solo un proveedor participó: no hubo con quién comparar precios. (El SEACE cuenta como participantes a los proveedores que se registraron en el procedimiento; no todos presentan oferta.)"],
    ["media", "Precio alto", "Un producto del contrato costó entre 2 y 10 veces lo que el Estado suele pagar por el mismo producto (mismo código del catálogo y misma unidad, en al menos 8 compras de 4 entidades). Puede haber razones (marca, entrega, urgencia), pero vale la pena preguntar."],
    ["neutro", "Revisar precio", "Más de 10 veces lo usual: suele ser un error al registrar la cantidad o la unidad en el SEACE, más que un precio. Revisa el contrato."],
    ["media", "Subió", "El monto final supera en 25% o más al monto firmado."],
    ["media", "Sin competencia", metodoInfo("Contratación Directa").explica],
    ...(["adicional", "resolucion", "nulidad", "intervencion", "ampliacion"] as const)
      .map((t): [string, string, string] => [EVENTOS[t].tono, EVENTOS[t].texto, EVENTOS[t].explica]),
  ];
  return (
    <details className="ct-glosario">
      <summary>¿Qué significa cada señal y cada forma de contratar?</summary>
      <dl>
        {senales.map(([tono, texto, explica]) => (
          <div key={texto}><dt><span className={`badge ${tono}`}>{texto}</span></dt><dd>{explica}</dd></div>
        ))}
        <div>
          <dt>Tipo de gasto</dt>
          <dd>
            El SEACE no dice qué partida del presupuesto paga cada contrato. Lo deducimos del catálogo del bien o
            servicio contratado (y, en las obras, de su proyecto): es una equivalencia, no un registro contable.
          </dd>
        </div>
        {metodos.filter(Boolean).sort().map((m) => (
          <div key={m}><dt>{m}</dt><dd>{metodoInfo(m).explica}</dd></div>
        ))}
      </dl>
    </details>
  );
}

/** S/ with cents for small unit prices (a bag of cement), rounded like everything else above. */
const fmtUnitario = (v: number) => (v < 1000 ? `S/ ${v.toLocaleString("es-PE", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : fmtSoles(v));
const veces = (r: number) => `${r.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces`;

/** The worst comparison among a contract's lines: what its badge says. */
function precioDe(lineas: Lineas | null): "alto" | "revisar" | null {
  const r = (lineas?.[1] ?? []).map(([, cant, , total, mediana]) =>
    comparaPrecio(cant && total ? total / cant : null, mediana));
  return r.includes("alto") ? "alto" : r.includes("revisar") ? "revisar" : null;
}

/** "Qué se compró": the contract's lines, with quantity, unit price and, for items the State buys
 *  often, what it usually pays for the same item. */
function LineasCompradas({ lineas, compacto }: { lineas: Lineas; compacto: boolean }) {
  const [n, filas] = lineas;
  const visibles = filas.filter(([desc]) => desc);
  if (!visibles.length) return null;
  const mostradas = visibles.slice(0, compacto ? 2 : 3);
  return (
    <div className="ct-lineas">
      <span className="mp-etq">Qué se compró</span>
      <ul>
        {mostradas.map(([desc, cant, unidad, total, mediana, compras], k) => {
          const unitario = cant && cant > 1 && total ? total / cant : null;
          const nivel = comparaPrecio(unitario, mediana);
          return (
            <li key={k}>
              <span className="ct-linea-desc">{desc}</span>
              <span className="ct-linea-cifra">
                {[cant != null ? `${numero(cant)} ${unidades(unidad, cant)}`.trim() : null,
                  unitario ? `${fmtUnitario(unitario)} c/u` : null,
                  total != null ? fmtSoles(total) : null].filter(Boolean).join(" · ")}
              </span>
              {unitario && mediana ? (
                <span className={`ct-linea-precio ${nivel ?? ""}`}>
                  {nivel === "alto" ? `${veces(unitario / mediana)} lo usual: ` : nivel === "revisar" ? "Muy lejos de lo usual: " : ""}
                  el Estado suele pagar {fmtUnitario(mediana)} c/u por el mismo producto ({plural(compras ?? 0, "compra", "compras")})
                  {nivel === "revisar" ? ". Puede ser un error al registrar la cantidad o la unidad: revisa el contrato." : ""}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {n > mostradas.length ? <small>y {plural(n - mostradas.length, "línea más", "líneas más")} en el contrato</small> : null}
    </div>
  );
}

export function Contrato({ v, nombres, compacto = false }: { v: Vista; nombres: NombresGasto | null; compacto?: boolean }) {
  const eventos = eventosDe(v.eventos);
  const cuantos: Record<string, number> = {};
  for (const e of eventos) cuantos[e.tipo] = (cuantos[e.tipo] ?? 0) + 1;
  const cambio = v.final != null && v.monto ? (v.final - v.monto) / v.monto : null;
  const cuenta: Record<string, number> = {};
  const gasto = etiquetaGasto(v.gasto, nombres);
  const precio = precioDe(v.lineas);
  const cuis = (v.cui ?? "").split(",").filter(Boolean);
  return (
    <li className="contrato">
      <div className="ct-cab">
        <time dateTime={v.fecha}>{fechaCorta(v.fecha)}</time>
        {v.cat ? <span className="etiqueta-tipo">{CATEGORIA[v.cat]}</span> : null}
        {v.via === "directo" ? <span className="badge media">Sin competencia</span> : null}
        {v.via === "competitivo" && v.postores === 1 ? <span className="badge media">Un solo participante</span> : null}
        {precio === "alto" ? <span className="badge media">Precio alto</span> : null}
        {precio === "revisar" ? <span className="badge neutro">Revisar precio</span> : null}
        {(["nulidad", "resolucion", "intervencion", "adicional", "ampliacion", "reduccion"] as const).filter((t) => cuantos[t]).map((t) => (
          <span key={t} className={`badge ${EVENTOS[t].tono}`}>
            {EVENTOS[t].texto}{cuantos[t] > 1 ? ` ×${cuantos[t]}` : ""}
          </span>
        ))}
        {cambio != null && cambio >= 0.25 ? <span className="badge media">Subió {fmtPct(cambio)}</span> : null}
      </div>
      <p className="ct-objeto">{v.objeto ? fmtNombre(v.objeto) : "Sin descripción en el SEACE"}</p>
      <div className="ct-cifras">
        {v.entidad ? (
          <span className="ct-quien">
            <span className="mp-etq">Entidad</span>
            {v.entidad.sec
              ? <Link href={`/entidad/${v.entidad.sec}/`} className="ct-enlace-proveedor"><b>{v.entidad.nombre}</b></Link>
              : <b>{v.entidad.nombre}</b>}
          </span>
        ) : (
          <span className="ct-quien">
            <span className="mp-etq">Proveedor</span>
            {v.proveedor?.enlace
              ? <Link href={urlProveedor(v.proveedor.id)} className="ct-enlace-proveedor"><b>{v.proveedor.nombre}</b></Link>
              : <b>{v.proveedor?.nombre || "No registrado en el SEACE"}</b>}
            {v.proveedor ? <span className="ct-ruc">{esRuc(v.proveedor.id) ? `RUC ${v.proveedor.id}` : "Consorcio"}</span> : null}
          </span>
        )}
        <span className="ct-cuanto">
          <span className="mp-etq">Monto firmado</span>
          <b>{fmtSoles(v.monto)}</b>
          {cambio != null ? (
            <small className={cambio > 0 ? "sube" : ""}>
              Monto final {fmtSoles(v.final)} ({cambio > 0 ? "+" : "−"}{fmtPct(Math.abs(cambio))})
            </small>
          ) : null}
        </span>
      </div>
      {v.lineas ? <LineasCompradas lineas={v.lineas} compacto={compacto} /> : null}
      {gasto ? <p className="ct-gasto"><span className="mp-etq">Tipo de gasto</span> {gasto}</p> : null}
      {!compacto ? (
        <p className="ct-como">
          {v.metodo || "Procedimiento no indicado"}
          {v.postores != null && v.via === "competitivo" ? ` · ${plural(v.postores, "participante", "participantes")}` : ""}
        </p>
      ) : null}
      <div className="ct-docs">
        {v.doc ? (
          <a href={urlDocumento(v.doc)} target="_blank" rel="noopener">
            <FileText size={14} aria-hidden /> Contrato firmado (PDF)
          </a>
        ) : null}
        {eventos.slice(0, 8).map((e) => {
          cuenta[e.tipo] = (cuenta[e.tipo] ?? 0) + 1;
          const varios = eventos.filter((x) => x.tipo === e.tipo).length > 1;
          return (
            <a key={e.doc} href={urlDocumento(e.doc)} target="_blank" rel="noopener">
              {EVENTOS[e.tipo]?.texto ?? "Documento"}{varios ? ` ${cuenta[e.tipo]}` : ""} (PDF)
            </a>
          );
        })}
        {eventos.length > 8 ? <span>y {eventos.length - 8} documentos más</span> : null}
        {!compacto ? cuis.map((x) => (
          <a key={x} href={fichaInversion(x)} target="_blank" rel="noopener">Obra CUI {x} ↗</a>
        )) : null}
      </div>
      {cuis.length > 1 ? (
        <p className="ct-otro">
          Este contrato abarca {cuis.length} proyectos (CUI {cuis.join(", ")}): su monto no es solo de uno de ellos.
        </p>
      ) : null}
      {v.nota ? <p className="ct-otro">{v.nota}</p> : null}
    </li>
  );
}

/** A unit's contracts and the expense type names, loaded the first time a panel needs them. */
function useContratos(sec: string, activo: boolean) {
  const [d, setD] = useState<ArchivoContratos | null | undefined>(undefined);
  const [nombres, setNombres] = useState<NombresGasto | null>(null);
  useEffect(() => {
    if (activo && d === undefined) {
      cargarContratos(sec).then(setD);
      cargarGastos().then(setNombres);
    }
  }, [activo, d, sec]);
  return { d, nombres };
}

/** What a project's contracts add up to, signed and after amendments. */
const sumas = (filas: FilaContrato[]) => ({
  n: filas.length, firmado: filas.reduce((a, c) => a + (c[3] ?? 0), 0), final: filas.reduce((a, c) => a + (c[4] ?? c[3] ?? 0), 0),
});

/** Who builds a project and for how much: the project as a whole, then the contracts that carry its
 *  CUI, of any year. */
export function ContratosDeObra({ sec, cui, n, monto, anual }: {
  sec: string; cui: string; n: number; monto: number | null; anual?: number | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const { d, nombres } = useContratos(sec, abierto);
  const filas = d ? d.c.filter((c) => (c[8] ?? "").split(",").includes(cui)) : [];
  return (
    <div className="ct-obra">
      <button type="button" className="ct-obra-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {n ? <>{plural(n, "contrato", "contratos")} · {fmtSoles(monto)} — ¿quién la hace?</> : "La obra completa: costo, avance y último reporte"}
        <ChevronDown size={15} aria-hidden />
      </button>
      {abierto && n && d === undefined ? <p className="explica cargando">Cargando…</p> : null}
      {abierto && !n ? <ObraCompleta sec={sec} cui={cui} anual={anual} /> : null}
      {abierto && n && d ? (
        <>
          <ObraCompleta sec={sec} cui={cui} anual={anual} contratos={sumas(filas)} />
          <ol className="contratos compacto">
            {filas.map((c, i) => <Contrato key={i} v={vistaEntidad(c, d)} nombres={nombres} compacto />)}
          </ol>
        </>
      ) : null}
    </div>
  );
}

/** Inside a project's detail: the project as a whole and its own contracts (by CUI). */
export function ContratosDelProyecto({ sec, cui, anual }: { sec: string; cui: string; anual?: number | null }) {
  const { d, nombres } = useContratos(sec, true);
  if (d === undefined) return <p className="explica cargando">Cargando contratos…</p>;
  const filas = d ? d.c.filter((c) => (c[8] ?? "").split(",").includes(cui)) : [];
  return (
    <section className="ct-del-proyecto">
      <ObraCompleta sec={sec} cui={cui} anual={anual} contratos={sumas(filas)} />
      <h5>Quién lo hace: contratos de este proyecto</h5>
      {filas.length ? (
        <ol className="contratos compacto">
          {filas.slice(0, 10).map((c, i) => <Contrato key={i} v={vistaEntidad(c, d!)} nombres={nombres} compacto />)}
        </ol>
      ) : (
        <p className="explica-nota">
          No encontramos contratos de este proyecto (CUI {cui}) en el SEACE: puede ejecutarse por administración
          directa, con compras pequeñas o a través de otra entidad.
        </p>
      )}
      {filas.length > 10 ? <p className="explica-nota">Y {filas.length - 10} más en la sección «A quién contrata».</p> : null}
    </section>
  );
}

/** Next to an expense type of an activity: the unit's contracts of that type (not tied to a project). */
export function ContratosDeTipo({ sec, clas }: { sec: string; clas: string }) {
  const [abierto, setAbierto] = useState(false);
  const { d, nombres } = useContratos(sec, true);
  const filas = useMemo(() => (d ? d.c.filter((c) => !c[8] && !!c[12] && coincideGasto(clas, c[12])
    && c[0] >= String(d.r.desde_ano ?? "")) : []), [d, clas]);
  if (!d || !filas.length) return null;
  const total = filas.reduce((a, c) => a + (c[3] ?? 0), 0);
  return (
    <div className="ct-tipo">
      <button type="button" className="ct-obra-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {plural(filas.length, "contrato", "contratos")} de este tipo · {fmtSoles(total)}
        <ChevronDown size={15} aria-hidden />
      </button>
      {abierto ? (
        <>
          <p className="explica-nota">
            Contratos de toda la entidad de este tipo de gasto: el SEACE no dice qué actividad paga cada uno.
          </p>
          <ol className="contratos compacto">
            {filas.slice(0, 10).map((c, i) => <Contrato key={i} v={vistaEntidad(c, d)} nombres={nombres} compacto />)}
          </ol>
          {filas.length > 10 ? (
            <button type="button" className="tab" onClick={() => filtrarContratos(grupoGasto(clas)!)}>
              Ver los {filas.length} en la lista de contratos
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** In a genérica's panel ("Bienes y servicios"): what the unit's contracts bought there, by type. */
export function ContratosDeGasto({ sec, prefijo }: { sec: string; prefijo: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { d, nombres } = useContratos(sec, visible);
  useEffect(() => {
    const det = ref.current?.closest("details");
    if (!det) return;
    const abrir = () => det.open && setVisible(true);
    abrir();
    det.addEventListener("toggle", abrir);
    return () => det.removeEventListener("toggle", abrir);
  }, []);
  const grupos = useMemo(() => {
    if (!d) return [];
    const g = new Map<string, { n: number; monto: number }>();
    for (const c of d.c) {
      const k = grupoGasto(c[12]);
      if (!k || !k.startsWith(`${prefijo}.`) || c[0] < String(d.r.desde_ano ?? "")) continue;
      const x = g.get(k) ?? { n: 0, monto: 0 };
      x.n += 1; x.monto += c[3] ?? 0;
      g.set(k, x);
    }
    return [...g.entries()].sort((a, b) => b[1].monto - a[1].monto);
  }, [d, prefijo]);
  return (
    <div ref={ref} className="ct-de-gasto">
      {visible && d === undefined ? <p className="explica cargando">Cargando contratos…</p> : null}
      {d && grupos.length ? (
        <>
          <h4>Sus contratos de este tipo de gasto</h4>
          <ul className="ct-gastos">
            {grupos.map(([g, x]) => (
              <li key={g}>
                <button type="button" className="ct-gasto-fila" onClick={() => filtrarContratos(g)}>
                  <span className="ct-top-cab">
                    <span className="ct-top-nombre">{nombres?.[g]?.[0] ?? g}</span>
                    <span className="cifra">{fmtSoles(x.monto)}</span>
                  </span>
                  <span className="detalle"><span>{plural(x.n, "contrato", "contratos")}</span><span>Ver los contratos</span></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {d && !grupos.length && (prefijo === "2.3" || prefijo === "2.6") ? (
        <p className="explica-nota">No encontramos contratos del SEACE de este tipo de gasto en esta entidad.</p>
      ) : null}
    </div>
  );
}
