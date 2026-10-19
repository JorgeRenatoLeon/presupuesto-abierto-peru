"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { fmtLugar, urlDatos, type DistritoIndice } from "@/lib/types";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Two taps to your municipality: type a district, province or region. Loads the
 *  1,900-district index (~150 KB) only when the field is first used. */
export function BuscaMunicipalidad({ autoFocus = false, etiqueta = "Busca tu municipalidad" }: { autoFocus?: boolean; etiqueta?: string }) {
  const [indice, setIndice] = useState<DistritoIndice[] | null>(null);
  const [q, setQ] = useState("");
  const [pedido, setPedido] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!pedido || indice) return;
    fetch(urlDatos("localidad/distritos.json")).then((r) => r.json()).then(setIndice).catch(() => setIndice([]));
  }, [pedido, indice]);

  const resultados = useMemo(() => {
    const t = norm(q.trim());
    if (!indice || t.length < 2) return [];
    const puntaje = (d: DistritoIndice) =>
      norm(d.d).startsWith(t) ? 0 : norm(d.d).includes(t) ? 1 : norm(d.p).startsWith(t) ? 2 : norm(d.r ?? "").startsWith(t) ? 3 : 9;
    return indice.map((d) => [puntaje(d), d] as const).filter(([p]) => p < 9)
      .sort((a, b) => a[0] - b[0] || a[1].d.localeCompare(b[1].d)).slice(0, 8).map(([, d]) => d);
  }, [indice, q]);

  return (
    <div className="busca-muni">
      <label htmlFor={id} className="busca-etiqueta">{etiqueta}</label>
      <input id={id} type="search" className="buscador" value={q} autoFocus={autoFocus} autoComplete="off"
             placeholder="Distrito, provincia o región (p. ej. Ollantaytambo)"
             onFocus={() => setPedido(true)} onChange={(e) => { setPedido(true); setQ(e.target.value); }}
             aria-describedby={`${id}-estado`} />
      <p id={`${id}-estado`} className="sr-only" aria-live="polite">
        {q.trim().length >= 2 ? (indice ? `${resultados.length} resultados` : "Cargando distritos…") : ""}
      </p>
      {resultados.length ? (
        <ul className="busca-resultados">
          {resultados.map((d) => (
            <li key={d.u}>
              <Link href={d.s ? `/entidad/${d.s}/` : `/localidad/${d.u.slice(0, 2)}/${d.u.slice(2, 4)}/#d${d.u}`}>
                <span className="nombre">{fmtLugar(d.d)}</span>
                <span className="detalle">{d.d === d.p ? "Capital de provincia" : `Provincia de ${fmtLugar(d.p)}`} · {fmtLugar(d.r ?? "")}</span>
              </Link>
              <Link className="busca-prov" href={`/localidad/${d.u.slice(0, 2)}/${d.u.slice(2, 4)}/#d${d.u}`}
                    aria-label={`Ver la provincia de ${fmtLugar(d.p)}`}>Provincia <ArrowRight className="icono-linea" aria-hidden /></Link>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && indice ? (
        <p className="busca-vacio">Ningún distrito coincide con «{q}». Prueba sin tildes o con el nombre de la provincia.</p>
      ) : null}
    </div>
  );
}
