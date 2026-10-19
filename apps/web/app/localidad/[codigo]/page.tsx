import { ArrowRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  load, loadOptional, fmtSoles, fmtPct, fmtDelta, fmtVariacion, fmtLugar, fmtFecha, interpretarAvance, urlDatos,
  corteDatos, type Localidad, type LocalidadIndice,
} from "@/lib/data";
import { KpiCard, Lectura, ListaBarras } from "@/components/ui";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";
import { ListaEntidades } from "@/components/ListaEntidades";
import { SeguirBoton } from "@/components/SeguirBoton";
import { DesgloseFunciones } from "@/components/DesgloseFunciones";
import { Bandas } from "@/components/Bandas";

// No `dynamicParams = false`: with output "export" only generated paths exist anyway, and
// Next 14's dev server rejects it with a misleading "missing generateStaticParams()" error.

export function generateStaticParams() {
  const deps = load<LocalidadIndice[]>("localidad/index.json");
  // output: "export" rejects a dynamic route with no pages (e.g. CI builds without data)
  return deps.length ? deps.map((d) => ({ codigo: d.codigo })) : [{ codigo: "15" }];
}

export function generateMetadata({ params }: { params: { codigo: string } }) {
  const d = loadOptional<Localidad>(`localidad/${params.codigo}.json`);
  const nombre = d ? fmtLugar(d.nombre) : "Tu región";
  return {
    title: `${nombre}: presupuesto, obras y alertas — Presupuesto Abierto Perú`,
    description: `Cuánto se gasta en ${nombre}, quién lo gasta, qué obras avanzan y cuáles no.`,
  };
}

const NIVEL: Record<string, string> = {
  "GOBIERNO NACIONAL": "Gobierno nacional (ministerios y sus programas)",
  "GOBIERNOS REGIONALES": "Gobierno regional",
  "GOBIERNOS LOCALES": "Municipalidades",
};

