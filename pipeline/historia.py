"""Backfill: every past year the sources still publish, fetched a few at a time until the lake
holds all of them, inside a storage budget on Hugging Face.

The daily update keeps the current and previous year. History starts below them and goes back as
far as each publisher serves files (checked October 2026):
  gasto      MEF <year>-Gasto.csv, 2009-2024 (one final 7-10 GB CSV per closed year -> ~70 MB parquet)
  ingreso    MEF <year>-Ingreso.csv, 2009-2024
  contratos  OECE contracts (OCDS), yearly files of the Open Contracting Partnership mirror
  ordenes    OECE purchase and service orders, monthly files since 2018

Each run takes the next missing units (one source-year each), newest year first and every source
of a year before an older one, at most one multi-GB MEF year per run; pushes each to Hugging Face
as it lands; then keeps the dataset within its budget (HF_LIMITE_GB, default 10 GB: Hugging Face's
free public storage is "best effort" past the first few GB):
  1. Rewriting a file keeps its old versions in the repo's history (the weekly latest copies,
     contracts, project data). When the space used passes 85% of the budget and history is what
     weighs, the history is squashed: every current file stays, old versions go.
  2. If the current files themselves pass 85%, the oldest backfilled year goes (the largest source
     of that year first) and is recorded as pruned, so it isn't fetched again. Only closed years
     are pruned: their publisher still serves them, unlike the current year's daily files, whose
     snapshots are the only history and are never touched.

lake/historia.json records each unit: done (when, bytes), unavailable, failed (retried after a
week) or pruned.
"""
import json
import os
import time
import traceback
from datetime import date, datetime, timezone

from config import LAKE

FUENTES = ("gasto", "ingreso", "contratos", "ordenes")
DESDE = {"gasto": 2009, "ingreso": 2009, "contratos": 2009, "ordenes": 2018}
PESADAS = {"gasto"}            # a multi-GB download: at most one per run
LIMITE_GB = float(os.environ.get("HF_LIMITE_GB") or 10)
UMBRAL = 0.85
REINTENTO_DIAS = 7
REGISTRO = LAKE / "historia.json"


def _registro() -> dict:
    return json.loads(REGISTRO.read_text()) if REGISTRO.exists() else {}


def _guardar(reg: dict) -> None:
    REGISTRO.write_text(json.dumps(reg, indent=1, sort_keys=True, ensure_ascii=False))


def plan(hoy: date | None = None) -> list[tuple[str, int]]:
    """Every source-year history should hold, newest year first."""
    actual = (hoy or date.today()).year
    return [(f, ano) for ano in range(actual - 2, min(DESDE.values()) - 1, -1) for f in FUENTES if ano >= DESDE[f]]


def _rutas(fuente: str, ano: int, remotos: set[str]) -> list[str]:
    """The files of a source-year in the remote repo."""
    if fuente in ("gasto", "ingreso"):
        pref = (f"{fuente}/{ano}.parquet", f"snapshots/{fuente}/{ano}/", f"cambios/{fuente}/{ano}/")
        return sorted(r for r in remotos if r == pref[0] or r.startswith(pref[1:]))
    if fuente == "contratos":
        return sorted(r for r in remotos if r in (f"contratos/{ano}.parquet", f"contratos_items/{ano}.parquet"))
    return sorted(r for r in remotos if r.startswith(f"ordenes/{ano}/"))


def _completa(fuente: str, ano: int, remotos: set[str], manifest: dict) -> bool:
    if fuente in ("gasto", "ingreso"):
        return str(ano) in manifest.get("datasets", {}).get(fuente, {})
    if fuente == "contratos":
        return f"contratos/{ano}.parquet" in remotos
    return f"ordenes/{ano}/12.parquet" in remotos


def pendientes(reg: dict, remotos: set[str], manifest: dict, solo: list[str] | None = None) -> list[tuple[str, int]]:
    ahora = time.time()
    out = []
    for f, ano in plan():
        if solo and f not in solo:
            continue
        estado = reg.get(f"{f}/{ano}") or {}
        if estado.get("estado") in ("hecho", "podado", "no_publicado"):
            continue
        if estado.get("estado") == "fallido" and ahora - estado.get("ts", 0) < REINTENTO_DIAS * 86400:
            continue
        if not _completa(f, ano, remotos, manifest):
            out.append((f, ano))
    return out


def traer(fuente: str, ano: int) -> list:
    """Fetch one source-year into the local lake. Returns the lake files written."""
    import lake
    if fuente in ("gasto", "ingreso"):
        from update import update
        nuevas = update([ano], [fuente], ignorar_cadencia=True)
        archivos = []
        for ds, y, pub in nuevas:
            archivos += [lake.snapshot_path(ds, y, pub), lake.latest_path(ds, y)]
            if lake.changes_path(ds, y, pub).exists():
                archivos.append(lake.changes_path(ds, y, pub))
        return archivos
    if fuente == "contratos":
        import contratos
        return contratos.actualizar([ano], forzar=True)
    import ordenes
    return ordenes.actualizar([ano])


