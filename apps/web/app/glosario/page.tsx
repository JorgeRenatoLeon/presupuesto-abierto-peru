import Link from "next/link";
import { loadOptional, fmtNombre, type Glosario } from "@/lib/data";

export const metadata = {
  title: "Glosario del presupuesto — Presupuesto Abierto Perú",
  description: "Qué significan PIA, PIM, devengado, función, genérica y las demás palabras del presupuesto público, en palabras simples y con la definición oficial del MEF.",
};

const GRUPOS: Record<string, string> = {
  presupuesto: "El presupuesto", ejecucion: "Cómo se gasta (las etapas)", estructura: "Quién gasta",
  clasificacion: "Cómo se clasifica el gasto", inversion: "Obras y actividades",
};

export default function GlosarioPage() {
  const g = loadOptional<Glosario>("glosario.json");
  if (!g) return <div className="pagina"><div className="tarjeta vacio">Aún no hay glosario procesado.</div></div>;
  const grupos = Object.keys(GRUPOS).map((k) => [k, g.terminos.filter((t) => t.grupo === k)] as const);
  return (
    <div className="pagina lectura-larga">
      <section className="hero">
        <h1>Glosario del presupuesto</h1>
        <p>Las palabras que usa el Estado, en palabras simples. Las definiciones de funciones y tipos de gasto son las oficiales del MEF.</p>
        <nav className="indice-glosario" aria-label="Secciones">
          {grupos.map(([k]) => <a key={k} href={`#${k}`}>{GRUPOS[k]}</a>)}
          <a href="#funciones">Las 25 funciones</a>
          <a href="#genericas">Tipos de gasto</a>
        </nav>
      </section>

      {grupos.map(([k, ts]) => (
        <section key={k} id={k} className="seccion">
          <h2>{GRUPOS[k]}</h2>
          <dl className="glosario">
            {ts.map((t) => (
              <div key={t.clave} id={t.clave}>
                <dt>{t.termino}</dt>
                <dd><p className="simple">{t.simple}</p><p>{t.detalle}</p></dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section id="funciones" className="seccion">
        <h2>Las 25 funciones del Estado</h2>
        <p className="sub">Para qué se gasta. Puedes ver cuánto recibe cada una y qué cambió en <Link href="/comparar/funcion/">¿Qué cambió? › Función</Link>.</p>
        <dl className="glosario">
          {g.funciones.map((f) => (
            <div key={f.codigo} id={`f${f.codigo}`}>
              <dt><span className="codigo">{f.codigo}</span> {fmtNombre(f.nombre)}</dt>
              <dd>
                {f.simple ? <p className="simple">{f.simple}{f.ejemplos ? ` Por ejemplo: ${f.ejemplos}.` : ""}</p> : null}
                <p className="oficial">{f.oficial}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="genericas" className="seccion">
        <h2>Tipos de gasto (genéricas)</h2>
        <p className="sub">Cómo se gasta: en sueldos, compras, obras, deuda…</p>
        <dl className="glosario">
          {g.genericas.map((f) => (
            <div key={f.codigo} id={`g${f.codigo}`}>
              <dt><span className="codigo">{f.codigo}</span> {fmtNombre(f.nombre)}</dt>
              <dd><p className="simple">{f.simple} Por ejemplo: {f.ejemplos}.</p><p className="oficial">{f.oficial}</p></dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="nota-fuente">Fuentes: {Object.values(g.fuentes).join("; ")}. Los resúmenes “en palabras simples” son nuestros.</p>
    </div>
  );
}
