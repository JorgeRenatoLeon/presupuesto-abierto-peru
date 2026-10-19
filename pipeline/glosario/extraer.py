"""Extract MEF's official definitions into CSVs the pipeline joins to the budget data.

Sources (public, MEF):
- Clasificador Funcional (D.S. N° 068-2008-EF), Anexo "Glosario de Términos":
  https://www.mef.gob.pe/contenidos/presu_publ/clasi_pres/2009/clasificador_fucional_programatico2009.pdf
- Clasificadores Presupuestarios (DNPP), gasto e ingreso:
  https://www.mef.gob.pe/contenidos/presu_publ/sectr_publ/prcon_ineg/2011/clasificad/ManualdeClasificadorPresupuestal2009_M.pdf

Usage (needs poppler's pdftotext): python extraer.py funcional.pdf manual.pdf
Writes funcional.csv (codigo, nivel, nombre, definicion) and economico.csv (codigo, nombre, definicion).
"""
import csv
import re
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).parent


def _texto(pdf: str) -> list[str]:
    return subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout.splitlines()


def _limpia(partes: list[str]) -> str:
    t = re.sub(r"\s+", " ", " ".join(partes)).strip()
    return re.sub(r"(^|[.:] )([a-záéíóúñ])", lambda m: m.group(1) + m.group(2).upper(), t)


def funcional(pdf: str) -> list[dict]:
    filas, actual = [], None
    for linea in _texto(pdf):
        if re.fullmatch(r"\s*\d{1,3}\s*", linea) or "\f" in linea and not linea.strip("\f").strip():
            continue  # page numbers / form feeds
        m = re.match(r"^\f?( *)(\d{2}|\d{3}|\d{4}) ([A-ZÁÉÍÓÚÑ]\S.*)$", linea)
        if m and len(m.group(1)) <= 12:
            actual = {"codigo": m.group(2), "nivel": {2: "funcion", 3: "division", 4: "grupo"}[len(m.group(2))],
                      "nombre": m.group(3).strip(), "def": []}
            filas.append(actual)
        elif actual and linea.strip():
            actual["def"].append(linea.strip())
    return [{"codigo": f["codigo"], "nivel": f["nivel"], "nombre": f["nombre"], "definicion": _limpia(f["def"])}
            for f in filas]


def economico(pdf: str) -> list[dict]:
    filas, actual = [], None
    for linea in _texto(pdf):
        m = re.match(r"^\f?([12](?:\.\d{1,2}){1,5})\s{2,}(\S.*)$", linea)
        if m:
            actual = {"codigo": m.group(1), "nombre": m.group(2).strip(), "def": []}
            filas.append(actual)
        elif (actual and not actual["def"] and linea.strip().isupper() and len(linea.strip()) < 35
              and not linea.strip().endswith(".")):
            actual["nombre"] += " " + linea.strip()  # a name wrapped onto the next line
        elif actual and linea.startswith(" " * 8) and linea.strip() and not re.search(r"Clasificadores presupuestarios|^\s*\d+\s*$", linea):
            actual["def"].append(linea.strip())
        elif actual and not linea.strip():
            continue
    vistos = {}
    for f in filas:  # the manual repeats codes in its index: keep the entry that has a definition
        if f["def"] or f["codigo"] not in vistos:
            vistos[f["codigo"]] = f
    return [{"codigo": c, "nombre": _limpia([f["nombre"].lower()]), "definicion": _limpia([" ".join(f["def"]).lower()])}
            for c, f in vistos.items()]


def _escribe(nombre: str, filas: list[dict]) -> None:
    with open(AQUI / nombre, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0]))
        w.writeheader()
        w.writerows(filas)
    print(f"{nombre}: {len(filas)} entries")


if __name__ == "__main__":
    _escribe("funcional.csv", funcional(sys.argv[1]))
    _escribe("economico.csv", economico(sys.argv[2]))
