"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fmtSoles, fmtNombre, urlDatos } from "@/lib/types";
import { MontoPar } from "@/components/MontoPar";
import { BotonExplicar, PanelExplicacion } from "@/components/Explicacion";
import { ContratosDelProyecto, ContratosDeTipo } from "@/components/Contratos";
import { OrdenesDelProyecto, OrdenesDeTipo } from "@/components/Ordenes";

type Item = { nombre: string; tipo: "proyecto" | "actividad"; pim: number | null; devengado: number | null; sd?: boolean;
               /** projects: their CUI, which ties them to their contracts */ cui?: string };
/** What a list leaves out: [how many, budget, spent] */
type Resto = [number, number, number];
/** detalle/<sec>.json, per función, aligned with the entity's items: its main metas (and the rest
 *  counted), every expense type by clasificador code (largest first) and funding sources (rubro). */
type Detalle = { m: [string, number, number][]; mo?: Resto; e: [string, number, number][]; f: [string, number, number][] };
type Clasificador = {
  especificas: Record<string, [string, string | null]>; rubros: Record<string, string>;
  /** "2.3" -> "Bienes y servicios" */ genericas?: Record<string, string>;
  /** catch-all expense types ("Servicios diversos", "Otros bienes"…) */ genericos?: string[];
};

/** Expense types shown before "Otros N tipos de gasto" opens the rest. */
const VISIBLES = 6;

