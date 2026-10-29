"""Search the site for a project: every project with money this year, split by unit so that a
project's own page loads one small part and the search all of them."""
import json

import duckdb

import exportar as X


def test_every_project_of_the_year_in_its_units_part(tmp_path):
    con = duckdb.connect()
    con.execute("""CREATE TABLE obras (cui VARCHAR, sec_ejec VARCHAR, nombre VARCHAR, funcion VARCHAR,
                   dept VARCHAR, dept_nombre VARCHAR, pim DOUBLE, devengado DOUBLE, pim_pub_ant DOUBLE, dev_ano_ant DOUBLE,
                   senal VARCHAR, entidad VARCHAR)""")
    con.execute("""INSERT INTO obras VALUES
        ('2408189', '1231', 'ANILLO VIAL PERIFERICO', 'TRANSPORTE', '15', 'LIMA', 378900000.4, 0, 0, NULL, 'sin_avance', 'PROINVERSION'),
        ('2001111', '1072', 'PUENTE B', 'TRANSPORTE', '08', 'CUSCO', 5000000, 1000000, 5000000, 300000, NULL, 'MTC'),
        ('2002222', '17', 'COLEGIO C', 'EDUCACION', '08', 'CUSCO', 0, 0, 100, NULL, NULL, 'COLEGIO')""")
    X._buscar_obras(con, tmp_path)
    partes = [json.loads((tmp_path / "buscar" / f"obras-{k}.json").read_text()) for k in range(X.BUSCAR_PARTES)]
    assert partes[1231 % 16]["o"][0][:3] == ["2408189", "1231", "ANILLO VIAL PERIFERICO"]
    p = partes[1072 % 16]
    assert p["f"] == ["TRANSPORTE"] and p["d"] == [["08", "CUSCO"], ["15", "LIMA"]], "names once per file, rows point to them"
    assert p["e"] == {"1072": "MTC"}, "the part's units, by name, for the project page"
    assert p["o"] == [["2001111", "1072", "PUENTE B", 0, 0, 5000000, 1000000, 5000000, 300000, None]]
    assert partes[1231 % 16]["o"][0][5] == 378900000, "soles, rounded"
    assert not any(r[0] == "2002222" for x in partes for r in x["o"]), "no budget and no spending this year: left out"
