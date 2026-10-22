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
    assert got == CANON["gasto"]["dims"] + CANON["gasto"]["montos"] + CANON["gasto"]["opcionales"], \
        "a pivoted source has no monthly commitments: the columns exist, empty"


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


# MEF's *-Diario layout (the only source since October 2026), header as published
DIARIO = ("ANO_EJE,MES_EJE,NIVEL_GOBIERNO,NIVEL_GOBIERNO_NOMBRE,SECTOR,SECTOR_NOMBRE,PLIEGO,PLIEGO_NOMBRE,SEC_EJEC,"
          "EJECUTORA,EJECUTORA_NOMBRE,DEPARTAMENTO_EJECUTORA,DEPARTAMENTO_EJECUTORA_NOMBRE,PROVINCIA_EJECUTORA,"
          "PROVINCIA_EJECUTORA_NOMBRE,DISTRITO_EJECUTORA,DISTRITO_EJECUTORA_NOMBRE,SEC_FUNC,PROGRAMA_PPTO,"
          "PROGRAMA_PPTO_NOMBRE,TIPO_ACT_PROY,TIPO_ACT_PROY_NOMBRE,PRODUCTO_PROYECTO,PRODUCTO_PROYECTO_NOMBRE,"
          "ACTIVIDAD_ACCION_OBRA,ACTIVIDAD_ACCION_OBRA_NOMBRE,FUNCION,FUNCION_NOMBRE,DIVISION_FUNCIONAL,"
          "DIVISION_FUNCIONAL_NOMBRE,GRUPO_FUNCIONAL,GRUPO_FUNCIONAL_NOMBRE,META,FINALIDAD,META_NOMBRE,"
          "DEPARTAMENTO_META,DEPARTAMENTO_META_NOMBRE,FUENTE_FINANCIAMIENTO,FUENTE_FINANCIAMIENTO_NOMBRE,RUBRO,"
          "RUBRO_NOMBRE,TIPO_RECURSO,TIPO_RECURSO_NOMBRE,CATEGORIA_GASTO,CATEGORIA_GASTO_NOMBRE,TIPO_TRANSACCION,"
          "GENERICA,GENERICA_NOMBRE,SUBGENERICA,SUBGENERICA_NOMBRE,SUBGENERICA_DET,SUBGENERICA_DET_NOMBRE,"
          "ESPECIFICA,ESPECIFICA_NOMBRE,ESPECIFICA_DET,ESPECIFICA_DET_NOMBRE,MONTO_PIA,MONTO_PIM,MONTO_CERTIFICADO,"
          "MONTO_COMPROMETIDO_ANUAL,MONTO_COMPROMETIDO,MONTO_DEVENGADO,MONTO_GIRADO").split(",")


def test_diario_sums_month_zero_budget_and_monthly_execution(tmp_path):
    """Month 0 rows hold PIA/PIM; months 1-12 hold execution. Taking the latest month's PIA/PIM
    (the old logic) collapsed national PIA to S/ 42 bn in production; summing restores it."""
    def fila(linea, mes, tipo, pia=0, pim=0, cert=0, comp_anual=0, comp=0, dev=0, gir=0):
        r = {c: "X" for c in DIARIO}
        r.update(ANO_EJE="2026", MES_EJE=str(mes), SEC_EJEC="300001", SEC_FUNC=linea, META=linea,
                 TIPO_ACT_PROY={"PROYECTO": "2", "ACTIVIDAD": "3"}[tipo], TIPO_ACT_PROY_NOMBRE=tipo,
                 MONTO_PIA=f"{pia:.2f}", MONTO_PIM=f"{pim:.2f}", MONTO_CERTIFICADO=f"{cert:.2f}",
                 MONTO_COMPROMETIDO_ANUAL=f"{comp_anual:.2f}", MONTO_COMPROMETIDO=f"{comp:.2f}",
                 MONTO_DEVENGADO=f"{dev:.2f}", MONTO_GIRADO=f"{gir:.2f}")
        return ",".join(f'"{r[c]}"' for c in DIARIO)
    filas = [
        fila("0001", 0, "PROYECTO", pia=100, pim=150),
        fila("0001", 1, "PROYECTO", cert=50, comp_anual=40, comp=30, dev=20, gir=10),
        fila("0001", 2, "PROYECTO", cert=10, comp_anual=10, comp=10, dev=15, gir=5),
        fila("0002", 0, "ACTIVIDAD", pim=80),             # created during the year: no PIA
        fila("0002", 2, "ACTIVIDAD", dev=8, gir=8),
    ]
    csv = tmp_path / "2026-Gasto-Diario.csv"
    csv.write_text(",".join(f'"{c}"' for c in DIARIO) + "\n" + "\n".join(filas) + "\n")
    out = tmp_path / "gasto.parquet"
    stats = normalize("gasto", 2026, [csv], out)

    con = duckdb.connect()
    got = {r[0]: r[1:] for r in con.execute(f"""
        SELECT SEC_FUNC, TIPO_ACT_PROY, MONTO_PIA, MONTO_PIM, MONTO_CERTIFICADO_ANUAL, MONTO_COMPROMETIDO_ANUAL,
               MONTO_DEVENGADO_ENERO, MONTO_DEVENGADO_FEBRERO, MONTO_DEVENGADO_ANUAL, MONTO_GIRADO_ANUAL
        FROM read_parquet('{out}')""").fetchall()}
    assert stats["rows"] == 2 and stats["mes_ult"] == 2 and stats["format"] == "monthly"
    assert got["0001"] == ("PROYECTO", 100, 150, 60, 50, 20, 15, 35, 15)
    assert got["0002"] == ("ACTIVIDAD", 0, 80, 0, 0, 0, 8, 8, 8)
    assert stats["totals"]["MONTO_PIA"] == "100.00" and stats["totals"]["MONTO_PIM"] == "230.00"
