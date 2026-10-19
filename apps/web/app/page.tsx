import Link from "next/link";
import {
  load, loadOptional, latestYear, fmtSoles, fmtPct, interpretarAvance, corteDatos,
  type ResumenAnual, type SerieNacional, type PorFuncion, type Alerta,
  type IngresoResumen, type ContrasteMensual, type LocalidadIndice, type Auditoria, type AlertasResumen,
  type ComparacionResumen,
} from "@/lib/data";
import { GraficoContraste } from "@/components/Grafico";
import { KpiCard, Lectura } from "@/components/ui";
import { GraficoMensual } from "@/components/Grafico";
import { AlertaCard } from "@/components/AlertaCard";
import { RepartoPorCien } from "@/components/Reparto";
import { SelectorRegion } from "@/components/SelectorRegion";
import { BuscaMunicipalidad } from "@/components/BuscaMunicipalidad";

export default function Home() {
  const resumen = load<ResumenAnual[]>("resumen_anual.json");
  const serie = load<SerieNacional[]>("serie_nacional.json");
  const funciones = load<PorFuncion[]>("por_funcion.json");
  const alertas = loadOptional<AlertasResumen>("alertas/resumen.json")?.top ?? load<Alerta[]>("alertas.json");
  const departamentos = load<LocalidadIndice[]>("localidad/index.json");
  const auditoria = loadOptional<Auditoria>("auditar.json");
  const resumenIng = load<IngresoResumen[]>("ingreso_resumen_anual.json");
  const contraste = load<ContrasteMensual[]>("contraste_mensual.json");

  const actual = latestYear(resumen);
  const ano = actual?.ano;
  const avance = actual?.pim && actual.devengado_ytd != null ? actual.devengado_ytd / actual.pim : null;
  const cmp = loadOptional<ComparacionResumen>("comparar/resumen.json");
  const esperado = actual ? (cmp?.ano === actual.ano ? cmp.avance_esperado : undefined) ?? actual.mes_ult / 12 : null;
  const lectura = actual ? interpretarAvance(avance, actual.mes_ult, esperado) : null;
  const corte = actual ? corteDatos(actual.mes_ult, cmp?.ano === actual.ano ? cmp.publicacion.fecha : null, actual.ano) : "";

  const serieAno = serie.filter((s) => s.ano === ano).map((s) => ({ mes: s.mes, valor: s.devengado }));
  const funcionesAno = funciones
    .filter((f) => f.ano === ano)
    .map((f) => ({ id: f.funcion, nombre: f.funcion_nombre, monto: f.pim ?? 0 }));
  const alertasTop = alertas.slice(0, 3); // national changes first (see pipeline/alerts.py)

  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿En qué se gasta el dinero del Perú?</h1>
        <p>
          Seguimiento del presupuesto público con datos oficiales del MEF{ano ? ` — año ${ano}` : ""}
          {actual ? `, actualizado ${corte}` : ""}.
        </p>
      </section>

      {actual ? (
        <>
          <section className="kpis">
            <KpiCard etiqueta="Presupuesto vigente (PIM)" valor={fmtSoles(actual.pim)}
                     nota="Lo que las entidades pueden gastar este año" />
            <KpiCard etiqueta="Ejecutado (devengado)" valor={fmtSoles(actual.devengado_ytd)}
                     nota={`Acumulado ${corte}`} />
            <KpiCard etiqueta="Avance de ejecución" valor={fmtPct(avance)}
                     nota={`Esperado a la fecha: ${fmtPct(esperado)}`} />
            <KpiCard etiqueta="Presupuesto inicial (PIA)" valor={fmtSoles(actual.pia)}
                     nota="Aprobado al inicio del año" />
          </section>

          {lectura ? <Lectura tono={lectura.tono}>{lectura.texto}</Lectura> : null}

          <section className="seccion tarjeta">
            <h2>¿A dónde va cada S/ 100?</h2>
            <p className="sub">De cada S/ 100 del presupuesto vigente {ano}, por función del Estado.</p>
            <RepartoPorCien partes={funcionesAno} href="/comparar/funcion/" />
            <div style={{ marginTop: 10 }}>
              <Link className="tab" href="/comparar/funcion/">¿Cómo cambió cada función? →</Link>
            </div>
          </section>

          {departamentos.length ? (
            <section className="seccion tarjeta">
              <h2>¿Qué hace tu municipalidad con su presupuesto?</h2>
              <p className="sub">En qué gasta, cuánto lleva y qué obras no avanzan, distrito por distrito.</p>
              <BuscaMunicipalidad />
              <p className="sub" style={{ marginTop: 14 }}>O recorre tu región:</p>
              <SelectorRegion departamentos={departamentos} />
            </section>
          ) : null}

          {auditoria?.obras_sin_avance ? (
            <section className="seccion tarjeta">
              <h2>Qué vale la pena vigilar</h2>
              <div className="kpis" style={{ marginTop: 6 }}>
                <KpiCard etiqueta="Proyectos sin avance" valor={fmtSoles(auditoria.obras_sin_avance.pim)}
                         nota={`${auditoria.obras_sin_avance.n.toLocaleString("es-PE")} proyectos sin gasto ${corte}`} />
                {auditoria.gasto_diciembre ? (
                  <KpiCard etiqueta={`Gasto de fin de año ${auditoria.gasto_diciembre.ano}`}
                           valor={`${auditoria.gasto_diciembre.n_35} entidades`}
                           nota="gastaron más de un tercio de su año en diciembre" />
                ) : null}
                <KpiCard etiqueta="Sentencias y laudos" valor={fmtSoles(auditoria.laudos.pim)}
                         nota={auditoria.laudos.a_empresas ? `${fmtSoles(auditoria.laudos.a_empresas)} para empresas` : "presupuestados este año"} />
              </div>
              <div style={{ marginTop: 10 }}>
                <Link className="tab activo" href="/auditar/">Ver qué vigilar y cómo actuar →</Link>
              </div>
            </section>
          ) : null}

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

        </>
      ) : (
        <div className="tarjeta vacio">
          Aún no hay datos procesados. Ejecuta el pipeline (<code>python run.py update --force</code>) y
          vuelve a construir la web.
        </div>
      )}

      <section className="seccion">
        <h2 style={{ marginBottom: 10 }}>Lo que está cambiando</h2>
        {alertasTop.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {alertasTop.map((a, i) => <AlertaCard key={a.id ?? i} alerta={a} />)}
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
