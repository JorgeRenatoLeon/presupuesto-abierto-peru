"""What moved inside a category: a "+S/ 313 M in Vías nacionales" broken down into the activities
and projects (of each unit) whose budget changed, for each of the comparator's three readings."""
import json

import duckdb

import compare as C

COLS = ["FUNCION", "DIVISION_FUNCIONAL", "GRUPO_FUNCIONAL", "TIPO_TRANSACCION", "GENERICA", "SUBGENERICA",
        "SUBGENERICA_DET", "ESPECIFICA", "ESPECIFICA_DET", "DEPARTAMENTO_META", "NIVEL_GOBIERNO", "TIPO_ACT_PROY",
        "TIPO_ACT_PROY_NOMBRE", "PRODUCTO_PROYECTO", "PRODUCTO_PROYECTO_NOMBRE", "ACTIVIDAD_ACCION_OBRA",
        "ACTIVIDAD_ACCION_OBRA_NOMBRE", "SEC_EJEC", "EJECUTORA_NOMBRE", "MONTO_PIA", "MONTO_PIM"]


def _tabla(con, nombre, filas):
    con.execute(f"CREATE TABLE {nombre} ({', '.join(c + (' DOUBLE' if c.startswith('MONTO') else ' VARCHAR') for c in COLS)})")
    for f in filas:
        con.execute(f"INSERT INTO {nombre} VALUES ({', '.join('?' * len(COLS))})", f)


def _linea(sec, ejecutora, proyecto, cui, nombre, pia, pim):
    tipo = ("2", "PROYECTO") if proyecto else ("3", "ACTIVIDAD")
    return ["15", "033", "0066", "2", "6", "2", "3", "2", "3", "15", "E", *tipo,
            cui if proyecto else "3000001", nombre if proyecto else "ACCIONES COMUNES",
            "4000001" if proyecto else "5001", "OBRAS" if proyecto else nombre, sec, ejecutora, pia, pim]


def test_a_categorys_change_is_explained_by_what_moved_inside_it(tmp_path):
    con = duckdb.connect()
    _tabla(con, "cur", [_linea("1", "PROVIAS NACIONAL", True, "2001111", "CARRETERA A", 100, 400),
                        _linea("1", "PROVIAS NACIONAL", False, None, "CONSERVACION VIAL", 500, 450),
                        _linea("2", "MTC", True, "2002222", "PUENTE B", 0, 50)])
    _tabla(con, "prv", [_linea("1", "PROVIAS NACIONAL", True, "2001111", "CARRETERA A", 100, 150),
                        _linea("1", "PROVIAS NACIONAL", False, None, "CONSERVACION VIAL", 500, 500)])
    _tabla(con, "ant", [_linea("1", "PROVIAS NACIONAL", False, None, "CONSERVACION VIAL", 300, 300)])
    C._cambios_adentro(con, tmp_path)
    grupo = json.loads((tmp_path / "cambios" / "funcion" / "15-033-0066.json").read_text())
    pub = grupo["publicacion"]
    assert [x[1] for x in pub["f"]] == ["CARRETERA A", "PUENTE B", "CONSERVACION VIAL"], \
        "since the previous publication: the road +250, the new bridge +50, then the cut -50"
    assert pub["f"][0] == ["proyecto", "CARRETERA A", "1", "PROVIAS NACIONAL", "2001111", 150, 400]
    assert pub["s"] == [2, 300, 1, -50], "two rose by 300 in all, one fell by 50: the category's +250"
    assert grupo["aprobado"]["f"][0][1] == "CARRETERA A" and grupo["aprobado"]["f"][-1][5:] == [500, 450]
    assert ["actividad", "CONSERVACION VIAL", "1", "PROVIAS NACIONAL", None, 300, 500] in grupo["anual"]["f"], \
        "against last year's approved budget, an activity keeps no CUI"
    assert (tmp_path / "cambios" / "generica" / "2.6.2.3.2.3.json").exists()
    assert (tmp_path / "cambios" / "nivel" / "E.json").exists() and (tmp_path / "cambios" / "departamento" / "15.json").exists()
