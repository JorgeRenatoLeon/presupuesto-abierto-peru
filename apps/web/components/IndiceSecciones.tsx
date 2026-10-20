"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

export type Seccion = { id: string; titulo: string };

/** "Saltar a…": a sticky strip of the page's sections under the header. The section on screen is
 *  marked, its chip kept in view; "Arriba" returns to the top. Long pages stop being a scroll hunt. */
export function IndiceSecciones({ secciones }: { secciones: Seccion[] }) {
  const [activa, setActiva] = useState<string | null>(null);
  const tira = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const visibles = new Map<string, number>();
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) visibles.set(e.target.id, e.boundingClientRect.top);
        else visibles.delete(e.target.id);
      }
      const primera = secciones.find((s) => visibles.has(s.id));
      setActiva(primera ? primera.id : null);
    }, { rootMargin: "-120px 0px -55% 0px" });
    for (const s of secciones) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [secciones]);

  useEffect(() => {  // keep the marked chip visible in the horizontal strip
    const chip = activa ? tira.current?.querySelector<HTMLElement>(`a[href="#${activa}"]`) : null;
    if (chip && tira.current) {
      const t = tira.current;
      t.scrollTo({ left: chip.offsetLeft - t.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
    }
  }, [activa]);

  return (
    <nav className="indice" aria-label="Secciones de esta página">
      <div className="indice-tira" ref={tira}>
        {secciones.map((s) => (
          <a key={s.id} href={`#${s.id}`} aria-current={activa === s.id ? "location" : undefined}>{s.titulo}</a>
        ))}
      </div>
      <button type="button" className="indice-arriba" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <ArrowUp className="icono-linea" aria-hidden /><span className="sr-only">Volver arriba</span>
      </button>
    </nav>
  );
}
