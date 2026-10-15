# Graphify Report

## Summary
- Nodes: 221
- Relationships: 372
- Remaining inferred relationships: 0
- Refinement: verified direct calls, semantic edge taxonomy, primitive filtering, rationale labels.

## God Nodes
- `types.ts` - 24 connections
- `page.tsx` - 23 connections
- `page.tsx` - 21 connections
- `page.tsx` - 20 connections
- `compilerOptions` - 17 connections
- `load()` - 13 connections
- `data.ts` - 12 connections
- `ui.tsx` - 12 connections
- `page.tsx` - 11 connections
- `Explorador.tsx` - 11 connections

## Relationship Types
- `calls`: 69
- `contains`: 143
- `implements`: 1
- `imports`: 75
- `imports_from`: 24
- `method`: 5
- `rationale_for`: 21
- `re_exports`: 1
- `references`: 31
- `shares_data_with`: 2

## Refinements Applied
- 11 direct pipeline calls promoted to `EXTRACTED` with confidence score `1.0`.
- Data dictionary semantics and icon depiction represented as contextual `references` edges.
- Primitive type-only nodes and their edges removed; meaningful external types retained.
- Rationale labels refreshed from source locations where available.

## Suggested Questions
- How does `pipeline_run_main` orchestrate download, normalization, aggregation, alerts, validation, and QA?
- Which concepts connect the ETL pipeline to the citizen-facing web application?
- Which remaining cross-community relationships are inferred rather than directly extracted?
