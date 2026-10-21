"""Backfill: every past year the sources publish, newest first, inside a storage budget."""
import time
from datetime import date
from types import SimpleNamespace

import historia as H


def test_plan_goes_back_newest_first_every_source_of_a_year():
    p = H.plan(date(2026, 10, 21))
    assert p[:4] == [("gasto", 2024), ("ingreso", 2024), ("contratos", 2024), ("ordenes", 2024)], \
        "the daily update keeps 2025-2026; history starts at 2024"
    assert ("ordenes", 2017) not in p and ("gasto", 2009) in p and ("gasto", 2008) not in p


def test_pending_skips_what_is_there_pruned_or_recently_failed():
    reg = {"gasto/2024": {"estado": "podado"}, "ingreso/2024": {"estado": "fallido", "ts": time.time()},
           "ordenes/2023": {"estado": "hecho"}}
    remotos = {"contratos/2024.parquet"}
    manifest = {"datasets": {"gasto": {"2023": {}}}}
    p = H.pendientes(reg, remotos, manifest)
    assert p[:3] == [("ordenes", 2024), ("ingreso", 2023), ("contratos", 2023)]
    assert H.pendientes(reg, remotos, manifest, solo=["contratos"])[0] == ("contratos", 2023)


def test_over_budget_prunes_the_oldest_backfilled_year_first(tmp_path, monkeypatch):
    archivos = {"gasto/2026.parquet": 80e6, "snapshots/gasto/2026/2026-10-18.parquet": 80e6,
                "gasto/2015.parquet": 70e6, "snapshots/gasto/2015/2025-01-01.parquet": 70e6,
                **{f"ordenes/2018/{m:02d}.parquet": 15e6 for m in range(1, 13)}}
    borrados, compactado, empujado = [], [], []
    fake_api = SimpleNamespace(
        dataset_info=lambda repo, expand: SimpleNamespace(used_storage=sum(archivos.values()) * 1.5),
        list_repo_tree=lambda repo, repo_type, recursive: [SimpleNamespace(path=p, size=s) for p, s in archivos.items()])
    import hfsync
    monkeypatch.setattr(hfsync, "repo", lambda: "u/d")
    monkeypatch.setattr(hfsync, "api", lambda: fake_api)
    monkeypatch.setattr(hfsync, "borrar", lambda rutas, msg: borrados.append(rutas))
    monkeypatch.setattr(hfsync, "compactar", lambda msg: compactado.append(msg))
    monkeypatch.setattr(hfsync, "push", lambda paths, msg: empujado.append(msg))
    monkeypatch.setattr(H, "REGISTRO", tmp_path / "historia.json")
    H._guardar({"gasto/2015": {"estado": "hecho"}, "ordenes/2018": {"estado": "hecho"}})
    hecho = H.mantener(limite_gb=0.3)  # 0.48 GB of files: over 85% of 0.3 GB until two years go
    assert hecho["podados"] == ["gasto/2015", "ordenes/2018"], "oldest year first; the site's years are never pruned"
    assert borrados[0] == ["gasto/2015.parquet", "snapshots/gasto/2015/2025-01-01.parquet"]
    assert compactado, "deleted files only free space once the history is squashed"
    assert H._registro()["gasto/2015"]["estado"] == "podado"
