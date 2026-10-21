"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { fmtSoles, fmtPct, urlDatos } from "@/lib/types";
import { cargarDatos, plano, urlDocumento } from "@/lib/contratos";
import { fmtPrecio, unidadLegible, urlProducto, type ArchivoProducto, type IndiceProductos } from "@/lib/productos";
import { KpiCard } from "@/components/ui";
import { SeguirBoton } from "@/components/SeguirBoton";
import { plural, urlProveedor } from "@/components/Contratos";

const MESES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLargo = (ym: string) => `${["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre",
  "noviembre", "diciembre"][Number(ym.slice(5, 7))]} de ${ym.slice(0, 4)}`;
const fecha = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return d ? `${d} ${MESES[m]} ${y}` : `${MESES[m]} ${y}`;
};
const IRREGULARES: Record<string, string> = { mes: "meses", dia: "días", vez: "veces" };
/** "galón" -> "galones": SEACE writes units in the singular. */
const unidades = (u: string, n: number) => (n === 1 ? u : u.split(/\s+/).map((w) => IRREGULARES[w] ?? (w.length <= 2 || /\d|s$/.test(w)
  ? w : /ón$/.test(w) ? `${w.slice(0, -2)}ones` : /[aeiouáéó]$/.test(w) ? `${w}s` : /z$/.test(w) ? `${w.slice(0, -1)}ces`
    : /[ndlrj]$/.test(w) ? `${w}es` : w)).join(" "));
/** "+35% sobre lo usual" / "12% menos" next to a price */
function frente(precio: number, usual: number): { texto: string; clase: string } | null {
  const r = precio / usual - 1;
  if (Math.abs(r) < 0.1) return null;
  return r > 0 ? { texto: `${fmtPct(r)} más que lo usual`, clase: r >= 1 ? "alto" : "sube" } : { texto: `${fmtPct(-r)} menos`, clase: "" };
}

/** What the State paid per unit over time: each purchase as a dot, the month's median as a line,
 *  the usual range (middle half of the prices) as a band. Purchases far above the range sit on the
 *  top edge, hollow, with their real price in the tooltip. */
