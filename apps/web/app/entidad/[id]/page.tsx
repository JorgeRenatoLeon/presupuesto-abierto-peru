import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import {
  DATA_DIR, loadOptional, fmtSoles, fmtPct, fmtLugar, fmtFecha, interpretarAvance, corteDatos,
  type Alerta, type Obra, type ComparacionResumen, type Provincia,
} from "@/lib/data";
import { DesgloseFunciones } from "@/components/DesgloseFunciones";
import { IndiceSecciones } from "@/components/IndiceSecciones";
import { Migas } from "@/components/Migas";
import { KpiCard, Lectura } from "@/components/ui";
import { GraficoMensual } from "@/components/Grafico";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";
import { MasObras } from "@/components/MasObras";
import { SeguirBoton } from "@/components/SeguirBoton";
import { Bandas, type Banda } from "@/components/Bandas";
import { ResumenContratos, ListaContratos } from "@/components/Contratos";
import type { ContratosResumen } from "@/lib/contratos";

const ENT_DIR = join(DATA_DIR, "entidad");
const OBRAS_EN_PAGINA = 10;

// No `dynamicParams = false`: with output "export" only generated paths exist anyway, and
// Next 14's dev server rejects it with a misleading "missing generateStaticParams()" error.

export function generateStaticParams() {
  const ids = existsSync(ENT_DIR)
    ? readdirSync(ENT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    : [];
  // output: "export" rejects a dynamic route with no pages (e.g. CI builds without data)
  return ids.length ? ids.map((id) => ({ id })) : [{ id: "sin-datos" }];
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params; // Next 16: route params arrive as a promise
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
  funciones: { ano: number; codigo: string; funcion: string; pim?: number | null; devengado: number }[];
  genericas: { ano: number; codigo: string; generica: string; pim?: number | null; devengado: number }[];
  /** top projects by budget (pipeline exportar.py), n_obras = all of them */
  obras?: Obra[]; n_obras?: number;
  alertas?: Alerta[];
  /** contracts signed in SEACE in the period (pipeline contratos.py); absent: none linked */
  contratos?: ContratosResumen;
};
type FuenteContratos = { anos: number[]; hasta?: string | null; contratos: number; vinculados: number };

/** "MUNICIPALIDAD DISTRITAL DE OLLANTAYTAMBO" -> a small band for the kind of entity and a big
 *  one for the place; any other entity keeps its full name (smaller when long). */
function nombreEnBandas(nombre: string, pim: number | null, ano: number): Banda[] {
  const m = nombre.match(/^(MUNICIPALIDAD (?:DISTRITAL|PROVINCIAL|METROPOLITANA) DE)\s+(.+)$/i);
  const monto = { texto: `${fmtSoles(pim)} · ${ano}`, color: "verde" as const, chica: true };
  if (m) return [{ texto: m[1], color: "fucsia", chica: true }, { texto: fmtLugar(m[2]), color: "amarillo", grande: m[2].length <= 16 }, monto];
  return [{ texto: fmtLugar(nombre), color: "amarillo", chica: nombre.length > 28 }, monto];
}

export default async function EntidadPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params; // Next 16: route params arrive as a promise
  const archivo = join(ENT_DIR, `${params.id}.json`);
  if (!existsSync(archivo)) {
    return <div className="pagina"><div className="tarjeta vacio">Aún no hay datos de entidades procesados.</div></div>;
  }
  const raw = readFileSync(archivo, "utf-8");
  const { info, series, funciones, genericas, obras = [], n_obras = 0, alertas: alertasEntidad = [], contratos } =
    JSON.parse(raw) as Payload;
  const fuenteContratos = loadOptional<FuenteContratos>("contratos/fuente.json");
  const periodo = fuenteContratos ? fuenteContratos.anos.join(" y ") : "";
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
  const genAno = genericas.filter((g) => g.ano === ano).map((g) => ({ codigo: g.codigo, funcion: g.generica, pim: g.pim, devengado: g.devengado }));

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

      <IndiceSecciones secciones={[
        { id: "resumen", titulo: "Resumen" },
        { id: "en-que", titulo: "En qué gasta" },
        ...(n_obras ? [{ id: "obras", titulo: "Obras" }] : []),
        ...(fuenteContratos ? [{ id: "contratos", titulo: "A quién contrata" }] : []),
        { id: "mes-a-mes", titulo: "Mes a mes" },
        ...(esMunicipal && ranking.length > 1 ? [{ id: "comparacion", titulo: "Frente a otras" }] : []),
        ...(alertasEntidad.length ? [{ id: "alertas", titulo: `Alertas (${alertasEntidad.length})` }] : []),
        { id: "tipo-de-gasto", titulo: "Tipo de gasto" },
      ]} />

      <section className="seccion" id="resumen">
        <div className="kpis">
          <KpiCard etiqueta="Presupuesto vigente (PIM)" valor={fmtSoles(pim)} nota="Lo que puede gastar este año" />
          <KpiCard etiqueta={`Gastado ${corte}`} valor={fmtSoles(devYtd)} nota={`${fmtPct(avance)} del presupuesto`} />
          <KpiCard etiqueta="Avance" valor={fmtPct(avance)} nota={`Esperado a la fecha: ${fmtPct(esperado)}`} />
          <KpiCard etiqueta="Presupuesto inicial (PIA)" valor={fmtSoles(pia)} nota="Aprobado al inicio del año" />
        </div>
        <div style={{ marginTop: 14 }}><Lectura tono={lectura.tono}>{lectura.texto}</Lectura></div>
      </section>

      <section className="seccion tarjeta" id="en-que">
        <h2>¿A qué lo destina?</h2>
        <p className="sub">
          Su presupuesto por función del Estado. Abre cada una para ver sus actividades y proyectos, y en cada uno
          «¿En qué exactamente?»: metas, qué se compra o se paga y de dónde sale el dinero.
        </p>
        <DesgloseFunciones funciones={funcAno} sec={info.sec_ejec} esperado={esperado} />
      </section>

      {n_obras ? (
        <section className="seccion tarjeta" id="obras">
          <h2>Obras y proyectos de inversión ({n_obras})</h2>
          <p className="sub">
            {detenidas.length ? `${detenidas.length} sin ningún gasto ${corte}. ` : ""}
            Los de mayor presupuesto; cada uno enlaza a su ficha oficial en el MEF.
          </p>
          <ListaObras obras={obras.slice(0, OBRAS_EN_PAGINA)} sec={fuenteContratos ? info.sec_ejec : undefined} />
          <MasObras sec={info.sec_ejec} desde={OBRAS_EN_PAGINA} total={obras.length} />
        </section>
      ) : (
        <section className="seccion tarjeta" id="obras">
          <h2>Obras y proyectos de inversión</h2>
          <p className="sub">Esta entidad no tiene proyectos de inversión este año.</p>
        </section>
      )}

      {fuenteContratos ? (
        <section className="seccion tarjeta" id="contratos">
          <h2>¿A quién le contrata?</h2>
          <p className="sub">
            Los contratos que firmó en {periodo}, según el SEACE, el registro oficial de compras del Estado: con quién,
            por cuánto, cómo se eligió al proveedor y el contrato firmado, para descargar.
          </p>
          {contratos?.n ? (
            <>
              <ResumenContratos r={contratos} />
              <ListaContratos sec={info.sec_ejec} />
            </>
          ) : (
            <div className="vacio">
              No encontramos contratos de esta entidad en el SEACE en {periodo}. Puede que solo haga compras pequeñas
              (que no pasan por el SEACE) o que su nombre ahí sea muy distinto al del MEF.
            </div>
          )}
          <p className="aviso-contratos">
            <strong>Lo contratado no es lo pagado:</strong> el Estado no publica cada pago a cada proveedor. Las compras
            pequeñas (hasta 8 UIT), hechas con órdenes de compra o de servicio, no pasan por el SEACE y no aparecen aquí.
            Unimos los compradores del SEACE con esta entidad por su nombre y por los códigos de sus obras (CUI).
            {fuenteContratos.hasta ? ` Contratos firmados hasta el ${fmtFecha(fuenteContratos.hasta)}.` : ""}{" "}
            <Link href="/metodologia/#contratos">Cómo lo hacemos</Link>
          </p>
        </section>
      ) : null}

      <section className="seccion tarjeta" id="mes-a-mes">
        <h2>Gasto mes a mes</h2>
        <p className="sub">Lo gastado (devengado) en cada mes de {ano}.</p>
        <GraficoMensual puntos={serieAno.map((s) => ({ mes: s.mes, valor: s.devengado }))} />
      </section>

      {esMunicipal && ranking.length > 1 ? (
        <section className="seccion tarjeta" id="comparacion">
          <h2>Frente a las otras municipalidades de {fmtLugar(prov!.nombre)}</h2>
          <p className="sub">
            Puesto <strong>{puesto} de {ranking.length}</strong> por avance de ejecución {corte} (qué parte de su
            presupuesto ya gastó). Promedio de la provincia: {fmtPct(avanceProv)}.
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
        <section className="seccion" id="alertas">
          <h2 style={{ marginBottom: 10 }}>Alertas de esta entidad ({alertasEntidad.length})</h2>
          <div style={{ display: "grid", gap: 10 }}>
            {alertasEntidad.slice(0, 5).map((a, i) => <AlertaCard key={i} alerta={a} enEntidad />)}
          </div>
        </section>
      ) : null}

      <section className="seccion tarjeta" id="tipo-de-gasto">
        <h2>¿En qué tipo de gasto?</h2>
        <p className="sub">Sueldos, compras, obras… Abre cada tipo para ver qué incluye.</p>
        <DesgloseFunciones funciones={genAno} dimension="generica" esperado={esperado} />
      </section>
    </div>
  );
}
