import {
  load, latestYear,
  type ResumenAnual, type PorFuncion, type PorDepartamento, type EntidadIndex,
} from "@/lib/data";
import { Explorador } from "@/components/Explorador";

export const metadata = { title: "Explorar — Presupuesto Abierto Perú" };

export default function ExplorarPage() {
  const resumen = load<ResumenAnual[]>("resumen_anual.json");
  const ano = latestYear(resumen)?.ano;
  const funciones = load<PorFuncion[]>("por_funcion.json").filter((f) => f.ano === ano);
  const departamentos = load<PorDepartamento[]>("por_departamento.json").filter((d) => d.ano === ano);
  // full index (all ~2,900 entities), not just top 500 — search covers everything
  const entidades = load<EntidadIndex[]>("entidades.json");

  return (
    <div className="pagina">
      <section className="hero">
        <h1>Explorar el gasto público{ano ? ` · ${ano}` : ""}</h1>
        <p>Compara cuánto se ha gastado y qué tan avanzada va la ejecución en cada mirada del presupuesto.</p>
      </section>
      <Explorador funciones={funciones} departamentos={departamentos} entidades={entidades} />
    </div>
  );
}
