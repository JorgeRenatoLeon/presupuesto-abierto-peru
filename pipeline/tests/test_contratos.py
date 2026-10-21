"""Who the State contracts with: flattening OECE's OCDS records, linking buyers to executing
units (by name, by the projects they contract) and the per-unit files the site reads."""
import gzip
import json

import duckdb

import contratos as C


def _registro(ocid, comprador, contratos, cui=None, numero_postores=3, metodo="Licitación Pública"):
    return {"compiledRelease": {
        "ocid": ocid, "date": "2026-05-01T00:00:00Z",
        "buyer": {"id": f"PE-CONSUCODE-{comprador[0]}", "name": comprador[1]},
        "parties": [{"id": f"PE-CONSUCODE-{comprador[0]}", "address": {"department": comprador[2], "region": "LIMA",
                                                                      "locality": comprador[3]},
                     "additionalIdentifiers": [{"scheme": "PE-RUC", "id": comprador[4]}]}],
        "planning": {"budget": {"projectID": cui, "project": "OBRA"} if cui else {"description": "Fondos Públicos"}},
        "tender": {"procurementMethodDetails": metodo, "mainProcurementCategory": "works", "numberOfTenderers": numero_postores,
                   "title": "LP-1-2026", "value": {"amount": 1000.0, "currency": "USD", "amount_PEN": 3700.0}},
        "awards": [{"id": f"A{i}", "suppliers": c.pop("suppliers")} for i, c in enumerate(contratos)],
        "contracts": [dict(c, awardID=f"A{i}") for i, c in enumerate(contratos)],
    }}


def test_flattens_contracts_with_documents_amounts_and_project_codes(tmp_path):
    p = tmp_path / "2026.jsonl.gz"
    rec = _registro("ocds-1", ("1", "MUNICIPALIDAD DISTRITAL DE PRUEBA", "LIMA", "MIRAFLORES", "20131370645"), [{
        "id": 9, "title": "CONTRATO 1", "dateSigned": "2026-03-02T10:00:00-05:00", "description": " PAVIMENTACION  DE CALLES ",
        "value": {"amount": 1000.0, "currency": "USD"}, "period": {"durationInDays": 120},
        "items": [{"position": "1", "quantity": 2.0, "unit": {"name": "Unidad"}, "description": "CAMIONETA  PICK UP 4X4",
                   "totalValue": {"amount": 1000.0, "currency": "USD"},
                   "classification": {"id": "2510150300012345", "scheme": "CUBSO", "description": "CAMIONETA PICK UP"}},
                  {"position": "2", "quantity": 1.0, "unit": {"name": "Servicio"}, "description": "SIN CODIGO"}],
        "implementation": {"finalValue": {"amount": 1200.0, "currency": "USD"}},
        "suppliers": [{"id": "PE-RUC-1762914", "name": "CONSORCIO VEGAS"}],
        "documents": [{"id": "111", "documentType": "contractSigned", "title": "Archivos del contrato"},
                      {"id": "112", "documentType": "contractAnnexe", "title": "Archivos de la garantía de fiel cumplimiento"},
                      {"id": "113", "documentType": "contractAnnexe", "title": "Archivos del adicional del contrato"},
                      {"id": "114", "documentType": "contractAnnexe", "title": "Archivos de resolución intervención del contrato"},
                      {"id": "115", "documentType": "contractAnnexe", "title": "Archivos de la ampliación del contrato"}]}],
        cui="2543266,2678303")
    p.write_bytes(gzip.compress((json.dumps(rec) + "\n").encode()))
    [f] = list(C.filas(p))
    assert f["comprador_ruc"] == "20131370645" and f["ano"] == 2026
    assert (f["comprador_dep"], f["comprador_prov"], f["comprador_loc"]) == ("LIMA", "LIMA", "MIRAFLORES")
    assert f["proveedor"] == "CONSORCIO VEGAS" and f["proveedor_ruc"] == "1762914"
    assert f["monto"] == 3700.0 and f["monto_final"] == 4440.0, "USD converted with the tender's own rate"
    assert f["cui"] == "2543266,2678303" and f["doc_contrato"] == "111" and f["plazo_dias"] == 120
    assert f["eventos"] == "adicional:113,intervencion:114,ampliacion:115", "the guarantee is not an event"
    assert set(f) - {"_items"} == set(C.COLUMNAS)
    camioneta, otra = f["_items"]
    assert camioneta["unspsc"] == "25101503", "UNSPSC from the CUBSO code when not given apart"
    assert (camioneta["descripcion"], camioneta["cantidad"], camioneta["unidad"], camioneta["total"]) == \
        ("CAMIONETA PICK UP 4X4", 2.0, "Unidad", 3700.0)
    assert otra["unspsc"] is None and set(camioneta) == set(C.COLUMNAS_ITEMS) - {"ocid", "contrato_id"}


