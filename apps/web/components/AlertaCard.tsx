"use client";

import { useState } from "react";
import Link from "next/link";
import type { Alerta } from "@/lib/types";
import { MESES } from "@/lib/types";

export function AlertaCard({ alerta, enEntidad = false, nueva = false }: {
  alerta: Alerta; enEntidad?: boolean; nueva?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  const compartir = async () => {
    const texto = `${alerta.titulo}\n\n${alerta.mensaje}\n\nFuente: Presupuesto Abierto Perú (datos oficiales del MEF)`;
    try {
      if (navigator.share) {
        await navigator.share({ title: alerta.titulo, text: texto });
      } else {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }
    } catch {
      /* usuario canceló */
    }
  };

  return (
    <article className={`alerta ${alerta.severidad}`}>
      <div className="cabecera">
        {nueva ? <span className="badge nueva">Nueva</span> : null}
        <span className={`badge ${alerta.severidad}`}>{alerta.severidad === "alta" ? "Prioridad alta" : "Atención"}</span>
        {alerta.nivel ? <span className="badge neutro">{alerta.nivel}</span> : null}
        {alerta.departamento ? <span className="badge neutro">{alerta.departamento}</span> : null}
        {alerta.mes ? <span className="badge neutro">{MESES[alerta.mes]} {alerta.ano}</span> : <span className="badge neutro">{alerta.ano}</span>}
      </div>
      <h3>{alerta.titulo}</h3>
      <p>{alerta.mensaje}</p>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="tab" onClick={compartir}>
          {copiado ? "✓ Copiado" : "Compartir"}
        </button>
        {alerta.enlace ? <Link className="tab" href={alerta.enlace}>Ver la comparación →</Link> : null}
        {alerta.sec_ejec && !enEntidad ? <Link className="tab" href={`/entidad/${alerta.sec_ejec}/`}>Ver la entidad →</Link> : null}
      </div>
    </article>
  );
}
