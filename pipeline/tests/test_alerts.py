"""Each alert rule must fire on crafted data, and only where it should."""
import json

import duckdb

import alerts as A

MEDIDAS = "pia DOUBLE, pim DOUBLE, devengado DOUBLE, pim_pub_ant DOUBLE, pia_ano_ant DOUBLE, " \
          "pim_ano_ant DOUBLE, dev_ano_ant_periodo DOUBLE, dev_ano_ant DOUBLE"


def build_synthetic(serving) -> None:
    con = duckdb.connect(str(serving / "serving.duckdb"))
    con.execute("""
        CREATE TABLE dim_entidad AS SELECT * FROM (VALUES
            ('E1','001','MUNICIPALIDAD DE PRUEBA','M','GOBIERNOS LOCALES','15','LIMA','01','LIMA','01','MIRAFLORES'),
            ('E2','002','GOBIERNO REGIONAL DEMO','R','GOBIERNOS REGIONALES','01','AMAZONAS','01','CHACHAPOYAS','01','CHACHAPOYAS'),
            ('E3','003','ENTIDAD SIN PIA','E','GOBIERNO NACIONAL','15','LIMA','01','LIMA','01','LIMA')
        ) t(sec_ejec, ejecutora, nombre, nivel, nivel_nombre, dept, dept_nombre, prov, prov_nombre, dist, dist_nombre)
    """)
    # E2: PIM 12M, devengado tiny by June -> R2 (avance ~2% vs 50%). E3: PIA=0, PIM=8M -> R3.
    con.execute("""
        CREATE TABLE fact_entidad_mes AS
        SELECT * FROM (VALUES
            (2026, 5, 'E1', 10000000.0, 20000000.0, 800000.0),
            (2026, 6, 'E1', 10000000.0, 20000000.0, 900000.0),
            (2026, 5, 'E2', 12000000.0, 12000000.0, 100000.0),
            (2026, 6, 'E2', 12000000.0, 12000000.0, 150000.0),
            (2026, 5, 'E3',        0.0,  8000000.0, 400000.0),
            (2026, 6, 'E3',        0.0,  8000000.0, 400000.0)
        ) t(ano, mes, sec_ejec, pia, pim, devengado)
    """)
    # E1: PIM doubled between publications -> R1 (alta). E2 unchanged.
    con.execute("""
        CREATE TABLE cmp_entidad AS SELECT * FROM (VALUES
            ('E1', 'MUNICIPALIDAD DE PRUEBA', 'GOBIERNOS LOCALES', 'LIMA', 10000000.0, 20000000.0, 10000000.0),
            ('E2', 'GOBIERNO REGIONAL DEMO', 'GOBIERNOS REGIONALES', 'AMAZONAS', 12000000.0, 12000000.0, 12000000.0)
        ) t(sec_ejec, nombre, nivel, dept, pia, pim, pim_pub_ant)
    """)
    # Education: PIM -10% (-S/100M) since last publication -> R4; PIA -15% vs last year -> R5.
    # Its only división is identical -> must not produce duplicate alerts.
    # Obras por contrata +40% -> R4 alta. Lima PIA +2.5% -> below threshold.
    con.execute(f"CREATE TABLE cmp_nodos (dimension VARCHAR, id VARCHAR, padre VARCHAR, nivel INTEGER, "
                f"nombre VARCHAR, {MEDIDAS})")
    con.execute("""INSERT INTO cmp_nodos VALUES
        ('funcion', '22', NULL, 1, 'EDUCACION', 850e6, 900e6, 0, 1000e6, 1000e6, 1100e6, 0, 0),
        ('funcion', '22/047', '22', 2, 'EDUCACION BASICA', 850e6, 900e6, 0, 1000e6, 1000e6, 1100e6, 0, 0),
        ('etiqueta', 'obras_por_contrata', NULL, 1, 'Obras por contrata', 500e6, 700e6, 0, 500e6, 480e6, 600e6, 0, 0),
        ('departamento', '15', NULL, 1, 'LIMA', 2050e6, 2100e6, 0, 2100e6, 2000e6, 2200e6, 0, 0)""")
    con.close()
    (serving / "json" / "comparar").mkdir(parents=True)
    (serving / "json" / "comparar" / "resumen.json").write_text(json.dumps({
        "ano": 2026, "mes_ult": 8,
        "publicacion": {"id": "20260903T200428Z", "fecha": "2026-09-03", "mes_ult": 8},
        "publicacion_anterior": {"id": "20260702T212103Z", "fecha": "2026-07-02", "mes_ult": 6},
        "ano_anterior": {"ano": 2025, "publicacion": {"id": "20260903T200856Z", "fecha": "2026-09-03"}},
    }))


def test_alert_rules(tmp_path, monkeypatch):
    build_synthetic(tmp_path)
    monkeypatch.setattr(A, "SERVING", tmp_path)
    result = A.compute_alerts()
    by_rule = {}
    for a in result:
        by_rule.setdefault(a["regla"], []).append(a)

    r1 = by_rule["PIM_CAMBIO"]
    assert [a["sec_ejec"] for a in r1] == ["E1"] and r1[0]["datos"]["variacion_pct"] == 100.0
    assert r1[0]["severidad"] == "alta" and "2 de julio de 2026" in r1[0]["mensaje"]

    r2 = by_rule["RIESGO_EJEC"]
    assert "E2" in {a["sec_ejec"] for a in r2}
    assert next(a for a in r2 if a["sec_ejec"] == "E2")["severidad"] == "alta"

    assert "E3" in {a["sec_ejec"] for a in by_rule["PIA_PIM"]}

    r4 = {a["codigo"]: a for a in by_rule["CAMBIO_TEMA"]}
    assert set(r4) == {"22", "obras_por_contrata"}, "duplicate división or wrong node flagged"
    assert r4["22"]["datos"]["variacion_pct"] == -10.0 and r4["22"]["severidad"] == "media"
    assert r4["obras_por_contrata"]["severidad"] == "alta" and r4["22"]["enlace"] == "/comparar/funcion/"

    r5 = by_rule["CAMBIO_ANUAL"]
    assert [a["codigo"] for a in r5] == ["22"] and r5[0]["datos"]["variacion_pct"] == -15.0
    assert "sin descontar la inflación" in r5[0]["mensaje"]

    assert all(a["titulo"] and a["mensaje"] for a in result), "empty plain-language text"
    saved = json.loads((tmp_path / "json" / "alertas.json").read_text())
    assert saved[0]["severidad"] == "alta" and saved[0]["regla"] == "CAMBIO_TEMA"  # national changes first
