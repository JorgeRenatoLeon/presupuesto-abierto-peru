import {
  load, latestYear, fmtSoles, fmtPct, corteDatos, fraccionAno,
  type IngresoResumen, type IngresoPorFuente, type IngresoPorGenerica,
  type IngresoPorNivel, type ContrasteMensual, type ResumenAnual, type Meta,
} from "@/lib/data";
import { KpiCard, Lectura, ListaBarras } from "@/components/ui";
import { GraficoContraste } from "@/components/Grafico";

export const metadata = { title: "Ingresos — Presupuesto Abierto Perú" };

export default function IngresosPage() {
  const resumenIng = load<IngresoResumen[]>("ingreso_resumen_anual.json");
  const fuentes = load<IngresoPorFuente[]>("ingreso_por_fuente.json");
  const genericas = load<IngresoPorGenerica[]>("ingreso_por_generica.json");
  const niveles = load<IngresoPorNivel[]>("ingreso_por_nivel.json");
  const contraste = load<ContrasteMensual[]>("contraste_mensual.json");
  const resumenGasto = load<ResumenAnual[]>("resumen_anual.json");

  const actual = latestYear(resumenIng);
  const ano = actual?.ano;
  const avance = actual?.pim && actual.recaudado_ytd != null ? actual.recaudado_ytd / actual.pim : null;
  const pub = load<Meta>("meta.json").publicaciones?.find((p) => p.dataset === "ingreso" && p.ano === ano);

  const gastoAno = resumenGasto.find((r) => r.ano === ano);
  const cobertura =
    actual?.recaudado_ytd != null && gastoAno?.devengado_ytd
      ? actual.recaudado_ytd / gastoAno.devengado_ytd
      : null;

  const fuentesAno = fuentes.filter((f) => f.ano === ano).map((f) => ({
    id: f.rubro, nombre: f.rubro_nombre, monto: f.recaudado, referencia: f.pim,
  }));
  const genericasAno = genericas.filter((g) => g.ano === ano).map((g) => ({
    id: g.generica, nombre: g.generica_nombre, monto: g.recaudado, referencia: g.pim,
  }));
  const nivelesAno = niveles.filter((n) => n.ano === ano).map((n) => ({
    id: n.nivel, nombre: n.nivel, monto: n.recaudado, referencia: n.pim,
  }));
  const contrasteAno = contraste
    .filter((c) => c.ano === ano)
    .map((c) => ({ mes: c.mes, ingreso: c.ingreso_recaudado, gasto: c.gasto_devengado }));

  if (!actual) {
    return (
      <div className="pagina">
        <section className="hero">
          <h1>Ingresos públicos</h1>
          <p>La otra cara de la moneda: de dónde sale el dinero que el Estado gasta.</p>
        </section>
        <div className="tarjeta vacio">
          Aún no hay datos de ingresos procesados. Ejecuta el pipeline con{" "}
          <code>--dataset ingreso</code> (o <code>--dataset ambos</code>) y reconstruye la web.
        </div>
      </div>
    );
  }

  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿De dónde sale el dinero?{ano ? ` · ${ano}` : ""}</h1>
        <p>
          Ingresos públicos recaudados (impuestos, canon, tasas, endeudamiento…), actualizados{" "}
          {corteDatos(actual.mes_ult, pub?.fecha, ano)}. La otra cara del gasto.
        </p>
      </section>

      <section className="kpis">
        <KpiCard etiqueta="Meta de ingresos (PIM)" valor={fmtSoles(actual.pim)}
                 nota="Lo que se espera recaudar este año" />
        <KpiCard etiqueta="Recaudado" valor={fmtSoles(actual.recaudado_ytd)}
                 nota={`Acumulado ${corteDatos(actual.mes_ult, pub?.fecha, ano)}`} />
        <KpiCard etiqueta="Avance de recaudación" valor={fmtPct(avance)}
                 nota={`Referencia calendario: ${fmtPct(fraccionAno(actual.mes_ult, pub?.fecha, ano))}`} />
        <KpiCard etiqueta="Meta inicial (PIA)" valor={fmtSoles(actual.pia)}
                 nota="Estimado al aprobar el presupuesto" />
      </section>

      <Lectura tono="warn">
        Importante: estas cifras cubren los ingresos que cada entidad registra (canon, impuestos
        municipales, recursos propios, deuda…). No incluyen los Recursos Ordinarios — los impuestos
        nacionales que recauda la SUNAT para el tesoro público
        {cobertura != null
          ? ` — por eso lo registrado aquí equivale a ${fmtPct(cobertura)} del gasto del año; el resto se financia principalmente con esos Recursos Ordinarios.`
          : "."}
      </Lectura>

      <section className="seccion tarjeta">
        <h2>Las dos caras, mes a mes</h2>
        <p className="sub">Verde: lo que entra (recaudado). Rojo: lo que sale (devengado).</p>
        <GraficoContraste puntos={contrasteAno} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿De qué fuentes viene?</h2>
        <p className="sub">Rubros de financiamiento: impuestos, recursos propios, canon, deuda…</p>
        <ListaBarras items={fuentesAno} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿Qué tipo de ingreso es?</h2>
        <p className="sub">Clasificación económica de lo recaudado.</p>
        <ListaBarras items={genericasAno} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿Qué nivel de gobierno lo recauda?</h2>
        <ListaBarras items={nivelesAno} />
      </section>
    </div>
  );
}
