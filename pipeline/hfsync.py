"""Mirror the lake to a Hugging Face dataset repo: free public storage (no credit card),
versioned, and directly queryable by anyone:

    SELECT * FROM 'hf://datasets/<usuario>/<repo>/gasto/2026.parquet'   -- DuckDB

Enabled when HF_DATASET is set (e.g. 'usuario/presupuesto-abierto-peru'); pushing also
needs HF_TOKEN with write access. Without HF_DATASET everything stays in data/lake/.
"""
import os
import re
import shutil
from pathlib import Path

import lake
from config import LAKE, ANOS_SITIO


# What pull() saw, so push() never overwrites remote state it didn't start from.
_remoto: dict = {"existia": None, "sha": None}


def repo() -> str | None:
    return os.environ.get("HF_DATASET") or None


def pull() -> None:
    """Fetch what a run needs, not the whole history: the manifest, the newest snapshot of
    each of the site's years (base for the next diff and the site's data) and, for the
    current year, the one before it (the "since the last update" comparisons).

    A repo that doesn't exist yet means first run; any other failure (network, auth)
    aborts: continuing with an empty lake would push a manifest that forgets the history."""
    r = repo()
    if not r:
        print("  HF_DATASET not set: working with the local lake only")
        return
    from huggingface_hub import HfApi, hf_hub_download
    from huggingface_hub.errors import RepositoryNotFoundError

    token = os.environ.get("HF_TOKEN")
    try:
        info = HfApi(token=token).repo_info(r, repo_type="dataset")
    except RepositoryNotFoundError:
        _remoto.update(existia=False, sha=None)
        print(f"  {r}: repository not found yet (first run: push will create it)")
        return
    _remoto.update(existia=True, sha=info.sha)
    remotos = {s.rfilename for s in (info.siblings or [])}
    if "manifest.json" not in remotos:
        print(f"  {r}: empty repository (first run)")
        return
    # pinned to the commit we just inspected: one consistent snapshot of the lake
    get = lambda f: hf_hub_download(r, f, repo_type="dataset", local_dir=LAKE, token=token, revision=info.sha)
    get("manifest.json")
    m = lake.load_manifest()
    n = 0
    for ds in lake.DATASETS:
        anos = lake.years(m, ds)[-ANOS_SITIO:]
        for y in anos:
            ultima = lake.latest_pub(m, ds, y)
            guardadas = lake.snapshots(m, ds, y)
            # the snapshots a run needs: the base of the next diff and of "since the last update"
            # (current year), the latest one (previous year)
            necesarias = set(guardadas[-1:])
            if y == anos[-1]:
                necesarias |= set(guardadas[-2:]) | ({lake.base_comparacion(m, ds, y)} - {None})
            for p in sorted(necesarias):
                get(lake.rel(lake.snapshot_path(ds, y, p)))
                n += 1
            if m["datasets"][ds][str(y)]["publications"][ultima].get("cambios"):
                get(lake.rel(lake.changes_path(ds, y, ultima)))
            latest = lake.latest_path(ds, y)
            latest.parent.mkdir(parents=True, exist_ok=True)
            if lake.guardada(m, ds, y, ultima):  # latest file == a snapshot: copy, don't download it twice
                if ultima not in necesarias:
                    get(lake.rel(lake.snapshot_path(ds, y, ultima)))
                shutil.copyfile(lake.snapshot_path(ds, y, ultima), latest)
            else:  # a daily refresh: only the latest file has it
                get(lake.rel(latest))
    # who the State contracts with (contratos.py): the site's years, and when they were fetched
    desde = max(lake.years(m, "gasto"), default=0) - (ANOS_SITIO - 1)
    # purchase orders (ordenes.py): the current year's months, which the site summarizes
    c = [f for f in sorted(remotos) if f in ("contratos/fuente.json", "inversiones/fuente.json", "ordenes/fuente.json")
         or ((m_ := re.fullmatch(r"(contratos|contratos_items|procesos)/(\d{4})\.parquet", f)) and int(m_.group(2)) >= desde)
         or re.fullmatch(r"inversiones/\w+\.parquet", f)
         or ((m_ := re.fullmatch(r"ordenes/(\d{4})/\d{2}\.parquet", f)) and int(m_.group(1)) > desde)]
    for f in c:
        get(f)
    print(f"  pulled manifest + {n} snapshots + {len(c)} contract files from hf://datasets/{r}")


