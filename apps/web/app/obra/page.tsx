import { FichaObra } from "@/components/FichaObra";

export const metadata = {
  title: "Una obra — Presupuesto Abierto Perú",
  description: "Una obra o proyecto de inversión: su presupuesto y gasto de este año, la obra completa, sus contratos y sus órdenes.",
};

/** One page for every project (?sec=<unit>&cui=<CUI>): its files are loaded in the browser. */
export default function ObraPage() {
  return (
    <div className="pagina">
      <FichaObra />
    </div>
  );
}
