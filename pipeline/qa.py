"""Automatic QA: internal coherence checks + external reconciliation vs Consulta Amigable.

Two layers, one command (`python run.py qa --year 2026`):

1. COHERENCE (offline, always runs): cross-table consistency, month coverage,
   plausibility ranges, JSON export integrity. FAIL here = real data bug.

2. RECONCILIATION (network): fetches the Consulta Amigable *mensual* pages
   (same monthly cut as our default source files) and value-matches our national
   PIA / PIM / devengado (gasto) and PIA / PIM / recaudado (ingreso) against the
   numbers in the page. Column-order independent: we check that each of our
   values appears among the page's numeric tokens within tolerance, so MEF
   layout changes don't break the check. Unreachable page = SKIPPED (exit 0)
   unless --strict; a value mismatch = FAIL.

Output: console report + data/serving/qa_report.json (consumed by /metodologia later).
"""
import json
import re
import time
from pathlib import Path

import duckdb

from config import SERVING

# --- Tolerances ---
TOL_INTERNAL = 0.01          # absolute soles, cross-table sums must match to the centavo
TOL_CA_REL = 0.005           # 0.5% vs Consulta Amigable (rounding/cut differences)
TOL_GIRADO_REL = 0.02        # girado may lag devengado slightly in weird ways
ENTITY_RANGE = (2000, 4000)  # plausible count of ejecutoras
MAX_ENTITY_OVEREXEC_PCT = 1.0  # % of entities allowed with devengado > PIM (data quirks)

CA_URLS_GASTO = [
    "https://apps5.mineco.gob.pe/transparencia/mensual/default.aspx?y={year}&ap=ActProy",
    "https://apps5.mineco.gob.pe/transparencia/mensual/Navegador/default.aspx?y={year}&ap=ActProy",
]
CA_URLS_INGRESO = [
    "https://apps5.mineco.gob.pe/transparenciaingresos/mensual/default.aspx?y={year}",
    "https://apps5.mineco.gob.pe/transparenciaingresos/mensual/Navegador/default.aspx?y={year}",
]
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def _db() -> duckdb.DuckDBPyConnection:
    db = SERVING / "serving.duckdb"
    alt = SERVING / "serving.duckdb.new"
    if alt.exists() and (not db.exists() or alt.stat().st_mtime > db.stat().st_mtime):
        db = alt
    return duckdb.connect(str(db), read_only=True)


class Report:
    def __init__(self):
        self.checks: list[dict] = []

    def add(self, layer: str, name: str, status: str, detail: str = ""):
        self.checks.append({"layer": layer, "check": name, "status": status, "detail": detail})
        mark = {"PASS": "PASS", "FAIL": "FAIL", "WARN": "WARN", "SKIP": "SKIP"}[status]
        print(f"  {mark}  [{layer}] {name}" + (f" — {detail}" if detail else ""))

    @property
    def failed(self) -> bool:
        return any(c["status"] == "FAIL" for c in self.checks)

    @property
    def skipped_external(self) -> bool:
        return any(c["layer"] == "consulta-amigable" and c["status"] == "SKIP" for c in self.checks)

    def save(self):
        out = SERVING / "qa_report.json"
        out.write_text(json.dumps({
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "summary": {
                "pass": sum(1 for c in self.checks if c["status"] == "PASS"),
                "fail": sum(1 for c in self.checks if c["status"] == "FAIL"),
                "warn": sum(1 for c in self.checks if c["status"] == "WARN"),
                "skip": sum(1 for c in self.checks if c["status"] == "SKIP"),
            },
            "checks": self.checks,
        }, ensure_ascii=False, indent=1))
        print(f"\n  report -> {out}")


# ---------------------------------------------------------------------------
# Layer 1: internal coherence
# ---------------------------------------------------------------------------