def api():
    from huggingface_hub import HfApi
    return HfApi(token=os.environ.get("HF_TOKEN"))


def remotos() -> set[str]:
    """Every file path in the remote dataset (empty without HF_DATASET)."""
    r = repo()
    if not r:
        return {str(p.relative_to(LAKE)) for p in LAKE.rglob("*") if p.is_file()}
    return {f.path for f in api().list_repo_tree(r, repo_type="dataset", recursive=True) if hasattr(f, "size")}


def pull_metadatos() -> None:
    """For the backfill (historia.py): only the small files that say what the lake holds (the
    manifest, the backfill record, the contracts' and orders' download records), not the data."""
    r = repo()
    if not r:
        return
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import RepositoryNotFoundError
    try:
        info = api().repo_info(r, repo_type="dataset")
    except RepositoryNotFoundError:
        _remoto.update(existia=False, sha=None)
        return
    _remoto.update(existia=True, sha=info.sha)
    hay = {s.rfilename for s in (info.siblings or [])}
    for f in ("manifest.json", "historia.json", "contratos/fuente.json", "ordenes/fuente.json"):
        if f in hay:
            hf_hub_download(r, f, repo_type="dataset", local_dir=LAKE, token=os.environ.get("HF_TOKEN"), revision=info.sha)


def borrar(rutas: list[str], message: str) -> None:
    """Delete files from the remote dataset in one commit (their bytes stay in the history until
    compactar())."""
    r = repo()
    if not r or not rutas:
        return
    from huggingface_hub import CommitOperationDelete
    info = api().create_commit(r, repo_type="dataset", commit_message=message, parent_commit=_remoto["sha"],
                               operations=[CommitOperationDelete(path_in_repo=p) for p in rutas])
    _remoto.update(existia=True, sha=info.oid)


def compactar(message: str) -> None:
    """Squash the dataset's history into one commit: every current file stays, old versions of
    rewritten or deleted files go. Irreversible; historia.py calls it only when over budget."""
    r = repo()
    if not r:
        return
    a = api()
    a.super_squash_history(repo_id=r, repo_type="dataset", commit_message=message)
    _remoto.update(sha=a.repo_info(r, repo_type="dataset").sha)


def push(paths: list[Path], message: str) -> None:
    """Upload lake files (plus the manifest and dataset card) in a single commit."""
    r = repo()
    if not r:
        return
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("HF_TOKEN (write access) is required to push to Hugging Face")
    from huggingface_hub import HfApi, CommitOperationAdd

    card = LAKE / "README.md"
    card.write_text(dataset_card(r))
    files = list(dict.fromkeys([*paths, LAKE / "manifest.json", card]))
    api = HfApi(token=token)
    if not _remoto["existia"]:
        api.create_repo(r, repo_type="dataset", exist_ok=True)
        if _remoto["existia"] is False and api.file_exists(r, "manifest.json", repo_type="dataset"):
            raise SystemExit(f"{r} got a manifest after this run's pull; rerun to start from it")
    # parent_commit: rejected if the repo moved since pull() (e.g. a concurrent manual push)
    info = api.create_commit(r, repo_type="dataset", commit_message=message, parent_commit=_remoto["sha"],
                             operations=[CommitOperationAdd(path_in_repo=lake.rel(p), path_or_fileobj=str(p))
                                         for p in files])
    _remoto.update(existia=True, sha=info.oid)  # the next push in this run builds on this commit
    print(f"  pushed {len(files)} files to hf://datasets/{r}")


