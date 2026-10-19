"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { archivoExplicacion, fmtSoles, fmtPct, fmtLugar, urlDatos, type Explicacion } from "@/lib/types";

const cache = new Map<string, Explicacion | null>();

/** "¿Qué es?" for a budget category: MEF's definition, our plain reading, and from the data
 *  what that money pays for, how, and who spends it. Loaded on demand (one small file). */
export function PanelExplicacion({ dimension, id, soloDefinicion = false }:
  { dimension: string; id: string; soloDefinicion?: boolean }) {
  const clave = `${dimension}/${id}`;
  const [e, setE] = useState<Explicacion | null | undefined>(cache.get(clave));

  useEffect(() => {
    if (cache.has(clave)) return;
    let vivo = true;
    fetch(urlDatos(`explicar/${dimension}/${archivoExplicacion(id)}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => { cache.set(clave, d); if (vivo) setE(d); });
    return () => { vivo = false; };
  }, [clave, dimension, id]);

  if (e === undefined) return <div className="explica cargando" aria-busy>Cargando explicación…</div>;
  if (e === null) return <div className="explica">No hay explicación disponible para esta categoría.</div>;

  const total = e.pim || 1;
  const parte = (v: number | null) => fmtPct((v ?? 0) / total);
  return (
    <div className="explica" role="region" aria-label={`Qué es ${e.nombre}`}>
      {e.simple ? (
        <p className="explica-simple"><strong>En palabras simples:</strong> {e.simple.texto}
          {e.simple.ejemplos ? <span className="explica-ejemplos"> Por ejemplo: {e.simple.ejemplos}.</span> : null}</p>
      ) : null}
      {e.oficial ? (
        <blockquote className="explica-oficial">
          <p>{e.oficial.texto}</p>
          <footer>
            Definición oficial{e.oficial.heredado ? ` de «${e.oficial.nombre}», la categoría que la contiene` : ""} ·{" "}
            {e.oficial.fuente}
          </footer>
        </blockquote>
      ) : null}

      {soloDefinicion ? null : <div className="explica-grid">
        <section>
          <h4>¿En qué se usa este dinero?</h4>
          <ol className="explica-lista">
            {e.en_que.map((x) => (
              <li key={`${x.tipo}-${x.nombre}`}>
                <span className="explica-item">
                  <span className={`etiqueta-tipo ${x.tipo}`}>{x.tipo === "proyecto" ? "Obra / proyecto" : "Actividad"}</span>
                  {x.nombre.toLowerCase()}
                </span>
                <span className="cifra">{fmtSoles(x.pim)} <small>{parte(x.pim)}</small></span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4>{e.dimension === "funcion" ? "¿Cómo se gasta?" : "¿Para qué se gasta?"}</h4>
          <ul className="explica-lista">
            {e.como.map((x) => (
              <li key={x.codigo}>
                <span className="explica-item">{x.nombre.toLowerCase()}</span>
                <span className="cifra">{parte(x.pim)}</span>
              </li>
            ))}
          </ul>
          <h4>¿Quién lo gasta?</h4>
          <ul className="explica-lista">
            {e.quien.map((x) => (
              <li key={x.sec_ejec}>
                <Link href={`/entidad/${x.sec_ejec}/`} className="explica-item enlace">{fmtLugar(x.nombre)}</Link>
                <span className="cifra">{fmtSoles(x.pim)}</span>
              </li>
            ))}
          </ul>
          <p className="explica-pie">
            {e.entidades.toLocaleString("es-PE")} entidades tienen presupuesto en esta categoría en {e.ano}
            {e.por_nivel.length ? ": " + e.por_nivel.map((n) => `${n.nivel.toLowerCase()} ${parte(n.pim)}`).join(", ") : ""}.
          </p>
        </section>
      </div>}
    </div>
  );
}

export function BotonExplicar({ abierto, onClick, nombre }: { abierto: boolean; onClick: () => void; nombre: string }) {
  return (
    <button type="button" className={`boton-explicar ${abierto ? "activo" : ""}`} aria-expanded={abierto}
            aria-label={`${abierto ? "Ocultar" : "Ver"} qué es ${nombre}`} onClick={onClick}>
      ?<span className="sr-solo-movil"> ¿Qué es?</span>
    </button>
  );
}

/** Button + panel for places that list categories outside the comparator. */
export function Explicable({ dimension, id, nombre, soloDefinicion = false, texto }:
  { dimension: string; id: string; nombre: string; soloDefinicion?: boolean; texto?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      {texto ? (
        <button type="button" className="enlace-explicar" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
          {abierto ? "Ocultar definición" : texto}
        </button>
      ) : <BotonExplicar abierto={abierto} onClick={() => setAbierto(!abierto)} nombre={nombre} />}
      {abierto ? <PanelExplicacion dimension={dimension} id={id} soloDefinicion={soloDefinicion} /> : null}
    </>
  );
}