const pedidos = new Map<string, Promise<unknown>>();
function cargar<T>(ruta: string): Promise<T | null> {
  if (!pedidos.has(ruta)) {
    pedidos.set(ruta, fetch(urlDatos(ruta)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return pedidos.get(ruta) as Promise<T | null>;
}
const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString("es-PE")} ${n === 1 ? uno : varios}`;
const parte = (v: number | null | undefined, total: number | null | undefined) =>
  total && v != null ? Math.max(0, Math.min(1, v / total)) : null;
const pct = (v: number | null) => (v == null ? "—" : v > 0 && v < 0.01 ? "menos del 1%" : `${Math.round(v * 100)}%`);

/** An entity's largest activities and projects in one función, fetched from its data file the first
 *  time the <details> row opens (kept out of the page: 2,900 pages × 12 rows). They hang from the
 *  función as a tree, and what the list leaves out is counted, so the parts add up to the whole.
 *  contratos / ordenes: the unit has SEACE contracts / purchase orders, so each detail can show the
 *  ones behind its spending. */
export function ItemsAlAbrir({ sec, codigo, nombre, total, esperado, contratos = false, ordenes = false }: {
  sec: string; codigo: string; nombre: string; total?: number | null; esperado?: number | null; contratos?: boolean; ordenes?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [datos, setDatos] = useState<{ items: Item[]; resto: Resto | null } | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const det = ref.current?.closest("details");
    if (!det) return;
    const alCambiar = () => det.open && setAbierto(true);
    alCambiar();
    det.addEventListener("toggle", alCambiar);
    return () => det.removeEventListener("toggle", alCambiar);
  }, []);
  useEffect(() => {
    if (abierto && !datos) {
      cargar<{ items?: Record<string, Item[]>; items_resto?: Record<string, Resto> }>(`entidad/${sec}.json`)
        .then((d) => setDatos({ items: d?.items?.[codigo] ?? [], resto: d?.items_resto?.[codigo] ?? null }));
    }
  }, [abierto, datos, sec, codigo]);

  const items = datos?.items;
  return (
    <div ref={ref}>
      {abierto && !datos ? <p className="explica cargando">Cargando…</p> : null}
      {items?.length ? (
        <>
          <h4 className="panel-titulo">En qué lo usa: actividades y obras de «{nombre}»</h4>
          <ol className="items arbol">
            {items.map((i, k) => (
              <li key={`${i.tipo}-${i.nombre}-${k}`} className={i.sd ? "sin-desc" : ""}>
                <div className="item-cab">
                  <span className={`etiqueta-tipo ${i.tipo}`}>{i.tipo === "proyecto" ? "Obra / proyecto" : "Actividad"}</span>
                  {i.nombre?.trim()
                    ? <span className="item-nombre">{fmtNombre(i.nombre)}</span>
                    : <span className="item-nombre sin-nombre">Sin nombre en los datos del MEF</span>}
                  {i.sd ? <span className="badge sin-descripcion">Sin descripción</span> : null}
                </div>
                {total && i.pim ? <span className="item-cuota">{pct(parte(i.pim, total))} de «{nombre}»</span> : null}
                <MontoPar pim={i.pim} devengado={i.devengado} esperado={esperado} compacto />
                <DetalleItem sec={sec} codigo={codigo} k={k} nombre={i.nombre?.trim() ? fmtNombre(i.nombre) : "esta línea"}
                             sinDescripcion={!!i.sd} cui={i.cui ?? null} contratos={contratos} ordenes={ordenes} pim={i.pim} />
              </li>
            ))}
            {datos?.resto ? (
              <li className="items-resto">
                Y {plural(datos.resto[0], "actividad u obra más pequeña", "actividades u obras más pequeñas")}:{" "}
                <b>{fmtSoles(datos.resto[1])}</b>{total ? ` (${pct(parte(datos.resto[1], total))} de «${nombre}»)` : ""}.
              </li>
            ) : null}
          </ol>
        </>
      ) : null}
      {datos && !items?.length ? <p className="explica-nota">No hay actividades ni obras con nombre en esta área.</p> : null}
    </div>
  );
}

function DetalleItem({ sec, codigo, k, nombre, sinDescripcion, cui, contratos, ordenes, pim }: {
  sec: string; codigo: string; k: number; nombre: string; sinDescripcion: boolean; cui: string | null; contratos: boolean;
  ordenes: boolean; pim: number | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<{ d: Detalle | null; c: Clasificador | null } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (abierto && !datos) {
      Promise.all([cargar<Record<string, Detalle[]>>(`detalle/${sec}.json`), cargar<Clasificador>("clasificador.json")])
        .then(([d, c]) => setDatos({ d: d?.[codigo]?.[k] ?? null, c }));
    }
  }, [abierto, datos, sec, codigo, k]);
  const cerrar = () => {
    setAbierto(false);
    const b = boton.current;
    if (b && b.getBoundingClientRect().top < 60) b.scrollIntoView({ block: "center" });
    b?.focus({ preventScroll: true });
  };
  return (
    <>
      <button ref={boton} type="button" className="enlace-explicar abre" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? "Ocultar el detalle" : sinDescripcion ? "¿Qué se sabe de este presupuesto?" : "¿En qué exactamente?"}
        <ChevronDown className="icono-linea" aria-hidden />
      </button>
      {abierto ? (
        !datos ? <p className="explica cargando">Cargando…</p>
          : datos.d && datos.c ? <PanelDetalle d={datos.d} c={datos.c} nombre={nombre} sinDescripcion={sinDescripcion} sec={sec} cui={cui}
                                                contratos={contratos} ordenes={ordenes} pim={pim} cerrar={cerrar} />
            : <p className="explica">No hay más detalle para esta línea.</p>
      ) : null}
    </>
  );
}

/** One part of a whole (a meta, an expense type): its name, its amount, a bar for its share of
 *  the activity and, in words, that share and how much of it is spent. */
function Parte({ nombre, nota, pim, dev, total, children }: {
  nombre: React.ReactNode; nota?: React.ReactNode; pim: number; dev: number; total: number | null; children?: React.ReactNode;
}) {
  const p = parte(pim, total);
  return (
    <li className="parte">
      <div className="parte-cab">
        <span className="parte-nombre">{nombre}</span>
        <span className="parte-monto">{fmtSoles(pim)}</span>
      </div>
      <span className="parte-barra" aria-hidden><span style={{ width: `${(p ?? 0) * 100}%` }} /></span>
      <div className="parte-pie">
        <span>{nota}</span>
        <span>{p != null ? `${pct(p)} del total · ` : ""}{pim ? `${pct(Math.max(0, dev / pim))} gastado` : `gastado ${fmtSoles(dev)}`}</span>
      </div>
      {children}
    </li>
  );
}

function PanelDetalle({ d, c, nombre, sinDescripcion, sec, cui, contratos, ordenes, pim, cerrar }: {
  d: Detalle; c: Clasificador; nombre: string; sinDescripcion: boolean; sec: string; cui: string | null; contratos: boolean;
  ordenes: boolean; pim: number | null; cerrar: () => void;
}) {
  const [explicado, setExplicado] = useState<string | null>(null);
  const [verResto, setVerResto] = useState(false);
  const totalFuentes = d.f.reduce((a, [, p]) => a + p, 0) || 1;
  const total = pim || d.e.reduce((a, [, p]) => a + p, 0) || null;
  const genericos = new Set(c.genericos ?? []);
  // the largest types first; "Otros N tipos" opens the rest, grouped by family (never a lone "otros 1")
  const corte = d.e.length <= VISIBLES + 1 ? d.e.length : VISIBLES;
  const visibles = d.e.slice(0, corte);
  const resto = d.e.slice(corte);
  const restoPim = resto.reduce((a, [, p]) => a + p, 0);
  const restoDev = resto.reduce((a, [, , v]) => a + v, 0);
  const familias = new Map<string, [string, number, number][]>();
  for (const e of resto) {
    const g = e[0].split(".").slice(0, 2).join(".");
    familias.set(g, [...(familias.get(g) ?? []), e]);
  }
  const enGenericos = d.e.filter(([cod]) => genericos.has(cod)).reduce((a, [, p]) => a + p, 0);

  const fila = ([cod, p, v]: [string, number, number]) => {
    const [nom, contexto] = c.especificas[cod] ?? [cod, null];
    return (
      <Parte key={cod} pim={p} dev={v} total={total}
             nombre={<>{nom}<BotonExplicar abierto={explicado === cod} nombre={nom} onClick={() => setExplicado(explicado === cod ? null : cod)} /></>}
             nota={genericos.has(cod)
               ? <span className="generico">Partida genérica{contexto ? ` de «${contexto}»` : ""}: su nombre no dice qué se pagó</span>
               : contexto}>
        {explicado === cod ? <PanelExplicacion dimension="generica" id={cod} soloDefinicion /> : null}
        {contratos && !cui ? <ContratosDeTipo sec={sec} clas={cod} /> : null}
        {ordenes && !cui ? <OrdenesDeTipo sec={sec} clas={cod} /> : null}
      </Parte>
    );
  };

  return (
    <div className="detalle-item">
      <p className="detalle-titulo">Detalle de «{nombre}»</p>
      {sinDescripcion ? (
        <p className="aviso-sd">
          El MEF publica este presupuesto con un código genérico, sin nombre de proyecto ni meta que digan para qué es.
          Lo único público es el tipo de gasto, abajo. La ley permite reservar cierta información (por ejemplo, de defensa
          nacional); aun así, puedes pedir a la entidad la que sí sea pública con la Ley de Transparencia.
        </p>
      ) : null}
      <section className="detalle-gastos">
        <h5>Qué se compra o se paga</h5>
        <ul className="partes">
          {visibles.map(fila)}
          {resto.length ? (
            <li className="parte parte-resto">
              <button type="button" className="parte-abre" aria-expanded={verResto} onClick={() => setVerResto(!verResto)}>
                <span className="parte-cab">
                  <span className="parte-nombre">
                    Otros {plural(resto.length, "tipo de gasto", "tipos de gasto")}
                    <ChevronDown className="icono-linea" aria-hidden />
                  </span>
                  <span className="parte-monto">{fmtSoles(restoPim)}</span>
                </span>
                <span className="parte-barra" aria-hidden><span style={{ width: `${(parte(restoPim, total) ?? 0) * 100}%` }} /></span>
                <span className="parte-pie">
                  <span className="parte-accion">{verResto ? "Ocultarlos" : "Ver cuáles son"}</span>
                  <span>{total ? `${pct(parte(restoPim, total))} del total · ` : ""}{restoPim ? `${pct(Math.max(0, restoDev / restoPim))} gastado` : ""}</span>
                </span>
              </button>
              {verResto ? (
                <div className="partes-resto">
                  {[...familias.entries()].map(([g, filas]) => (
                    <div key={g}>
                      <h6>{c.genericas?.[g] ?? g}</h6>
                      <ul className="partes">{filas.map(fila)}</ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ) : null}
        </ul>
        {total && enGenericos / total >= 0.2 ? (
          <p className="explica-nota">
            El {pct(enGenericos / total)} de este presupuesto está en partidas genéricas («otros», «diversos»): el
            clasificador del MEF no dice en qué se usó. Las órdenes y contratos de la entidad de cada tipo, debajo de
            cada partida, muestran qué se compró.
          </p>
        ) : null}
      </section>
      {d.m.length ? (
        <section className="detalle-metas">
          <h5>Para qué (metas)</h5>
          <ul className="partes">
            {d.m.map(([meta, p, v], i) => (
              <Parte key={i} pim={p} dev={v} total={total}
                     nombre={meta.trim() ? meta : <span className="sin-nombre">Meta sin nombre</span>} />
            ))}
          </ul>
          {d.mo ? <p className="explica-nota">Y {plural(d.mo[0], "meta más", "metas más")}: {fmtSoles(d.mo[1])}.</p> : null}
        </section>
      ) : null}
      {d.f.length ? (
        <section className="detalle-fuentes">
          <h5>De dónde sale el dinero</h5>
          <p className="fuentes">
            {d.f.map(([r, p]) => (
              <span key={r}><b>{c.rubros[r] ?? r}</b> {Math.round((p / totalFuentes) * 100)}% <small>({fmtSoles(p)})</small></span>
            ))}
          </p>
        </section>
      ) : null}
      {(contratos || ordenes) && cui ? (
        <div className="detalle-ancho">
          {contratos ? <ContratosDelProyecto sec={sec} cui={cui} anual={pim} /> : null}
          {ordenes ? <OrdenesDelProyecto sec={sec} cui={cui} /> : null}
        </div>
      ) : null}
      <div className="detalle-ancho detalle-pie">
        <p className="explica-pie">Montos del presupuesto vigente y lo gastado (devengado), según los datos abiertos del MEF.</p>
        <button type="button" className="cerrar-panel" onClick={cerrar}>
          <ChevronUp className="icono-linea" aria-hidden /> Cerrar el detalle
        </button>
      </div>
    </div>
  );
}
