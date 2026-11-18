"""Reconciliation with Consulta Amigable, on the pages CI fetched on 2026-10-18 (trimmed)."""
from datetime import date

import qa as Q
from conftest import FIXTURES

# national 2026 totals by month from the 17 Oct Diario files (October is partial)
DEVENGADO = [21917558425.02, 23897577968.90, 19846389538.26, 20050910678.53, 19255603325.71, 19561370954.20,
             21752845506.10, 28497616452.18, 21726190760.72, 10646146113.44]
RECAUDADO = [30516655967.51, 15969338592.54, 7823655912.60, 7596932270.61, 7134230179.68, 6087179179.80,
             13931156314.73, 13935634494.37, 5662709579.32, 705725257.14]
OCT17 = {"pia": 257_561_619_143.0, "pim": 289_832_389_371.0, "devengado_mes": dict(enumerate(DEVENGADO, 1)),
         "ing_pia": 86_322_078_932.0, "ing_pim": 118_358_408_077.0, "recaudado_mes": dict(enumerate(RECAUDADO, 1)),
         "corte": {"gasto": date(2026, 10, 17), "ingreso": date(2026, 10, 17)}}


def _reconciliar(monkeypatch, tmp_path, vals) -> dict:
    paginas = {lado: (FIXTURES / f"ca_{lado}_2026-09-30.html").read_text() for lado in ("gasto", "ingreso")}
    monkeypatch.setattr(Q, "_fetch", lambda url: paginas["ingreso" if "ingresos" in url else "gasto"])
    monkeypatch.setattr(Q, "SERVING", tmp_path)
    rep = Q.Report()
    Q._reconcile(rep, 2026, vals)
    return {c["check"]: c for c in rep.checks}


def test_month_end_snapshot_is_compared_over_the_months_it_covers(monkeypatch, tmp_path):
    """CA publishes month-end snapshots (30 Sep) while MEF's daily file runs ahead (17 Oct)."""
    assert Q._corte_ca((FIXTURES / "ca_gasto_2026-09-30.html").read_text()) == date(2026, 9, 30)
    r = _reconciliar(monkeypatch, tmp_path, OCT17)
    assert r["gasto PIA matches CA"]["status"] == "PASS"
    dev = r["gasto devengado months 1-9 matches CA"]
    assert dev["status"] == "PASS" and "Δ 0.00%" in dev["detail"], "read DEVENGADO, not COMPROMISO MENSUAL"
    rec = r["ingreso recaudado months 1-9 matches CA"]  # late entries keep filling past months
    assert rec["status"] == "WARN" and "2026-09-30" in rec["detail"]
    assert not [c for c in r.values() if c["status"] == "FAIL"]


def test_the_october_semantics_bug_still_fails(monkeypatch, tmp_path):
    r = _reconciliar(monkeypatch, tmp_path, {**OCT17, "pia": 41_722_256_508.0, "pim": 9_979_250_403.0})
    assert r["gasto PIA matches CA"]["status"] == "FAIL" and r["gasto PIM matches CA"]["status"] == "FAIL"


def test_pim_is_checked_against_our_file_of_cas_cut_date(monkeypatch, tmp_path):
    """17 Nov 2026: revenue PIM was 5.1% above CA's 31 Oct page, all of it budget added in November;
    our 31 Oct file matched CA exactly. The check reads the file of CA's date, not today's."""
    ca_pim = {lado: Q._total_ca((FIXTURES / f"ca_{lado}_2026-09-30.html").read_text())["PIM"] for lado in ("gasto", "ingreso")}
    lejos = {**OCT17, "pim": ca_pim["gasto"] * 1.07, "ing_pim": ca_pim["ingreso"] * 1.07,
             "pim_dia": {lado: {date(2026, 9, 29): ca_pim[lado] * 0.99, date(2026, 9, 30): ca_pim[lado],
                                date(2026, 10, 17): ca_pim[lado] * 1.07} for lado in ("gasto", "ingreso")}}
    r = _reconciliar(monkeypatch, tmp_path, lejos)
    for lado in ("gasto", "ingreso"):
        assert r[f"{lado} PIM matches CA"]["status"] == "PASS" and "2026-09-30 file" in r[f"{lado} PIM matches CA"]["detail"]
    # a misread file of that same day still fails
    mal = {**lejos, "pim_dia": {lado: {date(2026, 9, 30): ca_pim[lado] * 0.5} for lado in ("gasto", "ingreso")}}
    assert _reconciliar(monkeypatch, tmp_path, mal)["ingreso PIM matches CA"]["status"] == "FAIL"
    # a Sunday cut: the Friday file stands in; nothing within 3 days falls back to today's file
    assert Q._pim_al_corte({date(2026, 5, 29): 1.0}, date(2026, 5, 31)) == (date(2026, 5, 29), 1.0)
    assert Q._pim_al_corte({date(2026, 5, 20): 1.0}, date(2026, 5, 31)) is None