def test_names_normalised_like_both_sources_write_them():
    assert C.normalizar("GOBIERNO REGIONAL DE JUNIN - DIRECCIÓN REGIONAL DE SALUD JUNIN") == \
        C.normalizar("REGION JUNIN-SALUD") == "GOBIERNO REGIONAL JUNIN SALUD"
    assert C.normalizar("REGION POLICIAL PIURA") == "REGION POLICIAL PIURA", "a police region is not a regional government"
    assert C.normalizar("MUNICIPALIDAD DISTRITAL DE QUEQUE¥A") == "MUNICIPALIDAD DISTRITAL QUEQUENA"
    assert C.normalizar("MINISTERIO DE VIVIENDA, CONSTRUCCIÓN Y SANEAMIENTO - Administración General") == \
        C.normalizar("MINISTERIO DE VIVIENDA, CONSTRUCCION Y SANEAMIENTO- ADM. GENERAL")
    assert C.texto_objeto("Ejecución del ¿Diseño del Puente¿  en  Callao") == 'Ejecución del "Diseño del Puente" en Callao'
    assert C.texto_objeto("¿Qué es?") == "¿Qué es?"


ENTIDADES = [  # (sec, nombre, dept, prov, dist, nivel)
    ("10", "REGION CUSCO - SALUD LA CONVENCION", "CUSCO", "LA CONVENCION", "SANTA ANA", "R"),
    ("11", "REGION CUSCO - EDUCACION LA CONVENCION", "CUSCO", "LA CONVENCION", "SANTA ANA", "R"),
    ("20", "REGION JUNIN- DIRECCION  REGIONAL DE SALUD JUNIN", "JUNIN", "HUANCAYO", "EL TAMBO", "R"),
    ("21", "REGION JUNIN-SALUD TARMA", "JUNIN", "TARMA", "TARMA", "R"),
    ("30", "DIRECCION DE EDUCACION DE LIMA", "LIMA", "LIMA", "LIMA", "E"),
    ("31", "REGION LIMA - EDUCACION LIMA PROVINCIAS", "LIMA", "HUAURA", "HUACHO", "R"),
    ("40", "MUNICIPALIDAD DISTRITAL DE SANTA ROSA", "PUNO", "MELGAR", "SANTA ROSA", "M"),
    ("41", "MUNICIPALIDAD DISTRITAL DE SANTA ROSA", "PUNO", "EL COLLAO", "SANTA ROSA", "M"),
    ("50", "REGION POLICIAL PIURA", "PIURA", "PIURA", "PIURA", "E"),
    ("60", "MUNICIPALIDAD DISTRITAL DE QUIMBIRI", "CUSCO", "LA CONVENCION", "QUIMBIRI", "M"),
    ("70", "MUNICIPALIDAD METROPOLITANA DE LIMA", "LIMA", "LIMA", "LIMA", "M"),
]


def test_links_each_buyer_to_its_own_unit_not_a_sibling():
    compradores = [  # (id, nombre, dep, loc)
        ("b-ugel", "GOBIERNO REGIONAL DE CUSCO - UNIDAD DE GESTION EDUCATIVA LOCAL LA CONVENCION", "CUSCO", "SANTA ANA"),
        ("b-tarma", "GOBIERNO REGIONAL DE JUNIN - DIRECCIÓN REGIONAL DE SALUD DE JUNIN - RED DE SALUD - TARMA", "JUNIN", "TARMA"),
        ("b-diresa", "GOBIERNO REGIONAL DE JUNIN - DIRECCION REGIONAL DE SALUD JUNIN", "JUNIN", "EL TAMBO"),
        ("b-dre", "GOBIERNO REGIONAL DE LIMA - DIRECCION REGIONAL DE EDUCACION DE LIMA PROVINCIAS", "LIMA", "SANTA MARIA"),
        ("b-collao", "MUNICIPALIDAD DISTRITAL DE SANTA ROSA MAZOCRUZ - EL COLLAO", "PUNO", "SANTA ROSA"),
        ("b-policia", "REGION POLICIAL PIURA", "PIURA", "PIURA"),
    ]
    m = {cid: sec for cid, (sec, _) in C.vincular(ENTIDADES, compradores).items()}
    assert m["b-ugel"] == "11", "an education unit must not take the health network of the same province"
    assert m["b-tarma"] == "21" and m["b-diresa"] == "20", "the Tarma network is not the DIRESA in Huancayo"
    assert m["b-dre"] == "31", "a regional directorate is never MINEDU's national unit"
    assert m["b-collao"] == "41", "namesake municipalities told apart by province"
    assert m["b-policia"] == "50"


