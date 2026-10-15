# Graph Report - .  (2026-09-27)

## Corpus Check
- Corpus is ~15,643 words - fits in a single context window. You may not need a graph.

## Summary
- 235 nodes · 410 edges · 19 communities (16 shown, 3 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Alertas UI|Alertas UI]]
- [[_COMMUNITY_QA y Validacion|QA y Validacion]]
- [[_COMMUNITY_Configuracion TypeScript|Configuracion TypeScript]]
- [[_COMMUNITY_Pipeline Configuracion|Pipeline Configuracion]]
- [[_COMMUNITY_Normalizacion CSV|Normalizacion CSV]]
- [[_COMMUNITY_Dependencias Web|Dependencias Web]]
- [[_COMMUNITY_Documentacion Presupuesto|Documentacion Presupuesto]]
- [[_COMMUNITY_Agregacion Serving|Agregacion Serving]]
- [[_COMMUNITY_Orquestacion Pipeline|Orquestacion Pipeline]]
- [[_COMMUNITY_Explorador UI|Explorador UI]]
- [[_COMMUNITY_Motor de Alertas|Motor de Alertas]]
- [[_COMMUNITY_Navegacion Web|Navegacion Web]]
- [[_COMMUNITY_Guia de Usuario|Guia de Usuario]]
- [[_COMMUNITY_Pruebas de Alertas|Pruebas de Alertas]]
- [[_COMMUNITY_Sincronizacion Datos|Sincronizacion Datos]]
- [[_COMMUNITY_Permisos Locales|Permisos Locales]]
- [[_COMMUNITY_Identidad Visual|Identidad Visual]]
- [[_COMMUNITY_Configuracion Next.js|Configuracion Next.js]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `load()` - 13 edges
3. `main()` - 11 edges
4. `download()` - 10 edges
5. `normalize()` - 10 edges
6. `Report` - 10 edges
7. `fmtSoles()` - 9 edges
8. `latestYear()` - 9 edges
9. `catalog()` - 9 edges
10. `fmtPct()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `aggregate()`  [INFERRED]
  pipeline/run.py → pipeline/aggregate.py
- `main()` --calls--> `compute_alerts()`  [INFERRED]
  pipeline/run.py → pipeline/alerts.py
- `main()` --calls--> `catalog()`  [INFERRED]
  pipeline/run.py → pipeline/download.py
- `main()` --calls--> `download()`  [INFERRED]
  pipeline/run.py → pipeline/download.py
- `main()` --calls--> `normalize()`  [INFERRED]
  pipeline/run.py → pipeline/normalize.py

## Import Cycles
- None detected.

## Communities (19 total, 3 thin omitted)

### Community 0 - "Alertas UI"
Cohesion: 0.10
Nodes (39): AlertasPage(), metadata, Home(), AlertaCard(), FiltroAlertas(), REGLAS, GraficoContraste(), GraficoMensual() (+31 more)

### Community 1 - "QA y Validacion"
Cohesion: 0.20
Nodes (16): float, _coherence(), _db(), _fetch(), _has_table(), _match(), _page_numbers(), bool (+8 more)

### Community 2 - "Configuracion TypeScript"
Cohesion: 0.10
Nodes (20): compilerOptions, allowJs, downlevelIteration, esModuleInterop, incremental, isolatedModules, jsx, lib (+12 more)

### Community 3 - "Pipeline Configuracion"
Cohesion: 0.18
Nodes (17): candidate_files(), ingreso_candidate_files(), int, str, Pipeline configuration: paths, dataset definitions, schema., catalog(), download(), _download_file() (+9 more)

### Community 4 - "Normalizacion CSV"
Cohesion: 0.24
Nodes (17): _csv_columns(), _detect_format(), _detect_ingreso_format(), normalize(), normalize_ingreso(), DuckDBPyConnection, int, Path (+9 more)

### Community 5 - "Dependencias Web"
Cohesion: 0.11
Nodes (17): dependencies, next, react, react-dom, devDependencies, @types/node, @types/react, typescript (+9 more)

### Community 6 - "Documentacion Presupuesto"
Cohesion: 0.22
Nodes (11): Budget ETL pipeline, Budget phase and monthly-versus-annual semantics, Citizen-facing budget exploration UI, Data Dictionary: Gasto e Ingreso Presupuestal, Design notes from paper wireframes to the web app, MEF budget and expenditure open data, Pipeline Python dependencies, Presupuesto Abierto Perú README (+3 more)

### Community 7 - "Agregacion Serving"
Cohesion: 0.31
Nodes (10): aggregate(), _build_ingreso_tables(), _export_entidades(), _export_json(), DuckDBPyConnection, Build the serving layer from Parquet: DuckDB tables + JSON extracts for the web, Small JSON extracts so the web app can render without a DB connection (MVP)., DataFrame -> list of dicts with NaN/NaT converted to None (valid JSON). (+2 more)

### Community 8 - "Orquestacion Pipeline"
Cohesion: 0.27
Nodes (9): main(), CLI orchestrator: python run.py {catalog|download|normalize|aggregate|validate|a, _require_year(), bool, int, Path, Validation: raw CSV vs Parquet vs serving tables must agree., validate() (+1 more)

### Community 9 - "Explorador UI"
Cohesion: 0.29
Nodes (7): Explorador(), Vista, FilaItem, metadata, EntidadIndex, PorDepartamento, PorFuncion

### Community 10 - "Motor de Alertas"
Cohesion: 0.33
Nodes (9): compute_alerts(), _db(), _fmt(), _persist(), DuckDBPyConnection, str, Alert engine — Etapa 1 rules from 'Problemática y Requisitos':  R1 PIM_CAMBIO, R1b: PIM changes between pipeline runs (catches changes the monthly grain misses (+1 more)

### Community 11 - "Navegacion Web"
Cohesion: 0.32
Nodes (4): metadata, BottomNav(), enlaces, TopNav()

### Community 12 - "Guia de Usuario"
Cohesion: 0.40
Nodes (3): FAQ, metadata, PASOS

### Community 13 - "Pruebas de Alertas"
Cohesion: 0.60
Nodes (4): build_synthetic(), main(), Path, Synthetic test: each alert rule must fire on crafted data. Run: python3 test_ale

### Community 14 - "Sincronizacion Datos"
Cohesion: 0.40
Nodes (4): dest, here, required, src

## Knowledge Gaps
- **62 isolated node(s):** `allow`, `metadata`, `ENT_DIR`, `Payload`, `metadata` (+57 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `main()` connect `Orquestacion Pipeline` to `QA y Validacion`, `Pipeline Configuracion`, `Normalizacion CSV`, `Agregacion Serving`, `Motor de Alertas`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Why does `qa()` connect `QA y Validacion` to `Orquestacion Pipeline`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `catalog()` connect `Pipeline Configuracion` to `Orquestacion Pipeline`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `main()` (e.g. with `aggregate()` and `compute_alerts()`) actually correct?**
  _`main()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `allow`, `metadata`, `ENT_DIR` to the rest of the system?**
  _82 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Alertas UI` be split into smaller, more focused modules?**
  _Cohesion score 0.10159651669085631 - nodes in this community are weakly interconnected._
- **Should `Configuracion TypeScript` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._