def mantener(limite_gb: float = LIMITE_GB) -> dict:
    """Keep the Hugging Face dataset within its budget (see the module docstring). Returns what it
    measured and did."""
    import hfsync
    api, repo = hfsync.api(), hfsync.repo()
    if not repo:
        return {}
    limite = limite_gb * 1e9
    usado = api.dataset_info(repo, expand=["usedStorage"]).used_storage or 0
    archivos = {f.path: getattr(f, "size", 0) or 0 for f in api.list_repo_tree(repo, repo_type="dataset", recursive=True)}
    cabeza = sum(archivos.values())
    hecho = {"usado_gb": round(usado / 1e9, 3), "archivos_gb": round(cabeza / 1e9, 3), "limite_gb": limite_gb,
             "podados": [], "compactado": False}
    print(f"  Hugging Face: {usado / 1e9:.2f} GB used, {cabeza / 1e9:.2f} GB of current files, budget {limite_gb:g} GB")
    reg = _registro()
    actual = date.today().year
    while cabeza > UMBRAL * limite:
        # the oldest closed year that history fetched; of that year, the heaviest source first
        candidatos = []
        for clave, estado in reg.items():
            f, ano = clave.split("/")[0], int(clave.split("/")[1])
            peso = sum(archivos.get(r, 0) for r in _rutas(f, ano, set(archivos)))
            if estado.get("estado") == "hecho" and ano <= actual - 2 and peso:
                candidatos.append((ano, -peso, f))
        if not candidatos:
            print("  WARN: over budget and nothing left that history may prune")
            break
        ano, menos, f = min(candidatos)
        rutas = _rutas(f, ano, set(archivos))
        hfsync.borrar(rutas, f"Historia: se poda {f} {ano} para mantener el dataset bajo {limite_gb:g} GB "
                             f"(el MEF/OECE lo sigue publicando)")
        for r in rutas:
            cabeza -= archivos.pop(r, 0)
        reg[f"{f}/{ano}"] = {"estado": "podado", "ts": time.time(), "bytes": -menos,
                             "fecha": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
        hecho["podados"].append(f"{f}/{ano}")
        print(f"  pruned {f} {ano} ({-menos / 1e6:,.0f} MB)")
    if hecho["podados"]:
        _guardar(reg)
        hfsync.push([REGISTRO], "Historia: registro de años podados")
    # deleted or rewritten files still weigh in the history until it is squashed
    if (usado > UMBRAL * limite or hecho["podados"]) and usado > cabeza * 1.1:
        hfsync.compactar("Historia: se compacta el historial (se conservan todos los archivos actuales)")
        hecho["compactado"] = True
        print("  squashed the dataset's history (Hugging Face updates the quota within 36 h)")
    return hecho


def correr(unidades: int = 2, push: bool = True, solo: list[str] | None = None) -> list[str]:
    """Fetch up to `unidades` missing source-years (at most one heavy), pushing each as it lands,
    then keep the dataset within budget. Returns the units fetched."""
    import hfsync
    import lake
    hfsync.pull_metadatos()
    reg = _registro()
    remotos = hfsync.remotos()
    cola = pendientes(reg, remotos, lake.load_manifest(), solo)
    print(f"Historia: {len(cola)} source-years missing; fetching up to {unidades}")
    traidos, pesadas = [], 0
    for f, ano in cola:
        if len(traidos) >= unidades:
            break
        if f in PESADAS:
            if pesadas:
                continue
            pesadas += 1
        clave = f"{f}/{ano}"
        print(f"== {clave}", flush=True)
        try:
            archivos = traer(f, ano)
        except SystemExit as e:  # update() exits when the server has no file for that year
            reg[clave] = {"estado": "no_publicado" if "None of the expected" in str(e) else "fallido",
                          "ts": time.time(), "error": str(e)[:300]}
            print(f"  {clave}: {reg[clave]['estado']} ({e})")
            continue
        except Exception as e:  # noqa: BLE001 - one bad year must not stop the others
            traceback.print_exc()
            reg[clave] = {"estado": "fallido", "ts": time.time(), "error": f"{e.__class__.__name__}: {e}"[:300]}
            continue
        nbytes = sum(p.stat().st_size for p in archivos if p.exists())
        reg[clave] = {"estado": "hecho", "ts": time.time(), "bytes": nbytes,
                      "fecha": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
        _guardar(reg)
        if push and archivos:
            hfsync.push([*archivos, REGISTRO], f"Historia: {f} {ano}")
        traidos.append(clave)
        print(f"  {clave}: {len(archivos)} files, {nbytes / 1e6:,.0f} MB")
        if os.environ.get("GITHUB_ACTIONS") == "true":  # on the runner only: free its disk for the next year
            for p in archivos:
                if p.suffix == ".parquet" and p.exists():
                    p.unlink()
    _guardar(reg)
    if push:
        if not traidos:
            hfsync.push([REGISTRO], "Historia: registro")
        mantener()
    return traidos