def _coherence(rep: Report, year: int) -> dict:
    con = _db()
    vals: dict = {}

    r = con.execute("SELECT mes_ult, pia, pim, devengado_ytd, girado_ytd FROM resumen_anual WHERE ano=?",
                    [year]).fetchone()
    if not r:
        rep.add("coherencia", f"resumen_anual has year {year}", "FAIL", "year missing")
        con.close()
        return vals
    mes_ult, pia, pim, dev, gir = r
    vals.update(mes_ult=mes_ult, pia=pia, pim=pim, devengado=dev, girado=gir)
    rep.add("coherencia", f"resumen_anual has year {year}", "PASS",
            f"mes_ult={mes_ult}, PIM=S/{pim/1e9:.1f}B, dev=S/{dev/1e9:.1f}B")

    # months contiguous 1..mes_ult in both national facts
    for t in ("fact_nacional_mes", "fact_ing_nacional_mes"):
        try:
            meses = [x[0] for x in con.execute(
                f"SELECT DISTINCT mes FROM {t} WHERE ano=? ORDER BY mes", [year]).fetchall()]
        except duckdb.CatalogException:
            rep.add("coherencia", f"{t} exists", "WARN", "table missing (dataset not loaded)")
            continue
        expected = list(range(1, (mes_ult if t == "fact_nacional_mes" else max(meses or [0])) + 1))
        ok = meses == expected and len(meses) > 0
        rep.add("coherencia", f"{t} months contiguous", "PASS" if ok else "FAIL", f"{meses}")

    # cross-table devengado agreement
    pairs = [("fact_entidad_mes", "devengado"), ("fact_funcion_mes", "devengado"),
             ("fact_dept_mes", "devengado"), ("fact_generica_mes", "devengado")]
    for t, col in pairs:
        s = con.execute(f"SELECT SUM({col}) FROM {t} WHERE ano=?", [year]).fetchone()[0] or 0
        ok = abs(s - dev) <= TOL_INTERNAL
        rep.add("coherencia", f"devengado {t} == resumen", "PASS" if ok else "FAIL",
                f"{s:,.2f} vs {dev:,.2f}")

    # girado sanity (national)
    if gir is not None:
        ok = gir <= dev * (1 + TOL_GIRADO_REL)
        rep.add("coherencia", "girado <= devengado (nacional)", "PASS" if ok else "WARN",
                f"girado {gir:,.0f} vs devengado {dev:,.0f}")

    # national devengado <= PIM
    ok = dev <= pim * 1.001
    rep.add("coherencia", "devengado <= PIM (nacional)", "PASS" if ok else "FAIL",
            f"avance {dev/pim*100:.1f}%")

    # entity-level over-execution ratio
    n_ent, n_over = con.execute("""
        WITH e AS (
            SELECT sec_ejec, SUM(devengado) dev,
                   SUM(pim) FILTER (mes = (SELECT max(mes) FROM fact_entidad_mes f2
                                           WHERE f2.ano = f.ano AND f2.sec_ejec = f.sec_ejec)) pim
            FROM fact_entidad_mes f WHERE ano=? GROUP BY sec_ejec)
        SELECT count(*), count(*) FILTER (pim > 0 AND dev > pim * 1.005) FROM e
    """, [year]).fetchone()
    pct_over = n_over / n_ent * 100 if n_ent else 0
    rep.add("coherencia", "entities executing beyond PIM", "PASS" if pct_over <= MAX_ENTITY_OVEREXEC_PCT else "WARN",
            f"{n_over}/{n_ent} ({pct_over:.2f}%)")
    ok = ENTITY_RANGE[0] <= n_ent <= ENTITY_RANGE[1]
    rep.add("coherencia", "entity count plausible", "PASS" if ok else "WARN", f"{n_ent}")

    # ingreso side (if loaded)
    ri = con.execute("SELECT pia, pim, recaudado_ytd FROM resumen_ing_anual WHERE ano=?", [year]).fetchone() \
        if _has_table(con, "resumen_ing_anual") else None
    if ri:
        vals.update(ing_pia=ri[0], ing_pim=ri[1], recaudado=ri[2])
        s = con.execute("SELECT SUM(recaudado) FROM fact_ing_fuente_mes WHERE ano=?", [year]).fetchone()[0] or 0
        ok = abs(s - ri[2]) <= TOL_INTERNAL
        rep.add("coherencia", "recaudado fact_ing_fuente == resumen", "PASS" if ok else "FAIL",
                f"{s:,.2f} vs {ri[2]:,.2f}")
        rep.add("coherencia", "nota: ingresos sin Recursos Ordinarios", "PASS",
                "dataset covers rubros 04-19; RO (impuestos del tesoro) no se registra aquí")
    else:
        rep.add("coherencia", "ingreso data loaded", "WARN", "resumen_ing_anual missing/empty")

    # JSON exports parse and are consistent
    jdir = SERVING / "json"
    for name in ("resumen_anual", "serie_nacional", "por_funcion", "top_entidades",
                 "entidades", "alertas", "contraste_mensual"):
        p = jdir / f"{name}.json"
        try:
            data = json.loads(p.read_text())
            rep.add("coherencia", f"json {name} valid", "PASS", f"{len(data)} records")
        except Exception as e:
            rep.add("coherencia", f"json {name} valid", "FAIL", str(e))

    # comparisons (compare.py, computed from the lake): must add up to the serving layer
    rp = jdir / "comparar" / "resumen.json"
    if rp.exists():
        res = json.loads(rp.read_text())
        if res.get("ano") == year:
            cmp_pim = res["totales"]["pim"] or 0
            ok = abs(cmp_pim - pim) <= 1.0  # exact DECIMAL vs DOUBLE sums
            rep.add("coherencia", "comparar PIM nacional == resumen", "PASS" if ok else "FAIL",
                    f"{cmp_pim:,.2f} vs {pim:,.2f}")
        for dim in res.get("dimensiones", []):
            try:
                n = len(json.loads((jdir / "comparar" / f"{dim['id']}.json").read_text())["nodos"])
                rep.add("coherencia", f"json comparar/{dim['id']} valid", "PASS" if n else "WARN", f"{n} nodos")
            except Exception as e:
                rep.add("coherencia", f"json comparar/{dim['id']} valid", "FAIL", str(e))
    else:
        rep.add("coherencia", "comparar/resumen.json exists", "WARN", "run `python run.py compare`")

    con.close()
    return vals


