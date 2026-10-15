"""changes.diff(): the budget change log must capture new, removed and re-budgeted lines exactly."""
import duckdb

from conftest import FIXTURES
from changes import diff
from normalize import normalize


def _prev(tmp_path):
    prev = tmp_path / "prev.parquet"  # fixture has execution data through January
    normalize("gasto", 2024, [FIXTURES / "2024-Gasto-Devengado-Mensual-Extracto-test.csv"], prev)
    return prev


def test_diff_between_publications(tmp_path):
    prev = _prev(tmp_path)
    # next "publication": line 1 gets +1,000,000 PIM and a revised January (closed month);
    # line 4 only executes in February (normal progress); line 2 disappears; a new line appears
    new = tmp_path / "new.parquet"
    con = duckdb.connect()
    con.execute(f"CREATE TABLE p AS SELECT row_number() OVER () AS rn, * FROM read_parquet('{prev}')")
    con.execute("""UPDATE p SET MONTO_PIM = MONTO_PIM + 1000000, MONTO_DEVENGADO_ENERO = MONTO_DEVENGADO_ENERO + 5
                   WHERE rn = 1""")
    con.execute("UPDATE p SET MONTO_DEVENGADO_FEBRERO = MONTO_DEVENGADO_FEBRERO + 100 WHERE rn = 4")
    con.execute("DELETE FROM p WHERE rn = 2")
    con.execute("INSERT INTO p SELECT * REPLACE (99 AS rn, '999999' AS SEC_FUNC, 50000.00 AS MONTO_PIM) "
                "FROM p WHERE rn = 3")
    con.execute(f"COPY (SELECT * EXCLUDE (rn) FROM p) TO '{new}' (FORMAT parquet)")

    out = tmp_path / "cambios.parquet"
    s = diff("gasto", prev, new, out)

    assert s["lineas"] == {"nueva": 1, "eliminada": 1, "presupuesto_modificado": 1}
    assert s["campos_modificados"] == {"MONTO_PIM": 1, "MONTO_DEVENGADO_ENERO": 1, "MONTO_DEVENGADO_FEBRERO": 1}
    assert s["meses_cerrados_revisados"] == {1: {"lineas": 1, "neto": "5.00"}}
    log = f"read_parquet('{out}')"
    assert con.execute(f"SELECT count(*) FROM {log}").fetchone()[0] == 3  # February progress is not a budget change
    delta = con.execute(f"""SELECT MONTO_PIM_DESPUES - MONTO_PIM_ANTES FROM {log}
                            WHERE ESTADO = 'modificada'""").fetchone()[0]
    assert delta == 1000000
    nueva = con.execute(f"SELECT MONTO_PIM_ANTES, MONTO_PIM_DESPUES FROM {log} WHERE ESTADO = 'nueva'").fetchone()
    assert nueva[0] is None and nueva[1] == 50000
    # the log is self-describing: names travel with it
    assert con.execute(f"SELECT count(*) FROM {log} WHERE EJECUTORA_NOMBRE IS NULL").fetchone()[0] == 0


def test_identical_publications_have_empty_log(tmp_path):
    prev = _prev(tmp_path)
    s = diff("gasto", prev, prev, tmp_path / "cambios.parquet")
    assert s["lineas"] == {"nueva": 0, "eliminada": 0, "presupuesto_modificado": 0}
    assert s["campos_modificados"] == {} and s["meses_cerrados_revisados"] == {}
