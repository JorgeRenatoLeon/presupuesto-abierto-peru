"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Alerta, ComparacionResumen, Localidad, Obra, TemaSeguible } from "@/lib/types";
import { fmtSoles, fmtPct, fmtDelta, fmtVariacion, fmtLugar, fmtFecha, urlDatos } from "@/lib/types";
import {
  leerSeguidos, guardarSeguidos, mismo, claveAlerta, leerAlertasVistas, guardarAlertasVistas, marcarVisto, type Seguido,
} from "@/lib/seguimiento";
import type { ArchivoContratos, ArchivoProveedor } from "@/lib/contratos";
import { fmtPrecio, urlProducto, type ArchivoProducto } from "@/lib/productos";
import { urlProveedor } from "@/components/Contratos";
import { AlertaCard } from "@/components/AlertaCard";
import { BarraProgreso } from "@/components/ui";

type EntidadPayload = {
  info: { sec_ejec: string; nombre: string; nivel: string | null; dept: string | null; pim: number | null; devengado: number | null };
  obras: Obra[]; n_obras: number; alertas: Alerta[];
};
type Temas = Record<string, TemaSeguible[]>;
type Datos = {
  entidad?: EntidadPayload; departamento?: Localidad; tema?: TemaSeguible; proveedor?: ArchivoProveedor; producto?: ArchivoProducto;
  /** a followed entity's contracts, to tell the new ones */
  contratos?: ArchivoContratos | null;
  error?: boolean;
};
/** Contracts or purchases dated after what this item showed last time: [date, what, who, soles][] */
type Novedad = [string, string, string, number | null];

const clave = (s: Seguido) => `${s.tipo}:${s.dimension ?? ""}:${s.id}`;
const cache = new Map<string, Promise<unknown>>();
function traer<T>(ruta: string): Promise<T> {
  if (!cache.has(ruta)) cache.set(ruta, fetch(urlDatos(ruta)).then((r) => (r.ok ? r.json() : Promise.reject(r.status))));
  return cache.get(ruta) as Promise<T>;
}

