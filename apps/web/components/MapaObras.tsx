"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, LayerGroup, Map as Mapa } from "leaflet";
import "leaflet/dist/leaflet.css";
// tile usage: https://operations.osmfoundation.org/policies/tiles/ (attribution, no bulk use)
import { fmtSoles, fmtPct, fmtNombre, fichaInversion, urlDatos, withBase } from "@/lib/types";
import { cargarDatos, plano } from "@/lib/contratos";

/** mapa/indice.json: [department code, name, projects located, with no spending this year] */
type Indice = [string, string, number, number][];
/** [lat, lon, CUI, unit, name, total cost, share spent since it began, physical progress, signal
 *  (1 no spending this year, 2 very low, 3 cut), this year's budget, this year's spending, problem reported] */
type Fila = [number, number, string, string, string, number | null, number | null, number | null, number, number, number, 0 | 1];
type ArchivoMapa = { e: Record<string, string>; p: Fila[] };
type Filtro = "todas" | "sin_gasto" | "problema";

const CENTRO_PERU: [number, number] = [-9.2, -75.0];
const ETIQUETA_FILTRO: Record<Filtro, string> = { todas: "Todas", sin_gasto: "Sin gasto este año", problema: "Con un problema reportado" };

/** Every project of this year's budget that MEF locates, on one map: where it is, what it costs, how
 *  far along it is. Orange: no spending this year (or very little). Loaded per department. */
export function MapaObras() {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<Mapa | null>(null);
  const capa = useRef<LayerGroup | null>(null);
  const [indice, setIndice] = useState<Indice | null>(null);
  const [dep, setDep] = useState<string>("todos");
  const [sec, setSec] = useState<string | null>(null);
  const [datos, setDatos] = useState<Record<string, ArchivoMapa>>({});
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [q, setQ] = useState("");
  const [listo, setListo] = useState(false);

  // ?dep=08 shows a department; ?sec=301289 (with its dep) an entity's projects
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("dep");
    if (d && /^\d{2}$/.test(d)) setDep(d);
    const s = p.get("sec");
    if (s && /^\d{1,6}$/.test(s)) setSec(s);
    cargarDatos<Indice>(urlDatos("mapa/indice.json")).then((i) => setIndice(i ?? []));
  }, []);

  // the map itself: Leaflet only exists in the browser
  useEffect(() => {
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !caja.current || mapa.current) return;
      const m = L.map(caja.current, { preferCanvas: true, zoomControl: true, attributionControl: true }).setView(CENTRO_PERU, 5);
      // OpenStreetMap's own tiles (no key; light use with attribution), darkened in CSS to sit in the page
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, className: "teselas-oscuras",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      capa.current = L.layerGroup().addTo(m);
      mapa.current = m;
      setListo(true);
    });
    return () => { vivo = false; mapa.current?.remove(); mapa.current = null; };
  }, []);

  // the departments' files: the one chosen, or all of them
  useEffect(() => {
    if (!indice) return;
    const deps = dep === "todos" ? indice.map(([d]) => d) : [dep];
    for (const d of deps) {
      if (datos[d]) continue;
      cargarDatos<ArchivoMapa>(urlDatos(`mapa/${d}.json`)).then((x) => x && setDatos((prev) => ({ ...prev, [d]: x })));
    }
  }, [indice, dep, datos]);

  const filas = useMemo(() => {
    const t = plano(q.trim());
    const out: { f: Fila; entidad: string }[] = [];
    for (const [d, x] of Object.entries(datos)) {
      if (dep !== "todos" && d !== dep) continue;
      for (const f of x.p) {
        if (sec && f[3] !== sec) continue;
        if (filtro === "sin_gasto" && f[8] !== 1) continue;
        if (filtro === "problema" && !f[11]) continue;
        if (t && !f[2].startsWith(t) && !plano(f[4]).includes(t)) continue;
        out.push({ f, entidad: x.e[f[3]] ?? "" });
      }
    }
    return out;
  }, [datos, dep, sec, filtro, q]);

  // draw: one circle per project, sized by its total cost, orange when it is not spending
  useEffect(() => {
    if (!listo) return;
    let vivo = true;
    import("leaflet").then((L) => {
      if (!vivo || !capa.current || !mapa.current) return;
      capa.current.clearLayers();
      const marcas: CircleMarker[] = [];
      for (const { f, entidad } of filas) {
        const radio = f[5] ? Math.max(3, Math.min(11, Math.log10(f[5]) - 3)) : 3;
        const parado = f[8] === 1 || f[8] === 2;
        const c = L.circleMarker([f[0], f[1]], {
          radius: radio, weight: 1, color: "#0e0e10", fillOpacity: 0.85,
          fillColor: parado ? "#ff8a00" : "#ffe600",
        });
        c.bindPopup(() => ficha(f, entidad), { maxWidth: 300 });
        marcas.push(c);
        capa.current.addLayer(c);
      }
      if (marcas.length && (sec || dep !== "todos" || q.trim())) {
        // the middle 96% of the points: one project located far away (a typo, a national office) must not
        // shrink the department to a corner
        const lats = filas.map(({ f }) => f[0]).sort((a, b) => a - b), lons = filas.map(({ f }) => f[1]).sort((a, b) => a - b);
        const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
        const borde = filas.length >= 25 ? 0.02 : 0;
        mapa.current.fitBounds([[q(lats, borde), q(lons, borde)], [q(lats, 1 - borde), q(lons, 1 - borde)]], { padding: [24, 24], maxZoom: 13 });
      }
    });
    return () => { vivo = false; };
  }, [filas, listo, sec, dep, q]);

  const total = filas.length;
  const sinGasto = filas.filter(({ f }) => f[8] === 1).length;
  return (
    <div className="mapa-obras">
      <div className="ct-controles mapa-controles">
        <input type="search" className="buscador" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder="Busca una obra por su nombre o CUI" aria-label="Buscar una obra" />
        <select className="buscador" value={dep} onChange={(e) => { setDep(e.target.value); setSec(null); }} aria-label="Departamento">
          <option value="todos">Todo el Perú</option>
          {(indice ?? []).map(([d, nombre, n]) => <option key={d} value={d}>{fmtNombre(nombre)} ({n.toLocaleString("es-PE")})</option>)}
        </select>
        <select className="buscador" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} aria-label="Qué obras">
          {(Object.keys(ETIQUETA_FILTRO) as Filtro[]).map((k) => <option key={k} value={k}>{ETIQUETA_FILTRO[k]}</option>)}
        </select>
      </div>
      <p className="ct-cuenta" aria-live="polite">
        {sec ? `Obras de ${fmtNombre(Object.values(datos).find((x) => x.e[sec])?.e[sec] ?? "la entidad")}: ` : ""}
        {total.toLocaleString("es-PE")} {total === 1 ? "obra" : "obras"} en el mapa
        {sinGasto ? `, ${sinGasto.toLocaleString("es-PE")} sin gasto este año` : ""}
        {sec ? <> · <button type="button" className="enlace-explicar" onClick={() => setSec(null)}>ver todas las del departamento</button></> : null}
      </p>
      <div ref={caja} className="mapa-caja" role="region" aria-label="Mapa de obras" />
      <p className="leyenda-html">
        <span><span className="chip amarillo" aria-hidden />Obra con gasto este año</span>
        <span><span className="chip naranja" aria-hidden />Sin gasto (o casi) este año</span>
        <span>El tamaño del círculo crece con el costo total de la obra. Toca uno para ver su ficha.</span>
      </p>
    </div>
  );
}

