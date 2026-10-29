import { Buscador } from "@/components/Buscador";

export const metadata = {
  title: "Buscar — Presupuesto Abierto Perú",
  description: "Busca una entidad, un municipio, una obra, un proveedor o un producto en el presupuesto público del Perú.",
};

export default function BuscarPage() {
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Buscar</h1>
        <p>Entidades, municipios y regiones, obras y proyectos, proveedores y productos: todo el presupuesto del año en un solo lugar.</p>
      </section>
      <Buscador />
    </div>
  );
}
