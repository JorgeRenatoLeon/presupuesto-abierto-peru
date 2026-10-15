"""normalize(): raw MEF CSV -> canonical wide Parquet must be lossless and format-independent."""
from collections import Counter

import duckdb
import ftfy
import pytest

from conftest import FIXTURES
from config import CANON
from normalize import normalize, SUSPICIOUS


def _csv(name):
    return FIXTURES / name


def test_pivoted_gasto_is_lossless(tmp_path):
    csv = _csv("2024-Gasto-Devengado-Mensual-Extracto-test.csv")
    out = tmp_path / "gasto.parquet"
    stats = normalize("gasto", 2024, [csv], out)

    con = duckdb.connect()
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_csv('{csv}', all_varchar=true)").fetchall()]
    def typed(c):
        if c.startswith("MONTO_"):
            return f'CAST("{c}" AS DECIMAL(18,2))'
        return 'CAST("ANO_EJE" AS INTEGER)' if c == "ANO_EJE" else f'"{c}"'
    select = ", ".join(typed(c) for c in cols)
    raw = con.execute(f"SELECT {select} FROM read_csv('{csv}', all_varchar=true)").fetchall()
    pq = con.execute(f"SELECT {', '.join(chr(34) + c + chr(34) for c in cols)} FROM read_parquet('{out}')").fetchall()
    # names with mojibake are repaired on purpose; everything else must match exactly
    names = {i for i, c in enumerate(cols) if c.endswith("_NOMBRE")}
    fix = lambda v: ftfy.fix_text(v) if v and any(m in v for m in SUSPICIOUS) else v
    raw = [tuple(fix(v) if i in names else v for i, v in enumerate(r)) for r in raw]
    assert Counter(raw) == Counter(pq)
    assert stats["rows"] == 21
    # canonical schema, in canonical order, whatever the source had
    got = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{out}')").fetchall()]
    assert got == CANON["gasto"]["dims"] + CANON["gasto"]["montos"]


def test_monthly_rows_gasto_is_pivoted(tmp_path):
    csv = _csv("2026-Gasto-Diario-Extracto-test.csv")  # 63-col format, MES_EJE rows
    out = tmp_path / "gasto.parquet"
    stats = normalize("gasto", 2026, [csv], out)

    con = duckdb.connect()
    src = f"read_csv('{csv}', all_varchar=true)"
    keys = [c for c in CANON["gasto"]["dims"] if not c.endswith("_NOMBRE") and c != "ANO_EJE"]
    keys = [c for c in keys if c in [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]]
    n_keys = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT {', '.join(keys)} FROM {src})").fetchone()[0]
    assert stats["rows"] == n_keys
    dev_src = con.execute(f"SELECT sum(CAST(MONTO_DEVENGADO AS DECIMAL(38,2))) FROM {src}").fetchone()[0]
    dev_jul, dev_anual, otros = con.execute(f"""SELECT sum(MONTO_DEVENGADO_JULIO), sum(MONTO_DEVENGADO_ANUAL),
        sum(MONTO_DEVENGADO_ENERO + MONTO_DEVENGADO_DICIEMBRE) FROM read_parquet('{out}')""").fetchone()
    assert dev_jul == dev_anual == dev_src and otros == 0
    pim_src = con.execute(f"SELECT sum(CAST(MONTO_PIM AS DECIMAL(38,2))) FROM {src}").fetchone()[0]
    assert con.execute(f"SELECT sum(MONTO_PIM) FROM read_parquet('{out}')").fetchone()[0] == pim_src
    assert stats["format"] == "monthly" and stats["mes_ult"] in (0, 7)


def test_monthly_rows_ingreso_keeps_each_month(tmp_path):
    csv = _csv("2026-Ingreso-Recaudado-Mensual-fixture-test.csv")  # ANO_DOC/MES_DOC rows
    out = tmp_path / "ingreso.parquet"
    normalize("ingreso", 2026, [csv], out)

    con = duckdb.connect()
    by_month = dict(con.execute(f"""SELECT CAST(MES_DOC AS INTEGER), sum(CAST(MONTO_RECAUDADO AS DECIMAL(38,2)))
        FROM read_csv('{csv}', all_varchar=true) GROUP BY 1""").fetchall())
    meses = CANON["ingreso"]["montos"][2:14]
    got = con.execute(f"SELECT {', '.join(f'sum({m})' for m in meses)} FROM read_parquet('{out}')").fetchone()
    for i, v in enumerate(got, start=1):
        assert v == by_month.get(i, 0), (i, v, by_month.get(i))


def test_pivoted_ingreso_without_optional_columns(tmp_path):
    csv = _csv("2025-Ingreso-Recaudado-fixture-test.csv")
    out = tmp_path / "ingreso.parquet"
    stats = normalize("ingreso", 2025, [csv], out)
    con = duckdb.connect()
    anual, suma = con.execute(f"""SELECT sum(MONTO_RECAUDADO_ANUAL),
        sum({' + '.join(CANON['ingreso']['montos'][2:14])}) FROM read_parquet('{out}')""").fetchone()
    assert stats["rows"] == 4 and anual == suma


def test_wrong_year_is_rejected(tmp_path):
    with pytest.raises(SystemExit):
        normalize("gasto", 2025, [_csv("2024-Gasto-Devengado-Mensual-Extracto-test.csv")], tmp_path / "x.parquet")
