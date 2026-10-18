"use client";

import { useRouter } from "next/navigation";
import { fmtLugar } from "@/lib/types";

/** "¿Dónde vives?" -> the department's page. */
export function SelectorRegion({ departamentos }: { departamentos: { codigo: string; nombre: string }[] }) {
  const router = useRouter();
  return (
    <select className="buscador" defaultValue="" aria-label="Elige tu departamento"
            onChange={(e) => e.target.value && router.push(`/localidad/${e.target.value}/`)}>
      <option value="" disabled>Elige tu departamento…</option>
      {[...departamentos].sort((a, b) => fmtLugar(a.nombre).localeCompare(fmtLugar(b.nombre))).map((d) => (
        <option key={d.codigo} value={d.codigo}>{fmtLugar(d.nombre)}</option>
      ))}
    </select>
  );
}
