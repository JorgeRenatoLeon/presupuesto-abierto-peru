export type Banda = { texto: string; color: "fucsia" | "amarillo" | "verde" | "naranja" | "celeste"; chica?: boolean; grande?: boolean };

/** The page's question and number as a stack of fluorescent poster bands (the site's signature).
 *  One heading for assistive tech; each band wipes in once, left to right, unless motion is reduced. */
export function Bandas({ bandas, etiqueta }: { bandas: Banda[]; etiqueta?: string }) {
  return (
    <h1 className="bandas" aria-label={etiqueta ?? bandas.map((b) => b.texto).join(" ")}>
      {bandas.map((b, i) => (
        <span key={i} aria-hidden className={`banda ${b.color} ${b.chica ? "chica" : ""} ${b.grande ? "grande" : ""}`}
              style={{ "--i": i } as React.CSSProperties}>
          {b.texto}
        </span>
      ))}
    </h1>
  );
}