def dataset_card(r: str) -> str:
    return f"""---
language:
- es
license: other
pretty_name: Presupuesto Abierto Perú
tags:
- presupuesto-publico
- peru
- open-government
configs:
- config_name: gasto
  data_files: "gasto/*.parquet"
- config_name: ingreso
  data_files: "ingreso/*.parquet"
- config_name: contratos
  data_files: "contratos/*.parquet"
- config_name: contratos_items
  data_files: "contratos_items/*.parquet"
- config_name: inversiones
  data_files: "inversiones/detalle.parquet"
- config_name: ordenes
  data_files: "ordenes/*/*.parquet"
- config_name: procesos
  data_files: "procesos/*.parquet"
---

# Presupuesto Abierto Perú — datos

Presupuesto y ejecución del gasto e ingresos públicos del Perú, a partir de los archivos
oficiales del **Ministerio de Economía y Finanzas (MEF)** —
[Portal de Datos Abiertos](https://datosabiertos.mef.gob.pe/dataset/presupuesto-y-ejecucion-de-gasto).
Fuente y atribución: MEF; consulte los términos de uso del portal. Proyecto ciudadano independiente.

Los CSV del MEF (~2–3 GB por año) se convierten sin pérdida a Parquet (~60–70 MB por año):
misma información, columnas tipadas, montos exactos (`DECIMAL(18,2)`), una fila por línea
presupuestal y los meses como columnas.

| Ruta | Contenido |
|---|---|
| `gasto/<año>.parquet`, `ingreso/<año>.parquet` | Última publicación del MEF para ese año |
| `snapshots/<dataset>/<año>/<publicación>.parquet` | Cada publicación del MEF, sin reescribir (el MEF sobrescribe sus archivos: esta es la historia) |
| `cambios/<dataset>/<año>/<publicación>.parquet` | Líneas nuevas, eliminadas o con PIA/PIM modificado respecto a la publicación anterior |
| `manifest.json` | Origen (ETag, fecha, tamaño), filas y totales de cada publicación |
| `contratos/<año>.parquet` | Contratos firmados en el SEACE (proveedor y RUC, monto, monto final, procedimiento, postores, CUI de la obra, documentos), registros actualizados ese año. Fuente: OECE, datos de contrataciones abiertas (OCDS) vía [Open Contracting Partnership](https://data.open-contracting.org/en/publication/135), CC BY 4.0 |
| `inversiones/detalle.parquet`, `inversiones/seguimiento.parquet` | Cada proyecto de inversión completo (Banco de Inversiones del MEF): costo actualizado y viable, devengado acumulado, avance físico, modalidad, ubicación, y el último reporte de la entidad (Formato 12B: situación, problemas, acciones) |
| `contratos_items/<año>.parquet` | Qué se compró en cada contrato, línea por línea: código del catálogo (CUBSO y UNSPSC), descripción, cantidad, unidad y monto. Se une a `contratos` por `ocid` y `contrato_id` |
| `procesos/<año>.parquet` | Procedimientos del SEACE aún sin contrato firmado: convocados (con sus bases y plazos), adjudicados por firmar, desiertos, nulos o cancelados; valor referencial, participantes, ganador. Misma fuente que `contratos` |
| `ordenes/<año>/<mes>.parquet` | Órdenes de compra y de servicio que cada entidad registra en el SEACE (compras de hasta 8 UIT, servicios públicos, catálogo electrónico y órdenes que ejecutan contratos): entidad y RUC, descripción, proveedor y RUC, monto, estado, fechas. Un archivo por mes de registro. Fuente: OECE, [Portal de Datos Abiertos](https://www.gob.pe/14272-acceder-al-portal-de-datos-abiertos-del-oece) |

```sql
-- DuckDB
SELECT FUNCION_NOMBRE, sum(MONTO_PIM) AS pim, sum(MONTO_DEVENGADO_ANUAL) AS devengado
FROM 'hf://datasets/{r}/gasto/2026.parquet'
GROUP BY 1 ORDER BY pim DESC;
```
"""