export default function LocalidadPage({ params }: { params: { codigo: string } }) {
  const d = loadOptional<Localidad>(`localidad/${params.codigo}.json`);
  if (!d) return <div className="pagina"><div className="tarjeta vacio">Aún no hay datos de este departamento.</div></div>;

  const nombre = fmtLugar(d.nombre);
  const mes = d.mes_ult ?? 12;
  const avance = d.gasto.pim ? (d.gasto.devengado ?? 0) / d.gasto.pim : null;
  const esperado = d.avance_esperado ?? mes / 12;
  const lectura = interpretarAvance(avance, mes, esperado);
  const corte = corteDatos(mes, d.publicacion?.fecha, d.ano);
  const c = d.cambios;

  return (
    <div className="pagina">
      <nav style={{ fontSize: 13 }}>
        <Link href="/localidad/" style={{ color: "var(--rojo)", fontWeight: 600 }}><ArrowLeft className="icono-linea" aria-hidden /> Todas las regiones</Link>
      </nav>
      <section className="hero">
        <Bandas etiqueta={`${nombre}: ¿cómo se usa el presupuesto?`} bandas={[
          { texto: "¿Cómo se usa el presupuesto en", color: "fucsia", chica: true },
          { texto: `${nombre}?`, color: "amarillo", grande: true },
          { texto: `${fmtSoles(d.gasto.pim)} · ${d.ano}`, color: "verde", chica: true },
        ]} />
        <p>
          Todo lo que el Estado gasta en {nombre} en {d.ano}
          {d.publicacion ? `, según la publicación del MEF del ${fmtFecha(d.publicacion.fecha)}` : ""}
          {mes ? ` (datos ${corte})` : ""}.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <SeguirBoton item={{ tipo: "departamento", id: d.codigo, nombre }} />
          <a className="tab" href={urlDatos(`feeds/departamento/${d.codigo}.xml`)}>Suscribirse (RSS)</a>
        </div>
      </section>

      <section className="kpis">
        <KpiCard etiqueta="Presupuesto vigente" valor={fmtSoles(d.gasto.pim)} nota={`Para gastar en ${nombre}`} />
        <KpiCard etiqueta="Ejecutado" valor={fmtSoles(d.gasto.devengado)} nota={`Avance ${fmtPct(avance)}; esperado ${fmtPct(esperado)}`} />
        <KpiCard etiqueta="Última actualización" valor={c.pim_pub_ant ? fmtDelta((d.gasto.pim ?? 0) - c.pim_pub_ant) : "—"}
                 nota={c.pim_pub_ant ? `${fmtVariacion(c.pim_pub_ant, d.gasto.pim)} frente a la publicación anterior` : "Sin publicación anterior"} />
        <KpiCard etiqueta={`Aprobado frente a ${d.ano - 1}`} valor={c.pia_ano_ant ? fmtVariacion(c.pia_ano_ant, d.gasto.pia) : "—"}
                 nota={c.pia_ano_ant ? `${fmtSoles(c.pia_ano_ant)} → ${fmtSoles(d.gasto.pia)}` : ""} />
      </section>
      <Lectura tono={lectura.tono}>{lectura.texto}</Lectura>

      <section className="seccion tarjeta">
        <h2>¿Quién gasta en {nombre}?</h2>
        <p className="sub">El mismo departamento recibe dinero de tres niveles de gobierno.</p>
        <ListaBarras items={d.por_nivel.map((n) => ({
          id: n.nivel, nombre: NIVEL[n.nivel] ?? n.nivel, monto: n.devengado, referencia: n.pim,
        }))} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿En qué se gasta?</h2>
        <p className="sub">Gastado {corte} en {nombre}, por función. Abre cada una para saber qué es y en qué se usa.</p>
        <DesgloseFunciones funciones={d.por_funcion.slice(0, 10).map((f) => ({ codigo: f.id ?? f.funcion, funcion: f.funcion, devengado: f.devengado }))} />
      </section>

      <section className="seccion tarjeta" id="obras">
        <h2>Proyectos sin avance ({d.obras.n_sin_avance})</h2>
        <p className="sub">
          Proyectos de inversión de S/ 1 millón o más que {corte} no registran ningún gasto:
          {" "}{fmtSoles(d.obras.pim_sin_avance)} en total. Pregunta a la entidad por su cronograma.
        </p>
        <ListaObras obras={d.obras.sin_avance} conEntidad vacio="Ningún proyecto grande está detenido." />
      </section>

      <section className="seccion tarjeta">
        <h2>Los proyectos más grandes</h2>
        <p className="sub">{d.obras.n.toLocaleString("es-PE")} proyectos de inversión en {nombre}; estos son los de mayor presupuesto.</p>
        <ListaObras obras={d.obras.top} conEntidad />
      </section>

      {d.gobierno_regional.length ? (
        <section className="seccion tarjeta">
          <h2>Gobierno regional</h2>
          <p className="sub">Sede central y unidades ejecutoras (hospitales, UGEL, proyectos especiales…).</p>
          <ListaEntidades entidades={d.gobierno_regional} esperado={esperado} buscador={d.gobierno_regional.length > 8} />
        </section>
      ) : null}

      {d.provincias?.length ? (
        <section className="seccion tarjeta" id="provincias">
          <h2>Provincias de {nombre}</h2>
          <p className="sub">Entra a tu provincia para ver cada distrito, su municipalidad y las obras que no avanzan.</p>
          <ul className="provincias">
            {d.provincias.map((pr) => (
              <li key={pr.codigo}>
                <Link href={`/localidad/${d.codigo}/${pr.codigo.slice(2)}/`}>
                  <span className="nombre">{fmtLugar(pr.nombre)}</span>
                  <span className="detalle">{pr.n_municipalidades} municipalidades · {fmtSoles(pr.pim)} · avance {fmtPct(pr.pim ? pr.devengado / pr.pim : null)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="seccion tarjeta">
        <h2>Municipalidades ({d.municipalidades.length})</h2>
        <p className="sub">Busca la tuya. La barra compara lo ejecutado con el presupuesto vigente.</p>
        <ListaEntidades entidades={d.municipalidades} esperado={esperado} porProvincia />
      </section>

      <section className="seccion">
        <h2 style={{ marginBottom: 10 }}>Alertas en {nombre} ({d.alertas.total})</h2>
        {d.alertas.top.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {d.alertas.top.map((a, i) => <AlertaCard key={a.id ?? i} alerta={a} />)}
            <Link className="tab" href={`/alertas/?dep=${d.codigo}`} style={{ justifySelf: "start" }}>
              Ver todas las alertas de {nombre} <ArrowRight className="icono-linea" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="tarjeta vacio">Sin alertas con los datos actuales.</div>
        )}
      </section>
    </div>
  );
}