export function Seguimiento() {
  const [seguidos, setSeguidos] = useState<Seguido[] | null>(null);
  const [datos, setDatos] = useState<Record<string, Datos>>({});
  const [resumen, setResumen] = useState<ComparacionResumen | null>(null);
  const [vistas, setVistas] = useState<Set<string> | null>(null); // alerts seen before this visit

  useEffect(() => {
    setSeguidos(leerSeguidos());
    setVistas(leerAlertasVistas());
    traer<ComparacionResumen>("comparar/resumen.json").then(setResumen).catch(() => {});
  }, []);

  useEffect(() => {
    if (!seguidos) return;
    for (const s of seguidos) {
      const k = clave(s);
      const guardar = (d: Datos) => setDatos((prev) => ({ ...prev, [k]: d }));
      if (s.tipo === "entidad") {
        Promise.all([traer<EntidadPayload>(`entidad/${s.id}.json`), traer<ArchivoContratos>(`contratos/${s.id}.json`).catch(() => null)])
          .then(([entidad, contratos]) => guardar({ entidad, contratos }), () => guardar({ error: true }));
      }
      if (s.tipo === "proveedor") traer<ArchivoProveedor>(`proveedor/${s.id}.json`).then((proveedor) => guardar({ proveedor }), () => guardar({ error: true }));
      if (s.tipo === "producto") traer<ArchivoProducto>(`producto/${s.id}.json`).then((producto) => guardar({ producto }), () => guardar({ error: true }));
      if (s.tipo === "departamento") traer<Localidad>(`localidad/${s.id}.json`).then((departamento) => guardar({ departamento }), () => guardar({ error: true }));
      if (s.tipo === "tema") traer<Temas>("seguimiento/temas.json").then(
        (t) => guardar((t[s.dimension ?? "funcion"] ?? []).find((n) => n.id === s.id) ? { tema: t[s.dimension ?? "funcion"].find((n) => n.id === s.id) } : { error: true }),
        () => guardar({ error: true }));
    }
  }, [seguidos]);

  const alertasDe = (d: Datos): Alerta[] => d.entidad?.alertas ?? d.departamento?.alertas.top ?? [];
  const cargados = seguidos != null && seguidos.every((s) => datos[clave(s)]);
  const actuales = useMemo(
    () => (seguidos ?? []).flatMap((s) => alertasDe(datos[clave(s)] ?? {}).map(claveAlerta)),
    [seguidos, datos]);

  // once everything is on screen, remember it: next visit only the new ones get "Nueva"
  useEffect(() => {
    if (!cargados) return;
    guardarAlertasVistas(new Set([...(vistas ?? []), ...actuales]));
    for (const x of seguidos ?? []) {
      const d = datos[clave(x)];
      const hasta = ultimaFecha(d);
      if (hasta) marcarVisto(x, { hasta, precio: d?.producto?.r.mediana });
    }
  }, [cargados, actuales, vistas, seguidos, datos]);

  const dejar = (s: Seguido) => {
    const resto = leerSeguidos().filter((x) => !mismo(x, s));
    guardarSeguidos(resto);
    setSeguidos(resto);
  };

  if (seguidos == null) return <div className="tarjeta vacio">Cargando…</div>;
  if (!seguidos.length) {
    return (
      <div className="tarjeta vacio">
        Aún no sigues nada. Busca tu <Link href="/localidad/" style={{ color: "var(--rojo)", fontWeight: 600 }}>región</Link>,
        tu municipalidad en <Link href="/explorar/" style={{ color: "var(--rojo)", fontWeight: 600 }}>Explorar</Link> o un
        tema en <Link href="/comparar/" style={{ color: "var(--rojo)", fontWeight: 600 }}>Comparar</Link>, y toca «Seguir».
      </div>
    );
  }

  const nuevas = vistas ? actuales.filter((k) => !vistas.has(k)).length : 0;
  return (
    <>
      {resumen ? (
        <p className="sub" style={{ fontSize: 13.5 }}>
          Datos de la publicación del MEF del {fmtFecha(resumen.publicacion.fecha)}.
          {vistas ? (nuevas ? ` ${nuevas} alerta${nuevas === 1 ? "" : "s"} nueva${nuevas === 1 ? "" : "s"} desde tu última visita.` : " Nada nuevo desde tu última visita.") : ""}
        </p>
      ) : null}
      {seguidos.map((s) => {
        const d = datos[clave(s)];
        return (
          <section key={clave(s)} className="tarjeta seccion">
            <div className="linea1" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <h2 style={{ marginBottom: 6 }}>{s.tipo === "departamento" ? fmtLugar(s.nombre) : s.nombre}</h2>
              <button className="tab" onClick={() => dejar(s)} aria-label={`Dejar de seguir ${s.nombre}`}>Dejar de seguir</button>
            </div>
            {!d ? <div className="vacio">Cargando…</div> : d.error ? <div className="vacio">No encontramos datos actuales de esto.</div> : (
              <>
                <Resumen d={d} s={s} />
                <Novedades lista={novedades(d, s)} s={s} d={d} />
                {alertasDe(d).length ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {alertasDe(d).slice(0, 5).map((a, i) => (
                      <AlertaCard key={a.id ?? i} alerta={a} nueva={!!vistas && !vistas.has(claveAlerta(a))} />
                    ))}
                  </div>
                ) : s.tipo !== "tema" ? <p className="sub" style={{ marginTop: 8 }}>Sin alertas con los datos actuales.</p> : null}
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

/** The latest contract or purchase date an item shows: what "visto" remembers. */
function ultimaFecha(d: Datos | undefined): string | null {
  if (!d) return null;
  if (d.proveedor) return d.proveedor.r.hasta ?? null;
  if (d.producto) return d.producto.r.hasta ?? null;
  if (d.contratos) return d.contratos.c.reduce((m, c) => (c[0] > m ? c[0] : m), "") || null;
  return null;
}

function novedades(d: Datos, s: Seguido): Novedad[] | null {
  const desde = s.visto?.hasta;
  if (!desde) return null;  // first visit since following: everything is the baseline
  if (d.proveedor) {
    return d.proveedor.c.filter((c) => c[0] > desde).map((c) => [c[0], c[1], d.proveedor!.e[c[2]]?.[1] ?? "", c[3]]);
  }
  if (d.producto) {
    return d.producto.c.filter((c) => c[0] > desde).map((c) => [c[0], `${fmtPrecio(c[6])} por ${d.producto!.unidad}`, c[2], c[7]]);
  }
  if (d.contratos) {
    const p = d.contratos.p;
    return d.contratos.c.filter((c) => c[0] > desde).map((c) => [c[0], c[1], c[2] != null ? p[c[2]]?.[1] ?? "" : "", c[3]]);
  }
  return null;
}

/** "3 contratos nuevos desde tu última visita", and for a product whether its usual price moved. */
function Novedades({ lista, s, d }: { lista: Novedad[] | null; s: Seguido; d: Datos }) {
  const antes = s.visto?.precio;
  const ahora = d.producto?.r.mediana;
  const cambio = antes && ahora ? ahora / antes - 1 : null;
  if (!lista && cambio == null) return null;
  const que = s.tipo === "producto" ? ["compra nueva", "compras nuevas"] : ["contrato nuevo", "contratos nuevos"];
  return (
    <div className="novedades">
      {cambio != null && Math.abs(cambio) >= 0.05 ? (
        <p className={cambio > 0 ? "sube" : ""}>
          Su precio usual {cambio > 0 ? "subió" : "bajó"} {fmtPct(Math.abs(cambio))}: de {fmtPrecio(antes)} a {fmtPrecio(ahora)}.
        </p>
      ) : null}
      {lista ? (
        <p><strong>{lista.length ? `${lista.length} ${lista.length === 1 ? que[0] : que[1]} desde tu última visita`
          : `Sin ${que[1]} desde tu última visita.`}</strong></p>
      ) : null}
      {lista?.length ? (
        <ul>
          {lista.slice(0, 5).map(([f, que_, quien, monto], i) => (
            <li key={i}>
              <span className="novedad-fecha">{fmtFecha(f)}</span> {que_}
              {quien ? <> · <span className="novedad-quien">{quien}</span></> : null}
              {monto ? <> · {fmtSoles(monto)}</> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Resumen({ d, s }: { d: Datos; s: Seguido }) {
  if (d.proveedor) {
    const r = d.proveedor.r;
    return (
      <>
        <p className="sub">Proveedor · {r.n.toLocaleString("es-PE")} contratos con {r.entidades.toLocaleString("es-PE")} entidades · {fmtSoles(r.monto)}</p>
        <Link className="tab" href={urlProveedor(s.id)} style={{ display: "inline-block", marginTop: 4 }}>Ver el proveedor <ArrowRight className="icono-linea" aria-hidden /></Link>
      </>
    );
  }
  if (d.producto) {
    const r = d.producto.r;
    return (
      <>
        <p className="sub">Producto · precio usual {fmtPrecio(r.mediana)} por {d.producto.unidad} · {r.n.toLocaleString("es-PE")} compras</p>
        <Link className="tab" href={urlProducto(s.id)} style={{ display: "inline-block", marginTop: 4 }}>Ver el producto <ArrowRight className="icono-linea" aria-hidden /></Link>
      </>
    );
  }
  if (d.entidad) {
    const i = d.entidad.info;
    const avance = i.pim ? (i.devengado ?? 0) / i.pim : null;
    const detenidas = d.entidad.obras.filter((o) => o.senal === "sin_avance").length;
    return (
      <>
        <p className="sub">{[i.nivel, i.dept].filter(Boolean).join(" · ")}</p>
        <BarraProgreso avance={avance} />
        <div className="detalle" style={{ fontSize: 13, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <span>{fmtPct(avance)} ejecutado de {fmtSoles(i.pim)}</span>
          <span>{d.entidad.n_obras} proyectos{detenidas ? `, ${detenidas} sin avance` : ""}</span>
        </div>
        <Link className="tab" href={`/entidad/${s.id}/`} style={{ display: "inline-block", marginTop: 8 }}>Ver la entidad <ArrowRight className="icono-linea" aria-hidden /></Link>
      </>
    );
  }
  if (d.departamento) {
    const x = d.departamento;
    const avance = x.gasto.pim ? (x.gasto.devengado ?? 0) / x.gasto.pim : null;
    return (
      <>
        <BarraProgreso avance={avance} />
        <div className="detalle" style={{ fontSize: 13, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          <span>{fmtPct(avance)} ejecutado de {fmtSoles(x.gasto.pim)}</span>
          <span>{x.cambios.pim_pub_ant ? `${fmtDelta((x.gasto.pim ?? 0) - x.cambios.pim_pub_ant)} en la última actualización` : ""}</span>
        </div>
        <p className="sub" style={{ marginTop: 6 }}>{x.obras.n_sin_avance} proyectos sin avance · {x.alertas.total} alertas ({x.alertas.alta} altas)</p>
        <Link className="tab" href={`/localidad/${s.id}/`} style={{ display: "inline-block", marginTop: 4 }}>Ver la región <ArrowRight className="icono-linea" aria-hidden /></Link>
      </>
    );
  }
  const t = d.tema!;
  return (
    <>
      <div className="detalle" style={{ fontSize: 13.5, display: "grid", gap: 4 }}>
        <span>Presupuesto vigente: <strong>{fmtSoles(t.pim)}</strong></span>
        {t.pim_pub_ant ? <span>Última actualización: {fmtDelta((t.pim ?? 0) - t.pim_pub_ant)} ({fmtVariacion(t.pim_pub_ant, t.pim)})</span> : null}
        {t.pia_ano_ant ? <span>Aprobado frente al año anterior: {fmtVariacion(t.pia_ano_ant, t.pia)}</span> : null}
      </div>
      <Link className="tab" href={`/comparar/${s.dimension ?? "funcion"}/`} style={{ display: "inline-block", marginTop: 8 }}>Comparar <ArrowRight className="icono-linea" aria-hidden /></Link>
    </>
  );
}
