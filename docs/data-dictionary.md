# Data Dictionary — Gasto e Ingreso Presupuestal (MEF)

> Ingresos: see the section at the end. Official ingreso dictionary: `Ingresos_Diccionario_oficial.csv`.

Source: [Presupuesto y Ejecución de Gasto](https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto) · Official dictionary: `Gastos_Diccionario_oficial.csv` (this folder)

## Key semantics (read before querying)

- **Grain**: one row per entidad (SEC_EJEC) × meta (SEC_FUNC) × clasificador de gasto × **month** (`MES_EJE`).
- **Monthly flows** (sum freely across months): `MONTO_COMPROMETIDO`, `MONTO_DEVENGADO`, `MONTO_GIRADO`.
- **Annual stocks** (repeated on every month's rows — never sum across months; use latest month): `MONTO_PIA`, `MONTO_PIM`, `MONTO_CERTIFICADO`, `MONTO_COMPROMETIDO_ANUAL`.
- **Codes are text**: keep leading zeros (`META` = '00001', ubigeo codes, clasificador).
- **Meta/Finalidad** only identifiable combining functional + programmatic structure (see Comentarios 20.04).
- **Hierarchies**:
  - Institutional: NIVEL_GOBIERNO → SECTOR → PLIEGO → EJECUTORA (SEC_EJEC)
  - Functional: FUNCION → DIVISION_FUNCIONAL → GRUPO_FUNCIONAL → META/FINALIDAD
  - Programmatic: PROGRAMA_PPTO → PRODUCTO_PROYECTO → ACTIVIDAD_ACCION_OBRA
  - Financing: FUENTE_FINANCIAMIENTO → RUBRO → TIPO_RECURSO
  - Expense: CATEGORIA_GASTO → GENERICA → SUBGENERICA → SUBGENERICA_DET → ESPECIFICA → ESPECIFICA_DET
- **Budget phases (citizen explanation)**: PIA (initial budget) → PIM (modified budget) → Certificado (reserved) → Comprometido (committed) → **Devengado (goods/services received = real spending)** → Girado (paid out).

## Variables (official)

| Variable | Tipo | Descripción |
|---|---|---|
| `ANO_EJE` | Numérico | Año de ejecución del presupuesto. |
| `MES_EJE` | Numérico | Mes de ejecución del presupuesto. |
| `NIVEL_GOBIERNO` | Carácter | Código (letra) que identifica el Nivel de Gobierno: E, R, M; para Nacional, Regionales y Locales, respectivamente. |
| `NIVEL_GOBIERNO_NOMBRE` | Carácter | Descripción de Nivel de Gobierno: Nacional, Regionales, Locales. |
| `SECTOR` | Carácter | Código de Sector al que pertenece la Entidad. |
| `SECTOR_NOMBRE` | Carácter | Descripción de código del Sector al que pertenece la Entidad. |
| `PLIEGO` | Carácter | Código de Pliego al que pertenece la Entidad. |
| `PLIEGO_NOMBRE` | Carácter | Descripción de código del Pliego al que pertenece la Entidad. |
| `SEC_EJEC` | Carácter | Código que identifica a una Entidad. |
| `EJECUTORA` | Carácter | Código de la cadena institucional que identifica a una Entidad. |
| `EJECUTORA_NOMBRE` | Carácter | Nombre de la Entidad. |
| `DEPARTAMENTO_EJECUTORA` | Carácter | Código de departamento donde se ubica la Entidad. |
| `DEPARTAMENTO_EJECUTORA_NOMBRE` | Carácter | Nombre de departamento donde se ubica la Entidad. |
| `PROVINCIA_EJECUTORA` | Carácter | Código de provincia del departamento donde se ubica la Entidad. |
| `PROVINCIA_EJECUTORA_NOMBRE` | Carácter | Nombre de provincia del departamento donde se ubica la Entidad. |
| `DISTRITO_EJECUTORA` | Carácter | Código de distrito de la provincia del departamento donde se ubica la Entidad. |
| `DISTRITO_EJECUTORA_NOMBRE` | Carácter | Nombre de distrito de la provincia del departamento donde se ubica la Entidad. |
| `SEC_FUNC` | Numérico | Código de meta. |
| `PROGRAMA_PPTO` | Numérico | Código de Programa Presupuestal. |
| `PROGRAMA_PPTO_NOMBRE` | Carácter | Descripción del Programa Presupuestal. |
| `TIPO_ACT_PROY` | Numérico | Código que muestra si es proyecto o producto. |
| `TIPO_ACT_PROY_NOMBRE` | Numérico | Nombre que indica si es proyecto o producto. |
| `PRODUCTO_PROYECTO` | Numérico | Código que identifica a un proyecto o producto. |
| `PRODUCTO_PROYECTO_NOMBRE` | Carácter | Descripción de un proyecto o producto. |
| `ACTIVIDAD_ACCION_OBRA` | Numérico | Código que identifica a una Actividad/Acción de inversioón u obra. |
| `ACTIVIDAD_ACCION_OBRA_NOMBRE` | Carácter | Descripción de una Actividad/Acción de inversión u obra. |
| `FUNCION` | Carácter | Código de Función. |
| `FUNCION_NOMBRE` | Carácter | Corresponde al nivel máximo de agregación de las acciones a tomar, orientadas a la ejecución de un determinado tema. |
| `DIVISION_FUNCIONAL` | Carácter | Código de División Funcional. |
| `DIVISION_FUNCIONAL_NOMBRE` | Carácter | Corresponde al nivel de agregación de las acciones a tomar, orientadas a la ejecución de un determinado tema. |
| `GRUPO_FUNCIONAL` | Carácter | Código de Grupo Funcional. |
| `GRUPO_FUNCIONAL_NOMBRE` | Carácter | Corresponde al tercer nivel de agregación de las acciones a tomar, orientadas a la ejecución de un determinado tema. |
| `META` | Carácter | Secuencial que se incrementará desde '00001' en adelante cada vez que exista para diferentes metas (sec_func) la misma combinación: Función + División Funcional + Grupo Funcional + Producto/Proyecto + Act/AccInv/Obra. Lo diferenciará la Finalidad. |
| `FINALIDAD` | Carácter | Código de Finalidad. |
| `META_NOMBRE` | Carácter | Descripción de la Finalidad. |
| `DEPARTAMENTO_META` | Carácter | Código de Departamento del Ubigeo de la meta. |
| `DEPARTAMENTO_META_NOMBRE` | Carácter | Nombre del departamento del Ubigeo de la meta. |
| `FUENTE_FINANCIAMIENTO` | Carácter | Código de la Fuente de Financimiento que agrupa a uno o más Rubros. |
| `FUENTE_FINANCIAMIENTO_NOMBRE` | Carácter | Descripción de la Fuente de Financiamiento. |
| `RUBRO` | Carácter | Código del Rubro que puede utilizar la Entidad. |
| `RUBRO_NOMBRE` | Carácter | Descripción del Rubro. |
| `TIPO_RECURSO` | Carácter | Código del Tipo de Recurso. |
| `TIPO_RECURSO_NOMBRE` | Carácter | Descripción del Tipo de Recurso. |
| `CATEGORIA_GASTO` | Numérico | Código de la Categoria de Gasto. |
| `CATEGORIA_GASTO_NOMBRE` | Carácter | Descripción de la Categoría de Gasto. |
| `TIPO_TRANSACCION` | Numérico | Número que identifica si es Gasto (2) o Ingreso (1). Para este reporte, siempre se presentará el número 2. |
| `GENERICA` | Numérico | Mayor nivel de agregación de los clasificadores de gasto. |
| `GENERICA_NOMBRE` | Carácter | Descripción de la Genérica. |
| `SUBGENERICA` | Numérico | Es el nivel intermedio de agregación (subgenérica nivel 1) de los clasificadores de gasto. |
| `SUBGENERICA_NOMBRE` | Carácter | Descripción de la subgenérica. |
| `SUBGENERICA_DET` | Numérico | Es el nivel intermedio de agregación (subgenérica nivel 2) de los clasificadores de gasto. |
| `SUBGENERICA_DET_NOMBRE` | Carácter | Descripción de la subgenérica detalle. |
| `ESPECIFICA` | Numérico | Código de Específica nivel 1. Identifica el detalle del gasto. |
| `ESPECIFICA_NOMBRE` | Carácter | Descripción de la específica. |
| `ESPECIFICA_DET` | Numérico | Código de Específica nivel 2. Identifica el detalle del gasto. |
| `ESPECIFICA_DET_NOMBRE` | Carácter | Descripción de la específica detalle. |
| `MONTO_PIA` | Numérico | Monto asignado de Presupuesto Institucional de Apertura. |
| `MONTO_PIM` | Numérico | Monto de Presupuesto Institucional Modificado. |
| `MONTO_CERTIFICADO` | Numérico | Monto del presupuesto utilizado en fase Certificación, al nivel mostrado. |
| `MONTO_COMPROMETIDO_ANUAL` | Numérico | Monto del presupuesto utilizado en fase Compromiso anual, al nivel mostrado. |
| `MONTO_COMPROMETIDO` | Numérico | Monto del presupuesto utilizado en fase Compromiso mensual, al nivel mostrado. |
| `MONTO_DEVENGADO` | Numérico | Monto ejecutado como fase Devengado, al nivel mostrado. |
| `MONTO_GIRADO` | Numérico | Monto ejecutado como fase Girado, al nivel mostrado. |

## Ingresos (37 variables — dataset "Presupuesto y Ejecución de Ingreso")

Key semantics:

- **Grain**: one row per entidad × fuente/rubro × clasificador de ingreso × **month** (`ANO_DOC`/`MES_DOC` — note: *not* ANO_EJE/MES_EJE; the pipeline renames them for consistency).
- **Monthly flow**: `MONTO_RECAUDADO` (sum freely across months). **Annual stocks**: `MONTO_PIA`, `MONTO_PIM` (never sum across months).
- **No functional/programmatic structure** (that only exists on the gasto side) — ingresos classify by *source*: FUENTE_FINANCIAMIENTO → RUBRO → TIPO_RECURSO, and economically by GENERICA → SUBGENERICA (det) → ESPECIFICA (det).
- **Contrast with gasto**: compare `recaudado` vs `devengado` by month/year (pipeline export `contraste_mensual.json`). Caveat for interpretation: gasto is also financed by debt and prior-year balances, so recaudado < devengado is not automatically a deficit alarm.
- File variants mirror gasto: `<year>-Ingreso-Recaudado-Mensual.csv` (pivoted or monthly depending on year), `<year>-Ingreso-Mensual.csv`, `<year>-Ingreso-Diario.csv`, plus per-sector diario splits (`...-Diario-Recaudado-sector<NN>.csv`). The normalizer auto-detects monthly vs pivoted.

Full variable list: `Ingresos_Diccionario_oficial.csv` (fetched from the MEF file server).
