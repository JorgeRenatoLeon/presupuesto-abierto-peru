"""CLI orchestrator.

Daily job (what CI runs):
  python run.py update     pull lake -> check MEF -> ingest new publications -> push lake ->
                           refresh contracts (OECE, weekly) -> rebuild serving

Individual steps:
  catalog | download | normalize | aggregate | compare | alerts | exportar | validate | qa | serving | pull | push |
  contratos | all
"""
import argparse
import datetime
import email.utils
import json
import os
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser(description="Presupuesto Peru ETL")
    p.add_argument("command", choices=["update", "serving", "catalog", "download", "normalize", "aggregate",
                                        "compare", "alerts", "exportar", "validate", "qa", "pull", "push", "all",
                                        "contratos"])
    p.add_argument("--year", type=int)
    p.add_argument("--years", type=int, nargs="+")
    p.add_argument("--dataset", choices=["gasto", "ingreso", "ambos"], default="ambos",
                   help="Which side of the coin: gasto (spending), ingreso (revenue), or ambos")
    p.add_argument("--local-file", type=Path, nargs="+",
                   help="normalize: use local CSV(s) as a publication (e.g. an extract)")
    p.add_argument("--published", help="normalize: MEF Last-Modified of the local file (HTTP date). "
                                       "Default: data/raw/catalog.json, else the file's mtime")
    p.add_argument("--diario", action="store_true",
                   help="download: the ~8GB Gasto-Diario file instead of the Devengado-Mensual default")
    p.add_argument("--keep-raw", action="store_true", help="update: keep downloaded CSVs in data/raw/incoming")
    p.add_argument("--force", action="store_true", help="update: rebuild serving even if MEF published nothing new")
    p.add_argument("--no-push", action="store_true", help="update: don't push the lake to Hugging Face")
    p.add_argument("--ignore-cadence", action="store_true",
                   help="update: download a re-published file even if ingested less than CADENCIA_DIAS ago")
    p.add_argument("--strict", action="store_true", help="QA: fail if Consulta Amigable is unreachable")
    p.add_argument("--skip-external", action="store_true", help="QA: coherence checks only (no network)")
    args = p.parse_args()
    datasets = ["gasto", "ingreso"] if args.dataset == "ambos" else [args.dataset]

    if args.command == "catalog":
        from download import catalog
        catalog(args.years or ([args.year] if args.year else [datetime.date.today().year]))
    elif args.command == "download":
        _require_year(args)
        from download import download
        for ds in datasets:
            download(args.year, prefer_diario=args.diario, dataset=ds)
    elif args.command == "normalize":
        _require_year(args)
        _normalize_local(args, datasets)
    elif args.command in ("update", "all"):
        if args.command == "all":
            _require_year(args)
        _update(args, datasets, force=args.force or args.command == "all")
    elif args.command == "serving":
        _serving(args)
    elif args.command == "aggregate":
        from aggregate import aggregate
        aggregate()
    elif args.command == "compare":
        from compare import compare
        compare()
    elif args.command == "alerts":
        from alerts import compute_alerts
        compute_alerts()
    elif args.command == "exportar":
        from explicar import explicar
        from exportar import exportar
        exportar()
        explicar()
    elif args.command == "validate":
        if not _validate(args.year or _current_year(), datasets):
            raise SystemExit(1)
    elif args.command == "qa":
        from qa import qa
        if not qa(args.year or _current_year(), strict=args.strict, skip_external=args.skip_external):
            raise SystemExit(1)
    elif args.command == "contratos":
        import contratos
        contratos.actualizar(args.years or [_current_year() - 1, _current_year()], forzar=args.force)
    elif args.command == "pull":
        import hfsync
        hfsync.pull()
    elif args.command == "push":
        import hfsync
        from config import LAKE
        hfsync.push(sorted(p for p in LAKE.rglob("*.parquet") if not p.name.startswith(".")),
                    "Sincronización manual del lago")


