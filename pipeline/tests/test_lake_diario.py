"""Daily refresh, weekly history: every day's MEF file updates the site; one a week is kept for good,
and "since the last update" always compares with a snapshot at least a week older."""
from datetime import datetime, timezone

import lake as L

ANO = datetime.now(timezone.utc).year


def _m(pubs: dict[str, bool]) -> dict:
    return {"datasets": {"gasto": {str(ANO): {"latest": max(pubs), "publications": {
        p: ({} if g is None else {"snapshot": g}) for p, g in pubs.items()}}}}}


def test_one_publication_a_week_is_kept():
    m = _m({f"{ANO}1017T133819Z": None})  # before daily ingests every publication was a snapshot
    assert L.guardar_snapshot(m, "gasto", ANO, f"{ANO}1022T141849Z") is False, "five days later: a daily refresh"
    assert L.guardar_snapshot(m, "gasto", ANO, f"{ANO}1024T120000Z") is True, "a week later, give or take a few hours"
    assert L.guardar_snapshot(m, "gasto", ANO - 1, f"{ANO - 1}1201T000000Z") is True, "past years: always kept"
    assert L.guardar_snapshot(_m({f"{ANO}0101T000000Z": False}), "gasto", ANO, f"{ANO}0102T000000Z") is True, \
        "no snapshot yet this year: keep it"


def test_since_the_last_update_spans_at_least_a_week():
    m = _m({f"{ANO}1010T140000Z": True, f"{ANO}1017T140000Z": True, f"{ANO}1020T140000Z": False})
    assert L.base_comparacion(m, "gasto", ANO) == f"{ANO}1010T140000Z", \
        "three days after a snapshot, the window goes back to the one before it, not to three days"
    m = _m({f"{ANO}1010T140000Z": True, f"{ANO}1017T140000Z": True})
    assert L.base_comparacion(m, "gasto", ANO) == f"{ANO}1010T140000Z", "on a snapshot day: the week before"
    m = _m({f"{ANO}1015T140000Z": True, f"{ANO}1017T140000Z": False})
    assert L.base_comparacion(m, "gasto", ANO) == f"{ANO}1015T140000Z", "history shorter than a week: the latest kept"
    assert L.snapshots(m, "gasto", ANO) == [f"{ANO}1015T140000Z"]


def test_a_daily_refresh_writes_only_the_latest_file(tmp_path, monkeypatch):
    monkeypatch.setattr(L, "LAKE", tmp_path)
    m = {"datasets": {}}
    stats = {"rows": 1, "mes_ult": 10, "totals": {}}
    for pub, guardar in ((f"{ANO}1017T133819Z", True), (f"{ANO}1022T141849Z", False)):
        tmp = tmp_path / f"{pub}.tmp"
        tmp.write_text(pub)
        L.add_publication(m, "gasto", ANO, pub, tmp, {}, stats, guardar=guardar)
    assert L.latest_path("gasto", ANO).read_text() == f"{ANO}1022T141849Z"
    assert L.snapshot_path("gasto", ANO, f"{ANO}1017T133819Z").exists()
    assert not L.snapshot_path("gasto", ANO, f"{ANO}1022T141849Z").exists()
    assert L.latest_pub(m, "gasto", ANO) == f"{ANO}1022T141849Z" and not L.guardada(m, "gasto", ANO, f"{ANO}1022T141849Z")
