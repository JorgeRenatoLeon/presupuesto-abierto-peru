"""update(): when to download, and failing loudly when MEF can't be checked."""
from datetime import datetime, timedelta, timezone

import pytest
import requests

import download
import update as U

AHORA = datetime.now(timezone.utc)
SRC = {"name": "2026-Gasto-Diario.csv", "url": "x", "size": 8_335_000_000, "etag": '"nuevo"',
       "last_modified": "Sat, 17 Oct 2026 13:38:19 GMT", "accept_ranges": True}


def _manifest(dias_desde_ingesta: float) -> dict:
    hace = (AHORA - timedelta(days=dias_desde_ingesta)).strftime("%Y-%m-%dT%H:%M:%SZ")
    pub = {"source": {"etag": '"viejo"', "size": 1, "last_modified": "Thu, 03 Sep 2026 20:04:28 GMT"},
           "ingested_at": hace}
    return {"datasets": {"gasto": {str(AHORA.year): {"latest": "20260903T200428Z",
                                                     "publications": {"20260903T200428Z": pub}}}}}


@pytest.fixture
def sin_red(monkeypatch):
    """No downloads or ingests in these tests: record what update() would have done."""
    hechos = []
    monkeypatch.setattr(U, "fetch", lambda src, dest: hechos.append(("fetch", src["name"])))
    monkeypatch.setattr(U, "is_downloaded", lambda src, dest: False)
    monkeypatch.setattr(U, "ingest", lambda *a, **k: hechos.append(("ingest",)) or None)
    return hechos


def test_republished_file_waits_for_the_cadence(monkeypatch, sin_red):
    monkeypatch.setattr(U.lake, "load_manifest", lambda: _manifest(dias_desde_ingesta=0.3))
    monkeypatch.setattr(U, "resolve_source", lambda ds, y, **kw: SRC)
    assert U.update([AHORA.year], ["gasto"]) == []
    assert sin_red == [], "a file re-stamped the same day must not be downloaded again (daily cadence)"


def test_republished_file_is_ingested_after_the_cadence(monkeypatch, sin_red):
    monkeypatch.setattr(U.lake, "load_manifest", lambda: _manifest(dias_desde_ingesta=1))
    monkeypatch.setattr(U, "resolve_source", lambda ds, y, **kw: SRC)
    monkeypatch.setattr(U.Path, "unlink", lambda self, missing_ok=False: None)
    U.update([AHORA.year], ["gasto"])
    assert ("fetch", SRC["name"]) in sin_red


def test_unreachable_server_fails_the_run(monkeypatch, sin_red):
    monkeypatch.setattr(U.lake, "load_manifest", lambda: _manifest(dias_desde_ingesta=8))
    def caida(ds, y, **kw):
        raise IOError("MEF server: could not check")
    monkeypatch.setattr(U, "resolve_source", caida)
    with pytest.raises(IOError):
        U.update([AHORA.year], ["gasto"])


def test_no_file_anywhere_fails_the_run(monkeypatch, sin_red):
    monkeypatch.setattr(U.lake, "load_manifest", lambda: {"datasets": {}})
    monkeypatch.setattr(U, "resolve_source", lambda ds, y, **kw: None)
    with pytest.raises(SystemExit):
        U.update([AHORA.year, AHORA.year - 1], ["gasto", "ingreso"])


class _Resp:
    def __init__(self, status):
        self.status_code, self.headers = status, {}


def test_head_404_means_missing_but_errors_raise(monkeypatch):
    monkeypatch.setattr(download.time, "sleep", lambda s: None)
    monkeypatch.setattr(download.requests, "head", lambda *a, **k: _Resp(404))
    assert download.head("2026-Gasto-Devengado-Mensual.csv") is None
    monkeypatch.setattr(download.requests, "head", lambda *a, **k: _Resp(503))
    with pytest.raises(IOError):
        download.head("2026-Gasto-Diario.csv")
    def timeout(*a, **k):
        raise requests.ConnectTimeout("boom")
    monkeypatch.setattr(download.requests, "head", timeout)
    with pytest.raises(IOError):
        download.head("2026-Gasto-Diario.csv")


