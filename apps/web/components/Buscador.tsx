"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { fmtSoles, fmtPct, fmtNombre, fmtLugar, urlDatos, type DistritoIndice, type EntidadIndex } from "@/lib/types";
import { cargarDatos, type IndiceProveedores } from "@/lib/contratos";
import { urlProducto, unidadLegible, fmtPrecio, type IndiceProductos } from "@/lib/productos";
import { urlProveedor } from "@/components/Contratos";
import { SENAL_OBRA } from "@/components/Obras";
import {
  PARTES_OBRAS, cargarParte, consulta, normalizar, puntaje, urlObra, type Consulta, type FilaObra, type ParteObras,
} from "@/lib/buscar";

type Resultado = { clave: string; href: string; nombre: string; detalle: string; monto?: string; badge?: { texto: string; clase: string } };
type Grupo = { id: string; titulo: string; total: number; filas: Resultado[]; cargando?: string; nota?: string };

const PRIMEROS = 6;
const EJEMPLOS = ["Despacho Presidencial", "Provías Nacional", "Hospital", "Cusco", "Cemento", "Petroperú"];

/** Ranked matches: best tier first, then the largest amount. */
function ordenar<T>(xs: T[], c: Consulta, texto: (x: T) => string, extra: (x: T) => number | null, monto: (x: T) => number) {
  const out: [number, T][] = [];
  for (const x of xs) {
    const p = puntaje(c, texto(x)) ?? extra(x);
    if (p != null) out.push([p, x]);
  }
  return out.sort((a, b) => a[0] - b[0] || monto(b[1]) - monto(a[1])).map(([, x]) => x);
}

/** One search for the whole site: entities, places, projects, suppliers and products. The small
 *  indexes load when the field is first used; the projects (16 parts) and suppliers from the
 *  third letter on. */
