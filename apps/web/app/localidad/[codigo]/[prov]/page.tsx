import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import {
  DATA_DIR, loadOptional, fmtSoles, fmtPct, fmtLugar, fmtFecha, interpretarAvance, corteDatos,
  type Provincia, type EntidadLugar,
} from "@/lib/data";
import { KpiCard, Lectura } from "@/components/ui";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";
import { Migas } from "@/components/Migas";
import { DesgloseFunciones } from "@/components/DesgloseFunciones";

const PROV_DIR = join(DATA_DIR, "localidad", "prov");

export const dynamicParams = false;

export function generateStaticParams() {
  const codigos = existsSync(PROV_DIR)
    ? readdirSync(PROV_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, 4))
    : [];
  // output: "export" rejects a dynamic route with no pages (e.g. CI builds without data)
  return codigos.length ? codigos.map((c) => ({ codigo: c.slice(0, 2), prov: c.slice(2) })) : [{ codigo: "15", prov: "01" }];
}

export function generateMetadata({ params }: { params: { codigo: string; prov: string } }) {
  const p = loadOptional<Provincia>(`localidad/prov/${params.codigo}${params.prov}.json`);
  const nombre = p ? fmtLugar(p.nombre) : "Tu provincia";
  return {
    title: `Provincia de ${nombre}: municipalidades, obras y alertas — Presupuesto Abierto Perú`,
    description: `Cada distrito de ${nombre} y su municipalidad: cuánto tiene, cuánto gastó y qué obras no avanzan.`,
  };
}

function Avance({ e, esperado }: { e: EntidadLugar; esperado: number }) {
  const a = e.pim ? (e.devengado ?? 0) / e.pim : null;
  const tono = interpretarAvance(a, 12, esperado).tono;
  return (
    <span className={`avance-mini ${tono}`}>
      <span className="barra"><span style={{ width: `${Math.min(100, (a ?? 0) * 100)}%` }} /></span>
      <span className="cifra">{fmtPct(a)}</span>
    </span>
  );
}

export default function ProvinciaPage({ params }: { params: { codigo: string; prov: string } }) {
  const p = loadOptional<Provincia>(`localidad/prov/${params.codigo}${params.prov}.json`);
  if (!p) return <div className="pagina"><div className="tarjeta vacio">Aún no hay datos de esta provincia.</div></div>;

  const nombre = fmtLugar(p.nombre);
  const dep = fmtLugar(p.dept_nombre ?? "");
  const mes = p.mes_ult ?? 12;
  const esperado = p.avance_esperado ?? mes / 12;
  const avance = p.gasto.pim ? p.gasto.devengado / p.gasto.pim : null;
  const corte = corteDatos(mes, p.publicacion?.fecha, p.ano);
  const lectura = interpretarAvance(avance, mes, esperado);

  return (
    <div className="pagina">
      <Migas pasos={[{ href: `/localidad/${p.dept}/`, texto: dep }, { href: `/localidad/${p.dept}/${p.codigo.slice(2)}/`, texto: `Provincia de ${nombre}` }]} />
      <section className="hero">
        <h1>Provincia de {nombre}</h1>
        <p>
          Las {p.distritos.length} municipalidades de la provincia y las demás entidades con sede en ella, en {p.ano}
          {p.publicacion ? `, según la publicación del MEF del ${fmtFecha(p.publicacion.fecha)}` : ""} (datos {corte}).
        </p>
      </section>

      <section className="kpis">
        <KpiCard etiqueta="Presupuesto vigente" valor={fmtSoles(p.gasto.pim)} nota="De las entidades con sede en la provincia" />
        <KpiCard etiqueta="Ejecutado" valor={fmtSoles(p.gasto.devengado)} nota={`Avance ${fmtPct(avance)}; esperado ${fmtPct(esperado)}`} />
        <KpiCard etiqueta="Proyectos sin avance" valor={String(p.obras.n_sin_avance)} nota={fmtSoles(p.obras.pim_sin_avance)} />
        <KpiCard etiqueta="Alertas" valor={String(p.alertas.total)} nota={`${p.alertas.alta} de prioridad alta`} />
      </section>
      <Lectura tono={lectura.tono}>{lectura.texto}</Lectura>

      <section className="seccion tarjeta" id="distritos">
        <h2>Distritos y sus municipalidades</h2>
        <p className="sub">
          Toca tu municipalidad para ver en qué gasta. La barra es el avance de ejecución {corte}; lo esperado a la fecha es {fmtPct(esperado)}.
        </p>
        <ul className="distritos">
          {p.distritos.map((d) => (
            <li key={d.ubigeo} id={`d${d.ubigeo}`}>
              <div className="distrito-cab">
                <h3>{fmtLugar(d.nombre)}</h3>
                <span className="ubigeo" title="Ubigeo (código INEI del distrito)">{d.ubigeo}</span>
              </div>
              {d.municipalidad ? (
                <Link className="distrito-muni" href={`/entidad/${d.municipalidad.sec_ejec}/`}>
                  <span className="nombre">{fmtLugar(d.municipalidad.nombre)}</span>
                  <span className="cifra">{fmtSoles(d.municipalidad.pim)}</span>
                  <Avance e={d.municipalidad} esperado={esperado} />
                  {d.municipalidad.alertas.alta || d.municipalidad.obras_sin_avance ? (
                    <span className="distrito-senales">
                      {d.municipalidad.alertas.alta ? <span className="badge alta">{d.municipalidad.alertas.alta} alertas altas</span> : null}
                      {d.municipalidad.obras_sin_avance ? <span className="badge media">{d.municipalidad.obras_sin_avance} obras sin avance</span> : null}
                    </span>
                  ) : null}
                </Link>
              ) : null}
              {d.otras.length ? (
                <details className="distrito-otras">
                  <summary>{d.otras.length} {d.otras.length === 1 ? "entidad más" : "entidades más"} con sede aquí</summary>
                  <ul>
                    {d.otras.map((e) => (
                      <li key={e.sec_ejec}>
                        <Link href={`/entidad/${e.sec_ejec}/`}>{fmtLugar(e.nombre)}</Link>
                        <span className="cifra">{fmtSoles(e.pim)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="seccion tarjeta">
        <h2>¿En qué se gasta en {nombre}?</h2>
        <p className="sub">Gastado {corte} por las entidades con sede en la provincia, por función. Abre cada una para saber qué es.</p>
        <DesgloseFunciones funciones={p.por_funcion.slice(0, 10).map((f) => ({ codigo: f.id, funcion: f.funcion, devengado: f.devengado ?? 0 }))} />
      </section>

      <section className="seccion tarjeta" id="obras">
        <h2>Proyectos sin avance ({p.obras.n_sin_avance})</h2>
        <p className="sub">Proyectos de S/ 1 millón o más que {corte} no registran ningún gasto. Pregunta a la entidad por su cronograma.</p>
        <ListaObras obras={p.obras.sin_avance} conEntidad vacio="Ningún proyecto grande está detenido." />
      </section>

      {p.alertas.top.length ? (
        <section className="seccion">
          <h2 style={{ marginBottom: 10 }}>Alertas en la provincia ({p.alertas.total})</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {p.alertas.top.map((a, i) => <AlertaCard key={a.id ?? i} alerta={a} />)}
          </div>
        </section>
      ) : null}
      <p className="nota-fuente">
        Ubicamos a cada entidad por su sede (ubigeo de la unidad ejecutora). Ministerios y programas nacionales que gastan
        en {nombre} desde Lima no aparecen aquí: el MEF solo indica el departamento donde se gasta.
      </p>
    </div>
  );
}
