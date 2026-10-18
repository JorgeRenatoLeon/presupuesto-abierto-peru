"use client";

import { useEffect, useState } from "react";
import { leerSeguidos, guardarSeguidos, mismo, type Seguido } from "@/lib/seguimiento";

/** ☆ Seguir / ★ Siguiendo: adds the item to this browser's watchlist (/seguimiento). */
export function SeguirBoton({ item, compacto = false }: { item: Seguido; compacto?: boolean }) {
  // unknown until mounted: the static HTML can't know what this browser follows
  const [sigue, setSigue] = useState<boolean | null>(null);
  const { tipo, id, dimension } = item;
  useEffect(() => {
    setSigue(leerSeguidos().some((s) => mismo(s, { tipo, id, dimension, nombre: "" })));
  }, [tipo, id, dimension]);

  const alternar = () => {
    const resto = leerSeguidos().filter((s) => !mismo(s, item));
    guardarSeguidos(sigue ? resto : [...resto, item]);
    setSigue(!sigue);
  };

  if (compacto) {
    return (
      <button className={`seguir-compacto ${sigue ? "activo" : ""}`} onClick={alternar} aria-pressed={!!sigue}
              aria-label={`${sigue ? "Dejar de seguir" : "Seguir"} ${item.nombre}`} title={sigue ? "Siguiendo" : "Seguir"}>
        {sigue ? "★" : "☆"}
      </button>
    );
  }
  return (
    <button className={`tab ${sigue ? "activo" : ""}`} onClick={alternar} aria-pressed={!!sigue}
            title="Se guarda solo en este navegador; míralo en «Siguiendo»">
      {sigue ? "★ Siguiendo" : "☆ Seguir"}
    </button>
  );
}
