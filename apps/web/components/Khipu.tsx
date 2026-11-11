import { fmtNombre, fmtSoles } from "@/lib/types";

/** Dye order validated for colour-blind separation of neighbours (dataviz validator, light ground):
 *  añil, cochinilla, q'olle, maíz morado, turquesa; whatever is left is "otras" in undyed grey. */
export const TINTAS = ["anil", "cochinilla", "qolle", "morado", "turquesa"] as const;

export type Segmento = { id: string; nombre: string; monto: number };

/** A round amount per knot (1, 2 or 5 times a power of ten) so the longest cord carries 6 to 15. */
function unidadNudo(mayor: number): number {
  const base = 10 ** Math.floor(Math.log10(mayor / 6));
  return [5, 2, 1].map((k) => k * base).find((u) => mayor / u >= 6) ?? base;
}

/** Names whose first word is too long for a cord's tip on a phone, by a word of their own. */
const CORTOS: Record<string, string> = { "Planeamiento, gestión y reserva de contingencia": "Gestión" };

/** A name's first word, for the tip of a cord on a phone: "Orden público y seguridad" -> "Orden". */
const corto = (nombre: string) =>
  CORTOS[nombre] ?? (/^(las|los|otras|otros)\b/i.test(nombre) ? nombre : nombre.split(/[\s,]+/)[0]);

/** A budget split as a khipu: each part a dyed cord hanging from the main cord, its length the
 *  money, a knot every round amount. Identity never rests on colour alone: each cord carries its
 *  share and its name (the first word on a phone), and the rows below are its legend. */
export function Khipu({ segmentos, etiqueta }: { segmentos: Segmento[]; etiqueta: string }) {
  const montos = segmentos.map((s) => Math.max(s.monto, 0));
  const total = montos.reduce((a, m) => a + m, 0) || 1;
  const mayor = Math.max(...montos, 1);
  const unidad = unidadNudo(mayor);
  const nombres = segmentos.map((s) => fmtNombre(s.nombre));
  // On a phone (cords about 58px apart, 150px for the longest) a long first word runs past its
  // column; when it would touch its neighbour's at about the same height, the later label drops
  // just below it, so two names never read as one phrase.
  const ancho = (t: string) => t.length * 6.9; // Alegreya Sans 700 at 13px, measured
  const baja = montos.map(() => 0);
  for (let i = 1; i < montos.length; i++) {
    const tocan = (ancho(corto(nombres[i - 1])) + ancho(corto(nombres[i]))) / 2 > 56;
    const antes = (montos[i - 1] / mayor) * 150 + baja[i - 1], aqui = (montos[i] / mayor) * 150;
    if (tocan && Math.abs(aqui - antes) < 38) baja[i] = Math.max(0, antes + 38 - aqui);
  }
  return (
    <figure className="khipu">
      <div className="khipu-cuerdas" role="img" aria-label={`${etiqueta}: ` + segmentos.map((s, i) =>
        `${fmtNombre(s.nombre)} ${Math.round((montos[i] / total) * 100)}%`).join(", ")}>
        {segmentos.map((s, i) => {
          const largo = montos[i] / mayor;
          const nudos = Math.floor(montos[i] / unidad);
          const nombre = nombres[i];
          return (
            <span key={s.id} className={`khipu-colgante ${tinta(i)}`} title={`${nombre}: ${fmtSoles(montos[i])}`}
                  style={{ "--largo": largo, "--i": i, "--baja": `${Math.round(baja[i])}px` } as React.CSSProperties}>
              <span className="khipu-cuerda">
                {Array.from({ length: nudos }, (_, k) => (
                  <i key={k} className="khipu-nudo" style={{ top: `${(((k + 1) * unidad) / montos[i]) * 100}%` }} />
                ))}
              </span>
              <span className="khipu-cuota">{Math.round((montos[i] / total) * 100)}%</span>
              <span className="khipu-nombre"><span className="khipu-nombre-corto">{corto(nombre)}</span><span className="khipu-nombre-largo">{nombre}</span></span>
            </span>
          );
        })}
      </div>
      <figcaption className="khipu-clave">
        <i className="khipu-nudo" aria-hidden /> cada nudo: {fmtSoles(unidad)}
      </figcaption>
    </figure>
  );
}

export const tinta = (i: number) => TINTAS[i] ?? "otras";
