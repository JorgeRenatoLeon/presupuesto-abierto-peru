import { ArrowRight } from "lucide-react";
import Link from "next/link";
import {
  loadOptional, fmtSoles, fmtPct, fmtLugar, fmtFecha, urlDatos, ACCIONES, corteDatos, type Auditoria,
} from "@/lib/data";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";

export const metadata = {
  title: "Qué vigilar — Presupuesto Abierto Perú",
  description: "Cinco señales del presupuesto público que vale la pena revisar cada mes, y cómo actuar.",
};

const enlace = { color: "var(--rojo)", fontWeight: 600 } as const;

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="tarjeta seccion" id={`senal-${n}`}>
      <div className="paso" style={{ marginBottom: 10 }}>
        <span className="paso-num">{n}</span>
        <h2 style={{ margin: "3px 0 0" }}>{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

export default function AuditarPage() {
  const a = loadOptional<Auditoria>("auditar.json");
  if (!a) {
    return (
      <div className="pagina">
        <section className="hero"><h1>¿Qué vigilar en el presupuesto?</h1></section>
        <div className="tarjeta vacio">Aún no hay datos procesados.</div>
      </div>
    );
  }
  const corte = a.mes_ult ? corteDatos(a.mes_ult, a.publicacion?.fecha, a.ano) : "";
  const o = a.obras_sin_avance;
  const d = a.gasto_diciembre;
  const l = a.laudos;
  const n = (r: string) => a.conteos[r]?.total ?? 0;

  return (
    <div className="pagina">
      <section className="hero">
        <h1>¿Qué vigilar en el presupuesto?</h1>
        <p>
          Cinco señales que vale la pena revisar cada mes, con los datos de la publicación del MEF
          {a.publicacion ? ` del ${fmtFecha(a.publicacion.fecha)}` : ""}. No prueban que algo esté mal:
          son buenas preguntas para hacerle a tus autoridades.
        </p>
      </section>

      {o ? (
        <Paso n={1} titulo="Proyectos que no avanzan">
          <p style={{ fontSize: 14 }}>
            <strong>{o.n.toLocaleString("es-PE")} proyectos de inversión</strong> de S/ 1 millón o más no registran
            ningún gasto {corte}: <strong>{fmtSoles(o.pim)}</strong> que todavía no se convierten en obras.
            {o.n_paralizadas ? <> De ellos, <strong>{o.n_paralizadas}</strong> sí avanzaron el año pasado y este año se detuvieron.</> : null}
          </p>
          <p className="sub" style={{ margin: "8px 0" }}>
            Por qué importa: una obra detenida puede significar problemas con el contratista, el expediente o el
            financiamiento. Las obras suelen gastar más a fin de año, pero a mitad de año ya deberían moverse.
          </p>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {o.por_departamento.slice(0, 8).map((x) => (
              <Link key={x.codigo} className="tab" href={`/localidad/${x.codigo}/#obras`}>
                {fmtLugar(x.nombre)}: {x.n}
              </Link>
            ))}
          </div>
          <ListaObras obras={o.top.slice(0, 8)} conEntidad />
          <div style={{ marginTop: 10 }}>
            <Link className="tab" href="/alertas/?regla=OBRA_SIN_AVANCE">Ver los {n("OBRA_SIN_AVANCE")} más grandes <ArrowRight className="icono-linea" aria-hidden /></Link>
          </div>
        </Paso>
      ) : null}

      {d ? (
        <Paso n={2} titulo="El gasto apresurado de diciembre">
          <p style={{ fontSize: 14 }}>
            En {d.ano}, el Estado gastó en diciembre el {fmtPct(d.promedio)} de todo el año. Pero{" "}
            <strong>{d.n_25} entidades</strong> concentraron ahí un cuarto o más de su gasto, y{" "}
            <strong>{d.n_35}</strong> más de un tercio.
          </p>
          <p className="sub" style={{ margin: "8px 0" }}>
            Por qué importa: si el dinero no se usa, “se devuelve”. Eso empuja compras y pagos apresurados a fin de
            año, con menos control. Entre octubre y diciembre de {d.ano + 1}, vigila a tu municipalidad.
          </p>
          <div className="tabla-scroll">
            <table className="tabla-simple">
            <thead><tr><th>Entidad</th><th>Diciembre</th><th>% del año</th></tr></thead>
            <tbody>
              {d.top.slice(0, 10).map((x) => (
                <tr key={x.sec_ejec}>
                  <td><Link href={`/entidad/${x.sec_ejec}/`} style={{ color: "var(--tinta)", fontWeight: 600 }}>{fmtLugar(x.nombre)}</Link>
                    {x.dept ? <div className="sub" style={{ margin: 0 }}>{fmtLugar(x.dept)}</div> : null}</td>
                  <td>{fmtSoles(x.dic)}</td>
                  <td><strong>{fmtPct(x.pct)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Paso>
      ) : null}

      <Paso n={3} titulo="Sentencias judiciales y laudos arbitrales">
        <p style={{ fontSize: 14 }}>
          Este año hay <strong>{fmtSoles(l.pim)}</strong> presupuestados para pagar sentencias y laudos arbitrales
          en {l.entidades} entidades
          {l.a_empresas ? <>; <strong>{fmtSoles(l.a_empresas)}</strong> son pagos a empresas (personas jurídicas)</> : null}.
        </p>
        <p className="sub" style={{ margin: "8px 0" }}>
          Por qué importa: un laudo suele venir de una disputa con un contratista. Pagar mucho por laudos puede
          señalar contratos mal hechos o mal gestionados. Pregunta qué contratos los originaron.
        </p>
        <div className="tabla-scroll">
          <table className="tabla-simple">
          <thead><tr><th>Entidad</th><th>Presupuesto</th><th>A empresas</th></tr></thead>
          <tbody>
            {l.top.slice(0, 8).map((x) => (
              <tr key={x.sec_ejec}>
                <td><Link href={`/entidad/${x.sec_ejec}/`} style={{ color: "var(--tinta)", fontWeight: 600 }}>{fmtLugar(x.nombre)}</Link></td>
                <td>{fmtSoles(x.pim)}</td>
                <td>{fmtSoles(x.a_empresas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Paso>

      <Paso n={4} titulo="Cambios fuertes de presupuesto">
        <p style={{ fontSize: 14 }}>
          {n("CAMBIO_TEMA")} cambios fuertes por tema en la última actualización, {n("CAMBIO_ANUAL")} frente al año
          anterior y {n("PIM_CAMBIO")} entidades cuyo presupuesto cambió 20% o más.
        </p>
        <p className="sub" style={{ margin: "8px 0" }}>
          Por qué importa: el presupuesto se modifica por decreto durante el año. Cuando un tema crece o se
          recorta mucho, alguien decidió mover ese dinero: ¿de dónde salió y a dónde fue?
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {a.destacadas.map((x, i) => <AlertaCard key={x.id ?? i} alerta={x} />)}
        </div>
        <div style={{ marginTop: 10 }}><Link className="tab activo" href="/comparar/">Comparar el presupuesto <ArrowRight className="icono-linea" aria-hidden /></Link></div>
      </Paso>

      <Paso n={5} titulo="Entidades que no ejecutan">
        <p style={{ fontSize: 14 }}>
          {n("RIESGO_EJEC")} entidades van 15 puntos o más por detrás del calendario
          ({a.conteos.RIESGO_EJEC?.alta ?? 0} de ellas, 25 puntos o más).
        </p>
        <p className="sub" style={{ margin: "8px 0" }}>
          Por qué importa: el dinero que no se ejecuta no se convierte en servicios, y al final del año suele
          gastarse con apuro (señal 2) o quedar sin usar.
        </p>
        <Link className="tab" href="/alertas/?regla=RIESGO_EJEC">Ver la lista <ArrowRight className="icono-linea" aria-hidden /></Link>
      </Paso>

      <section className="tarjeta seccion">
        <h2>¿Encontraste algo? Así puedes actuar</h2>
        <div style={{ display: "grid", gap: 12, fontSize: 14 }}>
          <p>
            <strong>Pide la información.</strong> Por la Ley N.º 27806 de Transparencia, cualquier persona puede
            pedir documentos a una entidad pública (contratos, cronogramas de obra, informes), sin explicar para qué.
            La entidad debe responder en 10 días hábiles. Cada una tiene su formulario en el{" "}
            <a style={enlace} href={ACCIONES.transparencia} target="_blank" rel="noopener">Portal de Transparencia Estándar</a>.
          </p>
          <p>
            <strong>Denuncia ante la Contraloría</strong> si sospechas de un uso irregular del dinero: es gratuito y
            puede ser anónimo.{" "}
            <a style={enlace} href={ACCIONES.denuncia} target="_blank" rel="noopener">Cómo presentar una denuncia</a>.
          </p>
          <p>
            <strong>Participa.</strong> Las sesiones del concejo municipal y del consejo regional son públicas, y el
            presupuesto participativo decide parte de las inversiones de tu localidad.
          </p>
          <p>
            <strong>Comparte.</strong> Cada alerta tiene un botón para compartirla con datos y fuente.
          </p>
        </div>
      </section>

      <section className="tarjeta seccion">
        <h2>Recibe avisos</h2>
        <p style={{ fontSize: 14 }}>
          Sigue tu región o tu municipalidad con <strong>«Seguir»</strong> y revisa lo nuevo en{" "}
          <Link href="/seguimiento/" style={enlace}>Siguiendo</Link>. O suscríbete con cualquier lector de RSS:{" "}
          <a style={enlace} href={urlDatos("feeds/alertas.xml")}>alertas de prioridad alta</a>,{" "}
          <a style={enlace} href={urlDatos("feeds/cambios.xml")}>cambios por tema</a>,{" "}
          <a style={enlace} href={urlDatos("feeds/obras.xml")}>proyectos sin avance</a>. Cada departamento tiene
          también su propio canal en su página.
        </p>
      </section>
    </div>
  );
}
