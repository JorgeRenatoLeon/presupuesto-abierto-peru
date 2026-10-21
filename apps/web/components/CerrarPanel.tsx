"use client";

import { useRef } from "react";
import { ChevronUp } from "lucide-react";

/** The end of an opened panel, said out loud: "Cerrar «Ambiente»" closes the <details> it sits in
 *  and brings its row back into view, so a long panel never leaves the reader lost below it. */
export function CerrarPanel({ texto }: { texto: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button" className="cerrar-panel" onClick={() => {
      const det = ref.current?.closest("details");
      if (!det) return;
      det.open = false;
      const fila = det.querySelector("summary");
      if (fila && fila.getBoundingClientRect().top < 0) fila.scrollIntoView({ block: "start" });
      fila?.focus({ preventScroll: true });
    }}>
      <ChevronUp className="icono-linea" aria-hidden /> {texto}
    </button>
  );
}