/** A project's card in the map's popup, built from text nodes (names come from the data). */
function ficha(f: Fila, entidad: string): HTMLElement {
  const [, , cui, sec, nombre, costo, gastado, fisico, senal, pim, dev, problema] = f;
  const div = document.createElement("div");
  div.className = "mapa-ficha";
  const linea = (tag: string, texto: string, clase?: string) => {
    const el = document.createElement(tag);
    el.textContent = texto;
    if (clase) el.className = clase;
    div.appendChild(el);
    return el;
  };
  linea("strong", fmtNombre(nombre));
  const a = document.createElement("a");
  a.href = withBase(`/entidad/${sec}/#obras`);
  a.textContent = fmtNombre(entidad);
  div.appendChild(a);
  if (costo) linea("span", `Costo total: ${fmtSoles(costo)}${gastado != null ? ` · gastado desde el inicio: ${fmtPct(gastado)}` : ""}`);
  if (fisico != null) linea("span", `Avance físico: ${fmtPct(fisico / 100)}`);
  linea("span", `Este año: ${fmtSoles(dev)} gastado de ${fmtSoles(pim)}`, senal === 1 || senal === 2 ? "parado" : undefined);
  if (problema) linea("span", "La entidad reporta un problema: míralo en su ficha.", "parado");
  const ficha = document.createElement("a");
  ficha.href = fichaInversion(cui);
  ficha.target = "_blank";
  ficha.rel = "noopener";
  ficha.textContent = `Ficha oficial · CUI ${cui} ↗`;
  div.appendChild(ficha);
  return div;
}
