"use client";

import { useEffect, useRef, useState } from "react";
import { fmtSoles, urlDatos } from "@/lib/types";

type Item = { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null };
const pedidos = new Map<string, Promise<Record<string, Item[]>>>();
const itemsDe = (sec: string) => {
  if (!pedidos.has(sec)) {
    pedidos.set(sec, fetch(urlDatos(`entidad/${sec}.json`)).then((r) => r.json()).then((d) => d.items ?? {}).catch(() => ({})));
  }
  return pedidos.get(sec)!;
};

/** An entity's largest activities and projects in one función, fetched from the entity's data
 *  file the first time its <details> row opens (kept out of the page: 2,900 pages × 12 rows). */
export function ItemsAlAbrir({ sec, codigo }: { sec: string; codigo: string }) {
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
    if (abierto && !items) itemsDe(sec).then((m) => setItems(m[codigo] ?? []));
  }, [abierto, items, sec, codigo]);

  return (
    <div ref={ref}>
      {abierto && !items ? <p className="explica cargando">Cargando…</p> : null}
      {items?.length ? (
        <>
          <h4>En qué lo usa (presupuesto vigente · gastado)</h4>
          <ol className="explica-lista">
            {items.map((i) => (
              <li key={`${i.tipo}-${i.nombre}`}>
                <span className="explica-item">
                  <span className={`etiqueta-tipo ${i.tipo}`}>{i.tipo === "proyecto" ? "Obra / proyecto" : "Actividad"}</span>
                  {i.nombre.toLowerCase()}
                </span>
                <span className="cifra">{fmtSoles(i.pim)}<small> · {fmtSoles(i.devengado)}</small></span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}
