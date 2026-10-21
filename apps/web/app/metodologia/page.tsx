import Link from "next/link";
import { load, loadOptional, MESES, corteDatos, latestYear, fmtFecha, fmtPct, fmtSoles, urlDatos, type Meta, type ResumenAnual } from "@/lib/data";
import type { FuenteOrdenes } from "@/lib/ordenes";

type FuenteContratos = { anos: number[]; hasta?: string | null; contratos: number; vinculados: number;
  monto: number; monto_vinculado: number; compradores: number; compradores_vinculados: number;
  con_tipo_de_gasto?: number; proveedores?: number };

export const metadata = { title: "Metodología — Presupuesto Abierto Perú" };

const enlace = { color: "var(--rojo)", fontWeight: 600 } as const;

export default function MetodologiaPage() {
  const meta = load<Meta>("meta.json");
  const resumen = load<ResumenAnual[]>("resumen_anual.json");
  const actual = latestYear(resumen);
  const publicaciones = meta.publicaciones ?? [];
  const fc = loadOptional<FuenteContratos>("contratos/fuente.json");
  const fo = loadOptional<FuenteOrdenes>("ordenes/fuente.json");

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
          <div className="tabla-scroll">
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
          </div>
        ) : null}
      </section>

      <section className="tarjeta seccion">
        <h2>Actualización</h2>
        <p style={{ fontSize: 14 }}>
          {meta.generated_at
            ? <>Datos procesados por última vez el <strong>{meta.generated_at}</strong>. </>
            : null}
          {actual
            ? <>La información está actualizada <strong>{corteDatos(actual.mes_ult, publicaciones.find((p) => p.dataset === "gasto" && p.ano === actual.ano)?.fecha, actual.ano)} de {actual.ano}</strong>. </>
            : null}
          Todos los días revisamos si el MEF publicó una versión nueva de sus archivos. Desde octubre de 2026 el
          MEF solo publica archivos diarios de 8 a 10 GB, así que descargamos la versión nueva como máximo una vez
          por semana (el año anterior, una vez al mes). Al descargarla verificamos que cada total coincida con el
          archivo original y que las cifras tengan sentido, y regeneramos todo el sitio.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Guardamos cada publicación del MEF</h2>
        <p style={{ fontSize: 14 }}>
          El MEF reemplaza sus archivos en cada actualización: el archivo de hoy trae el presupuesto
          modificado (PIM) vigente, pero no cómo era la semana pasada. Por eso guardamos una copia de cada
          versión que descargamos (una por semana) y las comparamos: así detectamos recortes, aumentos y
          transferencias entre una actualización y la siguiente. Los archivos de ~2–3 GB se convierten, sin pérdida de información,
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
          gasto ejecutado hasta la misma fecha; como el MEF publica a mitad de mes, el último mes del año
          anterior se cuenta en proporción a los días transcurridos). Marcamos como “cambio fuerte” lo que varía al menos 5% en una
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
          cambios frente al año anterior, proyectos sin avance, gasto concentrado en diciembre, ejecución
          lenta y presupuestos muy distintos al inicial.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Proyectos de inversión y señales</h2>
        <p style={{ fontSize: 14, marginBottom: 8 }}>
          El presupuesto de un año muestra solo la parte de cada obra que se paga ese año. Para ver la obra completa
          usamos el <strong>Banco de Inversiones del MEF</strong> (datos abiertos «Detalle de inversiones» y «Formato 12B»,
          actualizados cada semana): su costo total actualizado frente al aprobado, lo gastado desde el inicio, el avance
          físico, cómo se ejecuta, dónde está, los laudos arbitrales y el último reporte de la entidad, con los problemas
          que declara. Así, una obra de S/ 23 millones en su último año puede tener S/ 3 millones de presupuesto y
          contratos de años anteriores por mucho más.
        </p>
        <p style={{ fontSize: 14 }}>
          Cada proyecto de inversión se identifica por su código único (CUI) y lo agrupamos por la entidad que
          lo ejecuta; su ficha oficial está en el Sistema de Seguimiento de Inversiones del MEF. Desde junio,
          marcamos <strong>“sin avance”</strong> a los proyectos de S/ 1 millón o más sin ningún gasto en el año,
          y <strong>“avance muy bajo”</strong> a los que llevan menos de 10%; <strong>“presupuesto recortado”</strong>{" "}
          indica una reducción de 30% o más frente a la publicación anterior del MEF. Las alertas de proyectos
          solo incluyen los de S/ 5 millones o más, y son de prioridad alta si superan S/ 20 millones o si el
          proyecto avanzó el año anterior y este año se detuvo. Las obras suelen ejecutarse más hacia fin de
          año: estas señales son preguntas, no conclusiones.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          El <strong>gasto de fin de año</strong> compara lo devengado en diciembre con todo el año, en entidades
          que ejecutaron al menos S/ 5 millones. Señalamos a las que concentraron 35% o más (el promedio del
          Estado ronda 14%).
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          El <strong>presupuesto sin descripción</strong> es el que el MEF publica con el código genérico de proyecto
          2999999 o sin nombre de proyecto, actividad o meta. Avisamos desde S/ 1 millón (prioridad alta desde
          S/ 100 millones). En octubre de 2026 sumaba S/ 2,651 millones, casi todo inversión en defensa: puede ser
          información reservada por ley, pero sin descripción no se puede vigilar.
        </p>
      </section>

      <section className="tarjeta seccion" id="contratos">
        <h2>¿A quién le contrata el Estado?</h2>
        <p style={{ fontSize: 14 }}>
          Los contratos vienen del <strong>SEACE</strong>, el sistema donde las entidades registran sus compras. Lo
          publica el OECE (antes OSCE) en el estándar de datos de contrataciones abiertas (OCDS); usamos la copia de la{" "}
          <a style={enlace} href="https://data.open-contracting.org/en/publication/135" target="_blank" rel="noopener">Open
          Contracting Partnership</a> (licencia CC BY 4.0) y la revisamos cada semana. De cada contrato mostramos el
          objeto, el proveedor y su RUC, el monto firmado y el final, la fecha, cómo se eligió al proveedor, cuántos
          proveedores participaron y sus documentos: el contrato firmado y lo que vino después (adicionales,
          ampliaciones, resoluciones, nulidades), que se descargan directamente del SEACE.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          El SEACE no usa los códigos del MEF, así que unimos cada comprador con una unidad ejecutora del presupuesto
          de dos formas: <strong>por el nombre</strong>, dentro del mismo departamento y cuidando de no confundir
          unidades hermanas (la red de salud y la UGEL de una misma provincia, dos distritos con el mismo nombre), y{" "}
          <strong>por los códigos de obra (CUI)</strong> que contrata: si la mayoría de sus obras son de una unidad,
          es esa unidad.
          {fc ? <> Así quedan unidos {fc.vinculados.toLocaleString("es-PE")} de los {fc.contratos.toLocaleString("es-PE")}{" "}
            contratos firmados en {fc.anos.join(" y ")} ({fmtPct(fc.vinculados / fc.contratos)}; {fmtPct(fc.monto_vinculado / fc.monto)}{" "}
            del monto).</> : null}{" "}
          Lo que falta es casi todo de entidades que no están en el presupuesto público: empresas del Estado
          (Petroperú, Sedapal, las eléctricas), EsSalud y el Banco Central de Reserva. Cada obra muestra además los
          contratos que llevan su CUI, aunque los haya firmado otra entidad (una empresa municipal, por ejemplo).
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Qué se compró y con qué tipo de gasto.</strong> Cada contrato trae sus líneas (qué se compró, cuánto y a
          qué precio) con el código del catálogo de compras del Estado (CUBSO). Con ese código le asignamos el tipo de
          gasto del presupuesto que le corresponde (por ejemplo, «mantenimiento y reparación de vehículos» o
          «combustibles») según una tabla pública que cualquiera puede revisar
          (<code>pipeline/etiquetas/bienes_gasto.csv</code>); en las obras, el tipo de gasto sale del propio proyecto en el
          presupuesto del MEF. Es una equivalencia, no un registro contable: el SEACE no dice qué partida paga cada
          contrato. Por eso, junto a cada tipo de gasto de una actividad mostramos los contratos de la entidad de ese
          tipo, y en cada proyecto, los que llevan su código (CUI).
          {fc?.con_tipo_de_gasto ? ` ${fmtPct(fc.con_tipo_de_gasto / fc.contratos)} de los contratos tienen tipo de gasto; el resto no trae código de catálogo.` : ""}
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Cada proveedor tiene su página</strong>
          {fc?.proveedores ? ` (${fc.proveedores.toLocaleString("es-PE")} empresas, consorcios y personas)` : ""}: todo lo que
          firmó con el Estado en el periodo, con qué entidades y qué vende. Búscalos en{" "}
          <Link href="/proveedores/" style={enlace}>Proveedores</Link>. Su historial completo, con sanciones e
          impedimentos, está en la Ficha Única del Proveedor del OECE.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Precios del Estado.</strong> Cada producto que las entidades compran con frecuencia (al menos cinco compras
          de dos entidades, en la unidad que más se usa) tiene su página: cuánto se paga por unidad en cada compra y el
          precio mediano de cada mes, quién lo vende y a qué precio, quién lo compra y sus últimas compras con el contrato.
          Los precios por unidad salen de las líneas de los contratos de bienes (de a dos o más unidades); los que se alejan
          más de 10 veces de lo usual se cuentan aparte, porque suelen ser errores al registrar la cantidad o la unidad.
          Búscalos en <Link href="/productos/" style={enlace}>Precios del Estado</Link>.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Lo que está comprando ahora.</strong> Los procedimientos del SEACE que aún no tienen contrato firmado: los
          convocados (con su valor referencial, la fecha límite de ofertas, los participantes registrados y sus bases para
          descargar) y los adjudicados que faltan firmar, de los últimos doce meses. Contamos también los que quedaron
          desiertos (nadie presentó una oferta válida), nulos o cancelados: muchos desiertos pueden indicar bases difíciles
          de cumplir o un valor referencial bajo.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Las señales: <strong>«un solo participante»</strong> cuando en un concurso participó un solo proveedor (el SEACE
          cuenta como participantes a los que se registraron en el procedimiento; no todos presentan oferta);{" "}
          <strong>«precio alto»</strong> cuando algún producto costó entre 2 y 10 veces lo que el Estado suele pagar por el
          mismo producto (mismo código del catálogo CUBSO y misma unidad, comparado con al menos 8 compras de 4 entidades
          en el periodo, y solo en productos cuyos precios usuales son parecidos entre sí; más de 10 veces suele ser un
          error al registrar la cantidad o la unidad y lo marcamos como «revisar»); <strong>«subió»</strong> cuando el monto
          final supera en 25% o más lo firmado;{" "}
          <strong>«sin competencia»</strong> cuando el proveedor se eligió por contratación directa o exoneración;{" "}
          <strong>«adicional»</strong>, <strong>«resuelto»</strong>, <strong>«declarado nulo»</strong> y{" "}
          <strong>«obra intervenida»</strong> según los documentos registrados después de la firma. Son preguntas que
          vale la pena hacer, no pruebas de una irregularidad.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Lo contratado no es lo pagado:</strong> el Estado no publica cada pago a cada proveedor. Las compras
          de hasta 8 UIT se hacen con órdenes de compra o de servicio y no pasan por un procedimiento del SEACE (están
          en la sección siguiente). Un
          comprador con un nombre muy distinto al del MEF puede quedar sin unir o, rara vez, unirse a una unidad
          parecida: en cada contrato se ve quién lo firmó.
          {fc?.hasta ? ` Contratos firmados hasta el ${fmtFecha(fc.hasta)}.` : ""}
        </p>
      </section>

      <section className="tarjeta seccion" id="mapa">
        <h2>El mapa de obras</h2>
        <p style={{ fontSize: 14 }}>
          Las obras y proyectos de inversión del presupuesto del año que el Banco de Inversiones del MEF ubica con
          coordenadas, en el <Link href="/mapa/" style={enlace}>mapa</Link>: su costo total, cuánto se gastó desde que
          empezó, su avance físico y si este año no tiene gasto. Un proyecto que figura en varias unidades se muestra en la
          que tiene más presupuesto. Las coordenadas las registra cada entidad; algunas pueden ser aproximadas (el centro del
          distrito, por ejemplo). Mapa base: © colaboradores de OpenStreetMap.
        </p>
      </section>

      <section className="tarjeta seccion" id="ordenes">
        <h2>Las compras del día a día: órdenes de compra y de servicio</h2>
        <p style={{ fontSize: 14 }}>
          Además de sus contratos, cada entidad registra en el SEACE, bajo su responsabilidad, todas sus{" "}
          <strong>órdenes de compra y de servicio</strong>: las compras pequeñas (hasta 8 UIT) que no necesitan concurso,
          los servicios que le prestan personas (locadores), la luz y el agua, las compras en los catálogos de Perú Compras
          y los pagos de sus contratos. El OECE las publica cada mes desde 2018 en su{" "}
          <a style={enlace} href="https://www.gob.pe/14272-acceder-al-portal-de-datos-abiertos-del-oece" target="_blank"
             rel="noopener">Portal de Datos Abiertos</a> y las revisamos cada semana. De cada orden mostramos qué se compró
          (como lo escribió la entidad), el proveedor y su RUC, el monto, la fecha, cómo se compró y su estado.
          {fo ? <> En {fo.ano} van {fo.ordenes.toLocaleString("es-PE")} órdenes por {fmtSoles(fo.monto)}; unimos a su unidad
            ejecutora el {fmtPct(fo.monto_vinculado / fo.monto)} del monto, con el RUC de cada entidad y los mismos
            criterios que los contratos.</> : null}
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Son lo que las partidas genéricas del presupuesto no dicen: la «locación de servicios realizados por persona
          natural» (la mayor partida de bienes y servicios del país) son miles de órdenes a personas con nombre y RUC por
          servicios descritos; los «servicios diversos» u «otros bienes», una lista de compras concretas.
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <strong>Tipo de gasto probable.</strong> Una orden no trae el código del presupuesto que la paga (ni la meta ni la
          partida). Lo deducimos de su descripción con reglas públicas (<code>pipeline/etiquetas/ordenes_gasto.csv</code>:
          «combustible», «alquiler de camioneta», «servicio de una persona»…), y la mostramos junto a las partidas de ese
          tipo en cada actividad. Las órdenes que citan el código de una obra (CUI) aparecen en esa obra. Es una
          estimación: el SEACE no dice qué actividad paga cada orden. En el sitio mostramos las órdenes más grandes de
          cada entidad y de cada tipo; todas están en los datos abiertos.
        </p>
      </section>

      <section className="tarjeta seccion">
        <h2>Avisos</h2>
        <p style={{ fontSize: 14 }}>
          Con <strong>«Seguir»</strong> puedes guardar regiones, entidades y temas en este navegador (sin cuenta) y
          ver lo nuevo en <Link href="/seguimiento/" style={enlace}>Siguiendo</Link>. También publicamos canales RSS:{" "}
          <a style={enlace} href={urlDatos("feeds/alertas.xml")}>alertas altas</a>,{" "}
          <a style={enlace} href={urlDatos("feeds/cambios.xml")}>cambios por tema</a>,{" "}
          <a style={enlace} href={urlDatos("feeds/obras.xml")}>proyectos sin avance</a> y uno por departamento.
          {process.env.NEXT_PUBLIC_TELEGRAM_CANAL ? (
            <> Y un resumen de cada actualización en nuestro{" "}
              <a style={enlace} href={process.env.NEXT_PUBLIC_TELEGRAM_CANAL} target="_blank" rel="noopener">canal de Telegram</a>.</>
          ) : null}
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
            Los contratos del SEACE, con su proveedor, monto y CUI, están en{" "}
            <code>{`contratos/${actual?.ano ?? 2026}.parquet`}</code>.
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
          Los datos del MEF no dicen a qué empresa se pagó; los contratos del SEACE dicen con quién se
          contrató y por cuánto, pero no cada pago. Cada actualización pasa controles automáticos de
          consistencia interna y de contraste con la Consulta Amigable. Si detectas una inconsistencia,
          compárala con la Consulta Amigable del MEF y escríbenos.
        </p>
      </section>
    </div>
  );
}
