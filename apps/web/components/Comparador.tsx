"use client";

import { useMemo, useState } from "react";
import type { ComparacionDimension, ComparacionResumen, Medida, NodoComparacion } from "@/lib/types";
import { fmtSoles, fmtDelta, fmtVariacion, fmtFecha, corteDatos, DIMENSIONES_EXPLICADAS } from "@/lib/types";
import { BotonExplicar, PanelExplicacion } from "@/components/Explicacion";
import { SeguirBoton } from "@/components/SeguirBoton";

type Modo = "aprobado" | "publicacion" | "anual";
type Orden = "cambio" | "monto";

/** "Cambio fuerte" uses the same bars as the pipeline's alert rules (pipeline/alerts.py),
 *  so what is highlighted here is what the alert feed reports. */
const UMBRAL: Record<Modo, { pct: number; soles: number }> = {
  aprobado: { pct: 0.1, soles: 100e6 },
  publicacion: { pct: 0.05, soles: 100e6 },
  anual: { pct: 0.1, soles: 100e6 },
};

/** Top-level rows that can be followed in /seguimiento (pipeline exportar._temas + localidad). */
const SEGUIBLE: Record<string, boolean> = { funcion: true, etiqueta: true, departamento: true };

/** accent-insensitive match: "educacion" finds "EDUCACIÓN" */
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Comparador({ data, resumen }: { data: ComparacionDimension; resumen: ComparacionResumen }) {
  const ant = resumen.publicacion_anterior;
  const corte = corteDatos(resumen.mes_ult, resumen.publicacion.fecha, resumen.ano);
  const modos = useMemo(() => {
    const m: { id: Modo; etiqueta: string; antes: Medida; despues: Medida; rotuloAntes: string;
               rotuloDespues: string; contexto: string; disponible: boolean }[] = [
      { id: "aprobado", etiqueta: "Desde la aprobación", antes: "pia", despues: "pim",
        rotuloAntes: "Aprobado (PIA)", rotuloDespues: "Vigente (PIM)", disponible: true,
        contexto: `Cuánto cambió cada rubro desde que el Congreso aprobó el presupuesto ${resumen.ano} hasta la publicación del MEF del ${fmtFecha(resumen.publicacion.fecha)}.` },
      { id: "publicacion", etiqueta: "Última actualización", antes: "pim_pub_ant", despues: "pim",
        rotuloAntes: ant ? `PIM al ${fmtFecha(ant.fecha)}` : "PIM anterior",
        rotuloDespues: `PIM al ${fmtFecha(resumen.publicacion.fecha)}`, disponible: !!ant,
        contexto: ant
          ? `Qué cambió entre la publicación del MEF del ${fmtFecha(ant.fecha)} y la del ${fmtFecha(resumen.publicacion.fecha)}.`
          : "Disponible desde la segunda actualización del MEF que procesemos." },
      { id: "anual", etiqueta: resumen.ano_anterior ? `Frente a ${resumen.ano_anterior.ano}` : "Año anterior",
        antes: "pia_ano_ant", despues: "pia",
        rotuloAntes: `Aprobado ${resumen.ano - 1}`, rotuloDespues: `Aprobado ${resumen.ano}`, disponible: !!resumen.ano_anterior,
        contexto: `Presupuesto aprobado (PIA) de ${resumen.ano} frente al de ${resumen.ano - 1}, y gasto ejecutado de enero ${corte} de cada año. Soles corrientes: no descuentan la inflación.` },
    ];
    return m;
  }, [resumen, ant, corte]);

  const [modoId, setModoId] = useState<Modo>(ant ? "publicacion" : "aprobado");
  const [orden, setOrden] = useState<Orden>("cambio");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState("");
  const [explicado, setExplicado] = useState<string | null>(null);
  const explicable = DIMENSIONES_EXPLICADAS.has(data.dimension);
  const modo = modos.find((m) => m.id === modoId)!;

  const delta = (n: NodoComparacion) => (n[modo.despues] ?? 0) - (n[modo.antes] ?? 0);
  const fuerte = (n: NodoComparacion) => {
    const a = n[modo.antes], d = delta(n);
    return !!a && Math.abs(d) >= UMBRAL[modoId].soles && Math.abs(d) / Math.abs(a) >= UMBRAL[modoId].pct;
  };
  const ordenar = (ns: NodoComparacion[]) =>
    [...ns].sort((x, y) => orden === "cambio"
      ? Math.abs(delta(y)) - Math.abs(delta(x))
      : (y[modo.despues] ?? 0) - (x[modo.despues] ?? 0));

  const { hijos, porId } = useMemo(() => {
    const hijos = new Map<string | null, NodoComparacion[]>();
    const porId = new Map<string, NodoComparacion>();
    for (const n of data.nodos) {
      porId.set(n.id, n);
      const k = n.nivel === 1 ? null : n.padre;
      hijos.set(k, [...(hijos.get(k) ?? []), n]);
    }
    return { hijos, porId };
  }, [data.nodos]);

  const raiz = ordenar(hijos.get(null) ?? []);
  const q = norm(busqueda.trim());
  const resultados = q
    ? ordenar(data.nodos.filter((n) => norm(n.nombre).includes(q))).slice(0, 100)
    : null;

  const ruta = (n: NodoComparacion) => {
    const partes: string[] = [];
    for (let p = n.padre ? porId.get(n.padre) : undefined; p; p = p.padre ? porId.get(p.padre) : undefined) {
      partes.unshift(p.nombre);
    }
    return partes.join(" › ");
  };
  const alternar = (id: string) =>
    setAbiertos((s) => { const t = new Set(s); t.has(id) ? t.delete(id) : t.add(id); return t; });

  // plain-language reading of the top level
  const sube = raiz.filter((n) => delta(n) > 0).sort((x, y) => delta(y) - delta(x))[0];
  const baja = raiz.filter((n) => delta(n) < 0).sort((x, y) => delta(x) - delta(y))[0];

  const fila = (n: NodoComparacion, profundidad: number, conRuta = false): JSX.Element => {
    const d = delta(n);
    const hs = hijos.get(n.id) ?? [];
    const abierto = abiertos.has(n.id);
    const maxHermanos = Math.max(...(hijos.get(n.nivel === 1 ? null : n.padre) ?? [n]).map((x) => Math.abs(delta(x))), 1);
    return (
      <li key={n.id}>
        <div className="cmp-fila" style={{ paddingLeft: conRuta ? 0 : (profundidad - 1) * 16 }}>
          {hs.length && !conRuta ? (
            <button className="cmp-toggle" aria-expanded={abierto} aria-label={`${abierto ? "Cerrar" : "Abrir"} ${n.nombre}`}
                    onClick={() => alternar(n.id)}>{abierto ? "▾" : "▸"}</button>
          ) : <span className="cmp-toggle vacio-toggle" aria-hidden />}
          <div className="cmp-cuerpo">
            <div className="linea1">
              <span className="nombre">
                {n.nombre}
                {explicable ? (
                  <BotonExplicar abierto={explicado === n.id} nombre={n.nombre}
                                 onClick={() => setExplicado(explicado === n.id ? null : n.id)} />
                ) : null}
                {fuerte(n) ? <span className="badge alta" style={{ marginLeft: 8 }}>cambio fuerte</span> : null}
                {n.nivel === 1 && SEGUIBLE[data.dimension] ? (
                  <SeguirBoton compacto item={data.dimension === "departamento"
                    ? { tipo: "departamento", id: n.id, nombre: n.nombre }
                    : { tipo: "tema", id: n.id, nombre: n.nombre, dimension: data.dimension }} />
                ) : null}
              </span>
              <span className={`cmp-delta ${d > 0 ? "sube" : d < 0 ? "baja" : ""}`}>
                {fmtDelta(d)} <small>{fmtVariacion(n[modo.antes], n[modo.despues])}</small>
              </span>
            </div>
            <div className={`cmp-barra ${d < 0 ? "baja" : ""}`}><div style={{ width: `${(Math.abs(d) / maxHermanos) * 100}%` }} /></div>
            <div className="detalle">
              <span>{conRuta ? ruta(n) || data.niveles[0] : data.niveles[n.nivel - 1]}</span>
              <span>{fmtSoles(n[modo.antes])} → {fmtSoles(n[modo.despues])}</span>
            </div>
            {modoId === "anual" && (n.dev_ano_ant_periodo != null || n.devengado != null) ? (
              <div className="detalle">
                <span>Ejecutado {corte}</span>
                <span>{fmtSoles(n.dev_ano_ant_periodo)} → {fmtSoles(n.devengado)} ({fmtVariacion(n.dev_ano_ant_periodo, n.devengado)})</span>
              </div>
            ) : null}
          </div>
        </div>
        {explicado === n.id ? <PanelExplicacion dimension={data.dimension} id={n.id} /> : null}
        {abierto && !conRuta ? <ul className="cmp-lista">{ordenar(hs).map((h) => fila(h, profundidad + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Tipo de comparación">
        {modos.map((m) => (
          <button key={m.id} role="tab" aria-selected={m.id === modoId} disabled={!m.disponible}
                  className={`tab ${m.id === modoId ? "activo" : ""}`} onClick={() => setModoId(m.id)}
                  title={m.disponible ? undefined : m.contexto}>
            {m.etiqueta}
          </button>
        ))}
      </div>
      <p className="sub" style={{ fontSize: 13.5 }}>{modo.contexto}</p>

      {!busqueda && (sube || baja) ? (
        <div className="lectura warn" style={{ background: "var(--fondo)", color: "var(--texto)", border: "1px solid var(--borde)" }}>
          <strong aria-hidden>≈</strong>
          <span>
            {sube ? <>Lo que más creció: <b>{sube.nombre}</b> ({fmtDelta(delta(sube))}, {fmtVariacion(sube[modo.antes], sube[modo.despues])}). </> : null}
            {baja ? <>Lo que más se redujo: <b>{baja.nombre}</b> ({fmtDelta(delta(baja))}, {fmtVariacion(baja[modo.antes], baja[modo.despues])}).</> : null}
          </span>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="buscador" style={{ flex: "1 1 220px" }} value={busqueda}
               onChange={(e) => setBusqueda(e.target.value)}
               placeholder={`Buscar en ${data.titulo.toLowerCase()}… (p. ej. educación)`} aria-label="Buscar" />
        <select className="buscador" style={{ width: "auto" }} value={orden}
                onChange={(e) => setOrden(e.target.value as Orden)} aria-label="Ordenar">
          <option value="cambio">Ordenar por tamaño del cambio</option>
          <option value="monto">Ordenar por monto</option>
        </select>
      </div>

      <div className="tarjeta">
        <div className="detalle cmp-cabecera">
          <span>{busqueda ? `${resultados?.length ?? 0} resultados` : data.niveles.join(" › ")}</span>
          <span>{modo.rotuloAntes} → {modo.rotuloDespues}</span>
        </div>
        {resultados ? (
          resultados.length ? <ul className="cmp-lista">{resultados.map((n) => fila(n, 1, true))}</ul>
            : <div className="vacio">Nada coincide con “{busqueda}”.</div>
        ) : raiz.length ? (
          <ul className="cmp-lista">{raiz.map((n) => fila(n, 1))}</ul>
        ) : (
          <div className="vacio">Sin datos para esta comparación todavía.</div>
        )}
      </div>
    </>
  );
}