def _con_contratos(filas):
    con = duckdb.connect()
    con.execute("CREATE TABLE dim_entidad (sec_ejec VARCHAR, nombre VARCHAR, dept_nombre VARCHAR, prov_nombre VARCHAR, "
                "dist_nombre VARCHAR, nivel VARCHAR)")
    con.executemany("INSERT INTO dim_entidad VALUES (?, ?, ?, ?, ?, ?)", [list(e) for e in ENTIDADES])
    # 2500001-03: Quimbiri's projects; 2500010: Lima's; 2001621: a generic code many units budget
    con.execute("""CREATE TABLE obras AS SELECT * FROM (VALUES ('60', '2500001'), ('60', '2500002'), ('60', '2500003'),
        ('70', '2500010'), ('10', '2001621'), ('11', '2001621'), ('20', '2001621'), ('21', '2001621')) t(sec_ejec, cui)""")
    con.execute("CREATE TABLE fact_entidad_mes AS SELECT 2026 AS ano")
    cols = ", ".join(C.COLUMNAS)
    con.execute(f"CREATE TABLE contratos ({', '.join(c + ' VARCHAR' for c in C.COLUMNAS)})")
    con.executemany(f"INSERT INTO contratos ({cols}) VALUES ({', '.join('?' * len(C.COLUMNAS))})",
                    [[f.get(c) for c in C.COLUMNAS] for f in filas])
    return con


def _contrato(i, comprador, nombre, fecha="2026-04-01", cui=None, monto=100.0, **kw):
    return dict(ocid=f"o{i}", contrato_id=str(i), fecha=fecha, ano=int(fecha[:4]), comprador_id=comprador, comprador=nombre,
                comprador_dep=kw.pop("dep", "CUSCO"), comprador_loc=kw.pop("loc", None), cui=cui, monto=monto,
                proveedor=kw.pop("proveedor", f"PROVEEDOR {i}"), proveedor_ruc=kw.pop("ruc", f"2060000000{i % 10}"),
                metodo=kw.pop("metodo", "Licitación Pública"), categoria=kw.pop("categoria", "services"),
                postores=kw.pop("postores", 3), **kw)


def _escribir(con, tmp_path, monkeypatch, items=()):
    lago, lago_items = tmp_path / "lago", tmp_path / "lago_items"
    lago.mkdir(); lago_items.mkdir()
    con.execute(f"""COPY (SELECT * REPLACE (CAST(ano AS INTEGER) AS ano, CAST(monto AS DOUBLE) AS monto,
                        CAST(monto_final AS DOUBLE) AS monto_final, CAST(postores AS INTEGER) AS postores
                        ) FROM contratos) TO '{lago / "2026.parquet"}' (FORMAT parquet)""")
    con.execute("CREATE TABLE items (ocid VARCHAR, contrato_id VARCHAR, pos VARCHAR, cubso VARCHAR, cubso_desc VARCHAR, "
                "unspsc VARCHAR, unspsc_desc VARCHAR, descripcion VARCHAR, cantidad DOUBLE, unidad VARCHAR, total DOUBLE)")
    if items:
        con.executemany("INSERT INTO items VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?)",
                        [[i[0], i[1], str(k), *i[2:]] for k, i in enumerate(items)])
    con.execute(f"COPY items TO '{lago_items / '2026.parquet'}' (FORMAT parquet)")
    monkeypatch.setattr(C, "CARPETA", lago)
    monkeypatch.setattr(C, "CARPETA_ITEMS", lago_items)


