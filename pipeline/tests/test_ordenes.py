"""Purchase and service orders: what entities buy outside contracts, tied to their budget's units
and, by description, to the budget's expense types."""
import json

import duckdb

import ordenes as O


def test_seace_text_is_readable():
    assert O.limpio("CORPORACION EL SE¿ORIAL SA", nombre=True) == "CORPORACION EL SEÑORIAL SA"
    assert O.limpio('"SERVICIO DE ALQUILER"').lower().startswith("servicio de alquiler")
    assert O.limpio("A" * 300, 160).endswith("…") and len(O.limpio("A" * 300, 160)) == 160
    assert O.limpio(None) is None and O.limpio("   ") is None


def _clasifica(filas):
    con = duckdb.connect()
    con.execute("CREATE TABLE x (objeto VARCHAR, persona BOOLEAN, t VARCHAR)")
    con.executemany("INSERT INTO x VALUES (?, ?, ?)", filas)
    return [g for (g,) in con.execute(f"SELECT {O._reglas_sql()} FROM x").fetchall()]


def test_rules_give_the_budget_expense_type():
    assert _clasifica([
        ("SERVICIOS", False, "ALQUILER DE CAMIONETA 4X4 PARA LA GERENCIA"),
        ("SERVICIOS", True, "SERVICIO DE UN ASISTENTE ADMINISTRATIVO PARA LA GERENCIA DE TESORERIA"),
        ("SERVICIOS", False, "SERVICIO DE CONSULTORIA ESPECIALIZADA"),
        ("BIENES", False, "ADQUISICION DE COMBUSTIBLE DIESEL B5 PARA LAS UNIDADES"),
        ("BIENES", True, "ADQUISICION DE PANETONES PARA LA CHOCOLATADA NAVIDEÑA"),
        ("CONSULTORIAS OBRAS", False, "SUPERVISION DE LA OBRA DE SANEAMIENTO"),
        ("BIENES", False, "ADQUISICION DE SACOS DE POLIPROPILENO"),
        ("SERVICIOS", False, "SERVICIO DE AGUA Y DESAGUE DEL LOCAL MUNICIPAL"),
    ]) == ["2.3.2.5.1.2", "2.3.2.9.1.1", "2.3.2.7.1.1", "2.3.1.3.1.1", "2.3.1.1.1.1", "2.6.8.1.4.3",
           "2.3.1.99.1.99", "2.3.2.2.1.2"], "first rule that matches; a person's service with no other clue is locación"


def test_exports_each_units_orders(tmp_path, monkeypatch):
    lago = tmp_path / "ordenes"
    (lago / "2026").mkdir(parents=True)
    con = duckdb.connect()
    base = """SELECT 2026 AS ano, {mes} AS mes, 'MUNICIPALIDAD DISTRITAL DE SURCO' AS entidad, '20131367938' AS ruc_entidad,
                     'LIMA' AS departamento, tipo, orden, descripcion, objeto, estado, via, monto AS monto_original,
                     'Nuevos Soles' AS moneda, monto, ruc_proveedor, proveedor, DATE '2026-0{mes}-10' AS emision,
                     DATE '2026-0{mes}-11' AS registro, NULL::DATE AS compromiso
              FROM (VALUES {filas}) t(tipo, orden, descripcion, objeto, estado, via, monto, ruc_proveedor, proveedor)"""
    con.execute(f"""COPY ({base.format(mes=8, filas='''
        ('s', 'O/S-1', 'SERVICIO DE UN ASISTENTE ADMINISTRATIVO', 'SERVICIOS', 'Devengada', 'menor', 3500.0, '10406543210', 'PEREZ ROJAS ANA'),
        ('c', 'O/C-2', 'ADQUISICION DE COMBUSTIBLE DIESEL', 'BIENES', 'Comprometida', 'menor', 9000.0, '20100000001', 'GRIFO EL SOL SAC'),
        ('c', 'O/C-3', 'CEMENTO PARA LA OBRA CUI N° 2595346', 'BIENES', 'Comprometida', 'menor', 12000.0, '20100000002', 'FERRETERIA SAC'),
        ('s', 'O/S-4', 'ALQUILER DE CAMIONETA', 'SERVICIOS', 'Anulada', 'menor', 50000.0, '20100000003', 'RENTA SAC'),
        ('s', 'O/S-5', 'PAGO DEL CONTRATO 010-2025', 'SERVICIOS', 'Comprometida', 'proceso', 800000.0, '20100000004', 'CONSORCIO X')''')})
        TO '{lago / "2026" / "08.parquet"}' (FORMAT parquet)""")
    # a republished month repeats an order: it counts once
    con.execute(f"""COPY ({base.format(mes=9, filas='''
        ('s', 'O/S-1', 'SERVICIO DE UN ASISTENTE ADMINISTRATIVO', 'SERVICIOS', 'Devengada', 'menor', 3500.0, '10406543210', 'PEREZ ROJAS ANA')''')})
        TO '{lago / "2026" / "09.parquet"}' (FORMAT parquet)""")
    con.execute("CREATE TABLE fact_entidad_mes AS SELECT 2026 AS ano")
    con.execute("""CREATE TABLE dim_entidad AS SELECT * FROM (VALUES ('E1', 'MUNICIPALIDAD DISTRITAL DE SANTIAGO DE SURCO', 'LIMA',
                   'LIMA', 'SANTIAGO DE SURCO', 'M')) t(sec_ejec, nombre, dept_nombre, prov_nombre, dist_nombre, nivel)""")
    # the contracts already tied this RUC to its unit
    con.execute("CREATE TABLE _todos AS SELECT 'B1' AS comprador_id, '20131367938' AS comprador_ruc")
    con.execute("CREATE TABLE _enl AS SELECT 'B1' AS comprador_id, 'E1' AS sec_ejec")
    monkeypatch.setattr(O, "CARPETA", lago)
    out = tmp_path / "json"
    out.mkdir()
    resumen = O.exportar(con, out)
    assert resumen["E1"] == {"n": 4, "monto": 824500, "sin_contrato": 24500, "personas": 1, "monto_personas": 3500}, \
        "cancelled orders out, a repeated order once; contract payments are not 'without contract'"
    d = json.loads((out / "ordenes" / "E1.json").read_text())
    assert [g for g, *_ in d["r"]["por_gasto"]][:1] == ["2.3.2.7.13.98"] and "2.3.1.11.1.1" not in [g for g, *_ in d["r"]["por_gasto"]], \
        "orders for a project are not counted under the activities' expense types"
    obra = next(o for o in d["o"] if o[7])
    assert obra[7] == "2595346" and obra[8] == 1, "an order that cites a CUI belongs to that project"
    assert {v for v, *_ in d["r"]["por_via"]} == {"menor", "proceso"}
