import Link from "next/link";
import {
  load, loadOptional, fmtSoles, fmtDelta, fmtVariacion, fmtFecha, corteDatos,
  type Alerta, type ComparacionResumen,
} from "@/lib/data";
import { KpiCard } from "@/components/ui";
import { AlertaCard } from "@/components/AlertaCard";

export const metadata = { title: "¿Qué cambió? — Presupuesto Abierto Perú" };

const DESCRIPCION: Record<string, string> = {
  funcion: "Educación, salud, transporte… y sus divisiones, hasta el grupo funcional.",
  generica: "Planilla, bienes y servicios, obras… hasta la partida específica.",
  etiqueta: "Obras por contrata, pagos a empresas privadas, laudos arbitrales, locadores…",
  departamento: "Dónde se gasta: el departamento de cada meta presupuestal.",
  nivel: "Gobierno nacional, gobiernos regionales y gobiernos locales.",
};

export default function CompararPage() {
  const resumen = loadOptional<ComparacionResumen>("comparar/resumen.json");
  const cambios = load<Alerta[]>("alertas.json")
    .filter((a) => a.regla === "CAMBIO_TEMA" || a.regla === "CAMBIO_ANUAL")
    .slice(0, 6);

  if (!resumen) {
    return (
      <div className="pagina">
        <section className="hero"><h1>¿Qué cambió en el presupuesto?</h1></section>
        <div className="tarjeta vacio">
          Aún no hay comparaciones. Ejecuta el pipeline (<code>python run.py update</code>) y vuelve a construir la web.
        </div>
      </div>
    );
  }
  const t = resumen.totales;
  const ant = resumen.publicacion_anterior;
  const corte = corteDatos(resumen.mes_ult, resumen.publicacion.fecha, resumen.ano);

  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿Qué cambió en el presupuesto {resumen.ano}?</h1>
        <p>
          El presupuesto se modifica todo el año. Compáralo con lo que aprobó el Congreso, con la
          actualización anterior del MEF y con el año pasado — por función, tipo de gasto, tema o departamento.
        </p>
      </section>

      <section className="kpis">
        <KpiCard etiqueta="Desde la aprobación" valor={fmtDelta((t.pim ?? 0) - (t.pia ?? 0))}
                 nota={`PIA ${fmtSoles(t.pia)} → PIM ${fmtSoles(t.pim)} (${fmtVariacion(t.pia, t.pim)})`} />
        <KpiCard etiqueta="Última actualización"
                 valor={ant ? fmtDelta((t.pim ?? 0) - (t.pim_pub_ant ?? 0)) : "—"}
                 nota={ant ? `Entre el ${fmtFecha(ant.fecha)} y el ${fmtFecha(resumen.publicacion.fecha)}`
                           : "Disponible desde la segunda actualización procesada"} />
        <KpiCard etiqueta={resumen.ano_anterior ? `Frente a ${resumen.ano_anterior.ano}` : "Año anterior"}
                 valor={resumen.ano_anterior ? fmtVariacion(t.pia_ano_ant, t.pia) : "—"}
                 nota={resumen.ano_anterior ? `Presupuesto aprobado: ${fmtSoles(t.pia_ano_ant)} → ${fmtSoles(t.pia)}` : ""} />
        <KpiCard etiqueta={`Ejecutado ${corte}`}
                 valor={resumen.ano_anterior ? fmtVariacion(t.dev_ano_ant_periodo, t.devengado) : fmtSoles(t.devengado)}
                 nota={resumen.ano_anterior ? `${fmtSoles(t.devengado)} vs ${fmtSoles(t.dev_ano_ant_periodo)} a la misma fecha de ${resumen.ano_anterior.ano}` : ""} />
      </section>

      <section className="seccion">
        <h2>Compara por…</h2>
        <div className="cmp-dimensiones">
          {resumen.dimensiones.map((d) => (
            <Link key={d.id} href={`/comparar/${d.id}/`} className="tarjeta cmp-dimension">
              <strong>{d.titulo}</strong>
              <span>{DESCRIPCION[d.id] ?? d.niveles.join(" › ")}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="seccion">
        <h2 style={{ marginBottom: 10 }}>Los cambios más fuertes</h2>
        {cambios.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {cambios.map((a, i) => <AlertaCard key={i} alerta={a} />)}
            <Link className="tab" href="/alertas/" style={{ justifySelf: "start" }}>Ver todas las alertas →</Link>
          </div>
        ) : (
          <div className="tarjeta vacio">No hay cambios por encima de los umbrales de alerta.</div>
        )}
      </section>

      <p className="sub" style={{ fontSize: 12.5 }}>
        Montos en soles corrientes (sin ajustar por inflación). El MEF publica una versión nueva de sus archivos
        cada mes y sobrescribe la anterior; guardamos cada publicación para poder comparar.{" "}
        <Link href="/metodologia/" style={{ color: "var(--rojo)", fontWeight: 600 }}>Cómo lo calculamos</Link>.
      </p>
    </div>
  );
}
