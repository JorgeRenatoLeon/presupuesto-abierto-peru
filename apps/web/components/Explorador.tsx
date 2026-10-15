"use client";

import { useMemo, useState } from "react";
import type { PorFuncion, PorDepartamento, EntidadIndex } from "@/lib/types";
import { ListaBarras, type FilaItem } from "@/components/ui";

type Vista = "funcion" | "departamento" | "entidad";

/** accent-insensitive match: "educacion" finds "EDUCACIÓN" */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Explorador({
  funciones, departamentos, entidades,
}: {
  funciones: PorFuncion[];
  departamentos: PorDepartamento[];
  entidades: EntidadIndex[];
}) {
  const [vista, setVista] = useState<Vista>("funcion");
  const [busqueda, setBusqueda] = useState("");

  const items: FilaItem[] = useMemo(() => {
    const q = norm(busqueda.trim());
    if (vista === "funcion") {
      return funciones
        .filter((f) => !q || norm(f.funcion_nombre).includes(q))
        .map((f) => ({ id: f.funcion, nombre: f.funcion_nombre, monto: f.devengado, referencia: f.pim }));
    }
    if (vista === "departamento") {
      return departamentos
        .filter((d) => !q || norm(d.dept_nombre ?? "").includes(q))
        .map((d) => ({ id: d.dept, nombre: d.dept_nombre ?? "(sin ubicar)", monto: d.devengado, referencia: d.pim }));
    }
    return entidades
      .filter((e) => e.devengado != null || e.pim != null)
      .filter((e) => !q || norm(`${e.nombre} ${e.pliego ?? ""} ${e.dept ?? ""}`).includes(q))
      .slice(0, 100)
      .map((e) => ({
        id: e.sec_ejec, nombre: e.nombre, monto: e.devengado ?? 0, referencia: e.pim,
        href: `/entidad/${e.sec_ejec}/`,
        extra: [e.nivel, e.dept].filter(Boolean).join(" · "),
      }));
  }, [vista, busqueda, funciones, departamentos, entidades]);

  return (
    <>
      <div className="tabs" role="tablist">
        {([
          ["funcion", "Por función"],
          ["departamento", "Por departamento"],
          ["entidad", "Por entidad"],
        ] as [Vista, string][]).map(([v, etiqueta]) => (
          <button key={v} role="tab" aria-selected={vista === v}
                  className={`tab ${vista === v ? "activo" : ""}`} onClick={() => setVista(v)}>
            {etiqueta}
          </button>
        ))}
      </div>
      <input
        className="buscador"
        placeholder={vista === "entidad" ? "Busca tu municipalidad, ministerio, hospital…" : "Filtrar…"}
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        aria-label="Buscar"
      />
      <div className="tarjeta">
        <ListaBarras items={items} />
        {vista === "entidad" && items.length === 100 ? (
          <p className="sub" style={{ marginTop: 8 }}>Mostrando 100 resultados; afina la búsqueda para ver más.</p>
        ) : null}
      </div>
    </>
  );
}
