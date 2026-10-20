import Link from "next/link";
import { loadOptional, fmtSoles } from "@/lib/data";
import { esRuc, type IndiceProveedores } from "@/lib/contratos";
import { BuscadorProveedores } from "@/components/Proveedor";

export const metadata = {
  title: "Proveedores del Estado — Presupuesto Abierto Perú",
  description: "A quién le contrata el Estado: busca cualquier empresa, consorcio o persona y mira sus contratos.",
};

const RANKING = 25;

export default function ProveedoresPage() {
  const indice = loadOptional<IndiceProveedores>("proveedores/indice.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Proveedores del Estado</h1>
        <p>
          Las empresas, consorcios y personas que firmaron contratos con el Estado
          {indice ? ` en ${indice.desde_ano} y ${indice.desde_ano + 1} (${indice.total.toLocaleString("es-PE")} en total)` : ""}:
          con qué entidades, para qué y por cuánto, según el SEACE.
        </p>
      </section>
      <section className="seccion">
        <BuscadorProveedores />
      </section>
      {indice?.p.length ? (
        <section className="seccion tarjeta">
          <h2>Los que más contratos firmaron</h2>
          <p className="sub">Por monto firmado. Lo contratado no es lo pagado: el Estado no publica cada pago a cada proveedor.</p>
          <ol className="ct-top ranking-prov">
            {indice.p.slice(0, RANKING).map(([id, nombre, n, monto, entidades]) => (
              <li key={id}>
                <div className="ct-top-cab">
                  <Link className="ct-top-nombre ct-enlace-proveedor" href={`/proveedor/?id=${encodeURIComponent(id)}`}>{nombre ?? id}</Link>
                  <span className="cifra">{fmtSoles(monto)}</span>
                </div>
                <div className="detalle">
                  <span>{esRuc(id) ? `RUC ${id}` : "Consorcio"} · {n.toLocaleString("es-PE")} {n === 1 ? "contrato" : "contratos"}</span>
                  <span>{entidades.toLocaleString("es-PE")} {entidades === 1 ? "entidad" : "entidades"}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="seccion tarjeta"><div className="vacio">Aún no hay contratos procesados.</div></section>
      )}
    </div>
  );
}
