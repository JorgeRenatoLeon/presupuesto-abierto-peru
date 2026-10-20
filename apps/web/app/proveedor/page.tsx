import { FichaProveedor } from "@/components/Proveedor";

export const metadata = {
  title: "Proveedor del Estado — Presupuesto Abierto Perú",
  description: "Lo que una empresa, consorcio o persona firmó con el Estado: entidades, montos, contratos y señales.",
};

/** One page for every supplier (?id=<RUC>): their files are loaded in the browser, so 50,000
 *  suppliers cost one page, not 50,000. */
export default function ProveedorPage() {
  return (
    <div className="pagina">
      <FichaProveedor />
    </div>
  );
}