def _has_table(con, name: str) -> bool:
    return bool(con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name=?", [name]).fetchone()[0])


# ---------------------------------------------------------------------------
# Layer 2: reconciliation vs Consulta Amigable
# ---------------------------------------------------------------------------

def _fetch(url: str) -> str | None:
    import requests
    try:
        s = requests.Session()
        r = s.get(url, headers={"User-Agent": UA}, timeout=30)
        if r.status_code == 200 and len(r.text) > 2000:
            return r.text
        # frameset shells are short; try to follow the first frame src
        m = re.search(r'<frame[^>]+src="([^"]+)"', r.text or "", re.I)
        if m:
            from urllib.parse import urljoin
            r2 = s.get(urljoin(url, m.group(1)), headers={"User-Agent": UA}, timeout=30)
            if r2.status_code == 200 and len(r2.text) > 2000:
                return r2.text
    except Exception:
        return None
    return None


def _page_numbers(html: str) -> list[float]:
    """All numeric tokens in the page that look like money amounts (>= 1e6)."""
    tokens = re.findall(r'>\s*([0-9][0-9,\.]{6,25})\s*<', html)
    out = []
    for t in tokens:
        try:
            v = float(t.replace(",", ""))
            if v >= 1e6:
                out.append(v)
        except ValueError:
            continue
    return out


def _match(rep: Report, side: str, metric: str, ours: float | None, page_nums: list[float]):
    if ours is None:
        rep.add("consulta-amigable", f"{side} {metric}", "SKIP", "no local value")
        return
    best = min(page_nums, key=lambda v: abs(v - ours), default=None)
    if best is None:
        rep.add("consulta-amigable", f"{side} {metric}", "SKIP", "no numbers parsed from page")
        return
    rel = abs(best - ours) / ours if ours else 1.0
    if rel <= TOL_CA_REL:
        rep.add("consulta-amigable", f"{side} {metric} matches CA", "PASS",
                f"ours {ours:,.0f} ≈ CA {best:,.0f} (Δ {rel*100:.2f}%)")
    else:
        rep.add("consulta-amigable", f"{side} {metric} matches CA", "FAIL",
                f"ours {ours:,.0f} vs closest CA number {best:,.0f} (Δ {rel*100:.2f}%) — "
                f"check month cut and source file freshness")


def _reconcile(rep: Report, year: int, vals: dict) -> None:
    html = next((h for u in CA_URLS_GASTO if (h := _fetch(u.format(year=year)))), None)
    if html:
        (SERVING / "qa_ca_gasto.html").write_text(html)  # debug artifact
        nums = _page_numbers(html)
        _match(rep, "gasto", "PIA", vals.get("pia"), nums)
        _match(rep, "gasto", "PIM", vals.get("pim"), nums)
        _match(rep, "gasto", "devengado YTD", vals.get("devengado"), nums)
    else:
        rep.add("consulta-amigable", "gasto page reachable", "SKIP",
                "CA mensual not fetchable (bot protection or offline) — open it in a browser to compare manually")

    html = next((h for u in CA_URLS_INGRESO if (h := _fetch(u.format(year=year)))), None)
    if html:
        (SERVING / "qa_ca_ingreso.html").write_text(html)
        nums = _page_numbers(html)
        _match(rep, "ingreso", "PIA", vals.get("ing_pia"), nums)
        _match(rep, "ingreso", "PIM", vals.get("ing_pim"), nums)
        _match(rep, "ingreso", "recaudado YTD", vals.get("recaudado"), nums)
    else:
        rep.add("consulta-amigable", "ingreso page reachable", "SKIP",
                "CA ingresos mensual not fetchable — open it in a browser to compare manually")


def qa(year: int, strict: bool = False, skip_external: bool = False) -> bool:
    print(f"QA for {year}")
    rep = Report()
    vals = _coherence(rep, year)
    if not skip_external:
        _reconcile(rep, year, vals)
    rep.save()
    if rep.failed:
        print("QA: FAILED")
        return False
    if strict and rep.skipped_external:
        print("QA: FAILED (strict mode: external reconciliation skipped)")
        return False
    print("QA: OK")
    return True
