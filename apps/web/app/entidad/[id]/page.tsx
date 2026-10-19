import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import {
  DATA_DIR, loadOptional, fmtSoles, fmtPct, fmtLugar, interpretarAvance, corteDatos,
  type Alerta, type Obra, type ComparacionResumen, type Provincia,
} from "@/lib/data";
import { DesgloseFunciones, type ItemEntidad } from "@/components/DesgloseFunciones";
import { Migas } from "@/components/Migas";
import { KpiCard, Lectura } from "@/components/ui";
import { GraficoMensual } from "@/components/Grafico";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";
import { MasObras } from "@/components/MasObras";
import { SeguirBoton } from "@/components/SeguirBoton";
import { Bandas, type Banda } from "@/components/Bandas";

const ENT_DIR = join(DATA_DIR, "entidad");
const OBRAS_EN_PAGINA = 10;

export const dynamicParams = false;

export function generateStaticParams() {
  const ids = existsSync(ENT_DIR)
    ? readdirSync(ENT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    : [];
  // output: "export" rejects a dynamic route with no pages (e.g. CI builds without data)
  return ids.length ? ids.map((id) => ({ id })) : [{ id: "sin-datos" }];
}

export function generateMetadata({ params }: { params: { id: string } }) {
  try {
    const { info } = JSON.parse(readFileSync(join(ENT_DIR, `${params.id}.json`), "utf-8"));
    return {
      title: `${fmtLugar(info.nombre)} — Presupuesto Abierto Perú`,
      description: `Presupuesto y ejecución de ${info.nombre}: PIM, devengado mensual, funciones y tipo de gasto.`,
    };
  } catch {
    return { title: "Entidad — Presupuesto Abierto Perú" };
  }
}

type Payload = {
  info: { sec_ejec: string; nombre: string; nivel: string | null; dept: string | null;
          pliego: string | null; devengado: number | null; pim: number | null;
          prov?: string | null; dist?: string | null; ubigeo?: string | null };
  series: { ano: number; mes: number; pia: number | null; pim: number | null; devengado: number }[];
  funciones: { ano: number; codigo: string; funcion: string; devengado: number }[];
  genericas: { ano: number; codigo: string; generica: string; devengado: number }[];
  /** per función code: this entity's largest activities and projects */
  items?: Record<string, ItemEntidad[]>;
  /** top projects by budget (pipeline exportar.py), n_obras = all of them */
  obras?: Obra[]; n_obras?: number;
  alertas?: Alerta[];
};

/** "MUNICIPALIDAD DISTRITAL DE OLLANTAYTAMBO" -> a small band for the kind of entity and a big
 *  one for the place; any other entity keeps its full name (smaller when long). */
function nombreEnBandas(nombre: string, pim: number | null, ano: number): Banda[] {
  const m = nombre.match(/^(MUNICIPALIDAD (?:DISTRITAL|PROVINCIAL|METROPOLITANA) DE)\s+(.+)$/i);
  const monto = { texto: `${fmtSoles(pim)} · ${ano}`, color: "verde" as const, chica: true };
  if (m) return [{ texto: m[1], color: "fucsia", chica: true }, { texto: fmtLugar(m[2]), color: "amarillo", grande: m[2].length <= 16 }, monto];
  return [{ texto: fmtLugar(nombre), color: "amarillo", chica: nombre.length > 28 }, monto];
}

export default function EntidadPage({ params }: { params: { id: string } }) {
  const archivo = join(ENT_DIR, `${params.id}.json`);
  if (!existsSync(archivo)) {
    return <div className="pagina"><div className="tarjeta vacio">Aún no hay datos de entidades procesados.</div></div>;
  }
  const raw = readFileSync(archivo, "utf-8");
  const { info, series, funciones, genericas, obras = [], n_obras = 0, alertas: alertasEntidad = [] } =
    JSON.parse(raw) as Payload;
  const detenidas = obras.filter((o) => o.senal === "sin_avance");

  const anos = Array.from(new Set(series.map((s) => s.ano))).sort();
  const ano = anos[anos.length - 1];
  const serieAno = series.filter((s) => s.ano === ano);
  const mesUlt = Math.max(...serieAno.map((s) => s.mes), 0);
  const pim = serieAno.find((s) => s.mes === mesUlt)?.pim ?? null;
  const pia = serieAno.find((s) => s.mes === mesUlt)?.pia ?? null;
  const devYtd = serieAno.reduce((acc, s) => acc + (s.devengado ?? 0), 0);
  const avance = pim ? devYtd / pim : null;
  const cmp = loadOptional<ComparacionResumen>("comparar/resumen.json");
  const esperado = (cmp?.ano === ano ? cmp.avance_esperado : undefined) ?? (mesUlt || 1) / 12;
  const lectura = interpretarAvance(avance, mesUlt || 1, esperado);
  const corte = corteDatos(mesUlt, cmp?.ano === ano ? cmp.publicacion.fecha : null, ano);

  const funcAno = funciones.filter((f) => f.ano === ano);
  const genAno = genericas.filter((g) => g.ano === ano).map((g) => ({ codigo: g.codigo, funcion: g.generica, devengado: g.devengado }));

  // where it sits, and how it compares with the other municipalities of its province
  const ub = info.ubigeo && /^\d{6}$/.test(info.ubigeo) && info.ubigeo.slice(0, 2) <= "25" ? info.ubigeo : null;
  const prov = ub ? loadOptional<Provincia>(`localidad/prov/${ub.slice(0, 4)}.json`) : null;
  const pares = prov ? prov.distritos.map((d) => d.municipalidad).filter((m): m is NonNullable<typeof m> => !!m && !!m.pim) : [];
  const esMunicipal = pares.some((m) => m.sec_ejec === info.sec_ejec);
  const ranking = esMunicipal
    ? [...pares].sort((a, b) => (b.devengado ?? 0) / (b.pim ?? 1) - (a.devengado ?? 0) / (a.pim ?? 1))
    : [];
  const puesto = ranking.findIndex((m) => m.sec_ejec === info.sec_ejec) + 1;
  const avanceProv = pares.length ? pares.reduce((a, m) => a + (m.devengado ?? 0), 0) / pares.reduce((a, m) => a + (m.pim ?? 0), 0) : null;

  return (
    <div className="pagina">
      {ub && prov ? (
        <Migas pasos={[
          { href: `/localidad/${ub.slice(0, 2)}/`, texto: fmtLugar(prov.dept_nombre ?? "") },
          { href: `/localidad/${ub.slice(0, 2)}/${ub.slice(2, 4)}/`, texto: `Provincia de ${fmtLugar(prov.nombre)}` },
          { href: `/localidad/${ub.slice(0, 2)}/${ub.slice(2, 4)}/#d${ub}`, texto: fmtLugar(info.dist ?? "") },
        ]} />
      ) : (
        <Migas pasos={[{ href: "/explorar/", texto: "Entidades" }]} />
      )}
      <section className="hero">
        <Bandas etiqueta={info.nombre} bandas={nombreEnBandas(info.nombre, pim, ano)} />
        <p>
          {[info.nivel ? fmtLugar(info.nivel) : null, info.pliego, info.dist && info.dist !== info.prov ? fmtLugar(info.dist) : null,
            info.prov ? fmtLugar(info.prov) : null, info.dept ? fmtLugar(info.dept) : null].filter((x) => x && x.trim()).join(" · ")}
          {` · Año ${ano}, datos ${corte}`}
        </p>
        <div style={{ marginTop: 10 }}>
          <SeguirBoton item={{ tipo: "entidad", id: info.sec_ejec, nombre: info.nombre }} />
        </div>
      </section>

      <section className="kpis">
        <KpiCard etiqueta="Presupuesto vigente (PIM)" valor={fmtSoles(pim)} />
        <KpiCard etiqueta="Ejecutado" valor={fmtSoles(devYtd)} />
        <KpiCard etiqueta="Avance" valor={fmtPct(avance)} nota={`Esperado: ${fmtPct(esperado)}`} />
        <KpiCard etiqueta="Presupuesto inicial (PIA)" valor={fmtSoles(pia)} />
      </section>

      <Lectura tono={lectura.tono}>{lectura.texto}</Lectura>

      {esMunicipal && ranking.length > 1 ? (
        <section className="seccion tarjeta">
          <h2>Frente a las otras municipalidades de {fmtLugar(prov!.nombre)}</h2>
          <p className="sub">
            Puesto <strong>{puesto} de {ranking.length}</strong> por avance de ejecución {corte}. Promedio de la
            provincia: {fmtPct(avanceProv)}.
          </p>
          <ol className="ranking">
            {ranking.map((m) => (
              <li key={m.sec_ejec} className={m.sec_ejec === info.sec_ejec ? "propio" : ""}>
                <Link href={`/entidad/${m.sec_ejec}/`}>{fmtLugar(m.distrito ?? m.nombre)}</Link>
                <span className="barra"><span style={{ width: `${Math.min(100, ((m.devengado ?? 0) / (m.pim ?? 1)) * 100)}%` }} /></span>
                <span className="cifra">{fmtPct((m.devengado ?? 0) / (m.pim ?? 1))}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {alertasEntidad.length ? (
        <section className="seccion">
          <h2 style={{ marginBottom: 10 }}>Alertas de esta entidad ({alertasEntidad.length})</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {alertasEntidad.slice(0, 5).map((a, i) => <AlertaCard key={i} alerta={a} enEntidad />)}
          </div>
        </section>
      ) : null}

      <section className="seccion tarjeta">
        <h2>Gasto mes a mes</h2>
        <GraficoMensual puntos={serieAno.map((s) => ({ mes: s.mes, valor: s.devengado }))} />
      </section>

      <section className="seccion tarjeta" id="obras">
        <h2>Obras y proyectos de inversión ({n_obras})</h2>
        <p className="sub">
          {n_obras
            ? `${detenidas.length ? `${detenidas.length} sin ningún gasto ${corte}. ` : ""}`
              + `Los de mayor presupuesto; cada uno enlaza a su ficha oficial en el MEF.`
            : "Esta entidad no tiene proyectos de inversión este año."}
        </p>
        {n_obras ? <ListaObras obras={obras.slice(0, OBRAS_EN_PAGINA)} /> : null}
        <MasObras sec={info.sec_ejec} desde={OBRAS_EN_PAGINA} total={obras.length} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿A qué lo destina?</h2>
        <p className="sub">Gastado {corte}, por función del Estado. Abre cada una para ver en qué lo usa y qué significa.</p>
        <DesgloseFunciones funciones={funcAno} sec={info.sec_ejec} />
      </section>

      <section className="seccion tarjeta">
        <h2>¿En qué tipo de gasto?</h2>
        <p className="sub">Sueldos, compras, obras… Abre cada tipo para ver qué incluye.</p>
        <DesgloseFunciones funciones={genAno} dimension="generica" />
      </section>
    </div>
  );
}
