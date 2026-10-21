"""A project as a whole (Banco de Inversiones): its total cost and every year's spending, so a
year's slice of the budget is never read as the whole project."""
import json

import duckdb

import inversiones as I


def test_reports_dated_and_boilerplate_is_not_a_problem():
    assert I._sin_fecha("[15/10/2026]  en proceso de liquidación ") == ("2026-10-15", "en proceso de liquidación")
    for nada in ("[01/02/2026] SIN RESTRICCIONES", "NINGUNO", "ninguna", "-", ".", "No se han identificado restricciones.",
                 "NO PRESENTA PROBLEMAS", "N/A"):
        assert I.problema_real(nada) is None, nada
    assert I.problema_real("[21/01/2026] LIMITACION PRESUPUESTAL/FALTA DE FINANCIAMIENTO") == \
        "LIMITACION PRESUPUESTAL/FALTA DE FINANCIAMIENTO"


def test_exports_each_project_whole(tmp_path, monkeypatch):
    lago = tmp_path / "inversiones"
    lago.mkdir()
    con = duckdb.connect()
    con.execute("""CREATE TABLE obras AS SELECT * FROM (VALUES
        ('E1', '2595346', 'ADQUISICION DE CAMARAS', 'MUNICIPALIDAD DE SURCO', '15', 'LIMA', NULL, 3149878.0, 3149877.45),
        ('E1', '9999999', 'OTRA OBRA', 'MUNICIPALIDAD DE SURCO', '15', 'LIMA', 'sin_avance', 100.0, 0.0))
        t(sec_ejec, cui, nombre, entidad, dept, dept_nombre, senal, pim, devengado)""")
    con.execute(f"""COPY (SELECT '2595346' AS cui, 'CAMARAS' AS nombre, 'E1' AS sec_ejec, 'ACTIVO' AS estado, 'APROBADO' AS situacion,
        'PROYECTO' AS tipo, 'POR CONTRATA' AS modalidad, 14115165.72 AS monto_viable, 23185976.2 AS costo_actualizado,
        0.0 AS monto_laudo, 20036098.75 AS dev_acum_ant, 3149877.45 AS dev_actual, 3149878.0 AS pim_actual, 0.0 AS saldo,
        100.0 AS avance_fisico, 100.0 AS avance_ejecucion, '202309' AS primer_devengado, '202610' AS ultimo_devengado,
        DATE '2023-01-01' AS fecha_viabilidad, DATE '2023-09-04' AS inicio, DATE '2026-05-11' AS fin,
        -12.145 AS latitud, -77.005 AS longitud, NULL::BIGINT AS beneficiarios, 'SEGURIDAD' AS tipologia)
        TO '{lago / "detalle.parquet"}' (FORMAT parquet)""")
    con.execute(f"""COPY (SELECT '2595346' AS cui, 23185976.2 AS devengado_acumulado, 100.0 AS avance_fisico,
        '[15/10/2026] CONTRATO 030-2024 POR S/ 10,500,000. ADICIONAL APROBADO.' AS situacion_reporte,
        '[15/10/2026] ninguno' AS problema, '[15/10/2026] REGISTRAR EL CIERRE' AS accion,
        TIMESTAMP '2026-10-15 10:00:00' AS fecha_reporte, DATE '2024-09-04' AS inicio_fisico, DATE '2026-05-11' AS fin_fisico)
        TO '{lago / "seguimiento.parquet"}' (FORMAT parquet)""")
    monkeypatch.setattr(I, "CARPETA", lago)
    out = tmp_path / "json"
    out.mkdir()
    resumen = I.exportar(con, out)
    assert resumen == {("E1", "2595346"): [23185976.2, 14115165.72, 23185976.2, 100.0]}, "only projects MEF describes"
    obras = json.loads((out / "obras" / "E1.json").read_text())
    assert set(obras) == {"2595346"}, "a project MEF does not describe is left out"
    obra = obras["2595346"]
    assert obra["acumulado"] == 23185976.2 and obra["ubicacion"] == [-12.145, -77.005]
    assert obra["reporte"] == ["2026-10-15", "CONTRATO 030-2024 POR S/ 10,500,000. ADICIONAL APROBADO.", None, None], \
        "the latest report; 'ninguno' is no problem, and no problem needs no action"
    mapa = json.loads((out / "mapa" / "15.json").read_text())
    assert mapa["e"] == {"E1": "MUNICIPALIDAD DE SURCO"} and len(mapa["p"]) == 1, "only projects MEF locates"
    assert mapa["p"][0][:3] == [-12.145, -77.005, "2595346"] and mapa["p"][0][6] == 1.0 and mapa["p"][0][8] == 0
    assert json.loads((out / "mapa" / "indice.json").read_text()) == [["15", "LIMA", 1, 0]]
