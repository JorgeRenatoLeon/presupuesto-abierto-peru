import Link from "next/link";
import { fmtSoles, fmtNombre } from "@/lib/types";
import { Franja, tinta } from "@/components/Franja";

type Parte = { id: string; nombre: string; monto: number };

/** Integer shares that add up to exactly `total` (largest remainder): "S/ 18 de cada S/ 100". */
export function partesDeCien(montos: number[], total = 100): number[] {
  const suma = montos.reduce((a, b) => a + b, 0) || 1;
  const exactas = montos.map((m) => (m / suma) * total);
  const base = exactas.map(Math.floor);
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = exactas.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of orden) {
    if (resto-- <= 0) break;
    base[i] += 1;
  }
  return base;
}

/** Part-to-whole: one stacked ink band (top 5 + the rest) and the ranked rows as its legend. */
export function RepartoPorCien({ partes, maximo = 8, href }: { partes: Parte[]; maximo?: number; href?: string }) {
  const ordenadas = [...partes].filter((p) => p.monto > 0).sort((a, b) => b.monto - a.monto);
  if (!ordenadas.length) return <div className="vacio">Sin datos disponibles todavía.</div>;
  const top = ordenadas.slice(0, maximo);
  const cola = ordenadas.slice(maximo);
  const filas = cola.length
    ? [...top, { id: "otros", nombre: `Otras ${cola.length} funciones`, monto: cola.reduce((a, p) => a + p.monto, 0) }]
    : top;
  const soles = partesDeCien(filas.map((f) => f.monto));
  return (
    <>
    <Franja segmentos={filas.slice(0, 5).concat(filas.length > 5 ? [{ id: "resto", nombre: "Las demás",
      monto: filas.slice(5).reduce((a, f) => a + f.monto, 0) }] : [])} etiqueta="Reparto del presupuesto por función" />
    <div className="reparto" role="list">
      {filas.map((f, i) => {
        const contenido = (
          <>
            <span className={`chip ${i < 5 ? tinta(i) : "otras"}`} aria-hidden />
            <span className="reparto-valor" aria-label={`${soles[i]} soles de cada 100`}>S/ {soles[i]}</span>
            <span className="reparto-cuerpo">
              <span className="linea1">
                <span className="nombre">{fmtNombre(f.nombre)}</span>
                <span className="monto">{fmtSoles(f.monto)}</span>
              </span>
            </span>
          </>
        );
        return href && f.id !== "otros"
          ? <Link key={f.id} href={href} className="reparto-fila" role="listitem">{contenido}</Link>
          : <div key={f.id} className="reparto-fila" role="listitem">{contenido}</div>;
      })}
    </div>
    </>
  );
}
