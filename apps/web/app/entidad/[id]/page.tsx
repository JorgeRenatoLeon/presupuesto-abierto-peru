import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import {
  DATA_DIR, loadOptional, fmtSoles, fmtPct, fmtLugar, interpretarAvance, corteDatos,
  type Alerta, type Obra, type ComparacionResumen,
} from "@/lib/data";
import { KpiCard, Lectura, ListaBarras } from "@/components/ui";
import { GraficoMensual } from "@/components/Grafico";
import { AlertaCard } from "@/components/AlertaCard";
import { ListaObras } from "@/components/Obras";
import { SeguirBoton } from "@/components/SeguirBoton";

const ENT_DIR = join(DATA_DIR, "entidad");

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
      title: `${info.nombre} — Presupuesto Abierto Perú`,
      description: `Presupuesto y ejecución de ${info.nombre}: PIM, devengado mensual, funciones y tipo de gasto.`,
    };
  } catch {
    return { title: "Entidad — Presupuesto Abierto Perú" };
  }
}

type Payload = {
  info: { sec_ejec: string; nombre: string; nivel: string | null; dept: string | null;
          pliego: string | null; devengado: number | null; pim: number | null;
          prov?: string | null; dist?: string | null };
  series: { ano: number; mes: number; pia: number | null; pim: number | null; devengado: number }[];
  funciones: { ano: number; funcion: string; devengado: number }[];
  genericas: { ano: number; generica: string; devengado: number }[];
  /** top projects by budget (pipeline exportar.py), n_obras = all of them */
  obras?: Obra[]; n_obras?: number;
  alertas?: Alerta[];
};

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

  const funcAno = funciones.filter((f) => f.ano === ano).map((f) => ({
    id: f.funcion, nombre: f.funcion, monto: f.devengado, referencia: null,
  }));
  const genAno = genericas.filter((g) => g.ano === ano).map((g) => ({
    id: g.generica, nombre: g.generica, monto: g.devengado, referencia: null,
  }));

  return (
    <div className="pagina">
      <nav style={{ fontSize: 13 }}>
        <Link href="/explorar/" style={{ color: "var(--rojo)", fontWeight: 600 }}>← Explorar</Link>
      </nav>
      <section className="hero">
        <h1>{info.nombre}</h1>
        <p>
          {[info.nivel, info.pliego, info.dist && info.dist !== info.prov ? fmtLugar(info.dist) : null,
            info.prov ? fmtLugar(info.prov) : null, info.dept ? fmtLugar(info.dept) : null].filter(Boolean).join(" · ")}
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
              + `Los ${Math.min(obras.length, n_obras)} de mayor presupuesto; cada uno enlaza a su ficha oficial en el MEF.`
            : "Esta entidad no tiene proyectos de inversión este año."}
        </p>
        {n_obras ? <ListaObras obras={obras} /> : null}
      </section>

      <section className="seccion tarjeta">
        <h2>¿A qué lo destina?</h2>
        <p className="sub">Funciones del Estado en las que gasta esta entidad.</p>
        <ListaBarras items={funcAno} unidadNota="devengado" />
      </section>

      <section className="seccion tarjeta">
        <h2>¿En qué tipo de gasto?</h2>
        <p className="sub">Personal, bienes y servicios, inversiones…</p>
        <ListaBarras items={genAno} unidadNota="devengado" />
      </section>
    </div>
  );
}
