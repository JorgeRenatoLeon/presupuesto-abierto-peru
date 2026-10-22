"""Month by month with commitments: what a unit spent each month and the commitments it registered,
with the period the data covers, so a commitment can be read per month until December."""
import json

import duckdb

import exportar as X
from config import MESES


def _con(lineas):
    con = duckdb.connect()
    cols = ["SEC_EJEC VARCHAR", "ANO_EJE INTEGER", "TIPO_TRANSACCION VARCHAR", "GENERICA VARCHAR", "SUBGENERICA VARCHAR",
            "SUBGENERICA_DET VARCHAR", "ESPECIFICA VARCHAR", "ESPECIFICA_DET VARCHAR", "MONTO_PIM DOUBLE"]
    cols += [f'"{p}_{m}" DOUBLE' for p in ("MONTO_DEVENGADO", "MONTO_COMPROMETIDO_ANUAL", "MONTO_COMPROMETIDO_MENSUAL") for m in MESES]
    con.execute(f"CREATE TABLE gasto_wide ({', '.join(cols)})")
    for sec, clas, pim, dev, comp, mens in lineas:
        fila = [sec, 2026, *clas.split("."), pim] + [(serie + [0] * 12)[:12][k] for serie in (dev, comp, mens) for k in range(12)]
        con.execute(f"INSERT INTO gasto_wide VALUES ({', '.join('?' * len(fila))})", fila)
    con.execute("CREATE TABLE fact_entidad_mes AS SELECT 2026 AS ano, 10 AS mes")
    return con


def test_a_units_months_and_its_commitments(tmp_path):
    vales = ("1061", "2.1.2.1.2.5", 203010, [0, 16319, 8365, 9388, 8625, 7846, 0, 17158, 22049, 22653],
             [71882, 0, 0, 0, 0, 0, 21338, 0, 109125, 0], [71882, 0, 0, 0, 0, 0, 17158, 0, 113305, 0])
    nada = ("1061", "2.3.1.1.1.1", 5, [0] * 10, [0] * 10, [0] * 10)
    con = _con([vales, nada])
    resumen = {"publicacion": {"id": "20261022T141849Z"}, "mes_ult": 10}
    X._meses(con, tmp_path, resumen, 2026)
    d = json.loads((tmp_path / "mes" / "1061.json").read_text())
    assert d["corte"] == "2026-10-21" and d["m"] == 10, "a file published on 22 October covers 21 of its days"
    assert round(d["transcurridos"], 2) == round(9 + 21 / 31, 2) and round(d["restantes"], 2) == round(3 - 21 / 31, 2)
    assert [l[0] for l in d["l"]] == ["2.1.2.1.2.5"], "a line with no movement at all is left out"
    assert d["l"][0][3][8] == 109125 and d["l"][0][4][8] == 113305, "September: annual and monthly commitments"
    assert d["t"][2] == d["l"][0][3] and "o" not in d
    assert d["t"][0] == 203015, "the unit's whole budget, including lines that did not move"


def test_small_lines_are_summed_so_totals_still_add_up(tmp_path, monkeypatch):
    monkeypatch.setattr(X, "MES_TOP_MENSUAL", 1)
    monkeypatch.setattr(X, "MES_TOP_ANUAL", 1)
    lineas = [("9", f"2.3.1.{i}.1.1", 100, [i * 10] * 10, [0] * 10, [0] * 10) for i in range(1, 6)]
    X._meses(_con(lineas), tmp_path, {"publicacion": {"id": "20261101T120000Z"}, "mes_ult": 10}, 2026)
    d = json.loads((tmp_path / "mes" / "9.json").read_text())
    assert len(d["l"]) == 1 and d["o"][0] == 4, "the largest line listed, the other four summed"
    assert [a + b for a, b in zip(d["l"][0][2], d["o"][2])] == d["t"][1]
    assert d["restantes"] == 2.0, "a file published in November covers all of October"
