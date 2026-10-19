import Link from "next/link";
import { BuscaMunicipalidad } from "@/components/BuscaMunicipalidad";
import { load, fmtSoles, fmtPct, fmtLugar, fmtVariacion, type LocalidadIndice } from "@/lib/data";

export const metadata = { title: "Tu municipalidad — Presupuesto Abierto Perú" };

export default function LocalidadIndex() {
  const deps = load<LocalidadIndice[]>("localidad/index.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿Cómo se usa el presupuesto donde vives?</h1>
        <p>
          Busca tu distrito para ir directo a tu municipalidad, o recorre tu región y tu provincia: quién gasta,
          en qué, qué obras avanzan y cuáles no.
        </p>
      </section>
      <section className="seccion tarjeta">
        <BuscaMunicipalidad autoFocus />
      </section>
      <h2 className="seccion">O elige tu región</h2>
      {deps.length ? (
        <div className="cmp-dimensiones">
          {deps.map((d) => {
            const avance = d.pim ? (d.devengado ?? 0) / d.pim : null;
            return (
              <Link key={d.codigo} href={`/localidad/${d.codigo}/`} className="tarjeta cmp-dimension">
                <strong>{fmtLugar(d.nombre)}</strong>
                <span>{fmtSoles(d.pim)} · {fmtPct(avance)} ejecutado</span>
                <span>
                  {d.n_sin_avance ? `${d.n_sin_avance} proyectos sin avance` : "Sin proyectos detenidos"}
                  {d.pim_pub_ant ? ` · ${fmtVariacion(d.pim_pub_ant, d.pim)} en la última actualización` : ""}
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="tarjeta vacio">Aún no hay datos por departamento.</div>
      )}
    </div>
  );
}
