import Link from "next/link";
import {
  load, latestYear, fmtSoles, fmtPct, interpretarAvance, MESES,
  type ResumenAnual, type SerieNacional, type PorFuncion, type Alerta,
  type IngresoResumen, type ContrasteMensual,
} from "@/lib/data";
import { GraficoContraste } from "@/components/Grafico";
import { KpiCard, Lectura, ListaBarras } from "@/components/ui";
import { GraficoMensual } from "@/components/Grafico";
import { AlertaCard } from "@/components/AlertaCard";

export default function Home() {
  const resumen = load<ResumenAnual[]>("resumen_anual.json");
  const serie = load<SerieNacional[]>("serie_nacional.json");
  const funciones = load<PorFuncion[]>("por_funcion.json");
  const alertas = load<Alerta[]>("alertas.json");
  const resumenIng = load<IngresoResumen[]>("ingreso_resumen_anual.json");
  const contraste = load<ContrasteMensual[]>("contraste_mensual.json");

  const actual = latestYear(resumen);
  const ano = actual?.ano;
  const avance = actual?.pim && actual.devengado_ytd != null ? actual.devengado_ytd / actual.pim : null;
  const lectura = actual ? interpretarAvance(avance, actual.mes_ult) : null;

  const serieAno = serie.filter((s) => s.ano === ano).map((s) => ({ mes: s.mes, valor: s.devengado }));
  const funcionesAno = funciones
    .filter((f) => f.ano === ano)
    .slice(0, 6)
    .map((f) => ({
      id: f.funcion,
      nombre: f.funcion_nombre,
      monto: f.devengado,
      referencia: f.pim,
      href: `/explorar/`,
    }));
  const alertasTop = alertas.slice(0, 3); // national changes first (see pipeline/alerts.py)

  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿En qué se gasta el dinero del Perú?</h1>
        <p>
          Seguimiento del presupuesto público con datos oficiales del MEF{ano ? ` — año ${ano}` : ""}
          {actual ? `, actualizado a ${MESES[actual.mes_ult].toLowerCase()}` : ""}.
        </p>
      </section>

      {actual ? (
        <>
          <section className="kpis">
            <KpiCard etiqueta="Presupuesto vigente (PIM)" valor={fmtSoles(actual.pim)}
                     nota="Lo que las entidades pueden gastar este año" />
            <KpiCard etiqueta="Ejecutado (devengado)" valor={fmtSoles(actual.devengado_ytd)}
                     nota={`Acumulado a ${MESES[actual.mes_ult].toLowerCase()}`} />
            <KpiCard etiqueta="Avance de ejecución" valor={fmtPct(avance)}
                     nota={`Esperado a la fecha: ${fmtPct(actual.mes_ult / 12)}`} />
            <KpiCard etiqueta="Presupuesto inicial (PIA)" valor={fmtSoles(actual.pia)}
                     nota="Aprobado al inicio del año" />
          </section>

          {lectura ? <Lectura tono={lectura.tono}>{lectura.texto}</Lectura> : null}

          <section className="seccion tarjeta">
            <h2>Gasto mes a mes</h2>
            <p className="sub">Devengado: bienes y servicios efectivamente recibidos.</p>
            <GraficoMensual puntos={serieAno} />
          </section>

          {(() => {
            const ing = resumenIng.find((r) => r.ano === ano);
            const contrasteAno = contraste
              .filter((c) => c.ano === ano)
              .map((c) => ({ mes: c.mes, ingreso: c.ingreso_recaudado, gasto: c.gasto_devengado }));
            if (!ing || !contrasteAno.length) return null;
            return (
              <section className="seccion tarjeta">
                <h2>Las dos caras de la moneda</h2>
                <p className="sub">
                  Lo que entra (recaudado por entidades: {fmtSoles(ing.recaudado_ytd)}, sin Recursos
                  Ordinarios) frente a lo que sale (devengado: {fmtSoles(actual.devengado_ytd)}).
                </p>
                <GraficoContraste puntos={contrasteAno} />
                <div style={{ marginTop: 10 }}>
                  <Link className="tab" href="/ingresos/">Ver el detalle de ingresos →</Link>
                </div>
              </section>
            );
          })()}

          <section className="seccion tarjeta">
            <h2>¿A qué se destina?</h2>
            <p className="sub">Principales funciones del Estado por gasto ejecutado.</p>
            <ListaBarras items={funcionesAno} />
            <div style={{ marginTop: 10 }}>
              <Link className="tab" href="/explorar/">Ver todo el detalle →</Link>
            </div>
          </section>
        </>
      ) : (
        <div className="tarjeta vacio">
          Aún no hay datos procesados. Ejecuta el pipeline (<code>python run.py all --year 2026</code>) y
          vuelve a construir la web.
        </div>
      )}

      <section className="seccion">
        <h2 style={{ marginBottom: 10 }}>Lo que está cambiando</h2>
        {alertasTop.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {alertasTop.map((a, i) => <AlertaCard key={i} alerta={a} />)}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="tab activo" href="/comparar/">Comparar el presupuesto →</Link>
              <Link className="tab" href="/alertas/">Ver todas las alertas →</Link>
            </div>
          </div>
        ) : (
          <div className="tarjeta vacio">Sin alertas con los datos actuales.</div>
        )}
      </section>

      <section className="tarjeta seccion">
        <h2>¿Primera vez viendo el presupuesto?</h2>
        <p className="sub">
          PIA, PIM, devengado… suena complicado pero no lo es. En 3 minutos entiendes cómo fluye el
          dinero público y qué significa cada número.
        </p>
        <Link className="tab activo" href="/guia/">Leer la guía del presupuesto</Link>
      </section>
    </div>
  );
}
