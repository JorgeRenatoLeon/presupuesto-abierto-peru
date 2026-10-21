"""Each investment project as a whole, from MEF's Banco de Inversiones (open data, refreshed daily).

The budget only shows a project's slice for the current year: a S/ 23 M project in its last year
may carry S/ 3 M, next to contracts signed two years earlier for S/ 17 M. These files give the
whole: what it costs (updated, and as approved when declared viable), what has been spent in
every year so far, physical progress, how it is executed (by contract or by the entity itself),
where it is, arbitration awards, and the entity's latest report on it (Formato 12B: situation,
problems, next steps).

  actualizar()       update step: download (weekly) -> lake/inversiones/{detalle,seguimiento}.parquet
  exportar(con, out) serving step: json/obras/<sec_ejec>.json for each unit's projects; returns a
                     small summary per (sec, cui) for the project lists of the entity pages
"""
import json
import re
import time
from datetime import datetime, timezone

import duckdb
import requests

from config import LAKE, RAW

FUENTES = {
    "detalle": "https://fs.datosabiertos.mef.gob.pe/datastorefiles/DETALLE_INVERSIONES.csv",
    "seguimiento": "https://fs.datosabiertos.mef.gob.pe/datastorefiles/FORMATO_12B.csv",
}
CARPETA = LAKE / "inversiones"
CADENCIA_DIAS = 7
LARGO_REPORTE = 900  # the latest situation report, as the entity wrote it; the full text is in the lake

_NUM = lambda c: f"TRY_CAST(nullif(trim({c}), '') AS DOUBLE)"
_FECHA = lambda c: f"TRY_CAST(left(nullif(trim({c}), ''), 10) AS DATE)"
COLUMNAS = {
    "detalle": f"""CODIGO_UNICO AS cui, NOMBRE_INVERSION AS nombre, SEC_EJEC AS sec_ejec, ESTADO AS estado,
        SITUACION AS situacion, TIPO_INVERSION AS tipo, DES_MODALIDAD AS modalidad,
        {_NUM('MONTO_VIABLE')} AS monto_viable, {_NUM('COSTO_ACTUALIZADO')} AS costo_actualizado,
        {_NUM('MONTO_LAUDO')} AS monto_laudo, {_NUM('DEVEN_ACUMUL_ANIO_ANT')} AS dev_acum_ant,
        {_NUM('DEV_ANIO_ACTUAL')} AS dev_actual, {_NUM('PIM_ANIO_ACTUAL')} AS pim_actual,
        {_NUM('SALDO_EJECUTAR')} AS saldo, {_NUM('AVANCE_FISICO')} AS avance_fisico,
        {_NUM('AVANCE_EJECUCION')} AS avance_ejecucion, PRIMER_DEVENGADO AS primer_devengado,
        ULTIMO_DEVENGADO AS ultimo_devengado, {_FECHA('FECHA_VIABILIDAD')} AS fecha_viabilidad,
        {_FECHA('FEC_INI_EJECUCION')} AS inicio, {_FECHA('FEC_FIN_EJECUCION')} AS fin,
        {_NUM('LATITUD')} AS latitud, {_NUM('LONGITUD')} AS longitud,
        TRY_CAST({_NUM('NUM_HABITANTES_BENEF')} AS BIGINT) AS beneficiarios, DES_TIPOLOGIA AS tipologia""",
    "seguimiento": f"""CODIGO_UNICO AS cui, {_NUM('DEVENGADO_ACUMULADO')} AS devengado_acumulado,
        {_NUM('AVANCE_FISICO')} AS avance_fisico, ULT_ESTADO_SITUACIONAL AS situacion_reporte,
        ULT_PROBLEMA AS problema, ACC_PROBLEMA AS accion, TRY_CAST(FECHA_ULT_ACT_F12B AS TIMESTAMP) AS fecha_reporte,
        {_FECHA('INICIO_EJEC_FISICA')} AS inicio_fisico, {_FECHA('CULMINA_EJEC_FISICA')} AS fin_fisico""",
}


def _metadatos() -> dict:
    p = CARPETA / "fuente.json"
    return json.loads(p.read_text()) if p.exists() else {}


def actualizar(forzar: bool = False) -> list:
    """Refresh lake/inversiones/{detalle,seguimiento}.parquet at most every CADENCIA_DIAS.
    Returns the lake files written (to push to Hugging Face)."""
    CARPETA.mkdir(parents=True, exist_ok=True)
    meta = _metadatos()
    escritos = []
    for nombre, url in FUENTES.items():
        destino = CARPETA / f"{nombre}.parquet"
        dias = (time.time() - (meta.get(nombre) or {}).get("descargado_ts", 0)) / 86400
        if not forzar and destino.exists() and dias < CADENCIA_DIAS:
            print(f"  inversiones {nombre}: al día (descargado hace {dias:.1f} días)")
            continue
        origen = RAW / "inversiones" / url.rsplit("/", 1)[1]
        origen.parent.mkdir(parents=True, exist_ok=True)
        print(f"  inversiones {nombre}: descargando {url}", flush=True)
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(origen.with_suffix(".part"), "wb") as f:
                for trozo in r.iter_content(chunk_size=1 << 20):
                    f.write(trozo)
        origen.with_suffix(".part").rename(origen)
        con = duckdb.connect()
        con.execute(f"""COPY (SELECT {COLUMNAS[nombre]} FROM read_csv('{origen}', all_varchar = true, header = true)
                        WHERE nullif(trim(CODIGO_UNICO), '') IS NOT NULL ORDER BY 1)
                        TO '{destino}' (FORMAT parquet, COMPRESSION zstd)""")
        n = con.execute(f"SELECT count(*) FROM '{destino}'").fetchone()[0]
        meta[nombre] = {"descargado": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "descargado_ts": time.time(),
                        "filas": n, "fuente": url}
        print(f"  inversiones {nombre}: {n:,} inversiones -> {destino.name} ({destino.stat().st_size / 1e6:.1f} MB)")
        origen.unlink(missing_ok=True)
        escritos.append(destino)
    if escritos:
        (CARPETA / "fuente.json").write_text(json.dumps(meta, indent=1))
        escritos.append(CARPETA / "fuente.json")
    return escritos


