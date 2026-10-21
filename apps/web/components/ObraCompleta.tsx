"use client";

import { useEffect, useState } from "react";
import { fmtSoles, fmtPct, fmtFecha, urlDatos } from "@/lib/types";
import { cargarDatos, type ObraEntera } from "@/lib/contratos";

export const cargarObras = (sec: string) => cargarDatos<Record<string, ObraEntera>>(urlDatos(`obras/${sec}.json`));
const MESES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "202309" (MEF's year-month) -> "sep 2023" */
const anoMes = (s: string | null) => (s && /^\d{6}$/.test(s) ? `${MESES[Number(s.slice(4))]} ${s.slice(0, 4)}` : null);

/** A project as a whole, before its contracts: the budget shows only this year's slice of a project,
 *  its contracts cover all of it (often signed in earlier years). From MEF's Banco de Inversiones and
 *  the entity's own monthly report (Formato 12B). */
export function ObraCompleta({ sec, cui, anual, contratos }: {
  sec: string; cui: string;
  /** this year's budget for the project (PIM) */
  anual?: number | null;
  /** what its contracts add up to: signed and, after amendments, final */
  contratos?: { n: number; firmado: number; final: number } | null;
}) {
  const [o, setO] = useState<ObraEntera | null | undefined>(undefined);
  useEffect(() => { cargarObras(sec).then((d) => setO(d?.[cui] ?? null)); }, [sec, cui]);
  if (!o) return null;
  const sobrecosto = o.costo && o.viable ? o.costo / o.viable - 1 : null;
  const gastado = o.costo && o.acumulado != null ? o.acumulado / o.costo : null;
  const [fecha, situacion, problema, accion] = o.reporte ?? [null, null, null, null];
  return (
    <div className="obra-entera">
      <h5>La obra completa</h5>
      <dl className="obra-cifras">
        <div>
          <dt>Costo total</dt>
          <dd>
            <b>{fmtSoles(o.costo)}</b>
            {sobrecosto != null && Math.abs(sobrecosto) >= 0.01 ? (
              <small className={sobrecosto >= 0.3 ? "sube" : ""}>
                aprobado en {fmtSoles(o.viable)} ({sobrecosto > 0 ? "+" : "−"}{fmtPct(Math.abs(sobrecosto))})
              </small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Gastado desde el inicio</dt>
          <dd><b>{fmtSoles(o.acumulado)}</b><small>{gastado != null ? `${fmtPct(gastado)} del costo` : ""}{anoMes(o.desde) ? ` · desde ${anoMes(o.desde)}` : ""}</small></dd>
        </div>
        {anual != null ? (
          <div><dt>Presupuesto de este año</dt><dd><b>{fmtSoles(anual)}</b><small>solo la parte que se paga este año</small></dd></div>
        ) : null}
        {o.fisico != null ? <div><dt>Avance físico</dt><dd><b>{fmtPct(o.fisico / 100)}</b><small>según la entidad</small></dd></div> : null}
        {contratos?.n ? (
          <div>
            <dt>Sus contratos en el SEACE</dt>
            <dd>
              <b>{fmtSoles(contratos.firmado)}</b>
              <small>{contratos.n === 1 ? "1 contrato" : `${contratos.n} contratos`}{contratos.final > contratos.firmado * 1.005 ? ` · ${fmtSoles(contratos.final)} con adicionales` : ""}</small>
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="obra-meta-linea">
        {[o.modalidad ? `Ejecución: ${o.modalidad.toLowerCase().replace(/,/g, ", ")}` : null,
          o.inicio && o.fin ? `del ${fmtFecha(o.inicio)} al ${fmtFecha(o.fin)}` : null,
          o.beneficiarios ? `${o.beneficiarios.toLocaleString("es-PE")} beneficiarios` : null].filter(Boolean).join(" · ")}
        {o.ubicacion ? (
          <> · <a href={`https://www.openstreetmap.org/?mlat=${o.ubicacion[0]}&mlon=${o.ubicacion[1]}#map=16/${o.ubicacion[0]}/${o.ubicacion[1]}`}
                 target="_blank" rel="noopener">Ver en el mapa ↗</a></>
        ) : null}
      </p>
      {o.laudo ? <p className="obra-alerta">Laudos arbitrales: {fmtSoles(o.laudo)} (pagos ordenados tras una disputa con el contratista).</p> : null}
      {problema ? (
        <p className="obra-alerta">
          <strong>Problema reportado por la entidad:</strong> {problema}{/[.!?]$/.test(problema) ? "" : "."}
          {accion ? <> <strong>Qué hará:</strong> {accion}</> : null}
        </p>
      ) : null}
      {situacion ? (
        <details className="obra-reporte">
          <summary>Último reporte de la entidad al MEF{fecha ? ` (${fmtFecha(fecha)})` : ""}</summary>
          <p>{situacion}</p>
        </details>
      ) : null}
      <p className="explica-nota">
        El presupuesto de cada año es solo la parte de la obra que se paga ese año; los contratos cubren la obra entera y
        pueden haberse firmado en años anteriores.
      </p>
    </div>
  );
}