def _update(args, datasets: list[str], force: bool) -> None:
    import hfsync
    import lake
    from update import update

    hfsync.pull()
    today = datetime.date.today()
    years = args.years or ([args.year] if args.year else [today.year, today.year - 1])
    print(f"Checking MEF for {datasets} {years}")
    nuevas = update(years, datasets, keep_raw=args.keep_raw, ignorar_cadencia=args.ignore_cadence)
    if nuevas and not args.no_push:
        # capture the snapshot first: MEF overwrites its files, the site can be rebuilt later
        files = []
        for ds, y, pub in nuevas:
            files += [lake.snapshot_path(ds, y, pub), lake.latest_path(ds, y)]
            if lake.changes_path(ds, y, pub).exists():
                files.append(lake.changes_path(ds, y, pub))
        hfsync.push(files, "MEF: " + ", ".join(f"{ds} {y} publicado {lake.pub_date(p)}" for ds, y, p in nuevas))
    contratos_nuevos = _contratos(years, push=not args.no_push)
    _output("changed", bool(nuevas) or contratos_nuevos)
    if nuevas or force or contratos_nuevos:
        _serving(args)
    else:
        print("No new MEF publications: serving layer left as is (use --force to rebuild).")
    if nuevas:
        _notificar()


def _contratos(years: list[int], push: bool) -> bool:
    """Refresh the OECE contracts (weekly) and push them. Best effort: if the source is down, the
    site keeps the contracts pulled from Hugging Face, and the budget update goes on."""
    import contratos
    import hfsync
    try:
        escritos = contratos.actualizar(sorted(years))
    except Exception as e:  # noqa: BLE001 - a third-party mirror must not stop the budget update
        print(f"  WARN contratos: {e}")
        return False
    if escritos and push:
        hfsync.push(escritos, "OECE: contratos " + ", ".join(p.stem for p in escritos if p.suffix == ".parquet"))
    return bool(escritos)


def _notificar() -> None:
    """Optional Telegram digest of the new publication; a failure here never fails the run."""
    from config import SERVING
    from notify import notificar
    try:
        notificar(json.loads((SERVING / "json" / "alertas.json").read_text()),
                  json.loads((SERVING / "json" / "comparar" / "resumen.json").read_text()))
    except Exception as e:  # noqa: BLE001 - notifications are best effort
        print(f"  WARN telegram: {e}")


def _serving(args) -> None:
    """Rebuild everything the site reads, from the lake."""
    from aggregate import aggregate
    from alerts import compute_alerts
    from compare import compare
    from explicar import explicar
    from exportar import exportar
    from qa import qa

    aggregate()
    compare()
    compute_alerts()
    exportar()
    explicar()
    year = _current_year()
    ok = _validate(year, ["gasto", "ingreso"])
    ok &= qa(year, strict=args.strict, skip_external=args.skip_external)
    if not ok:
        raise SystemExit(1)


def _validate(year: int, datasets: list[str]) -> bool:
    import lake
    from validate import validate, validate_ingreso
    m = lake.load_manifest()
    ok = True
    for ds in datasets:
        if year in lake.years(m, ds):
            ok &= validate(year) if ds == "gasto" else validate_ingreso(year)
    return ok


def _normalize_local(args, datasets: list[str]) -> None:
    """Ingest local CSV(s) into the lake as a publication (manual / backfill)."""
    import lake
    from config import RAW
    from update import ingest

    if args.local_file and len(datasets) > 1:
        raise SystemExit("--local-file requires a single --dataset (gasto or ingreso)")
    m = lake.load_manifest()
    for ds in datasets:
        files = args.local_file or sorted(RAW.glob(f"{args.year}-{ds.capitalize()}-*.csv"))
        if not files:
            raise SystemExit(f"No raw {ds} CSVs for {args.year} in {RAW}")
        ingest(ds, args.year, files, _local_source(files[0], args.published), m)


def _local_source(path: Path, published: str | None) -> dict:
    from config import RAW
    cat = RAW / "catalog.json"
    info = json.loads(cat.read_text())["files"].get(path.name, {}) if cat.exists() else {}
    last_modified = published or info.get("last_modified") or \
        email.utils.formatdate(path.stat().st_mtime, usegmt=True)
    return {"name": path.name, "size": path.stat().st_size, "etag": info.get("etag"),
            "last_modified": last_modified}


def _current_year() -> int:
    import lake
    years = lake.years(lake.load_manifest(), "gasto")
    if not years:
        raise SystemExit("The lake has no gasto data yet: run `python run.py update` first.")
    return years[-1]


def _output(name: str, value) -> None:
    """Print and, under GitHub Actions, expose as a step output."""
    line = f"{name}={str(value).lower() if isinstance(value, bool) else value}"
    print(line)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(line + "\n")


def _require_year(args) -> None:
    if not args.year:
        raise SystemExit("--year is required for this command")


if __name__ == "__main__":
    main()