function GraficoPrecios({ d, u }: { d: ArchivoProducto; u: string }) {
  const puntos = (d.x ?? d.c.map((c) => [c[0], c[6]] as [string, number])).map(([f, pu]) => ({ t: Date.parse(f), pu, f }));
  if (puntos.length < 2) return null;
  const W = 720, H = 240, padL = 8, padR = 8, padT = 22, padB = 28;
  const { q1, q3, mediana } = d.r;
  const tope = Math.max(...puntos.map((p) => p.pu));
  const techo = Math.min(tope, q3 + 3 * Math.max(q3 - q1, mediana * 0.2)) * 1.05;
  const t0 = Math.min(...puntos.map((p) => p.t)), t1 = Math.max(...puntos.map((p) => p.t));
  const x = (t: number) => padL + ((t - t0) / Math.max(t1 - t0, 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - Math.min(v, techo) / techo) * (H - padT - padB);
  const meses = d.s.filter(([m]) => Date.parse(`${m}-15`) >= t0 - 20 * 864e5);
  const linea = meses.map(([m, med], i) => `${i ? "L" : "M"}${x(Math.min(Math.max(Date.parse(`${m}-15`), t0), t1)).toFixed(1)},${y(med).toFixed(1)}`).join(" ");
  const ticks = [0, techo / 2, techo];
  return (
    <figure className="grafico-precios">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
           aria-label={`Precio por ${u} en cada compra: lo usual ${fmtPrecio(mediana)}, entre ${fmtPrecio(q1)} y ${fmtPrecio(q3)}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="eje" strokeDasharray="3 4" />
            <text x={padL} y={y(v) - 5} fontSize="11" className="rotulo">{fmtPrecio(v)}</text>
          </g>
        ))}
        <rect x={padL} width={W - padL - padR} y={y(q3)} height={Math.max(y(q1) - y(q3), 2)} className="banda-usual" />
        {linea ? <path d={linea} className="linea-mediana" /> : null}
        {puntos.map((p, i) => {
          const fuera = p.pu > techo;
          return (
            <g key={i}>
              <circle cx={x(p.t)} cy={y(p.pu)} r={4} className={fuera ? "punto fuera" : "punto"} />
              <circle cx={x(p.t)} cy={y(p.pu)} r={9} className="punto-zona">
                <title>{`${fecha(p.f)}: ${fmtPrecio(p.pu)} por ${u}`}</title>
              </circle>
            </g>
          );
        })}
        <text x={padL} y={H - 8} fontSize="11" className="rotulo">{fecha(puntos[0].f)}</text>
        <text x={W - padR} y={H - 8} fontSize="11" textAnchor="end" className="rotulo">{fecha(puntos[puntos.length - 1].f)}</text>
      </svg>
      <figcaption className="leyenda-html">
        <span><svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className="punto" /></svg>Cada compra</span>
        <span><svg width="18" height="10" aria-hidden><path d="M1 5 H17" className="linea-mediana" /></svg>Precio mediano del mes</span>
        <span><svg width="14" height="10" aria-hidden><rect width="14" height="10" className="banda-usual" /></svg>Rango usual</span>
      </figcaption>
    </figure>
  );
}

/** /producto/?id=<cubso>: what the State pays for one catalogue item, who sells it, who buys it. */
export function FichaProducto() {
  const [id, setId] = useState<string | null>(null);
  const [d, setD] = useState<ArchivoProducto | null | undefined>(undefined);
  const [ver, setVer] = useState(20);
  useEffect(() => {
    const pedido = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
    setId(pedido);
    if (!/^\d{8,16}$/.test(pedido)) { setD(null); return; }
    cargarDatos<ArchivoProducto>(urlDatos(`producto/${pedido}.json`)).then(setD);
  }, []);
  useEffect(() => {
    if (d?.nombre) document.title = `${d.nombre} — Precios del Estado — Presupuesto Abierto Perú`;
  }, [d]);

  if (d === undefined) return <p className="explica cargando">Cargando producto…</p>;
  if (d === null) {
    return (
      <section className="hero">
        <h1>Producto no encontrado</h1>
        <p>
          {id ? <>No tenemos suficientes compras del producto <strong>{id}</strong> para comparar precios. </> : null}
          Busca otro en <Link href="/productos/" className="enlace-texto">Precios del Estado</Link>.
        </p>
      </section>
    );
  }
  const r = d.r;
  const u = unidadLegible(d.unidad);
  // the latest month with at least three purchases: prices move (fuel), the period's median lags
  const ultimo = [...d.s].reverse().find(([, , n]) => n >= 3) ?? null;
  return (
    <>
      <section className="hero">
        <h1>{d.nombre ?? `Producto ${d.id}`}</h1>
        <p className="prov-tipo">Precio por {u}{d.familia ? ` · ${d.familia}` : ""} · código {d.id}</p>
        <p>
          Lo que pagaron las entidades del Estado por este producto en sus contratos ({fecha(r.desde)} – {fecha(r.hasta)}),
          según el SEACE: a quién se lo compraron y a qué precio.
        </p>
        <div style={{ marginTop: 10 }}><SeguirBoton item={{ tipo: "producto", id: d.id, nombre: d.nombre ?? d.id, visto: { hasta: r.hasta, precio: r.mediana } }} /></div>
      </section>

      <section className="seccion" id="resumen">
        <div className="kpis">
          <KpiCard etiqueta={`Precio usual por ${u}`} valor={fmtPrecio(r.mediana)}
                   nota={`La mitad de las compras pagó entre ${fmtPrecio(r.q1)} y ${fmtPrecio(r.q3)}${ultimo && Math.abs(ultimo[1] / r.mediana - 1) >= 0.1
                     ? `. En ${mesLargo(ultimo[0])}: ${fmtPrecio(ultimo[1])}` : ""}`} />
          <KpiCard etiqueta="Compras" valor={r.n.toLocaleString("es-PE")} nota={`De ${plural(r.compradores, "comprador", "compradores")} a ${plural(r.proveedores, "proveedor", "proveedores")}`} />
          <KpiCard etiqueta="Lo más que se pagó" valor={fmtPrecio(r.max)}
                   nota={`${(r.max / r.mediana).toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces lo usual; lo menos: ${fmtPrecio(r.min)}${r.revisar ? `. Sin contar ${plural(r.revisar, "compra", "compras")} a más de 10 veces lo usual, probables errores de registro` : ""}`} />
          <KpiCard etiqueta="Gastado en total" valor={fmtSoles(r.total)} nota={`${Math.round(r.cantidad).toLocaleString("es-PE")} ${unidades(u, r.cantidad)}`} />
        </div>
        {!r.comparable ? (
          <p className="aviso-contratos">
            Los precios de este producto varían mucho entre compras (presentaciones, marcas o cantidades distintas): por eso no
            marcamos sus contratos como «precio alto». Compara con cuidado.
          </p>
        ) : null}
      </section>

      <section className="seccion tarjeta" id="precio">
        <h2>¿Cuánto paga el Estado?</h2>
        <p className="sub">Precio por {u} en {d.x && d.x.length < r.n ? `${d.x.length} de sus ${r.n.toLocaleString("es-PE")} compras, repartidas en el tiempo,` : "cada compra"} y el precio mediano de cada mes.</p>
        <GraficoPrecios d={d} u={u} />
      </section>

      <section className="seccion tarjeta" id="vendedores">
        <h2>¿Quién lo vende?</h2>
        <p className="sub">Sus principales proveedores y el precio que suelen cobrar, frente al usual ({fmtPrecio(r.mediana)}).</p>
        <ol className="ct-top">
          {d.v.map(([ruc, nombre, n, med, total]) => {
            const f = frente(med, r.mediana);
            return (
              <li key={ruc}>
                <div className="ct-top-cab">
                  <Link className="ct-top-nombre ct-enlace-proveedor" href={urlProveedor(ruc)}>{nombre ?? ruc}</Link>
                  <span className="cifra">{fmtPrecio(med)}</span>
                </div>
                <div className="detalle">
                  <span>RUC {ruc} · {plural(n, "compra", "compras")} · {fmtSoles(total)}</span>
                  <span className={`precio-frente ${f?.clase ?? ""}`}>{f?.texto ?? "Cerca de lo usual"}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="seccion tarjeta" id="compradores">
        <h2>¿Quién lo compra?</h2>
        <p className="sub">Las entidades que más lo compran y lo que suelen pagar.</p>
        <ol className="ct-top">
          {d.e.map(([sec, nombre, n, med, total], i) => {
            const f = frente(med, r.mediana);
            return (
              <li key={`${sec}-${i}`}>
                <div className="ct-top-cab">
                  {sec ? <Link className="ct-top-nombre ct-enlace-proveedor" href={`/entidad/${sec}/`}>{nombre}</Link>
                    : <span className="ct-top-nombre">{nombre}</span>}
                  <span className="cifra">{fmtPrecio(med)}</span>
                </div>
                <div className="detalle">
                  <span>{plural(n, "compra", "compras")} · {fmtSoles(total)}</span>
                  <span className={`precio-frente ${f?.clase ?? ""}`}>{f?.texto ?? "Cerca de lo usual"}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="seccion tarjeta" id="compras">
        <h2>Sus últimas compras</h2>
        <p className="sub">Cada compra con su contrato firmado, para revisar.</p>
        <ol className="contratos">
          {d.c.slice(0, ver).map(([f, sec, entidad, ruc, proveedor, cant, pu, total, doc, linea], i) => {
            const fr = frente(pu, r.mediana);
            return (
              <li key={i} className="contrato">
                <div className="ct-cab">
                  <time dateTime={f}>{fecha(f)}</time>
                  {pu > 10 * r.mediana || pu < r.mediana / 10 ? <span className="badge neutro">Revisar precio</span>
                    : fr && fr.clase === "alto" ? <span className="badge media">{(pu / r.mediana).toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces lo usual</span> : null}
                </div>
                {linea ? <p className="ct-objeto">{linea}</p> : null}
                <div className="ct-cifras">
                  <span className="ct-quien">
                    <span className="mp-etq">Compró</span>
                    {sec ? <Link href={`/entidad/${sec}/`} className="ct-enlace-proveedor"><b>{entidad}</b></Link> : <b>{entidad}</b>}
                    <span className="ct-ruc">a {ruc ? <Link href={urlProveedor(ruc)} className="enlace-texto">{proveedor ?? ruc}</Link> : proveedor ?? "—"}</span>
                  </span>
                  <span className="ct-cuanto">
                    <span className="mp-etq">Por {u}</span>
                    <b>{fmtPrecio(pu)}</b>
                    <small className={fr?.clase ?? ""}>{Math.round(cant).toLocaleString("es-PE")} {unidades(u, cant)} · {fmtSoles(total)}</small>
                  </span>
                </div>
                {doc ? (
                  <div className="ct-docs">
                    <a href={urlDocumento(doc)} target="_blank" rel="noopener"><FileText size={14} aria-hidden /> Contrato firmado (PDF)</a>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {d.c.length > ver ? (
          <button type="button" className="tab" style={{ marginTop: 10 }} onClick={() => setVer((v) => v + 20)}>
            Ver {Math.min(20, d.c.length - ver)} compras más
          </button>
        ) : null}
        <p className="aviso-contratos">
          Precios por unidad de las líneas de los contratos (bienes comprados de a dos o más), con el código del catálogo del
          Estado (CUBSO) y la unidad que más se usa para este producto. Una compra muy por encima de lo usual puede tener
          razones (marca, entrega, urgencia) o ser un error al registrar la cantidad: vale la pena preguntar.{" "}
          <Link href="/metodologia/#contratos">Cómo lo hacemos</Link>
        </p>
      </section>
    </>
  );
}

/** /productos/: search any catalogue item the State buys often. */
export function BuscadorProductos() {
  const [indice, setIndice] = useState<IndiceProductos | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const cargar = () => {
    if (indice === undefined) cargarDatos<IndiceProductos>(urlDatos("productos/indice.json")).then(setIndice);
  };
  const t = plano(q.trim());
  const res = useMemo(() => {
    if (!indice || t.length < 2) return [];
    const palabras = t.split(/\s+/);
    return indice.p.filter(([id, nombre]) => id.startsWith(t) || palabras.every((w) => plano(nombre ?? "").includes(w))).slice(0, 30);
  }, [indice, t]);
  return (
    <div className="busca-prov">
      <label htmlFor="busca-producto" className="busca-etiqueta">Busca un producto: combustible, cemento, leche, uniformes…</label>
      <input id="busca-producto" type="search" className="buscador" value={q} autoComplete="off"
             onFocus={cargar} onChange={(e) => { cargar(); setQ(e.target.value); }} placeholder="Ej.: diesel, cemento portland, arroz" />
      {indice === undefined && t.length >= 2 ? <p className="explica cargando">Cargando productos…</p> : null}
      {res.length ? (
        <ul className="busca-resultados">
          {res.map(([id, nombre, unidad, med, n]) => (
            <li key={id}>
              <Link href={urlProducto(id)} className="prov-resultado">
                <span className="prov-resultado-nombre">{nombre ?? `Producto ${id}`}</span>
                <span className="detalle">
                  <span>{plural(n, "compra", "compras")}</span>
                  <span className="cifra">{fmtPrecio(med)} por {unidadLegible(unidad)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {indice && t.length >= 2 && !res.length ? (
        <p className="busca-vacio">Ningún producto con suficientes compras coincide con «{q}». Prueba con otra palabra.</p>
      ) : null}
    </div>
  );
}
