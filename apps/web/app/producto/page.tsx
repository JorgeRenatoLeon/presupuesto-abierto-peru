import { FichaProducto } from "@/components/Producto";

export const metadata = {
  title: "Precio de un producto — Presupuesto Abierto Perú",
  description: "Lo que paga el Estado por un producto en sus contratos: precio usual, quién lo vende, quién lo compra y cada compra.",
};

/** One page for every catalogue item (?id=<cubso>): their files are loaded in the browser. */
export default function ProductoPage() {
  return (
    <div className="pagina">
      <FichaProducto />
    </div>
  );
}
