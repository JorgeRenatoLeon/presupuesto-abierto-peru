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
    con.execute("CREATE TABLE fact_entidad_mes (ano INTEGER, mes INTEGER, sec_ejec VARCHAR, "
                "pia DOUBLE, pim DOUBLE, devengado DOUBLE)")
    con.execute("""
        INSERT INTO fact_entidad_mes
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
    # R6: a S/ 25M project with nothing spent (it executed last year) -> alta; a S/ 2M one is below threshold
    con.execute("""CREATE TABLE obras AS SELECT * FROM (VALUES
        ('E2', '2500001', 'MEJORAMIENTO DE LA CARRETERA DEMO', 'GOBIERNO REGIONAL DEMO', 'GOBIERNOS REGIONALES',
         '01', 'AMAZONAS', 'TRANSPORTE', 25e6, 25e6, 0.0, 0.0, 25e6, 3e6, 'sin_avance'),
        ('E1', '2500002', 'CREACION DEL PARQUE DEMO', 'MUNICIPALIDAD DE PRUEBA', 'GOBIERNOS LOCALES',
         '15', 'LIMA', 'VIVIENDA', 2e6, 2e6, 0.0, 0.0, 2e6, NULL, 'sin_avance')
        ) t(sec_ejec, cui, nombre, entidad, nivel, dept, dept_nombre, funcion, pia, pim, certificado, devengado,
            pim_pub_ant, dev_ano_ant, senal)""")
    # R7: in 2025 E3 spent 60% of its year in December; E2 spread it evenly
    con.execute("""INSERT INTO fact_entidad_mes
        SELECT 2025, m, 'E3', 0.0, 8e6, CASE WHEN m = 12 THEN 6e6 ELSE 4e6 / 11 END FROM range(1, 13) t(m)
        UNION ALL SELECT 2025, m, 'E2', 12e6, 12e6, 1e6 FROM range(1, 13) t(m)""")
    con.execute("""CREATE TABLE fact_nacional_mes AS SELECT ano, mes, 'X' AS nivel, sum(devengado) AS devengado
                   FROM fact_entidad_mes GROUP BY ALL""")
    # R8: E2 has S/ 150M published with no description (alta); E1's S/ 0.5M is below the threshold
    con.execute("""CREATE TABLE sin_descripcion AS SELECT * FROM (VALUES
        ('E2', 'GOBIERNO REGIONAL DEMO', 'GOBIERNOS REGIONALES', 'AMAZONAS', 'DEFENSA Y SEGURIDAD NACIONAL', 12,
         150e6, 120e6, ['PARA TRANSPORTE AEREO', 'ELECTRICIDAD Y ELECTRONICA']),
        ('E1', 'MUNICIPALIDAD DE PRUEBA', 'GOBIERNOS LOCALES', 'LIMA', 'TRANSPORTE', 1, 0.5e6, 0.0, ['OTROS BIENES'])
        ) t(sec_ejec, entidad, nivel, dept, funcion, lineas, pim, devengado, especificas)""")
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

    r6 = by_rule["OBRA_SIN_AVANCE"]
    assert [a["codigo"] for a in r6] == ["2500001"] and r6[0]["severidad"] == "alta"
    assert "paralizada" in r6[0]["mensaje"], "a project that moved last year and stopped must say so"

    r7 = by_rule["GASTO_DICIEMBRE"]
    assert [a["sec_ejec"] for a in r7] == ["E3"] and r7[0]["ano"] == 2025
    assert r7[0]["datos"]["porcentaje"] == 60.0 and r7[0]["severidad"] == "alta"
    assert all(a["ano"] == 2026 for a in by_rule["RIESGO_EJEC"] + by_rule["PIA_PIM"]), \
        "R2/R3 describe the year in progress, never the closed one"

    r8 = by_rule["SIN_DESCRIPCION"]
    assert [a["sec_ejec"] for a in r8] == ["E2"] and r8[0]["severidad"] == "alta"
    assert "«Para transporte aéreo»" in r8[0]["mensaje"] and "Ley de Transparencia" in r8[0]["mensaje"]

    assert len({a["id"] for a in result}) == len(result), "alert ids must be unique"
    assert all(a["publicacion"] == "20260903T200428Z" for a in result)
    assert all(a["titulo"] and a["mensaje"] for a in result), "empty plain-language text"
    saved = json.loads((tmp_path / "json" / "alertas.json").read_text())
    assert saved[0]["severidad"] == "alta" and saved[0]["regla"] == "CAMBIO_TEMA"  # national changes first


def test_execution_risk_measured_at_the_daily_cut(tmp_path, monkeypatch):
    """Diario files stop mid-month: R2 expects what the calendar allows by the publication
    date (15 June = 46% of the year), not the end of the month (6/12 = 50%)."""
    build_synthetic(tmp_path)
    resumen = tmp_path / "json" / "comparar" / "resumen.json"
    r = json.loads(resumen.read_text())
    r.update(avance_esperado=0.4583, publicacion={"id": "20260615T133819Z", "fecha": "2026-06-15", "mes_ult": 6})
    resumen.write_text(json.dumps(r))
    monkeypatch.setattr(A, "SERVING", tmp_path)
    e2 = next(a for a in A.compute_alerts() if a["regla"] == "RIESGO_EJEC" and a["sec_ejec"] == "E2")
    assert e2["datos"]["esperado_pct"] == 45.8
    assert "al 15 de junio" in e2["titulo"] and e2["mensaje"].startswith("Al 15 de junio de 2026")
