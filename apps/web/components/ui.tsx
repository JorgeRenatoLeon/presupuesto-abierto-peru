import Link from "next/link";
import { fmtSoles, fmtPct } from "@/lib/types";

export function KpiCard({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="tarjeta kpi">
      <div className="etiqueta">{etiqueta}</div>
      <div className="valor">{valor}</div>
      {nota ? <div className="nota">{nota}</div> : null}
    </div>
  );
}

export function Lectura({ tono, children }: { tono: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const icono = tono === "ok" ? "✓" : tono === "warn" ? "!" : "✕";
  return (
    <div className={`lectura ${tono}`}>
      <strong aria-hidden>{icono}</strong>
      <span>{children}</span>
    </div>
  );
}

export function BarraProgreso({ avance, tono }: { avance: number | null; tono?: "ok" | "warn" | "bad" }) {
  const pct = avance == null || !isFinite(avance) ? 0 : Math.max(0, Math.min(1, avance)) * 100;
  return (
    <div className={`barra ${tono ?? ""}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export type FilaItem = {
  id: string;
  nombre: string;
  monto: number;        // devengado
  referencia: number | null; // pim
  href?: string;
  extra?: string;
};

export function ListaBarras({ items, unidadNota }: { items: FilaItem[]; unidadNota?: string }) {
  if (!items.length) return <div className="vacio">Sin datos disponibles todavía.</div>;
  const max = Math.max(...items.map((i) => i.monto), 1);
  return (
    <div>
      {items.map((i) => {
        const avance = i.referencia ? i.monto / i.referencia : null;
        const contenido = (
          <>
            <div className="linea1">
              <span className="nombre">{i.nombre}</span>
              <span className="monto">{fmtSoles(i.monto)}</span>
            </div>
            <BarraProgreso avance={i.monto / max} />
            <div className="detalle">
              <span>{i.extra ?? ""}</span>
              <span>
                {avance != null ? `${fmtPct(avance)} de ${fmtSoles(i.referencia)}` : unidadNota ?? ""}
              </span>
            </div>
          </>
        );
        return i.href ? (
          <Link key={i.id} href={i.href} className="fila-lista">{contenido}</Link>
        ) : (
          <div key={i.id} className="fila-lista">{contenido}</div>
        );
      })}
    </div>
  );
}
