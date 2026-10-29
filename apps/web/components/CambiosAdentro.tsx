"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtSoles, fmtDelta, fmtNombre, fmtLugar, urlDatos } from "@/lib/types";
import { cargarDatos } from "@/lib/contratos";
import { urlObra } from "@/lib/buscar";

/** comparar/cambios/<dim>/<node>.json (pipeline compare._cambios_adentro) */
type Fila = [tipo: "proyecto" | "actividad", nombre: string | null, sec: string, ejecutora: string | null,
  cui: string | null, antes: number, despues: number];
type Archivo = Record<string, { s: [number, number, number, number]; f: Fila[] }>;

/** Dimensions whose rows can be opened: "etiqueta" groups classifier tags, it has no file. */
export const CON_CAMBIOS = new Set(["funcion", "generica", "departamento", "nivel"]);

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;

/** What a category's change is made of: the activities and projects, of each unit, that rose and
 *  fell most inside it, for the comparison the page shows. */
export function CambiosAdentro({ dimension, id, modo, nombre }: { dimension: string; id: string; modo: string; nombre: string }) {
  const [d, setD] = useState<Archivo | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    setD(undefined);
    cargarDatos<Archivo>(urlDatos(`comparar/cambios/${dimension}/${id.replace(/\//g, "-")}.json`))
      .then((x) => { if (vivo) setD(x); });
    return () => { vivo = false; };
  }, [dimension, id]);

  if (d === undefined) return <div className="explica cargando" aria-busy>Cargando qué cambió…</div>;
  const m = d?.[modo];
  if (!m || !m.f.length) {
    return <div className="explica">Ninguna actividad ni proyecto cambió de presupuesto en esta comparación.</div>;
  }
  const [nSube, sube, nBaja, baja] = m.s;
  const suben = m.f.filter((f) => f[6] > f[5]);
  const bajan = m.f.filter((f) => f[6] < f[5]);
  // the same project (CUI) rising in one unit and falling in another: money moved, not added
  const otraUnidad = (f: Fila, lista: Fila[]) =>
    f[4] ? lista.find((g) => g[4] === f[4] && g[2] !== f[2]) : undefined;

  const fila = (f: Fila, otra: Fila | undefined, sentido: "sube" | "baja") => {
    const [tipo, item, sec, ejecutora, cui, antes, despues] = f;
    const texto = item?.trim() ? fmtNombre(item) : "Sin nombre en los datos del MEF";
    return (
      <li key={`${sec}-${tipo}-${cui ?? item}`}>
        <span className="explica-item">
          <span className={`etiqueta-tipo ${tipo}`}>{tipo === "proyecto" ? "Obra / proyecto" : "Actividad"}</span>
          {cui ? <Link href={urlObra(sec, cui)} className="enlace">{texto}</Link> : texto}
          <span className="cambio-unidad">
            <Link href={`/entidad/${sec}/`}>{fmtLugar(ejecutora ?? sec)}</Link>
            {otra ? <> · {sentido === "sube" ? "viene de" : "pasó a"} {fmtLugar(otra[3] ?? otra[2])}</> : null}
          </span>
        </span>
        <span className="cifra">
          <b className={sentido}>{fmtDelta(despues - antes)}</b>
          <small>{fmtSoles(antes)} → {fmtSoles(despues)}</small>
        </span>
      </li>
    );
  };

  return (
    <div className="explica cambios-adentro" role="region" aria-label={`Qué cambió dentro de ${nombre}`}>
      <p className="cambios-resumen">
        Adentro, {nSube ? <><b>{plural(nSube, "actividad o proyecto subió", "actividades y proyectos subieron")}</b> {fmtDelta(sube)}</> : "nada subió"}
        {" y "}
        {nBaja ? <><b>{plural(nBaja, "bajó", "bajaron")}</b> {fmtDelta(baja)}</> : "nada bajó"}
        : en total {fmtDelta(sube + baja)}.
      </p>
      <div className="explica-grid">
        {suben.length ? (
          <section>
            <h4>Lo que más subió</h4>
            <ol className="explica-lista cambios-lista">{suben.map((f) => fila(f, otraUnidad(f, bajan), "sube"))}</ol>
            {nSube > suben.length ? <p className="explica-nota">Y {(nSube - suben.length).toLocaleString("es-PE")} más: {fmtDelta(sube - suben.reduce((a, f) => a + f[6] - f[5], 0))} entre todas.</p> : null}
          </section>
        ) : null}
        {bajan.length ? (
          <section>
            <h4>Lo que más bajó</h4>
            <ol className="explica-lista cambios-lista">{bajan.map((f) => fila(f, otraUnidad(f, suben), "baja"))}</ol>
            {nBaja > bajan.length ? <p className="explica-nota">Y {(nBaja - bajan.length).toLocaleString("es-PE")} más: {fmtDelta(baja - bajan.reduce((a, f) => a + f[6] - f[5], 0))} entre todas.</p> : null}
          </section>
        ) : null}
      </div>
      <p className="explica-pie">
        Cada fila es una actividad o un proyecto de una entidad. Cuando un mismo proyecto sube en una entidad y baja en
        otra, el dinero se trasladó entre ellas: no es gasto nuevo.
      </p>
    </div>
  );
}
