"use client";

import { useEffect, useRef, useState } from "react";
import { fmtSoles, fmtNombre, urlDatos } from "@/lib/types";
import { MontoPar } from "@/components/MontoPar";
import { BotonExplicar, PanelExplicacion } from "@/components/Explicacion";

type Item = { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null; sd?: boolean };
/** detalle/<sec>.json, per función, aligned with the entity's items: metas, expense types
 *  (clasificador code), the rest of the expense types summed, funding sources (rubro code). */
type Detalle = { m: [string, number, number][]; e: [string, number, number][]; o?: [number, number]; f: [string, number, number][] };
type Clasificador = { especificas: Record<string, [string, string | null]>; rubros: Record<string, string> };

const pedidos = new Map<string, Promise<unknown>>();
function cargar<T>(ruta: string): Promise<T | null> {
  if (!pedidos.has(ruta)) {
    pedidos.set(ruta, fetch(urlDatos(ruta)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return pedidos.get(ruta) as Promise<T | null>;
}

/** An entity's largest activities and projects in one función, fetched from its data file the
 *  first time the <details> row opens (kept out of the page: 2,900 pages × 12 rows). */
export function ItemsAlAbrir({ sec, codigo, esperado }: { sec: string; codigo: string; esperado?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const det = ref.current?.closest("details");
    if (!det) return;
    const alCambiar = () => det.open && setAbierto(true);
    alCambiar();
    det.addEventListener("toggle", alCambiar);
    return () => det.removeEventListener("toggle", alCambiar);
  }, []);
  useEffect(() => {
    if (abierto && !items) {
      cargar<{ items?: Record<string, Item[]> }>(`entidad/${sec}.json`).then((d) => setItems(d?.items?.[codigo] ?? []));
    }
  }, [abierto, items, sec, codigo]);

  return (
    <div ref={ref}>
      {abierto && !items ? <p className="explica cargando">Cargando…</p> : null}
      {items?.length ? (
        <>
          <h4>En qué lo usa: sus actividades y proyectos más grandes</h4>
          <ol className="items">
            {items.map((i, k) => (
              <li key={`${i.tipo}-${i.nombre}-${k}`} className={i.sd ? "sin-desc" : ""}>
                <div className="item-cab">
                  <span className={`etiqueta-tipo ${i.tipo}`}>{i.tipo === "proyecto" ? "Obra / proyecto" : "Actividad"}</span>
                  {i.nombre?.trim()
                    ? <span className="item-nombre">{fmtNombre(i.nombre)}</span>
                    : <span className="item-nombre sin-nombre">Sin nombre en los datos del MEF</span>}
                  {i.sd ? <span className="badge sin-descripcion">Sin descripción</span> : null}
                </div>
                <MontoPar pim={i.pim} devengado={i.devengado} esperado={esperado} compacto />
                <DetalleItem sec={sec} codigo={codigo} k={k} sinDescripcion={!!i.sd} />
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

function DetalleItem({ sec, codigo, k, sinDescripcion }: { sec: string; codigo: string; k: number; sinDescripcion: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<{ d: Detalle | null; c: Clasificador | null } | null>(null);
  useEffect(() => {
    if (abierto && !datos) {
      Promise.all([cargar<Record<string, Detalle[]>>(`detalle/${sec}.json`), cargar<Clasificador>("clasificador.json")])
        .then(([d, c]) => setDatos({ d: d?.[codigo]?.[k] ?? null, c }));
    }
  }, [abierto, datos, sec, codigo, k]);
  return (
    <>
      <button type="button" className="enlace-explicar" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? "Ocultar el detalle" : sinDescripcion ? "¿Qué se sabe de este presupuesto?" : "¿En qué exactamente?"}
      </button>
      {abierto ? (
        !datos ? <p className="explica cargando">Cargando…</p>
          : datos.d && datos.c ? <PanelDetalle d={datos.d} c={datos.c} sinDescripcion={sinDescripcion} />
            : <p className="explica">No hay más detalle para esta línea.</p>
      ) : null}
    </>
  );
}

function PanelDetalle({ d, c, sinDescripcion }: { d: Detalle; c: Clasificador; sinDescripcion: boolean }) {
  const [explicado, setExplicado] = useState<string | null>(null);
  const totalFuentes = d.f.reduce((a, [, p]) => a + p, 0) || 1;
  return (
    <div className="detalle-item">
      {sinDescripcion ? (
        <p className="aviso-sd">
          El MEF publica este presupuesto con un código genérico, sin nombre de proyecto ni meta que digan para qué es.
          Lo único público es el tipo de gasto, abajo. La ley permite reservar cierta información (por ejemplo, de defensa
          nacional); aun así, puedes pedir a la entidad la que sí sea pública con la Ley de Transparencia.
        </p>
      ) : null}
      {d.m.length ? (
        <section>
          <h5>Para qué (metas)</h5>
          <ul>
            {d.m.map(([nombre, pim, dev], i) => (
              <li key={i}>
                <span className={nombre.trim() ? "" : "sin-nombre"}>{nombre.trim() ? nombre : "Meta sin nombre"}</span>
                <MontoPar pim={pim} devengado={dev} compacto />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h5>Qué se compra o se paga</h5>
        <ul>
          {d.e.map(([cod, pim, dev]) => {
            const [nombre, contexto] = c.especificas[cod] ?? [cod, null];
            return (
              <li key={cod}>
                <span className="gasto-nombre">
                  {nombre}
                  <BotonExplicar abierto={explicado === cod} nombre={nombre} onClick={() => setExplicado(explicado === cod ? null : cod)} />
                  {contexto ? <small>{contexto}</small> : null}
                </span>
                <MontoPar pim={pim} devengado={dev} compacto />
                {explicado === cod ? <PanelExplicacion dimension="generica" id={cod} soloDefinicion /> : null}
              </li>
            );
          })}
          {d.o ? (
            <li>
              <span className="gasto-nombre">Otros tipos de gasto</span>
              <MontoPar pim={d.o[0]} devengado={d.o[1]} compacto />
            </li>
          ) : null}
        </ul>
      </section>
      {d.f.length ? (
        <section>
          <h5>De dónde sale el dinero</h5>
          <p className="fuentes">
            {d.f.map(([r, pim]) => (
              <span key={r}><b>{c.rubros[r] ?? r}</b> {Math.round((pim / totalFuentes) * 100)}% <small>({fmtSoles(pim)})</small></span>
            ))}
          </p>
        </section>
      ) : null}
      <p className="explica-pie">Montos del presupuesto vigente y lo gastado (devengado), según los datos abiertos del MEF.</p>
    </div>
  );
}
