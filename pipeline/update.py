"""Detect new MEF publications, ingest them into the lake, record what changed.

For each dataset-year: HEAD the source file; if its ETag/size are already in the
manifest, skip (a daily check costs a few requests). Otherwise download it in chunks,
normalize it into an immutable snapshot, diff it against the previous publication and
delete the CSV: the raw file is only needed for the minutes the conversion takes.
"""
from pathlib import Path

import lake
from changes import diff
from config import RAW, LAKE
from download import resolve_source, fetch, is_downloaded, sidecar
from normalize import normalize


def ingest(dataset: str, year: int, csv_files: list[Path], source: dict, m: dict) -> str | None:
    """Store local CSV(s) as the publication described by `source` (name/etag/size/last_modified).
    Ingest publications in chronological order: each is diffed against the one before it."""
    pub = lake.pub_id(source["last_modified"])
    if pub in lake.publications(m, dataset, year):
        print(f"  {dataset} {year}: publication {pub} already in the lake")
        return None
    tmp = LAKE / f".tmp_{dataset}_{year}.parquet"
    stats = normalize(dataset, year, csv_files, tmp)
    snap = lake.add_publication(m, dataset, year, pub, tmp, source, stats)
    prev = lake.previous_pub(m, dataset, year, pub)
    if prev:
        out = lake.changes_path(dataset, year, pub)
        summary = diff(dataset, lake.snapshot_path(dataset, year, prev), snap, out)
        m["datasets"][dataset][str(year)]["publications"][pub]["cambios"] = {"respecto_a": prev, **summary}
        ln = summary["lineas"]
        print(f"  changes vs {prev}: {ln['nueva']:,} new, {ln['eliminada']:,} removed, "
              f"{ln['modificada']:,} modified lines -> {lake.rel(out)} ({out.stat().st_size/1e6:.1f} MB)")
    lake.save_manifest(m)
    return pub


def update(years: list[int], datasets: list[str], keep_raw: bool = False) -> list[tuple[str, int, str]]:
    """Check MEF for each dataset-year; ingest new publications. Returns [(dataset, year, pub)]."""
    m = lake.load_manifest()
    nuevas = []
    for ds in datasets:
        for year in years:
            src = resolve_source(ds, year)
            if not src:
                print(f"  {ds} {year}: no file on the MEF server")
                continue
            if lake.is_known(m, ds, year, src):
                print(f"  {ds} {year}: unchanged ({src['name']}, {src['last_modified']})")
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
    return nuevas
