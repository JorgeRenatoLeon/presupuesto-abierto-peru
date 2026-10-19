"""Official definitions attach to the right budget categories."""
import csv

from explicar import GLOSARIO, _oficial, archivo
from exportar import _es_municipalidad, _provincias_de


def _defs(nombre):
    with open(GLOSARIO / nombre, newline="") as f:
        return {r["codigo"]: r for r in csv.DictReader(f)}


def test_official_glossaries_cover_the_classifiers():
    f, e = _defs("funcional.csv"), _defs("economico.csv")
    assert len([r for r in f.values() if r["nivel"] == "funcion"]) == 25
    assert f["0103"]["nombre"] == "Educación inicial" and "6 años" in f["0103"]["definicion"]
    assert e["2.6"]["definicion"].startswith("Gastos por las inversiones")


def test_definition_falls_back_to_the_nearest_ancestor():
    f, e = _defs("funcional.csv"), _defs("economico.csv")
    exacta = _oficial("funcion", "22/047/0103", f)
    assert exacta["nombre"] == "Educación inicial" and not exacta["heredado"]
    nueva = _oficial("funcion", "17/055/0124", f)  # group MEF added after the 2009 glossary
    assert nueva["heredado"] and nueva["nombre"] == "Medio Ambiente"
    assert _oficial("generica", "2.3.1.99.9.99", e)["heredado"]
    assert archivo("22/047/0103") == "22-047-0103"


def test_provinces_count_municipalities_not_other_entities():
    ents = [{"dept": "08", "prov": "13", "provincia": "URUBAMBA", "nivel": "M", "pim": 10.0, "devengado": 5.0,
             "nombre": "MUNICIPALIDAD DISTRITAL DE OLLANTAYTAMBO"},
            {"dept": "08", "prov": "13", "provincia": "URUBAMBA", "nivel": "M", "pim": 1.0, "devengado": 0.0,
             "nombre": "MANCOMUNIDAD MUNICIPAL DEL VALLE"},
            {"dept": "08", "prov": "13", "provincia": "URUBAMBA", "nivel": "R", "pim": 4.0, "devengado": 1.0,
             "nombre": "GOB. REG. CUSCO - EDUCACION URUBAMBA"}]
    assert not _es_municipalidad(ents[1])
    assert _provincias_de(ents) == [{"codigo": "0813", "nombre": "URUBAMBA", "pim": 15.0, "devengado": 6.0,
                                     "n_municipalidades": 1}]
