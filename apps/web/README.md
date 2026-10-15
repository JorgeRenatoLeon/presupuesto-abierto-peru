# Web — Presupuesto Abierto Perú

Next.js 14 (App Router, TypeScript, static export). No UI framework — hand-rolled CSS + SVG charts, zero chart dependencies.

## Run locally

```bash
# 1. Make sure the pipeline has produced data (data/serving/json at repo root)
cd ../../pipeline && python run.py update --force   # or: normalize --local-file <extract.csv>

# 2. Dev server (data sync runs automatically via predev)
cd ../apps/web
npm install
npm run dev                  # http://localhost:3000

# 3. Production build (static export to ./out; sync runs automatically)
npm run build
npm run serve                # serve the exported site locally
```

Troubleshooting "no data showing":

1. Restart the dev server (Ctrl+C, `npm run dev`) — data is read at render time, but a server started before the pipeline finished may show cached empty pages; hard-refresh the browser (Cmd+Shift+R).
2. If you're serving `out/`, rebuild first — `out/` is a snapshot from build time.
3. Data resolution order: `PRESUPUESTO_DATA_DIR` env var → `public/data/` → `../../data/serving/json/` (pipeline output). Empty placeholder files are ignored, so dev works even without syncing.

## Pages

- `/` — national overview: KPIs (PIM, devengado, avance vs calendario, PIA), monthly chart, top funciones, latest alerts
- `/explorar` — tabs por función / departamento / entidad, with search
- `/comparar` — what changed: since approval (PIA→PIM), since the previous MEF publication, vs last year
- `/comparar/[dimension]` — función, generica, etiqueta (temas), departamento, nivel: drill-down tree with search
- `/entidad/[id]` — one page per entity (statically generated from `public/data/entidad/*.json`)
- `/alertas` — filterable alert feed with share/copy actions
- `/guia` — citizen-language budget guide (PIA→PIM→devengado journey, FAQ)
- `/metodologia` — sources, refresh cadence, limitations

## Data contract

Everything under `public/data/` is produced by the pipeline (`data/serving/json/`):
`resumen_anual`, `serie_nacional`, `por_funcion`, `por_departamento`, `top_entidades`,
`entidades`, `entidad/<sec_ejec>`, `alertas`, `meta`, `comparar/{resumen,funcion,generica,etiqueta,departamento,nivel}`.
A build without data works (empty states + placeholder pages), which is what CI checks.

Deploy: GitHub Pages via `.github/workflows/refresh-data.yml` (sets `BASE_PATH` for project sites).
Any static host works (`apps/web/out`).
