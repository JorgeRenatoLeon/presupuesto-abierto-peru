"""Detect new MEF publications, ingest them into the lake, record what changed.

For each dataset-year: HEAD the source file; if its ETag/size are already in the
manifest, or it was ingested less than CADENCIA_DIAS ago (MEF re-stamps its multi-GB Diario
files every day), skip: a daily check costs a few requests. Otherwise download it in chunks,
normalize it into an immutable snapshot, diff it against the previous publication and
delete the CSV: the raw file is only needed for the minutes the conversion takes.
"""
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import lake
from changes import diff
from config import RAW, LAKE, CADENCIA_DIAS, CANON
from download import resolve_source, fetch, is_downloaded, sidecar
from normalize import normalize


def cordura(dataset: str, stats: dict, previo: dict | None) -> None:
    """Refuse to record a publication whose totals make no sense, before it reaches the lake
    (and Hugging Face): history can't be repaired once MEF overwrites its files. A semantics
    bug on 2026-10-18 produced national PIA S/ 42 bn instead of S/ 258 bn; these checks catch it."""
    t = {k: Decimal(v) for k, v in stats["totals"].items()}
    pia, pim, flujo = t["MONTO_PIA"], t["MONTO_PIM"], t[f"{CANON[dataset]['flujo']}_ANUAL"]
    errores = []
    if pia <= 0 or pim <= 0:
        errores.append(f"PIA {pia:,.0f} / PIM {pim:,.0f} must be positive")
    if dataset == "gasto" and pim > 0 and flujo > pim * Decimal("1.05"):
        errores.append(f"devengado {flujo:,.0f} exceeds PIM {pim:,.0f}")
    if previo:
        pt = {k: Decimal(v) for k, v in previo["totals"].items()}
        if pt["MONTO_PIA"] > 0 and abs(pia - pt["MONTO_PIA"]) / pt["MONTO_PIA"] > Decimal("0.02"):
            errores.append(f"PIA moved from {pt['MONTO_PIA']:,.0f} to {pia:,.0f}: PIA is fixed after approval")
        if pt["MONTO_PIM"] > 0 and not Decimal("0.8") <= pim / pt["MONTO_PIM"] <= Decimal("1.3"):
            errores.append(f"PIM moved from {pt['MONTO_PIM']:,.0f} to {pim:,.0f}")
    if errores:
        raise SystemExit(f"{dataset}: publication rejected before recording it: " + "; ".join(errores))


def ingest(dataset: str, year: int, csv_files: list[Path], source: dict, m: dict) -> str | None:
    """Store local CSV(s) as the publication described by `source` (name/etag/size/last_modified).
    Ingest publications in chronological order: each is diffed against the one before it."""
    pub = lake.pub_id(source["last_modified"])
    if pub in lake.publications(m, dataset, year):
        print(f"  {dataset} {year}: publication {pub} already in the lake")
        return None
    tmp = LAKE / f".tmp_{dataset}_{year}.parquet"
    stats = normalize(dataset, year, csv_files, tmp)
    prev = lake.previous_pub(m, dataset, year, pub)
    cordura(dataset, stats, m["datasets"][dataset][str(year)]["publications"][prev] if prev else None)
    # one publication a week is kept for good; the daily ones only refresh the latest file
    guardar = lake.guardar_snapshot(m, dataset, year, pub)
    base = ([p for p in lake.snapshots(m, dataset, year) if p < pub] or [None])[-1]
    snap = lake.add_publication(m, dataset, year, pub, tmp, source, stats, guardar=guardar)
    print(f"  {dataset} {year}: {pub} " + ("kept as a snapshot" if guardar else "refreshes the latest file (daily, not kept)"))
    if guardar and base and lake.snapshot_path(dataset, year, base).exists():
        out = lake.changes_path(dataset, year, pub)
        summary = diff(dataset, lake.snapshot_path(dataset, year, base), snap, out)
        m["datasets"][dataset][str(year)]["publications"][pub]["cambios"] = {"respecto_a": base, **summary}
        ln = summary["lineas"]
        print(f"  changes vs {base}: {ln['nueva']:,} new, {ln['eliminada']:,} removed, "
              f"{ln['presupuesto_modificado']:,} re-budgeted lines -> {lake.rel(out)} ({out.stat().st_size/1e6:.1f} MB)")
    lake.save_manifest(m)
    return pub


def dias_desde_ingesta(m: dict, dataset: str, year: int) -> float | None:
    """Days since this dataset-year was last ingested (None if never)."""
    pubs = m["datasets"].get(dataset, {}).get(str(year), {}).get("publications", {}).values()
    fechas = [datetime.strptime(p["ingested_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
              for p in pubs if p.get("ingested_at")]
    return (datetime.now(timezone.utc) - max(fechas)).total_seconds() / 86400 if fechas else None


def update(years: list[int], datasets: list[str], keep_raw: bool = False,
           ignorar_cadencia: bool = False) -> list[tuple[str, int, str]]:
    """Check MEF for each dataset-year; ingest new publications. Returns [(dataset, year, pub)]."""
    m = lake.load_manifest()
    nuevas, encontrados = [], 0
    actual = datetime.now(timezone.utc).year
    for ds in datasets:
        for year in years:
            # the current year from the daily file (see config.source_files); raises if the server can't be checked
            src = resolve_source(ds, year, prefer_diario=year >= actual)
            if not src:
                print(f"  {ds} {year}: no file on the MEF server")
                continue
            encontrados += 1
            if lake.is_known(m, ds, year, src):
                print(f"  {ds} {year}: unchanged ({src['name']}, {src['last_modified']})")
                continue
            cadencia = CADENCIA_DIAS["actual" if year >= actual else "anterior"]
            dias = dias_desde_ingesta(m, ds, year)
            if not ignorar_cadencia and dias is not None and dias < cadencia:
                print(f"  {ds} {year}: MEF republished {src['name']} ({src['last_modified']}); last ingest "
                      f"{dias:.1f} days ago, next in {cadencia - dias:.1f} (cadence {cadencia} days)")
                continue
            print(f"  {ds} {year}: NEW publication {src['name']} {src['last_modified']} "
                  f"({src['size']/1e6:,.0f} MB)", flush=True)
            dest = RAW / "incoming" / src["name"]
            if not is_downloaded(src, dest):
                fetch(src, dest)
            pub = ingest(ds, year, [dest], src, m)
            if not keep_raw:
                dest.unlink()
                sidecar(dest).unlink(missing_ok=True)
            if pub:
                nuevas.append((ds, year, pub))
    if not encontrados:
        raise SystemExit("None of the expected MEF files exist (renamed? see config.source_files)")
    return nuevas
