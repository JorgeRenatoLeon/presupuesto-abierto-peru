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
import { ResumenContratos, ListaContratos, ComprasEnCurso } from "@/components/Contratos";
import { RutaDinero, pasosEntidad } from "@/components/RutaDinero";
import { VistasGasto } from "@/components/VistasGasto";
import { CambiosDelMes } from "@/components/CambiosDelMes";
import { CifrasOrdenes, PanelOrdenes } from "@/components/Ordenes";
import type { ResumenOrdenes, FuenteOrdenes } from "@/lib/ordenes";
import type { ContratosResumen, NombresGasto } from "@/lib/contratos";

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
  /** [activities, projects, budget of the activities, budget of the projects] this year */
  n_items?: [number, number, number, number];
  /** purchase and service orders registered this year (pipeline ordenes.py) */
  ordenes?: ResumenOrdenes;
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
  const { info, series, funciones, genericas, obras = [], n_obras = 0, alertas: alertasEntidad = [], contratos, n_items, ordenes } =
    JSON.parse(raw) as Payload;
  const fuenteOrdenes = loadOptional<FuenteOrdenes>("ordenes/fuente.json");
  // month by month with commitments (pipeline exportar._meses), when the data has them
  const hayMeses = existsSync(join(DATA_DIR, "mes", `${params.id}.json`));
  const fuenteContratos = loadOptional<FuenteContratos>("contratos/fuente.json");
  const todosGastos = fuenteContratos ? loadOptional<NombresGasto>("contratos/gastos.json") : null;
  // only the names this page's summary uses travel in its payload
  const nombresGasto = Object.fromEntries((contratos?.por_gasto ?? []).flatMap(([g]) => (todosGastos?.[g] ? [[g, todosGastos[g]]] : [])));
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

      <RutaDinero pasos={pasosEntidad({
        pim, avance, ano,
        funciones: [...funcAno].sort((a, b) => (b.pim ?? 0) - (a.pim ?? 0)).map((f) => ({ nombre: f.funcion, pim: f.pim ?? 0 })),
        items: n_items ?? [0, n_obras, 0, 0],
        contratos: contratos?.n ? { n: contratos.n, monto: contratos.monto, proveedores: contratos.proveedores ?? null, periodo } : null,
        ordenes: ordenes?.n ? ordenes : null,
      })} />

      <IndiceSecciones secciones={[
        { id: "resumen", titulo: "Cuánto tiene" },
        ...(alertasEntidad.length ? [{ id: "alertas", titulo: `Alertas (${alertasEntidad.length})` }] : []),
        ...(hayMeses ? [{ id: "este-mes", titulo: "Este mes" }] : []),
        { id: "en-que", titulo: "En qué lo gasta" },
        { id: "obras", titulo: "Obras" },
        ...(fuenteContratos ? [{ id: "contratos", titulo: "A quién contrata" }] : []),
        ...(fuenteOrdenes ? [{ id: "ordenes", titulo: "Compras del día a día" }] : []),
      ]} />

      <section className="seccion tarjeta" id="resumen">
        <h2>¿Cuánto tiene y cuánto gastó?</h2>
        <div className="kpis">
          <KpiCard etiqueta="Presupuesto vigente (PIM)" valor={fmtSoles(pim)} nota="Lo que puede gastar este año" />
          <KpiCard etiqueta={`Gastado ${corte}`} valor={fmtSoles(devYtd)} nota={`${fmtPct(avance)} del presupuesto`} />
          <KpiCard etiqueta="Avance" valor={fmtPct(avance)} nota={`Esperado a la fecha: ${fmtPct(esperado)}`} />
          <KpiCard etiqueta="Presupuesto inicial (PIA)" valor={fmtSoles(pia)} nota="Aprobado al inicio del año" />
        </div>
        <div style={{ marginTop: 14 }}><Lectura tono={lectura.tono}>{lectura.texto}</Lectura></div>
        <h3 className="subtitulo" id="mes-a-mes">Mes a mes</h3>
        <p className="sub">Lo gastado (devengado) en cada mes de {ano}.</p>
        <GraficoMensual puntos={serieAno.map((s) => ({ mes: s.mes, valor: s.devengado }))} />
        {esMunicipal && ranking.length > 1 ? (
          <>
            <h3 className="subtitulo" id="comparacion">Frente a las otras municipalidades de {fmtLugar(prov!.nombre)}</h3>
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
          </>
        ) : null}
      </section>

      {alertasEntidad.length ? (
        <section className="seccion tarjeta" id="alertas">
          <h2>Alertas ({alertasEntidad.length})</h2>
          <p className="sub">Señales en sus datos que vale la pena preguntar: no son acusaciones.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {alertasEntidad.slice(0, 5).map((a, i) => <AlertaCard key={i} alerta={a} enEntidad />)}
          </div>
        </section>
      ) : null}

      {hayMeses ? (
        <section className="seccion tarjeta" id="este-mes">
          <h2>¿Qué cambió este mes?</h2>
          <p className="sub">
            Lo que gastó cada mes y los compromisos que firmó, por tipo de gasto, según el MEF. Un compromiso (un contrato,
            una orden, la planilla del año) no es gasto del mes: se muestra lo que significa por mes hasta diciembre.
          </p>
          <CambiosDelMes sec={info.sec_ejec} />
        </section>
      ) : null}

      <section className="seccion tarjeta" id="en-que">
        <h2>¿En qué lo gasta?</h2>
        <p className="sub">
          Sus {fmtSoles(pim)} de {ano}, vistos de dos formas. En cada área, abre sus actividades y obras y, en cada una,
          «¿En qué exactamente?»: metas, todo lo que se compra o se paga y de dónde sale el dinero.
        </p>
        <VistasGasto
          porFuncion={<DesgloseFunciones funciones={funcAno} sec={info.sec_ejec} esperado={esperado} contratos={!!fuenteContratos}
                                         ordenes={!!ordenes?.n} />}
          porTipo={<DesgloseFunciones funciones={genAno} dimension="generica" esperado={esperado} sec={info.sec_ejec}
                                      contratos={!!fuenteContratos} />} />
      </section>

      {n_obras ? (
        <section className="seccion tarjeta" id="obras">
          <h2>Obras y proyectos de inversión ({n_obras})</h2>
          <p className="sub">
            {detenidas.length ? `${detenidas.length} sin ningún gasto ${corte}. ` : ""}
            Los de mayor presupuesto este año. Cada obra dura varios años: abajo de cada una, lo que cuesta entera, quién
            la hace y su ficha oficial en el MEF.{" "}
            <Link href={`/mapa/?${ub ? `dep=${ub.slice(0, 2)}&` : ""}sec=${info.sec_ejec}`} className="enlace-texto">Verlas en el mapa</Link>
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
            Una parte de su gasto pasa por contratos. Estos son los que firmó en {periodo}, según el SEACE, el registro
            oficial de compras del Estado: con quién, por cuánto, cómo se eligió al proveedor y el contrato firmado.
          </p>
          {contratos?.n ? (
            <>
              <ResumenContratos r={contratos} nombres={nombresGasto} />
              {contratos.procesos ? <ComprasEnCurso sec={info.sec_ejec} r={contratos.procesos} /> : null}
              <ListaContratos sec={info.sec_ejec} />
            </>
          ) : (
            <>
              <div className="vacio">
                No encontramos contratos de esta entidad en el SEACE en {periodo}. Puede que solo haga compras pequeñas
                (que no pasan por el SEACE) o que su nombre ahí sea muy distinto al del MEF.
              </div>
              {contratos?.procesos ? <ComprasEnCurso sec={info.sec_ejec} r={contratos.procesos} /> : null}
            </>
          )}
          <p className="aviso-contratos">
            <strong>Lo contratado no es lo pagado:</strong> el Estado no publica cada pago a cada proveedor. Las compras
            pequeñas (hasta 8 UIT) no necesitan contrato: se hacen con órdenes de compra o de servicio, en la sección
            siguiente.
            Unimos los compradores del SEACE con esta entidad por su nombre y por los códigos de sus obras (CUI).
            {fuenteContratos.hasta ? ` Contratos firmados hasta el ${fmtFecha(fuenteContratos.hasta)}.` : ""}{" "}
            <Link href="/metodologia/#contratos">Cómo lo hacemos</Link>
          </p>
        </section>
      ) : null}

      {fuenteOrdenes ? (
        <section className="seccion tarjeta" id="ordenes">
          <h2>¿Qué compra en el día a día?</h2>
          <p className="sub">
            Las órdenes de compra y de servicio que registró en {fuenteOrdenes.ano}, según el SEACE: compras pequeñas que no
            necesitan concurso, servicios de personas, luz y agua, catálogos de Perú Compras y los pagos de sus contratos.
            Aquí está lo que las partidas genéricas del presupuesto («servicios diversos», «otros bienes») no dicen.
          </p>
          {ordenes?.n ? (
            <>
              <CifrasOrdenes r={ordenes} />
              <PanelOrdenes sec={info.sec_ejec} />
            </>
          ) : (
            <div className="vacio">
              No encontramos órdenes de esta entidad en el SEACE en {fuenteOrdenes.ano}. Puede que las registre con otro
              nombre o RUC, o que no use el módulo de órdenes del SEACE.
            </div>
          )}
          <p className="aviso-contratos">
            Cada entidad registra sus órdenes en el SEACE bajo su responsabilidad; el OECE las publica cada mes.
            {fuenteOrdenes.hasta ? ` Órdenes emitidas hasta el ${fmtFecha(fuenteOrdenes.hasta)}.` : ""}{" "}
            <Link href="/metodologia/#ordenes">Cómo lo hacemos</Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
