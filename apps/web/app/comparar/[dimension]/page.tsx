import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { loadOptional, type ComparacionDimension, type ComparacionResumen, fmtLugar } from "@/lib/data";
import { Comparador } from "@/components/Comparador";

// No `dynamicParams = false`: with output "export" only generated paths exist anyway, and
// Next 14's dev server rejects it with a misleading "missing generateStaticParams()" error.

export function generateStaticParams() {
  const resumen = loadOptional<ComparacionResumen>("comparar/resumen.json");
  const ids = (resumen?.dimensiones ?? [])
    .filter((d) => loadOptional<ComparacionDimension>(`comparar/${d.id}.json`))
    .map((d) => d.id);
  // output: "export" rejects a dynamic route with no pages (e.g. CI builds without data)
  return ids.length ? ids.map((dimension) => ({ dimension })) : [{ dimension: "funcion" }];
}

export async function generateMetadata(props: { params: Promise<{ dimension: string }> }) {
  const params = await props.params; // Next 16: route params arrive as a promise
  const data = loadOptional<ComparacionDimension>(`comparar/${params.dimension}.json`);
  return { title: `Comparar por ${data?.titulo.toLowerCase() ?? params.dimension} — Presupuesto Abierto Perú` };
}

export default async function CompararDimensionPage(props: { params: Promise<{ dimension: string }> }) {
  const params = await props.params; // Next 16: route params arrive as a promise
  const resumen = loadOptional<ComparacionResumen>("comparar/resumen.json");
  const data = loadOptional<ComparacionDimension>(`comparar/${params.dimension}.json`);
  if (!resumen || !data) {
    return <div className="pagina"><div className="tarjeta vacio">Aún no hay comparaciones procesadas.</div></div>;
  }

  return (
    <div className="pagina">
      <nav style={{ fontSize: 13 }}>
        <Link href="/comparar/" style={{ color: "var(--rojo)", fontWeight: 600 }}><ArrowLeft className="icono-linea" aria-hidden /> ¿Qué cambió?</Link>
      </nav>
      <section className="hero">
        <h1>Comparar por {data.titulo.toLowerCase()} · {resumen.ano}</h1>
        <p>
          {data.niveles.length > 1
            ? `Abre cada fila para bajar de nivel: ${data.niveles.join(" › ")}.`
            : "Cada fila suma todas las entidades del Estado."}
        </p>
      </section>

      <div className="tabs">
        {resumen.dimensiones.map((d) => (
          <Link key={d.id} href={`/comparar/${d.id}/`} className={`tab ${d.id === data.dimension ? "activo" : ""}`}>
            {d.titulo}
          </Link>
        ))}
      </div>

      <Comparador data={data} resumen={resumen} />

      {data.definiciones ? (
        <section className="tarjeta seccion">
          <h2>¿Qué incluye cada tema?</h2>
          <p className="sub">
            Los temas agrupan partidas del clasificador de gastos. El clasificador dice <em>en qué</em> se gasta,
            no <em>quién</em> cobra: son aproximaciones. Los temas se superponen, así que no se suman entre sí.
          </p>
          <div className="tabla-scroll">
            <table className="tabla-simple">
            <thead><tr><th>Tema</th><th>Qué incluye</th><th>Confianza</th></tr></thead>
            <tbody>
              {data.definiciones.map((d) => (
                <tr key={d.etiqueta}>
                  <td style={{ fontWeight: 600, color: "var(--tinta)" }}>{fmtLugar(d.nombre)}</td>
                  <td>{d.descripcion}</td>
                  <td><span className={`badge ${d.confianza === "alta" ? "neutro" : "media"}`}>{d.confianza}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
