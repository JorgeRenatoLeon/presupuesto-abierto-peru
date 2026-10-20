"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { fmtSoles, fmtPct, fmtNombre, fichaInversion, urlDatos } from "@/lib/types";
import {
  CATEGORIA, EVENTOS, esRuc, eventosDe, metodoInfo, plano, urlDocumento,
  type ArchivoContratos, type ContratosResumen, type FilaContrato, type Via,
} from "@/lib/contratos";
import { KpiCard } from "@/components/ui";

const PAGINA = 15;
const MESES_CORTOS = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES_CORTOS[m]} ${y}`;
};
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

const pedidos = new Map<string, Promise<ArchivoContratos | null>>();
/** contratos/<sec>.json, fetched once per page: the list and every project panel share it. */
function cargarContratos(sec: string): Promise<ArchivoContratos | null> {
  if (!pedidos.has(sec)) {
    pedidos.set(sec, fetch(urlDatos(`contratos/${sec}.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return pedidos.get(sec)!;
}

/** The period's contracts in figures: how much, with how many suppliers, how they were chosen and
 *  what went wrong after signing. No hooks: part of the static page. */
export function ResumenContratos({ r }: { r: ContratosResumen }) {
  const unPostor = r.competitivos ? (r.un_postor ?? 0) / r.competitivos : null;
  const sinCompetencia = r.monto ? (r.directo ?? 0) / r.monto : null;
  const mayor = r.top[0];
  const senales: { tono: "alta" | "media" | "info"; texto: string }[] = [];
  if (r.resueltos) senales.push({ tono: "alta", texto: `${plural(r.resueltos, "contrato resuelto", "contratos resueltos")}: terminaron antes de cumplirse.` });
  if (r.nulos) senales.push({ tono: "alta", texto: `${plural(r.nulos, "contrato declarado nulo", "contratos declarados nulos")}.` });
  if (r.intervenidos) senales.push({ tono: "alta", texto: `${plural(r.intervenidos, "obra intervenida", "obras intervenidas")}: la entidad tomó el control por problemas del contratista.` });
  if (r.extra) senales.push({ tono: "media", texto: `${fmtSoles(r.extra)} más de lo firmado, por adicionales en ${plural(r.con_adicionales ?? 0, "contrato", "contratos")}.` });
  if (r.de_otros) senales.push({ tono: "info", texto: `${plural(r.de_otros, "contrato lo firmó", "contratos los firmó")} otra entidad para obras de esta (${fmtSoles(r.monto_otros)}).` });
  return (
    <>
      <div className="kpis">
        <KpiCard etiqueta="Contratado" valor={fmtSoles(r.monto)} nota={`en ${plural(r.n, "contrato", "contratos")}`} />
        <KpiCard etiqueta="Proveedores" valor={(r.proveedores ?? 0).toLocaleString("es-PE")}
                 nota={mayor && r.monto ? `El principal se llevó ${fmtPct((mayor[3] ?? 0) / r.monto)}` : undefined} />
        <KpiCard etiqueta="Un solo postor" valor={fmtPct(unPostor)}
                 nota={r.competitivos ? `de ${plural(r.competitivos, "concurso", "concursos")} con competencia` : "Sin concursos con competencia"} />
        <KpiCard etiqueta="Sin competencia" valor={fmtPct(sinCompetencia)} nota="del monto, por contratación directa" />
      </div>
      {senales.length ? (
        <ul className="ct-senales">
          {senales.map((s) => <li key={s.texto} className={s.tono}>{s.texto}</li>)}
        </ul>
      ) : null}
      {r.top.length ? (
        <>
          <h3 className="ct-h3">Sus principales proveedores</h3>
          <ol className="ct-top">
            {r.top.map(([id, nombre, n, monto]) => (
              <li key={id}>
                <div className="ct-top-cab">
                  <span className="ct-top-nombre">{nombre}</span>
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

type Senal = "todas" | "un_postor" | "directo" | "adicional" | "problemas";

function cumple(c: FilaContrato, senal: Senal, via: Via): boolean {
  const ev = c[10] ?? "";
  if (senal === "un_postor") return via === "competitivo" && c[7] === 1;
  if (senal === "directo") return via === "directo";
  if (senal === "adicional") return ev.includes("adicional") || (c[4] != null && c[3] != null && c[4] > c[3]);
  if (senal === "problemas") return /resolucion|nulidad|intervencion/.test(ev);
  return true;
}

/** Every contract of the period on the page, searchable: loaded when the section comes into view. */
export function ListaContratos({ sec }: { sec: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [d, setD] = useState<ArchivoContratos | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [senal, setSenal] = useState<Senal>("todas");
  const [orden, setOrden] = useState<"monto" | "fecha">("monto");
  const [ver, setVer] = useState(PAGINA);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        obs.disconnect();
        cargarContratos(sec).then(setD);
      }
    }, { rootMargin: "400px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [sec]);

  const vias = useMemo(() => (d ? d.m.map((m) => metodoInfo(m).via) : []), [d]);
  const buscable = useMemo(() => (d ? d.c.map((c) => {
    const p = c[2] != null ? d.p[c[2]] : null;
    return plano(`${c[1]} ${p?.[1] ?? ""} ${p?.[0] ?? ""} ${c[8] ?? ""}`);
  }) : []), [d]);
  const filas = useMemo(() => {
    if (!d) return [];
    const desde = String(d.r.desde_ano ?? "");
    const t = plano(q.trim());
    const f = d.c.map((_, i) => i).filter((i) => {
      const c = d.c[i];
      return c[0] >= desde && (tipo === "todos" || c[6] === tipo) && cumple(c, senal, vias[c[5]])
        && (!t || buscable[i].includes(t));
    });
    return orden === "fecha" ? f.sort((a, b) => d.c[b][0].localeCompare(d.c[a][0])) : f;
  }, [d, q, tipo, senal, orden, vias, buscable]);
  useEffect(() => setVer(PAGINA), [q, tipo, senal, orden]);

  const filtrado = !!q.trim() || tipo !== "todos" || senal !== "todas";
  return (
    <div ref={ref} className="ct-lista">
      <h3 className="ct-h3">Todos sus contratos</h3>
      {d === undefined ? <p className="explica cargando">Cargando contratos…</p> : null}
      {d === null ? <p className="vacio">No se pudieron cargar los contratos. Vuelve a intentarlo recargando la página.</p> : null}
      {d ? (
        <>
          <div className="ct-controles">
            <input type="search" className="buscador" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Busca proveedor, RUC, obra u objeto" aria-label="Buscar en los contratos" />
            <select className="buscador" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de contrato">
              <option value="todos">Todos los tipos</option>
              <option value="o">Solo obras</option>
              <option value="b">Solo bienes</option>
              <option value="s">Solo servicios</option>
            </select>
            <select className="buscador" value={senal} onChange={(e) => setSenal(e.target.value as Senal)} aria-label="Señal">
              <option value="todas">Todas las señales</option>
              <option value="un_postor">Un solo postor</option>
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
              {filas.slice(0, ver).map((i) => <Contrato key={i} c={d.c[i]} d={d} via={vias[d.c[i][5]]} />)}
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

/** The words the rows use, explained once instead of on every row: the signals, and the ways
 *  this entity chose its suppliers. */
function SignificadoSenales({ metodos }: { metodos: string[] }) {
  const senales: [string, string, string][] = [
    ["media", "Un solo postor", "Se convocó un concurso, pero solo una empresa se presentó: no hubo con quién comparar precios."],
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
        {metodos.filter(Boolean).sort().map((m) => (
          <div key={m}><dt>{m}</dt><dd>{metodoInfo(m).explica}</dd></div>
        ))}
      </dl>
    </details>
  );
}

function Contrato({ c, d, via, compacto = false }: { c: FilaContrato; d: ArchivoContratos; via: Via; compacto?: boolean }) {
  const [fecha, objeto, p, monto, final, m, cat, postores, cui, doc, ev, b] = c;
  const prov = p != null ? d.p[p] : null;
  const eventos = eventosDe(ev);
  const tipos = new Set(eventos.map((e) => e.tipo));
  const comprador = d.b[b];
  const cambio = final != null && monto ? (final - monto) / monto : null;
  const cuenta: Record<string, number> = {};
  const metodo = d.m[m];
  return (
    <li className="contrato">
      <div className="ct-cab">
        <time dateTime={fecha}>{fechaCorta(fecha)}</time>
        {cat ? <span className="etiqueta-tipo">{CATEGORIA[cat]}</span> : null}
        {via === "directo" ? <span className="badge media">Sin competencia</span> : null}
        {via === "competitivo" && postores === 1 ? <span className="badge media">Un solo postor</span> : null}
        {(["nulidad", "resolucion", "intervencion", "adicional"] as const).filter((t) => tipos.has(t)).map((t) => (
          <span key={t} className={`badge ${EVENTOS[t].tono}`}>{EVENTOS[t].texto}</span>
        ))}
      </div>
      <p className="ct-objeto">{objeto ? fmtNombre(objeto) : "Sin descripción en el SEACE"}</p>
      <div className="ct-cifras">
        <span className="ct-quien">
          <span className="mp-etq">Proveedor</span>
          <b>{prov?.[1] || "No registrado en el SEACE"}</b>
          {prov ? <span className="ct-ruc">{esRuc(prov[0]) ? `RUC ${prov[0]}` : "Consorcio"}</span> : null}
        </span>
        <span className="ct-cuanto">
          <span className="mp-etq">Monto firmado</span>
          <b>{fmtSoles(monto)}</b>
          {cambio != null ? (
            <small className={cambio > 0 ? "sube" : ""}>
              Monto final {fmtSoles(final)} ({cambio > 0 ? "+" : "−"}{fmtPct(Math.abs(cambio))})
            </small>
          ) : null}
        </span>
      </div>
      {!compacto ? (
        <p className="ct-como" title={metodo ? metodoInfo(metodo).explica : undefined}>
          {metodo || "Procedimiento no indicado"}
          {postores != null && via === "competitivo" ? ` · ${plural(postores, "postor", "postores")}` : ""}
        </p>
      ) : null}
      <div className="ct-docs">
        {doc ? (
          <a href={urlDocumento(doc)} target="_blank" rel="noopener">
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
        {cui && !compacto ? cui.split(",").map((x) => (
          <a key={x} href={fichaInversion(x)} target="_blank" rel="noopener">Obra CUI {x} ↗</a>
        )) : null}
      </div>
      {comprador && comprador[2] === null ? (
        <p className="ct-otro">Lo firmó {fmtNombre(comprador[0])}, para una obra de esta entidad.</p>
      ) : d.b.filter((x) => x[2] !== null).length > 1 && comprador ? (
        <p className="ct-otro">Comprador en el SEACE: {fmtNombre(comprador[0])}</p>
      ) : null}
    </li>
  );
}

/** Who builds a project and for how much: the contracts that carry its CUI, of any year. */
export function ContratosDeObra({ sec, cui, n, monto }: { sec: string; cui: string; n: number; monto: number | null }) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState<ArchivoContratos | null | undefined>(undefined);
  useEffect(() => {
    if (abierto && d === undefined) cargarContratos(sec).then(setD);
  }, [abierto, d, sec]);
  const filas = d ? d.c.filter((c) => (c[8] ?? "").split(",").includes(cui)) : [];
  return (
    <div className="ct-obra">
      <button type="button" className="ct-obra-boton" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
        {plural(n, "contrato", "contratos")} · {fmtSoles(monto)} — ¿quién la hace?
        <ChevronDown size={15} aria-hidden />
      </button>
      {abierto && d === undefined ? <p className="explica cargando">Cargando…</p> : null}
      {abierto && d === null ? <p className="vacio">No se pudieron cargar los contratos.</p> : null}
      {abierto && d ? (
        <ol className="contratos compacto">
          {filas.map((c, i) => <Contrato key={i} c={c} d={d} via={metodoInfo(d.m[c[5]] ?? "").via} compacto />)}
        </ol>
      ) : null}
    </div>
  );
}
