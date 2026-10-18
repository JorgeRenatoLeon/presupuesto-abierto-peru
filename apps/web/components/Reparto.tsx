import Link from "next/link";
import { fmtSoles } from "@/lib/types";

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

/** Part-to-whole as a ranked single-hue bar list (magnitude, not identity): top N + "Otros". */
export function RepartoPorCien({ partes, maximo = 8, href }: { partes: Parte[]; maximo?: number; href?: string }) {
  const ordenadas = [...partes].filter((p) => p.monto > 0).sort((a, b) => b.monto - a.monto);
  if (!ordenadas.length) return <div className="vacio">Sin datos disponibles todavía.</div>;
  const top = ordenadas.slice(0, maximo);
  const cola = ordenadas.slice(maximo);
  const filas = cola.length
    ? [...top, { id: "otros", nombre: `Otras ${cola.length} funciones`, monto: cola.reduce((a, p) => a + p.monto, 0) }]
    : top;
  const soles = partesDeCien(filas.map((f) => f.monto));
  const mayor = Math.max(...soles, 1);
  return (
    <div className="reparto" role="list">
      {filas.map((f, i) => {
        const contenido = (
          <>
            <span className="reparto-valor" aria-label={`${soles[i]} soles de cada 100`}>S/ {soles[i]}</span>
            <span className="reparto-cuerpo">
              <span className="linea1">
                <span className="nombre">{f.nombre}</span>
                <span className="monto">{fmtSoles(f.monto)}</span>
              </span>
              <span className="reparto-barra"><span style={{ width: `${(soles[i] / mayor) * 100}%` }} /></span>
            </span>
          </>
        );
        return href && f.id !== "otros"
          ? <Link key={f.id} href={href} className="reparto-fila" role="listitem">{contenido}</Link>
          : <div key={f.id} className="reparto-fila" role="listitem">{contenido}</div>;
      })}
    </div>
  );
}