def test_project_codes_link_buyers_whose_names_differ(tmp_path, monkeypatch):
    kimbiri = [_contrato(i, "b-kimbiri", "MUNICIPALIDAD DISTRITAL DE KIMBIRI", cui=f"250000{i}") for i in (1, 2, 3)]
    emape = [_contrato(5, "b-emape", "EMPRESA MUNICIPAL ADMINISTRADORA DE PEAJE DE LIMA S.A.", cui="2500010", dep="LIMA"),
             _contrato(6, "b-emape", "EMPRESA MUNICIPAL ADMINISTRADORA DE PEAJE DE LIMA S.A.", dep="LIMA")]
    generico = [_contrato(7, "b-otra", "UNIDAD SIN NOMBRE PARECIDO", cui="2001621")]
    con = _con_contratos(kimbiri + emape + generico)
    _escribir(con, tmp_path, monkeypatch)
    con.execute(f"CREATE TEMP VIEW _c AS SELECT * FROM '{C.CARPETA / '2026.parquet'}'")
    e = C.enlazar(con)
    assert e["b-kimbiri"] == ("60", "cui"), "KIMBIRI's projects are QUIMBIRI's: same municipality"
    assert "b-emape" not in e, "a company is not a budget unit, even if it builds the city's projects"
    assert "b-otra" not in e, "a generic project code proves nothing"


def test_exports_each_unit_with_its_contracts_and_red_flags(tmp_path, monkeypatch):
    nombre = "MUNICIPALIDAD DISTRITAL DE KIMBIRI"
    filas = [
        _contrato(1, "b-kimbiri", nombre, cui="2500001", monto=1000.0, monto_final=1300.0, postores=1,
                  doc_contrato="111", eventos="adicional:112,resolucion:113", objeto="MEJORAMIENTO DE LA VIA",
                  categoria="works"),
        _contrato(2, "b-kimbiri", nombre, cui="2500002", monto=500.0, metodo="Contratación Directa", postores=1),
        _contrato(3, "b-kimbiri", nombre, cui="2500003", monto=200.0, fecha="2025-06-01", ruc="20600000001",
                  objeto="ELABORACION DEL EXPEDIENTE TECNICO"),
        _contrato(9, "b-kimbiri", nombre, monto=50.0, fecha="2026-02-01", objeto="MANTENIMIENTO DE CAMIONETA", ruc="10400000009"),
        _contrato(10, "b-kimbiri", nombre, monto=40.0, fecha="2026-03-01", categoria="works", objeto="REPARACION DEL LOCAL"),
        _contrato(4, "b-kimbiri", nombre, cui="2500001", monto=900.0, fecha="2023-02-01"),  # older: only for its project
        _contrato(5, "b-emape", "EMPRESA MUNICIPAL ADMINISTRADORA DE PEAJE DE LIMA S.A.", cui="2500010", dep="LIMA", monto=70.0),
        _contrato(6, "b-emape", "EMPRESA MUNICIPAL ADMINISTRADORA DE PEAJE DE LIMA S.A.", dep="LIMA", monto=80.0),
        _contrato(8, "b-kimbiri", nombre, fecha="2030-01-01", monto=5.0),  # a typo'd date never shows
    ]
    con = _con_contratos(filas)
    _escribir(con, tmp_path, monkeypatch, items=[
        ("o1", "1", "72141003", "MEJORAMIENTO DE LA VIA TRAMO 1", 1.0, "Servicio", 1000.0),
        ("o9", "9", "78181507", "MANTENIMIENTO PREVENTIVO DE CAMIONETA", 2.0, "Servicio", 30.0),
        ("o9", "9", "25172504", "LLANTAS", 4.0, "Unidad", 20.0),
        ("o3", "3", "81101508", "EXPEDIENTE TECNICO", 1.0, "Servicio", 200.0)])
    out = tmp_path / "json"
    (out / "contratos").mkdir(parents=True)
    (out / "contratos" / "viejo.json").write_text("{}")
    resumen, por_obra = C.exportar(con, out)

    r = resumen["60"]
    assert r["n"] == 5 and r["monto"] == 1790.0, "signed in 2025-2026 only"
    assert r["extra"] == 300.0 and r["con_adicionales"] == 1 and r["resueltos"] == 1
    assert (r["competitivos"], r["un_postor"]) == (4, 1), "a direct award is not a single-bidder tender"
    assert r["directo"] == 500.0 and r["proveedores"] == 4
    assert r["top"][0][1] == "PROVEEDOR 1"
    assert por_obra[("60", "2500001")] == [2, 1900.0], "a project lists its contracts of any year"

    d = json.loads((out / "contratos" / "60.json").read_text())
    assert d["b"] == [["Municipalidad distrital de Kimbiri", "", "cui"]], "buyer names readable, like the budget's"
    assert [c[3] for c in d["c"]] == [1000.0, 500.0, 200.0, 50.0, 40.0, 900.0], "the period first, by amount; then older ones"
    assert d["c"][0][4] == 1300.0 and d["c"][0][9] == "111" and d["c"][0][10] == "adicional:112,resolucion:113"
    assert d["m"][d["c"][1][5]] == "Contratación Directa" and d["r"]["mostrados"] == 5
    gasto = {c[3]: c[12] for c in d["c"]}
    assert gasto[1000.0] == "2.6.2.3.2", "a project's road works: investment in road infrastructure"
    assert gasto[200.0] == "2.6.8.1.3.1", "a project's expediente técnico"
    assert gasto[50.0] == "2.3.2.4.5.1", "no project: vehicle maintenance, by its largest line"
    assert gasto[40.0] == "2.3.2.4.2.1", "works with no catalogue code and no project: maintenance, of the building it names"
    assert d["c"][3][13] == [2, [["Mantenimiento preventivo de camioneta", 2.0, "Servicio", 30.0, None, None],
                                 ["Llantas", 4.0, "Unidad", 20.0, None, None]]], "no usual price to compare with: none shown"
    assert ["2.3.2.4", 2, 90.0] in r["por_gasto"], "what the unit's contracts buy, by expense group"

    prov = json.loads((out / "proveedor" / "20600000001.json").read_text())
    assert prov["nombre"] == "PROVEEDOR 1" and prov["tipo"] == "empresa"
    assert prov["r"]["n"] == 2 and prov["r"]["monto"] == 1200.0, "a supplier's page: its period contracts only"
    assert prov["e"] == [["60", "Municipalidad distrital de Quimbiri", 2, 1200.0]]
    assert [c[3] for c in prov["c"]] == [1000.0, 200.0] and prov["c"][0][2] == 0
    assert json.loads((out / "proveedor" / "10400000009.json").read_text())["tipo"] == "persona"
    indice = json.loads((out / "proveedores" / "indice.json").read_text())
    assert indice["p"][0][:4] == ["20600000001", "PROVEEDOR 1", 2, 1200.0] and indice["total"] == len(indice["p"])

    lima = json.loads((out / "contratos" / "70.json").read_text())
    assert [c[3] for c in lima["c"]] == [70.0], "the company's contract for Lima's project, not its toll business"
    assert lima["c"][0][12] is None, "no catalogue code, not works: no expense type rather than a guess"
    assert lima["b"][0][2] is None and resumen["70"]["de_otros"] == 1
    assert not (out / "contratos" / "viejo.json").exists()
    fuente = json.loads((out / "contratos" / "fuente.json").read_text())
    assert fuente["anos"] == [2025, 2026] and fuente["compradores_vinculados"] == 1