def _stats(pia, pim, dev):
    return {"totals": {"MONTO_PIA": str(pia), "MONTO_PIM": str(pim), "MONTO_DEVENGADO_ANUAL": str(dev)}}


def test_sanity_rejects_the_october_bug_and_accepts_normal_growth():
    previo = _stats(257_561_619_143, 286_785_787_229, 174_772_690_062)
    U.cordura("gasto", _stats(257_561_619_143, 295_000_000_000, 207_000_000_000), previo)  # a normal month
    with pytest.raises(SystemExit, match="PIA is fixed"):
        U.cordura("gasto", _stats(41_722_256_508, 9_979_250_403, 207_152_209_723), previo)  # 2026-10-18
    with pytest.raises(SystemExit, match="exceeds PIM"):
        U.cordura("gasto", _stats(41_722_256_508, 9_979_250_403, 207_152_209_723), None)  # even with no history


def test_ingesting_two_publications_writes_the_change_log(tmp_path, monkeypatch):
    """The real ingest() path: second publication is diffed against the first (no mocks)."""
    import duckdb
    from conftest import FIXTURES
    monkeypatch.setattr(U.lake, "LAKE", tmp_path)
    monkeypatch.setattr(U, "LAKE", tmp_path)
    csv1 = FIXTURES / "2024-Gasto-Devengado-Mensual-Extracto-test.csv"
    csv2 = tmp_path / "segunda.csv"  # same lines, one budget raised by S/ 1,000
    con = duckdb.connect()
    con.execute(f"CREATE TABLE t AS SELECT row_number() OVER () rn, * FROM read_csv('{csv1}', all_varchar=true)")
    con.execute("UPDATE t SET MONTO_PIM = CAST(CAST(MONTO_PIM AS DECIMAL(18,2)) + 1000 AS VARCHAR) WHERE rn = 1")
    con.execute(f"COPY (SELECT * EXCLUDE (rn) FROM t ORDER BY rn) TO '{csv2}' (HEADER, FORCE_QUOTE *)")
    m = {"datasets": {}}
    fuente = lambda fecha: {"name": "x.csv", "etag": fecha, "size": 1, "last_modified": fecha}
    p1 = U.ingest("gasto", 2024, [csv1], fuente("Thu, 02 Jul 2026 21:21:03 GMT"), m)
    p2 = U.ingest("gasto", 2024, [csv2], fuente("Thu, 03 Sep 2026 20:04:28 GMT"), m)
    pubs = m["datasets"]["gasto"]["2024"]["publications"]
    assert sorted(pubs) == [p1, p2] and m["datasets"]["gasto"]["2024"]["latest"] == p2
    assert pubs[p2]["cambios"]["lineas"] == {"nueva": 0, "eliminada": 0, "presupuesto_modificado": 1}
    assert (tmp_path / "cambios" / "gasto" / "2024" / f"{p2}.parquet").exists()


def test_the_current_year_comes_from_the_daily_file(monkeypatch, sin_red):
    """MEF posts a monthly-format file now and then (22 Oct 2026, a month behind and without monthly
    commitments): the current year must still come from the daily file, the previous one need not."""
    from config import source_files
    assert source_files("gasto", AHORA.year, prefer_diario=True)[0] == f"{AHORA.year}-Gasto-Diario.csv"
    assert source_files("ingreso", AHORA.year, prefer_diario=True)[0] == f"{AHORA.year}-Ingreso-Diario.csv"
    assert source_files("gasto", AHORA.year - 1)[0] == f"{AHORA.year - 1}-Gasto-Devengado-Mensual.csv"
    pedidos = []
    monkeypatch.setattr(U.lake, "load_manifest", lambda: _manifest(dias_desde_ingesta=0.3))
    monkeypatch.setattr(U, "resolve_source", lambda ds, y, prefer_diario=False: pedidos.append((y, prefer_diario)) or SRC)
    monkeypatch.setattr(U.lake, "is_known", lambda *a: True)  # only which file is asked for matters here
    U.update([AHORA.year, AHORA.year - 1], ["gasto"])
    assert pedidos == [(AHORA.year, True), (AHORA.year - 1, False)]
