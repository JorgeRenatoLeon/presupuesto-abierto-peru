import Link from "next/link";
import { loadOptional, urlDatos, type AlertasResumen } from "@/lib/data";
import { FiltroAlertas } from "@/components/FiltroAlertas";

export const metadata = { title: "Alertas — Presupuesto Abierto Perú" };

export default function AlertasPage() {
  const resumen = loadOptional<AlertasResumen>("alertas/resumen.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Alertas ciudadanas</h1>
        <p>
          Señales automáticas sobre el presupuesto: cambios bruscos, proyectos detenidos, gasto apresurado
          de fin de año, ejecución lenta y presupuestos muy distintos a lo aprobado. Compártelas o úsalas para
          preguntar a tus autoridades — <Link href="/auditar/" style={{ color: "var(--rojo)", fontWeight: 600 }}>así puedes actuar</Link>.
        </p>
        <p style={{ marginTop: 6 }}>
          <a className="tab" href={urlDatos("feeds/alertas.xml")}>Suscribirse a las alertas altas (RSS)</a>
        </p>
      </section>
      {resumen ? <FiltroAlertas resumen={resumen} /> : <div className="tarjeta vacio">Aún no hay alertas procesadas.</div>}
    </div>
  );
}
