import Link from "next/link";
import { loadOptional } from "@/lib/data";
import { fmtPrecio, unidadLegible, urlProducto, type IndiceProductos } from "@/lib/productos";
import { BuscadorProductos } from "@/components/Producto";

export const metadata = {
  title: "Precios del Estado — Presupuesto Abierto Perú",
  description: "Cuánto paga el Estado por lo que compra: combustible, cemento, alimentos, uniformes… y a quién se lo compra.",
};

const RANKING = 30;

export default function ProductosPage() {
  const indice = loadOptional<IndiceProductos>("productos/indice.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Precios del Estado</h1>
        <p>
          Cuánto pagan las entidades por lo que compran, producto por producto, según las líneas de sus contratos en el
          SEACE{indice ? ` (${indice.total.toLocaleString("es-PE")} productos comprados al menos cinco veces)` : ""}: el precio
          usual, quién lo vende y quién paga mucho más. Precios de los contratos firmados en los dos últimos años.
        </p>
      </section>
      <section className="seccion">
        <BuscadorProductos />
      </section>
      {indice?.p.length ? (
        <section className="seccion tarjeta">
          <h2>Los que más compra</h2>
          <p className="sub">Por número de compras. Cada uno con su precio usual por unidad.</p>
          <ol className="ct-top ranking-prov">
            {indice.p.slice(0, RANKING).map(([id, nombre, unidad, med, n]) => (
              <li key={id}>
                <div className="ct-top-cab">
                  <Link className="ct-top-nombre ct-enlace-proveedor" href={urlProducto(id)}>{nombre ?? `Producto ${id}`}</Link>
                  <span className="cifra">{fmtPrecio(med)}</span>
                </div>
                <div className="detalle">
                  <span>{n.toLocaleString("es-PE")} compras</span>
                  <span>por {unidadLegible(unidad)}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="seccion tarjeta"><div className="vacio">Aún no hay precios procesados.</div></section>
      )}
    </div>
  );
}
