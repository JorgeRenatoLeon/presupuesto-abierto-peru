import Link from "next/link";
import { load, fmtSoles, fmtPct, fmtLugar, fmtVariacion, type LocalidadIndice } from "@/lib/data";

export const metadata = { title: "Tu región — Presupuesto Abierto Perú" };

export default function LocalidadIndex() {
  const deps = load<LocalidadIndice[]>("localidad/index.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿Cómo se usa el presupuesto en tu región?</h1>
        <p>
          Elige tu departamento: cuánto gastan ahí el gobierno nacional, tu gobierno regional y tus
          municipalidades, qué proyectos están en marcha y cuáles no avanzan.
        </p>
      </section>
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