# what entities write when there is nothing to report: not a problem
_SIN_PROBLEMA = re.compile(r"^\W*$|SIN (RESTRICCI|PROBLEMA|OBSERVACI|INCONVENIENTE|DIFICULTAD)|NINGUN|^NO (PRESENTA|SE (HA|HAN|PRESENTA|IDENTIFIC|EVIDENCI|REGISTR|TIENE)|EXISTE|HAY|TIENE|APLICA|CUENTA)|^N\.?/?A\.?$", re.I)


def _sin_fecha(t: str | None) -> tuple[str | None, str | None]:
    """'[15/10/2026] en proceso de liquidación' -> ('2026-10-15', 'en proceso de liquidación')."""
    t = " ".join((t or "").split())
    m = re.match(r"^\[(\d{2})/(\d{2})/(\d{4})\]\s*(.*)$", t)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}", m.group(4) or None
    return None, t or None


def problema_real(t: str | None) -> str | None:
    _, texto = _sin_fecha(t)
    return None if not texto or _SIN_PROBLEMA.search(texto.strip()) else texto


def exportar(con, out) -> dict:
    """json/obras/<sec>.json: each of the unit's projects as a whole. Returns {(sec, cui): [updated
    cost, approved cost, spent in all years, physical progress]} for the entity pages' project lists."""
    carpeta = out / "obras"
    for viejo in carpeta.glob("*.json"):
        viejo.unlink()
    detalle, seguimiento = CARPETA / "detalle.parquet", CARPETA / "seguimiento.parquet"
    if not detalle.exists():
        return {}
    seg = f"'{seguimiento}'" if seguimiento.exists() else "(SELECT NULL::VARCHAR AS cui WHERE false)"
    filas = con.execute(f"""
        SELECT o.sec_ejec, o.cui, d.costo_actualizado::DOUBLE, d.monto_viable::DOUBLE,
               coalesce(s.devengado_acumulado, d.dev_acum_ant + coalesce(d.dev_actual, 0))::DOUBLE AS acumulado,
               coalesce(d.avance_fisico, s.avance_fisico)::DOUBLE AS avance_fisico, d.situacion, d.modalidad,
               d.inicio, d.fin, d.latitud::DOUBLE, d.longitud::DOUBLE, d.beneficiarios, d.monto_laudo::DOUBLE, d.primer_devengado,
               s.fecha_reporte, s.situacion_reporte, s.problema, s.accion, d.tipologia
        FROM (SELECT DISTINCT sec_ejec, cui FROM obras) o
        LEFT JOIN '{detalle}' d USING (cui) LEFT JOIN {seg} s USING (cui)
        WHERE d.cui IS NOT NULL OR s.cui IS NOT NULL ORDER BY 1, 2""").fetchall()
    por_sec: dict[str, dict] = {}
    resumen = {}
    for (sec, cui, costo, viable, acum, fisico, situacion, modalidad, inicio, fin, lat, lon, benef, laudo, primer,
         fecha_rep, sit_rep, problema, accion, tipologia) in filas:
        f_sit, sit = _sin_fecha(sit_rep)
        f_prob, prob = _sin_fecha(problema)
        _, acc = _sin_fecha(accion)
        reporte = None
        if sit or problema_real(problema):
            reporte = [str(fecha_rep)[:10] if fecha_rep else f_sit or f_prob,
                       sit if not sit or len(sit) <= LARGO_REPORTE else sit[:LARGO_REPORTE - 1].rstrip() + "…",
                       problema_real(problema), acc if acc and problema_real(problema) else None]
        por_sec.setdefault(sec, {})[cui] = {
            "costo": costo, "viable": viable, "acumulado": acum, "fisico": fisico, "situacion": situacion,
            "modalidad": modalidad, "inicio": str(inicio) if inicio else None, "fin": str(fin) if fin else None,
            "ubicacion": [round(lat, 6), round(lon, 6)] if lat and lon and -19 < lat < 0 and -82 < lon < -68 else None,
            "beneficiarios": benef or None, "laudo": laudo or None, "desde": primer or None,
            "tipologia": tipologia, "reporte": reporte,
        }
        resumen[(sec, cui)] = [costo, viable, acum, fisico]
    carpeta.mkdir(parents=True, exist_ok=True)
    for (sec,) in con.execute("SELECT DISTINCT sec_ejec FROM obras").fetchall():
        por_sec.setdefault(sec, {})  # a unit whose projects MEF does not describe still answers (no 404s)
    for sec, obras in por_sec.items():
        (carpeta / f"{sec}.json").write_text(json.dumps(obras, ensure_ascii=False, separators=(",", ":"), default=str))
    print(f"  json: obras/*.json ({len(por_sec)} units, {len(resumen):,} projects with their whole cost)")
    return resumen
