"use client";

import { useState } from "react";
import { urlDatos, type Obra } from "@/lib/types";
import { ListaObras } from "@/components/Obras";

/** The rest of an entity's largest projects, loaded from its data file on request:
 *  the page itself carries only the first ones (2,900 entity pages add up). */
export function MasObras({ sec, desde, total }: { sec: string; desde: number; total: number }) {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [cargando, setCargando] = useState(false);
  if (total <= desde) return null;
  if (obras) return <ListaObras obras={obras.slice(desde)} sec={sec} />;
  const cargar = () => {
    setCargando(true);
    fetch(urlDatos(`entidad/${sec}.json`)).then((r) => r.json()).then((d) => setObras(d.obras ?? [])).catch(() => setCargando(false));
  };
  return (
    <button type="button" className="tab" onClick={cargar} disabled={cargando} style={{ marginTop: 10 }}>
      {cargando ? "Cargando…" : `Ver ${Math.min(total, 40) - desde} proyectos más`}
    </button>
  );
}