def test_unit_prices_compared_across_the_state(tmp_path, monkeypatch):
    """The same catalogue item, bought by many units: a price 3x the usual is a signal; 30x is more
    likely a quantity typed in the wrong unit, and is not counted as one."""
    nombre = "MUNICIPALIDAD DISTRITAL DE KIMBIRI"
    filas, items = [], []
    for k in range(10):  # the usual price: about S/ 30 a bag, five buyers
        filas.append(_contrato(100 + k, f"b-{k % 5}", f"COMPRADOR {k % 5}", categoria="goods", monto=300.0))
        items.append((f"o{100 + k}", str(100 + k), "30111601", "CEMENTO PORTLAND", 10.0, "Bolsa", 280.0 + 4 * k))
    for k, precio in ((200, 90.0), (201, 900.0)):
        filas.append(_contrato(k, "b-kimbiri", nombre, categoria="goods", monto=precio * 10, cui="2500001"))
        items.append((f"o{k}", str(k), "30111601", "CEMENTO PORTLAND", 10.0, "Bolsa", precio * 10))
    con = _con_contratos(filas)
    _escribir(con, tmp_path, monkeypatch, items=items)
    out = tmp_path / "json"
    out.mkdir()
    # the CUBSO code is what prices are compared by: give the items one
    lago_items = C.CARPETA_ITEMS / "2026.parquet"
    duckdb.connect().execute(f"COPY (SELECT * REPLACE ('3011160100000001' AS cubso) FROM '{lago_items}') TO '{lago_items}' (FORMAT parquet)")
    resumen, _ = C.exportar(con, out)
    assert resumen["60"]["precio_alto"] == 1, "3x the usual price counts; 30x (likely a typo) does not"
    d = json.loads((out / "contratos" / "60.json").read_text())
    lineas = {c[3]: c[13][1][0] for c in d["c"]}
    assert lineas[900.0][4] == lineas[9000.0][4] and 29 < lineas[900.0][4] < 33, "the usual unit price"
    assert lineas[900.0][5] == 12, "how many purchases it comes from"
