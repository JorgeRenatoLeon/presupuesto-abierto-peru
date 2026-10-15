"""Pipeline configuration: paths, dataset definitions, schema."""
from pathlib import Path

BASE_URL = "https://fs.datosabiertos.mef.gob.pe/datastorefiles"
DATASET_PAGE = "https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto"

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
SERVING = DATA / "serving"
LAKE = DATA / "lake"  # canonical Parquet + publication snapshots; mirrored to Hugging Face (hfsync.py)

# Filename patterns on the MEF file server (catalog 2026-07-24 confirmed):
#   <year>-Gasto-Diario.csv            ~10 GB  refreshed daily    (63-col, monthly grain)
#   <year>-Gasto-Mensual.csv           ~10 GB  refreshed monthly  (63-col, monthly grain)
#   <year>-Gasto-Devengado-Mensual.csv ~2.8 GB refreshed monthly  (73-col, pivoted months)  <- DEFAULT
# No per-sector splits exist for gasto.
def candidate_files(year: int) -> list[str]:
    return [
        f"{year}-Gasto-Devengado-Mensual.csv",
        f"{year}-Gasto-Mensual.csv",
        f"{year}-Gasto-Diario.csv",
    ]

DICTIONARY_FILE = "Gastos_Diccionario.csv"
DICTIONARY_FILE_INGRESOS = "Ingresos_Diccionario.csv"


def source_files(dataset: str, year: int, prefer_diario: bool = False) -> list[str]:
    """The single source file per dataset-year, in order of preference (first existing wins)."""
    if dataset == "gasto":
        files = [f"{year}-Gasto-Devengado-Mensual.csv", f"{year}-Gasto-Mensual.csv", f"{year}-Gasto-Diario.csv"]
        return files[::-1] if prefer_diario else files
    return [f"{year}-Ingreso-Recaudado-Mensual.csv", f"{year}-Ingreso-Mensual.csv",
            f"{year}-Ingreso-Diario.csv", f"{year}-Ingreso-Recaudado.csv"]


# Ingreso dataset (dataset page: /dataset/presupuesto-y-ejecucion-de-ingreso).
# Naming observed across years; catalog() probes and records what exists.
def ingreso_candidate_files(year: int) -> list[str]:
    names = [
        f"{year}-Ingreso-Recaudado-Mensual.csv",
        f"{year}-Ingreso-Mensual.csv",
        f"{year}-Ingreso-Diario.csv",
        f"{year}-Ingreso-Recaudado.csv",
    ]
    # sector splits confirmed for ingresos diario (e.g. ...-sector35.csv)
    names += [f"{year}-Ingreso-Diario-Recaudado-sector{s:02d}.csv" for s in range(1, 100)]
    return names

# Month names as they appear in MEF column names (MONTO_DEVENGADO_ENERO ... _DICIEMBRE)
MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
         "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]

