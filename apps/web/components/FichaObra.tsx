"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { fmtSoles, fmtPct, fmtDelta, fmtNombre, fmtLugar, fichaInversion } from "@/lib/types";
import { cargarParte, parteDe, type FilaObra, type ParteObras } from "@/lib/buscar";
import { BarraProgreso } from "@/components/ui";
import { SENAL_OBRA } from "@/components/Obras";
import { ContratosDelProyecto } from "@/components/Contratos";
import { OrdenesDelProyecto } from "@/components/Ordenes";

/** One project of one unit (?sec=&cui=): this year's budget and spending, the project as a whole,
 *  its contracts and its purchase orders. Files are loaded in the browser: one part of the
 *  search index (its unit's), then the unit's project, contract and order files. */
export function FichaObra() {
  const [pedido, setPedido] = useState<{ sec: string; cui: string } | null>(null);
  const [p, setP] = useState<ParteObras | null | undefined>(undefined);
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const sec = u.get("sec")?.trim() ?? "", cui = u.get("cui")?.trim() ?? "";
    setPedido({ sec, cui });
    if (!/^\d{1,6}$/.test(sec) || !/^\d{4,8}$/.test(cui)) { setP(null); return; }
    cargarParte(parteDe(sec)).then(setP);
  }, []);
  const fila: FilaObra | undefined = pedido && p ? p.o.find((r) => r[1] === pedido.sec && r[0] === pedido.cui) : undefined;
  useEffect(() => {
    if (fila) document.title = `${fmtNombre(fila[2])} — Presupuesto Abierto Perú`;
  }, [fila]);

  if (p === undefined || !pedido) return <p className="explica cargando">Cargando la obra…</p>;
  const { sec, cui } = pedido;
  if (p === null) {
    return (
      <section className="hero">
        <h1>Obra no encontrada</h1>
        <p>El enlace no indica una obra válida. Búscala por su nombre o su CUI en <Link href="/buscar/" className="enlace-texto">Buscar</Link>.</p>
      </section>
    );
  }
  const entidad = p.e[sec] ?? null;
  const [, , nombre, f, d, pim, dev, pimAnt, devAnt, senal] = fila ?? [cui, sec, null, null, null, null, null, null, null, null];
  const depto = d != null ? p.d[d] : null;
  const avance = pim ? (dev ?? 0) / pim : null;
  const s = senal ? SENAL_OBRA[senal] : null;
  const cambio = pim != null && pimAnt != null ? pim - pimAnt : null;

  return (
    <>
      <nav style={{ fontSize: 13 }}>
        <Link href={`/entidad/${sec}/#obras`} style={{ color: "var(--rojo)", fontWeight: 600 }}>
          <ArrowLeft className="icono-linea" aria-hidden /> {entidad ? fmtLugar(entidad) : "La entidad"}
        </Link>
      </nav>
      <section className="hero">
        <p className="obra-tipo"><span className="etiqueta-tipo proyecto">Obra / proyecto</span> CUI {cui}</p>
        <h1 className="obra-titulo">{nombre ? fmtNombre(nombre) : `Proyecto ${cui}`}</h1>
        <p>
          {entidad ? <>A cargo de <Link href={`/entidad/${sec}/`} className="enlace-texto">{fmtLugar(entidad)}</Link></> : null}
          {f != null ? ` · ${fmtNombre(p.f[f])}` : ""}
          {depto ? ` · ${fmtLugar(depto[1])}` : ""}
        </p>
      </section>

      {fila ? (
        <section className="tarjeta seccion">
          <h2>Este año</h2>
          {s ? <p><span className={`badge ${s.clase}`}>{s.texto}</span></p> : null}
          <dl className="obra-cifras">
            <div><dt>Presupuesto</dt><dd><b>{fmtSoles(pim)}</b><small>lo que puede gastar este año (PIM)</small></dd></div>
            <div><dt>Gastado</dt><dd><b>{fmtSoles(dev)}</b><small>{fmtPct(avance)} del presupuesto del año</small></dd></div>
            {cambio ? (
              <div><dt>Desde la publicación anterior</dt><dd><b className={cambio > 0 ? "sube" : "baja"}>{fmtDelta(cambio)}</b><small>antes tenía {fmtSoles(pimAnt)}</small></dd></div>
            ) : null}
            {devAnt ? <div><dt>El año pasado</dt><dd><b>{fmtSoles(devAnt)}</b><small>gastado en todo el año</small></dd></div> : null}
          </dl>
          <BarraProgreso avance={avance} tono={s?.clase === "alta" ? "bad" : undefined} />
        </section>
      ) : (
        <p className="explica">Este proyecto no tiene presupuesto ni gasto de {entidad ? fmtLugar(entidad) : "esta entidad"} este año.</p>
      )}

      <section className="tarjeta seccion">
        <h2>La obra y quién la hace</h2>
        <ContratosDelProyecto sec={sec} cui={cui} anual={pim} />
        <OrdenesDelProyecto sec={sec} cui={cui} />
      </section>

      <p className="obra-enlaces">
        <a href={fichaInversion(cui)} target="_blank" rel="noopener">Ficha oficial en el Banco de Inversiones del MEF ↗</a>
        {depto ? <Link href={`/mapa/?dep=${depto[0]}&q=${cui}`}>Buscarla en el mapa</Link> : null}
        <Link href={`/entidad/${sec}/#obras`}>Las demás obras de la entidad</Link>
      </p>
    </>
  );
}