export function Buscador() {
  const [q, setQ] = useState("");
  const [pedido, setPedido] = useState(false);
  const [entidades, setEntidades] = useState<EntidadIndex[] | null>(null);
  const [distritos, setDistritos] = useState<DistritoIndice[] | null>(null);
  const [productos, setProductos] = useState<IndiceProductos | null>(null);
  const [proveedores, setProveedores] = useState<IndiceProveedores | null>(null);
  const [partes, setPartes] = useState<(ParteObras & { k: number; n: string[] })[]>([]);
  const [abiertos, setAbiertos] = useState<Record<string, number>>({});
  const campo = useRef<HTMLInputElement>(null);
  const diferida = useDeferredValue(q);
  const c = useMemo(() => consulta(diferida), [diferida]);
  const largo = c.texto.replace(/ /g, "").length;

  // ?q= on arrival (a link from elsewhere, the back button); the field keeps the URL in step
  useEffect(() => {
    const inicial = new URLSearchParams(window.location.search).get("q")?.trim();
    if (inicial) { setQ(inicial); setPedido(true); } else campo.current?.focus();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const url = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : window.location.pathname;
      window.history.replaceState(null, "", url);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!pedido || entidades) return;
    cargarDatos<EntidadIndex[]>(urlDatos("entidades.json")).then((x) => setEntidades(x ?? []));
    cargarDatos<DistritoIndice[]>(urlDatos("localidad/distritos.json")).then((x) => setDistritos(x ?? []));
    cargarDatos<IndiceProductos>(urlDatos("productos/indice.json")).then((x) => setProductos(x ?? { total: 0, p: [] }));
  }, [pedido, entidades]);
  const grande = largo >= 3;
  useEffect(() => {
    if (!grande || proveedores) return;
    cargarDatos<IndiceProveedores>(urlDatos("proveedores/indice.json")).then((x) => setProveedores(x ?? { total: 0, desde_ano: 0, p: [] }));
    for (let k = 0; k < PARTES_OBRAS; k++) {
      cargarParte(k).then((x) => {
        if (!x) return;
        const n = x.o.map((r) => normalizar(r[2]));
        setPartes((ps) => (ps.some((p) => p.k === k) ? ps : [...ps, { ...x, k, n }]));
      });
    }
  }, [grande, proveedores]);

  // normalized once per index, not per keystroke
  const ents = useMemo(() => (entidades ?? []).map((e) => ({
    e, n: normalizar(e.nombre), x: normalizar(`${e.nombre} ${e.pliego ?? ""} ${e.dist ?? ""} ${e.prov ?? ""} ${e.dept ?? ""}`),
  })), [entidades]);
  const lugares = useMemo(() => {
    const out: { tipo: 0 | 1 | 2; nombre: string; n: string; href: string; detalle: string }[] = [];
    const vistos = new Set<string>();
    for (const d of distritos ?? []) {
      const dep = d.u.slice(0, 2), prov = d.u.slice(0, 4);
      if (d.r && !vistos.has(dep)) {
        vistos.add(dep);
        out.push({ tipo: 0, nombre: d.r, n: normalizar(d.r), href: `/localidad/${dep}/`, detalle: "Región" });
      }
      if (!vistos.has(prov)) {
        vistos.add(prov);
        out.push({ tipo: 1, nombre: d.p, n: normalizar(d.p), href: `/localidad/${dep}/${d.u.slice(2, 4)}/`,
                   detalle: `Provincia · ${fmtLugar(d.r ?? "")}` });
      }
      out.push({ tipo: 2, nombre: d.d, n: normalizar(d.d),
                 href: d.s ? `/entidad/${d.s}/` : `/localidad/${dep}/${d.u.slice(2, 4)}/#d${d.u}`,
                 detalle: `Distrito · ${d.d === d.p ? "capital de la provincia" : `provincia de ${fmtLugar(d.p)}`}, ${fmtLugar(d.r ?? "")}` });
    }
    return out;
  }, [distritos]);
  const prods = useMemo(() => (productos?.p ?? []).map((p) => ({ p, n: normalizar(p[1]) })), [productos]);
  const provs = useMemo(() => (proveedores?.p ?? []).map((p) => ({ p, n: normalizar(p[1]) })), [proveedores]);

  const grupos: Grupo[] = useMemo(() => {
    if (largo < 2) return [];
    const digitos = /^\d+$/.test(c.texto) ? c.texto : null;
    const gs: Grupo[] = [];

    const es = ordenar(ents, c, (x) => x.n, (x) => (puntaje(c, x.x) != null ? 3 : null), (x) => x.e.pim ?? 0);
    gs.push({
      id: "entidades", titulo: "Entidades", total: es.length, cargando: entidades ? undefined : "Cargando entidades…",
      filas: es.map(({ e }) => ({
        clave: e.sec_ejec, href: `/entidad/${e.sec_ejec}/`, nombre: fmtLugar(e.nombre),
        detalle: [e.nivel ? fmtNombre(e.nivel) : null, e.pliego && e.pliego !== e.nombre ? fmtLugar(e.pliego) : null,
                  e.dist ? fmtLugar(e.dist) : e.dept ? fmtLugar(e.dept) : null].filter(Boolean).join(" · "),
        monto: e.pim ? fmtSoles(e.pim) : undefined,
      })),
    });

    const ls = ordenar(lugares, c, (x) => x.n, () => null, (x) => -x.tipo);
    gs.push({
      id: "lugares", titulo: "Lugares", total: ls.length, cargando: distritos ? undefined : "Cargando lugares…",
      filas: ls.map((l) => ({ clave: l.href, href: l.href, nombre: fmtLugar(l.nombre), detalle: l.detalle })),
    });

    if (largo >= 3) {
      const todas: { r: FilaObra; p: ParteObras; s: number }[] = [];
      for (const p of partes) {
        p.o.forEach((r, i) => {
          const s = digitos ? (r[0] === digitos ? 0 : r[0].startsWith(digitos) ? 1 : null) : puntaje(c, p.n[i]);
          if (s != null) todas.push({ r, p, s });
        });
      }
      todas.sort((a, b) => a.s - b.s || (b.r[5] ?? 0) - (a.r[5] ?? 0));
      gs.push({
        id: "obras", titulo: "Obras y proyectos", total: todas.length,
        cargando: partes.length < PARTES_OBRAS ? `Buscando en las obras (${partes.length} de ${PARTES_OBRAS} partes)…` : undefined,
        nota: "Proyectos de inversión con presupuesto o gasto este año. Búscalos también por su CUI.",
        filas: todas.map(({ r, p }) => {
          const [cui, sec, nombre, , d, pim, dev, , , senal] = r;
          const s = senal ? SENAL_OBRA[senal] : undefined;
          return {
            clave: `${sec}-${cui}`, href: urlObra(sec, cui), nombre: fmtNombre(nombre),
            detalle: [p.e[sec] ? fmtLugar(p.e[sec]) : null, d != null ? fmtLugar(p.d[d][1]) : null,
                      pim ? `${fmtPct((dev ?? 0) / pim)} gastado` : null, `CUI ${cui}`].filter(Boolean).join(" · "),
            monto: pim ? fmtSoles(pim) : undefined, badge: s,
          };
        }),
      });

      const ps = ordenar(provs, c, (x) => x.n, (x) => (digitos && x.p[0].startsWith(digitos) ? 0 : null), (x) => x.p[3] ?? 0);
      const filas: Resultado[] = ps.map(({ p: [id, nombre, n, monto, unidades] }) => ({
        clave: id, href: urlProveedor(id), nombre: nombre ?? id,
        detalle: `${/^\d{11}$/.test(id) ? `RUC ${id} · ` : ""}${n.toLocaleString("es-PE")} ${n === 1 ? "contrato" : "contratos"} con ${unidades.toLocaleString("es-PE")} ${unidades === 1 ? "entidad" : "entidades"}`,
        monto: monto ? fmtSoles(monto) : undefined,
      }));
      if (digitos && /^(\d{8}|\d{11})$/.test(digitos) && !filas.some((f) => f.clave === digitos)) {
        filas.unshift({ clave: digitos, href: urlProveedor(digitos), nombre: `Proveedor con RUC o DNI ${digitos}`, detalle: "Sus contratos con el Estado, si los tiene" });
      }
      gs.push({
        id: "proveedores", titulo: "Proveedores", total: filas.length,
        cargando: proveedores ? undefined : "Cargando proveedores…",
        nota: proveedores ? `Entre los ${proveedores.p.length.toLocaleString("es-PE")} con más contratos; escribe un RUC para ver cualquier otro.` : undefined,
        filas,
      });
    }

    const pr = ordenar(prods, c, (x) => x.n, () => null, (x) => x.p[5]);
    gs.push({
      id: "productos", titulo: "Productos y precios", total: pr.length, cargando: productos ? undefined : "Cargando productos…",
      filas: pr.map(({ p: [id, nombre, unidad, precio, n] }) => ({
        clave: id, href: urlProducto(id), nombre: nombre ? fmtNombre(nombre) : id,
        detalle: `${n.toLocaleString("es-PE")} compras · precio usual ${fmtPrecio(precio)} por ${unidadLegible(unidad)}`,
      })),
    });
    return gs;
  }, [c, largo, ents, lugares, partes, provs, prods, entidades, distritos, productos, proveedores]);

  const hay = grupos.some((g) => g.total);
  const cargando = grupos.some((g) => g.cargando);
  return (
    <>
      <div className="buscar-campo">
        <Search className="buscar-lupa" aria-hidden />
        <input ref={campo} type="search" className="buscador" value={q} autoComplete="off" enterKeyHint="search"
               aria-label="Buscar en el presupuesto" aria-describedby="buscar-estado"
               placeholder="Entidad, obra, proveedor…"
               onFocus={() => setPedido(true)} onChange={(e) => { setPedido(true); setQ(e.target.value); setAbiertos({}); }} />
      </div>
      <p id="buscar-estado" className="sr-only" aria-live="polite">
        {largo >= 2 && !cargando ? `${grupos.reduce((a, g) => a + g.total, 0)} resultados` : ""}
      </p>

      {largo < 2 ? (
        <div className="buscar-inicio">
          <p className="explica-nota">Prueba con:</p>
          <div className="buscar-ejemplos">
            {EJEMPLOS.map((e) => (
              <button key={e} type="button" className="tab" onClick={() => { setPedido(true); setQ(e); }}>{e}</button>
            ))}
          </div>
          <p className="buscar-explorar">
            ¿Prefieres recorrer las listas? <Link href="/explorar/">Explorar por función, región o entidad</Link>
            {" · "}<Link href="/mapa/">Mapa de obras</Link>{" · "}<Link href="/proveedores/">Proveedores</Link>
            {" · "}<Link href="/productos/">Precios</Link>
          </p>
        </div>
      ) : (
        <>
          {grupos.map((g) => {
            const ver = abiertos[g.id] ?? PRIMEROS;
            if (!g.total && !g.cargando) return null;
            return (
              <section key={g.id} className="buscar-grupo" aria-labelledby={`g-${g.id}`}>
                <h2 id={`g-${g.id}`}>{g.titulo} {g.total ? <span className="buscar-cuenta">{g.total.toLocaleString("es-PE")}</span> : null}</h2>
                {g.filas.length ? (
                  <ul className="busca-resultados">
                    {g.filas.slice(0, ver).map((r) => (
                      <li key={r.clave}>
                        <Link href={r.href}>
                          <span className="nombre">{r.nombre}{r.badge ? <span className={`badge ${r.badge.clase}`}>{r.badge.texto}</span> : null}</span>
                          <span className="detalle">{r.detalle}</span>
                        </Link>
                        {r.monto ? <span className="buscar-monto">{r.monto}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {g.cargando ? <p className="explica-nota buscar-cargando">{g.cargando}</p> : null}
                {g.total > ver ? (
                  <button type="button" className="tab buscar-mas" onClick={() => setAbiertos((a) => ({ ...a, [g.id]: ver + 20 }))}>
                    Ver {Math.min(20, g.total - ver)} más de {g.total.toLocaleString("es-PE")}
                  </button>
                ) : null}
                {g.nota && g.total ? <p className="explica-nota">{g.nota}</p> : null}
              </section>
            );
          })}
          {!hay && !cargando ? (
            <p className="busca-vacio">
              Nada coincide con «{q.trim()}». Prueba con menos palabras, sin tildes o con el nombre oficial (por ejemplo
              «ministerio de salud» en vez de una sigla poco común).
            </p>
          ) : null}
          <section className="buscar-grupo">
            <h2>En las categorías del presupuesto</h2>
            <p className="buscar-explorar">
              <Link href={`/comparar/funcion/?q=${encodeURIComponent(q.trim())}`}>«{q.trim()}» entre las funciones</Link>
              {" · "}
              <Link href={`/comparar/generica/?q=${encodeURIComponent(q.trim())}`}>entre los tipos de gasto</Link>
              <span className="explica-nota"> — cuánto cambió cada una y qué subió o bajó adentro.</span>
            </p>
          </section>
        </>
      )}
    </>
  );
}
