/** The page's question or name as one sentence-case heading, and the amount it is about on its own
 *  line beneath it (outside the heading, so the heading reads as the name alone). */
export function Titulo({ texto, monto }: { texto: string; monto?: string | null }) {
  return (
    <>
      <h1 className="titulo">{texto}</h1>
      {monto ? <p className="titulo-monto">{monto}</p> : null}
    </>
  );
}