# --- Canonical storage (lake): ONE ROW PER BUDGET LINE ITEM, months as columns ---
# The layout of MEF's *-Devengado-Mensual / *-Recaudado-Mensual files, typed and sorted.
# Measured on 2026 gasto: 2,068 MB CSV -> 57 MB Parquet, lossless (docs/adr-001).
# Codes stay VARCHAR (leading zeros are meaningful: META '00001', ubigeos, clasificador).
# MONTO_<flow>_<MES> are monthly flows (safe to sum); PIA, PIM, certificado, comprometido
# and girado *_ANUAL are annual stocks (never sum them across months).
GASTO_DIMS = [
    "ANO_EJE", "NIVEL_GOBIERNO", "NIVEL_GOBIERNO_NOMBRE", "SECTOR", "SECTOR_NOMBRE",
    "PLIEGO", "PLIEGO_NOMBRE", "SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE",
    "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE",
    "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
    "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE",
    "PROGRAMA_PPTO", "PROGRAMA_PPTO_NOMBRE", "TIPO_ACT_PROY", "TIPO_ACT_PROY_NOMBRE",
    "PRODUCTO_PROYECTO", "PRODUCTO_PROYECTO_NOMBRE",
    "ACTIVIDAD_ACCION_OBRA", "ACTIVIDAD_ACCION_OBRA_NOMBRE",
    "FUNCION", "FUNCION_NOMBRE", "DIVISION_FUNCIONAL", "DIVISION_FUNCIONAL_NOMBRE",
    "GRUPO_FUNCIONAL", "GRUPO_FUNCIONAL_NOMBRE", "SEC_FUNC", "META", "FINALIDAD", "META_NOMBRE",
    "DEPARTAMENTO_META", "DEPARTAMENTO_META_NOMBRE",
    "FUENTE_FINANCIAMIENTO", "FUENTE_FINANCIAMIENTO_NOMBRE",
    "RUBRO", "RUBRO_NOMBRE", "TIPO_RECURSO", "TIPO_RECURSO_NOMBRE",
    "CATEGORIA_GASTO", "CATEGORIA_GASTO_NOMBRE", "TIPO_TRANSACCION", "TIPO_TRANSACCION_NOMBRE",
    "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA", "SUBGENERICA_NOMBRE",
    "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE",
    "ESPECIFICA", "ESPECIFICA_NOMBRE", "ESPECIFICA_DET", "ESPECIFICA_DET_NOMBRE",
]
GASTO_MONTOS = (
    ["MONTO_PIA", "MONTO_PIM", "MONTO_CERTIFICADO_ANUAL", "MONTO_COMPROMETIDO_ANUAL"]
    + [f"MONTO_DEVENGADO_{m}" for m in MESES]
    + ["MONTO_DEVENGADO_ANUAL", "MONTO_GIRADO_ANUAL"]
)
INGRESO_DIMS = [
    "ANO_EJE", "NIVEL_GOBIERNO", "NIVEL_GOBIERNO_NOMBRE", "SECTOR", "SECTOR_NOMBRE",
    "PLIEGO", "PLIEGO_NOMBRE", "SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE",
    "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE",
    "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
    "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE",
    "FUENTE_FINANCIAMIENTO", "FUENTE_FINANCIAMIENTO_NOMBRE", "RUBRO", "RUBRO_NOMBRE",
    "TIPO_RECURSO", "TIPO_RECURSO_NOMBRE", "TIPO_TRANSACCION", "TIPO_TRANSACCION_NOMBRE",
    "GENERICA", "GENERICA_NOMBRE", "SUBGENERICA", "SUBGENERICA_NOMBRE",
    "SUBGENERICA_DET", "SUBGENERICA_DET_NOMBRE",
    "ESPECIFICA", "ESPECIFICA_NOMBRE", "ESPECIFICA_DET", "ESPECIFICA_DET_NOMBRE",
]
INGRESO_MONTOS = (
    ["MONTO_PIA", "MONTO_PIM"] + [f"MONTO_RECAUDADO_{m}" for m in MESES] + ["MONTO_RECAUDADO_ANUAL"]
)
CANON = {
    "gasto": {"dims": GASTO_DIMS, "montos": GASTO_MONTOS, "flujo": "MONTO_DEVENGADO"},
    "ingreso": {"dims": INGRESO_DIMS, "montos": INGRESO_MONTOS, "flujo": "MONTO_RECAUDADO"},
}
# Codes identify a line item; names are attributes of the codes.
def line_key(dataset: str) -> list[str]:
    return [c for c in CANON[dataset]["dims"] if not c.endswith("_NOMBRE")]

# Sort by hierarchy: better compression and row-group pruning for drill-down queries
# (local governments have blank SECTOR/PLIEGO, so their location codes come next).
_SORT_TAIL = ["FUENTE_FINANCIAMIENTO", "RUBRO", "TIPO_RECURSO", "TIPO_TRANSACCION", "GENERICA",
              "SUBGENERICA", "SUBGENERICA_DET", "ESPECIFICA", "ESPECIFICA_DET"]
SORT_KEYS = {
    "gasto": ["NIVEL_GOBIERNO", "SECTOR", "PLIEGO", "DEPARTAMENTO_EJECUTORA", "PROVINCIA_EJECUTORA",
              "DISTRITO_EJECUTORA", "SEC_EJEC", "FUNCION", "DIVISION_FUNCIONAL", "GRUPO_FUNCIONAL",
              "PROGRAMA_PPTO", "PRODUCTO_PROYECTO", "ACTIVIDAD_ACCION_OBRA", "SEC_FUNC", "META",
              "FINALIDAD", "DEPARTAMENTO_META"] + _SORT_TAIL,
    "ingreso": ["NIVEL_GOBIERNO", "SECTOR", "PLIEGO", "DEPARTAMENTO_EJECUTORA", "PROVINCIA_EJECUTORA",
                "DISTRITO_EJECUTORA", "SEC_EJEC"] + _SORT_TAIL,
}
# 30k-row groups: an entity drill-down over HTTP reads ~1 MB instead of ~3 MB (measured)
PARQUET_OPTS = "FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 30000"
# The site (and each CI run) uses the most recent years only: current + previous for the
# year-over-year comparison. Older years stay in the lake / Hugging Face dataset.
ANOS_SITIO = 2

for d in (RAW, SERVING, LAKE):
    d.mkdir(parents=True, exist_ok=True)
