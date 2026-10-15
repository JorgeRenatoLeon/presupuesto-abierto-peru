import { load, type Alerta } from "@/lib/data";
import { FiltroAlertas } from "@/components/FiltroAlertas";

export const metadata = { title: "Alertas — Presupuesto Abierto Perú" };

export default function AlertasPage() {
  const alertas = load<Alerta[]>("alertas.json");
  return (
    <div className="pagina">
      <section className="hero">
        <h1>Alertas ciudadanas</h1>
        <p>
          Señales automáticas sobre el presupuesto: cambios bruscos, ejecución lenta y
          presupuestos muy distintos a lo aprobado. Compártelas o úsalas para preguntar
          a tus autoridades.
        </p>
      </section>
      <FiltroAlertas alertas={alertas} />
    </div>
  );
}
