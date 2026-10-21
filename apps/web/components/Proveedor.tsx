"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fmtSoles, fmtPct, urlDatos } from "@/lib/types";
import {
  cargarDatos, esRuc, plano, type ArchivoProveedor, type IndiceProveedores, type NombresGasto,
} from "@/lib/contratos";
import { KpiCard } from "@/components/ui";
import { SeguirBoton } from "@/components/SeguirBoton";
import { Contrato, SignificadoSenales, cargarGastos, plural, urlProveedor, vistaProveedor } from "@/components/Contratos";

const PAGINA = 20;
/** OECE's official supplier profile (Ficha Única del Proveedor): sanctions, penalties, all its contracts. */
const FICHA_OECE = "https://apps.osce.gob.pe/perfilprov-ui/";
const TIPO = { empresa: "Empresa", persona: "Persona con negocio", consorcio: "Consorcio" } as const;

/** /proveedor/?id=<RUC>: everything a supplier signed with the State in the period. */
export function FichaProveedor() {
  const [id, setId] = useState<string | null>(null);
  const [d, setD] = useState<ArchivoProveedor | null | undefined>(undefined);
  const [nombres, setNombres] = useState<NombresGasto | null>(null);
  const [q, setQ] = useState("");
  const [ver, setVer] = useState(PAGINA);

  useEffect(() => {
    const pedido = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
    setId(pedido);
    if (!/^[0-9A-Za-z-]{1,40}$/.test(pedido)) {
      setD(null);
      return;
    }
    cargarDatos<ArchivoProveedor>(urlDatos(`proveedor/${pedido}.json`)).then(setD);
    cargarGastos().then(setNombres);
  }, []);
  useEffect(() => {
    if (d?.nombre) document.title = `${d.nombre} — Proveedores del Estado — Presupuesto Abierto Perú`;
  }, [d]);

  const vistas = useMemo(() => (d ? d.c.map((c) => vistaProveedor(c, d)) : []), [d]);
  const filas = useMemo(() => {
    const t = plano(q.trim());
    return vistas.filter((v) => !t || plano(`${v.objeto} ${v.entidad?.nombre ?? ""} ${v.cui ?? ""}`).includes(t));
  }, [vistas, q]);
  useEffect(() => setVer(PAGINA), [q]);

  if (d === undefined) return <p className="explica cargando">Cargando proveedor…</p>;
  if (d === null) {
    return (
      <section className="hero">
        <h1>Proveedor no encontrado</h1>
        <p>
          {id ? <>No encontramos contratos del SEACE con el proveedor <strong>{id}</strong> en los dos últimos años. </> : null}
          Búscalo por su nombre o RUC en <Link href="/proveedores/" className="enlace-texto">Proveedores del Estado</Link>.
        </p>
      </section>
    );
  }
  const r = d.r;
  const unPostor = r.competitivos ? r.un_postor / r.competitivos : null;
  const sinCompetencia = r.monto ? (r.directo ?? 0) / r.monto : null;
  const mayor = d.e[0];
  const senales: { tono: "alta" | "media"; texto: string }[] = [];
  if (r.resueltos) senales.push({ tono: "alta", texto: `${plural(r.resueltos, "contrato resuelto", "contratos resueltos")}: terminaron antes de cumplirse.` });
  if (r.nulos) senales.push({ tono: "alta", texto: `${plural(r.nulos, "contrato declarado nulo", "contratos declarados nulos")}.` });
  if (r.intervenidos) senales.push({ tono: "alta", texto: `${plural(r.intervenidos, "obra intervenida", "obras intervenidas")} por la entidad.` });
  if (r.extra) senales.push({ tono: "media", texto: `${fmtSoles(r.extra)} más de lo firmado, por adicionales en ${plural(r.con_adicionales, "contrato", "contratos")}.` });
  if (r.precio_alto) senales.push({ tono: "media", texto: `En ${plural(r.precio_alto, "contrato", "contratos")} cobró por algún producto entre 2 y 10 veces lo que el Estado suele pagar por él.` });
  const maxG = Math.max(...d.g.map(([, , m]) => m ?? 0), 1);
  return (
    <>
      <section className="hero">
        <h1>{d.nombre ?? d.id}</h1>
        <p className="prov-tipo">{TIPO[d.tipo]}{esRuc(d.id) ? ` · RUC ${d.id}` : ` · código SEACE ${d.id}`}</p>
        <p>
          Lo que firmó con el Estado en {d.desde_ano} y {d.desde_ano + 1}, según el SEACE: con qué entidades, para qué y por
          cuánto, con cada contrato para descargar.
        </p>
        <div style={{ marginTop: 10 }}>
          <SeguirBoton item={{ tipo: "proveedor", id: d.id, nombre: d.nombre ?? d.id, visto: { hasta: r.hasta } }} />
        </div>
      </section>

      <section className="seccion" id="resumen">
        <div className="kpis">
          <KpiCard etiqueta="Contratado" valor={fmtSoles(r.monto)} nota={`en ${plural(r.n, "contrato", "contratos")}`} />
          <KpiCard etiqueta="Entidades" valor={r.entidades.toLocaleString("es-PE")}
                   nota={mayor && r.monto ? `La principal: ${fmtPct((mayor[3] ?? 0) / r.monto)} de lo contratado` : undefined} />
          <KpiCard etiqueta="Un solo participante" valor={fmtPct(unPostor)}
                   nota={r.competitivos ? `en ${plural(r.competitivos, "concurso ganado", "concursos ganados")}` : "Sin concursos con competencia"} />
          <KpiCard etiqueta="Sin competencia" valor={fmtPct(sinCompetencia)} nota="del monto, por contratación directa" />
        </div>
        {senales.length ? (
          <ul className="ct-senales">
            {senales.map((s) => <li key={s.texto} className={s.tono}>{s.texto}</li>)}
          </ul>
        ) : null}
      </section>

      <section className="seccion tarjeta" id="entidades">
        <h2>¿A quién le vende?</h2>
        <ol className="ct-top">
          {d.e.slice(0, 15).map(([sec, nombre, n, monto]) => (
            <li key={`${sec}-${nombre}`}>
              <div className="ct-top-cab">
                {sec ? <Link className="ct-top-nombre ct-enlace-proveedor" href={`/entidad/${sec}/`}>{nombre}</Link>
                  : <span className="ct-top-nombre">{nombre}</span>}
                <span className="cifra">{fmtSoles(monto)}</span>
              </div>
              <span className="reparto-barra"><span style={{ width: `${r.monto ? Math.min(1, (monto ?? 0) / r.monto) * 100 : 0}%` }} /></span>
              <div className="detalle">
                <span>{plural(n, "contrato", "contratos")}{sec ? "" : " · fuera del presupuesto público"}</span>
                <span>{r.monto ? fmtPct((monto ?? 0) / r.monto) : "—"}</span>
              </div>
            </li>
          ))}
        </ol>
        {d.e.length > 15 ? <p className="explica-nota">Y {plural(d.e.length - 15, "entidad más", "entidades más")} en su lista de contratos.</p> : null}
      </section>

      {d.g.length && nombres ? (
        <section className="seccion tarjeta" id="que-vende">
          <h2>¿Qué le vende al Estado?</h2>
          <p className="sub">Por tipo de gasto del presupuesto, según el bien o servicio de cada contrato.</p>
          <ul className="ct-gastos">
            {d.g.map(([g, n, monto]) => (
              <li key={g} className="ct-gasto-fila estatica">
                <span className="ct-top-cab">
                  <span className="ct-top-nombre">{nombres[g]?.[0] ?? g}</span>
                  <span className="cifra">{fmtSoles(monto)}</span>
                </span>
                <span className="reparto-barra"><span style={{ width: `${((monto ?? 0) / maxG) * 100}%` }} /></span>
                <span className="detalle"><span>{plural(n, "contrato", "contratos")}</span></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="seccion tarjeta" id="contratos">
        <h2>Sus contratos</h2>
        <div className="ct-controles ct-controles-simple">
          <input type="search" className="buscador" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Busca entidad, obra u objeto" aria-label="Buscar en sus contratos" />
        </div>
        <p className="ct-cuenta" aria-live="polite">
          {q.trim() ? plural(filas.length, "contrato coincide", "contratos coinciden") : plural(filas.length, "contrato", "contratos")}
          {r.mostrados < r.n ? `: los ${r.mostrados} de mayor monto (de ${r.n.toLocaleString("es-PE")} en total)` : ""}
        </p>
        {filas.length ? (
          <ol className="contratos">
            {filas.slice(0, ver).map((v, i) => <Contrato key={i} v={v} nombres={nombres} />)}
          </ol>
        ) : <p className="vacio">Ningún contrato coincide.</p>}
        {filas.length > ver ? (
          <button type="button" className="tab" style={{ marginTop: 10 }} onClick={() => setVer((x) => x + PAGINA)}>
            Ver {Math.min(PAGINA, filas.length - ver)} contratos más
          </button>
        ) : null}
        <SignificadoSenales metodos={d.m} />
        <p className="aviso-contratos">
          <strong>Lo contratado no es lo pagado:</strong> el Estado no publica cada pago a cada proveedor, y las compras de
          hasta 8 UIT no pasan por el SEACE.{" "}
          {d.tipo !== "consorcio" ? (
            <>Su historial completo, sanciones e impedimentos están en la{" "}
              <a href={FICHA_OECE} target="_blank" rel="noopener">Ficha Única del Proveedor del OECE</a> (busca el RUC {d.id}).{" "}</>
          ) : (
            <>Los consorcios no tienen RUC propio en el SEACE: busca a sus integrantes en la{" "}
              <a href={FICHA_OECE} target="_blank" rel="noopener">Ficha Única del Proveedor del OECE</a>.{" "}</>
          )}
          <Link href="/metodologia/#contratos">Cómo lo hacemos</Link>
        </p>
      </section>
    </>
  );
}

/** /proveedores/: search any supplier by name or RUC. The index loads the first time the box is used. */
export function BuscadorProveedores() {
  const [indice, setIndice] = useState<IndiceProveedores | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const cargar = () => {
    if (indice === undefined) cargarDatos<IndiceProveedores>(urlDatos("proveedores/indice.json")).then(setIndice);
  };
  const t = plano(q.trim());
  const digitos = /^\d{6,11}$/.test(q.trim()) ? q.trim() : null;
  const res = useMemo(() => {
    if (!indice || t.length < 2) return [];
    return indice.p.filter(([id, nombre]) => id.startsWith(t) || plano(nombre ?? "").includes(t)).slice(0, 30);
  }, [indice, t]);
  return (
    <div className="busca-prov">
      <label htmlFor="busca-proveedor" className="busca-etiqueta">Busca una empresa, consorcio o persona por su nombre o RUC</label>
      <input id="busca-proveedor" type="search" className="buscador" value={q} autoComplete="off"
             onFocus={cargar} onChange={(e) => { cargar(); setQ(e.target.value); }}
             placeholder="Ej.: constructora, consorcio vial, 20601397553" />
      {indice === undefined && t.length >= 2 ? <p className="explica cargando">Cargando proveedores…</p> : null}
      {res.length ? (
        <ul className="busca-resultados">
          {res.map(([id, nombre, n, monto, entidades]) => (
            <li key={id}>
              <Link href={urlProveedor(id)} className="prov-resultado">
                <span className="prov-resultado-nombre">{nombre ?? id}</span>
                <span className="detalle">
                  <span>{esRuc(id) ? `RUC ${id}` : "Consorcio"} · {plural(n, "contrato", "contratos")} · {plural(entidades, "entidad", "entidades")}</span>
                  <span className="cifra">{fmtSoles(monto)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {indice && t.length >= 2 && !res.length ? (
        <p className="busca-vacio">
          Ningún proveedor de los {indice.p.length.toLocaleString("es-PE")} más grandes coincide con «{q}».
          {digitos ? <> Si es un RUC, <Link href={urlProveedor(digitos)} className="enlace-texto">ve directo a su ficha</Link>.</> : " Prueba con su RUC."}
        </p>
      ) : null}
    </div>
  );
}
