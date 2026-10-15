import Link from "next/link";
import { load, MESES, latestYear, fmtFecha, type Meta, type ResumenAnual } from "@/lib/data";

export const metadata = { title: "Metodología — Presupuesto Abierto Perú" };

const enlace = { color: "var(--rojo)", fontWeight: 600 } as const;

export default function MetodologiaPage() {
  const meta = load<Meta>("meta.json");
  const resumen = load<ResumenAnual[]>("resumen_anual.json");
  const actual = latestYear(resumen);
  const publicaciones = meta.publicaciones ?? [];

  return (
    <div className="pagina">
      <section className="hero">
        <h1>Metodología y fuentes</h1>
        <p>Transparencia también sobre cómo trabajamos nosotros.</p>
      </section>

      <section className="tarjeta seccion">
        <h2>Fuente de datos</h2>
        <p style={{ fontSize: 14 }}>
          Todos los montos provienen del dataset oficial{" "}
          <a style={enlace} href="https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto"
             target="_blank" rel="noopener">
            “Presupuesto y Ejecución de Gasto”
          </a>{" "}
          del Portal de Datos Abiertos del Ministerio de Economía y Finanzas (MEF). Es la misma
          información de la Consulta Amigable. No modificamos las cifras: las agregamos por entidad,
          función, departamento y mes, y las presentamos con explicaciones.
        </p>
        {publicaciones.length ? (
          <table className="tabla-simple" style={{ marginTop: 10 }}>
            <thead><tr><th>Archivo del MEF</th><th>Año</th><th>Publicado</th><th>Datos hasta</th></tr></thead>
            <tbody>
              {publicaciones.map((p) => (
                <tr key={`${p.dataset}-${p.ano}`}>
                  <td>{p.dataset === "gasto" ? "Gasto (devengado mensual)" : "Ingresos (recaudado mensual)"}</td>
                  <td>{p.ano}</td>
                  <td>{fmtFecha(p.fecha)}</td>
                  <td>{p.mes_ult ? MESES[p.mes_ult].toLowerCase() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="tarjeta seccion">
        <h2>Actualización</h2>
        <p style={{ fontSize: 14 }}>
          {meta.generated_at
            ? <>Datos procesados por última vez el <strong>{meta.generated_at}</strong>. </>
            : null}
          {actual
            ? <>La información cubre hasta <strong>{MESES[actual.mes_ult].toLowerCase()} de {actual.ano}</strong>. </>
            : null}
          Todos los días revisamos si el MEF publicó una versión nueva de sus archivos (suele hacerlo a inicios
          de cada mes). Cuando la hay, la descargamos, verificamos que cada línea y cada total coincidan con el
          archivo original y regeneramos todas las cifras del sitio.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Guardamos cada publicación del MEF</h2>
        <p style={{ fontSize: 14 }}>
          El MEF reemplaza sus archivos en cada actualización: el archivo de hoy trae el presupuesto
          modificado (PIM) vigente, pero no cómo era el mes pasado. Por eso guardamos una copia de cada
          publicación y las comparamos: así detectamos recortes, aumentos y transferencias entre una
          actualización y la siguiente. Los archivos de ~2–3 GB se convierten, sin pérdida de información,
          a un formato compacto de ~60–90 MB por año. También vimos que el MEF corrige meses ya publicados
          (sobre todo en ingresos), así que las cifras de los últimos meses son preliminares.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Cómo comparamos</h2>
        <p style={{ fontSize: 14 }}>
          En <Link href="/comparar/" style={enlace}>¿Qué cambió?</Link> cada función, tipo de gasto, tema o
          departamento se compara de tres formas: <strong>desde la aprobación</strong> (PIA frente al PIM
          vigente), <strong>en la última actualización</strong> (PIM de la publicación anterior del MEF frente
          al actual) y <strong>frente al año anterior</strong> (presupuesto aprobado de un año frente al otro, y
          gasto ejecutado en los mismos meses). Marcamos como “cambio fuerte” lo que varía al menos 5% en una
          actualización, o 10% entre años, y además S/ 100 millones o más. Todos los montos están en soles
          corrientes: no descuentan la inflación.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Los <Link href="/comparar/etiqueta/" style={enlace}>temas</Link> (obras por contrata, pagos a
          empresas y proveedores privados, laudos arbitrales…) agrupan partidas del clasificador de gastos
          con reglas públicas que cualquiera puede revisar en el repositorio del proyecto. El clasificador
          dice en qué se gasta, no quién cobra; por eso algunos temas son aproximaciones y lo indicamos.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Conceptos y decisiones técnicas</h2>
        <p style={{ fontSize: 14 }}>
          Usamos el <strong>devengado</strong> como medida de gasto real (bienes y servicios efectivamente
          recibidos), el estándar en análisis presupuestal. El PIA y el PIM son montos anuales: cuando
          mostramos su evolución usamos el valor vigente al último mes con datos. El “avance esperado”
          compara la ejecución con el avance del calendario (mes ÷ 12); es una referencia simple, no una
          meta oficial. Las alertas se generan con reglas públicas y umbrales configurables descritas en
          el repositorio del proyecto: cambios fuertes por tema y por entidad entre actualizaciones,
          cambios frente al año anterior, ejecución lenta y presupuestos muy distintos al inicial.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Datos abiertos</h2>
        {meta.hf_dataset ? (
          <p style={{ fontSize: 14 }}>
            Todos los datos procesados, con la historia de cada publicación del MEF, están disponibles en{" "}
            <a style={enlace} href={`https://huggingface.co/datasets/${meta.hf_dataset}`} target="_blank" rel="noopener">
              huggingface.co/datasets/{meta.hf_dataset}
            </a>{" "}
            en formato Parquet: se pueden consultar directamente con DuckDB, Python o R, por ejemplo{" "}
            <code>{`SELECT * FROM 'hf://datasets/${meta.hf_dataset}/gasto/${actual?.ano ?? 2026}.parquet'`}</code>.
          </p>
        ) : (
          <p style={{ fontSize: 14 }}>
            Los datos procesados se publican en formato Parquet junto con la historia de cada publicación del
            MEF, para que periodistas e investigadores puedan consultarlos directamente.
          </p>
        )}
      </section>

      <section className="tarjeta seccion">
        <h2>Limitaciones</h2>
        <p style={{ fontSize: 14 }}>
          Este es un proyecto ciudadano independiente; no reemplaza la información oficial del MEF ni de
          la Contraloría. Las cifras del año en curso son preliminares y cambian con cada actualización.
          La sección de ingresos cubre lo que las entidades registran directamente (canon, recursos
          propios, deuda, transferencias) y no incluye los Recursos Ordinarios del tesoro público.
          Estos datos no indican a qué empresa o persona se pagó: eso requiere cruzarlos con las
          contrataciones del Estado (OSCE/SEACE). Cada actualización pasa controles automáticos de
          consistencia interna y de contraste con la Consulta Amigable. Si detectas una inconsistencia,
          compárala con la Consulta Amigable del MEF y escríbenos.
        </p>
      </section>
    </div>
  );
}
