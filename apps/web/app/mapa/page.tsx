import { MapaObras } from "@/components/MapaObras";

export const metadata = {
  title: "Mapa de obras — Presupuesto Abierto Perú",
  description: "Las obras y proyectos de inversión del presupuesto de este año en el mapa: dónde están, cuánto cuestan y cuáles no avanzan.",
};

export default function MapaPage() {
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Mapa de obras</h1>
        <p>
          Las obras y proyectos de inversión del presupuesto de este año que el MEF ubica en el mapa (Banco de Inversiones):
          dónde están, cuánto cuestan, cuánto avanzan y cuáles no tienen gasto este año.
        </p>
      </section>
      <section className="seccion">
        <MapaObras />
      </section>
    </div>
  );
}
