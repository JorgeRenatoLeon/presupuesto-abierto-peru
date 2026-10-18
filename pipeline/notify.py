"""Optional push notifications: post a digest of each new MEF publication to a Telegram
channel. Free: create a bot with @BotFather, make it an admin of a public channel, and set
TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (e.g. "@presupuestoabierto"). Without them, nothing is sent.
"""
import os
from html import escape

import requests

MESES_ES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
            "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
DESTACAR = ("CAMBIO_TEMA", "CAMBIO_ANUAL", "OBRA_SIN_AVANCE", "GASTO_DICIEMBRE")


def _fmt(v: float) -> str:
    if abs(v) >= 1e9:
        return f"S/ {v/1e9:,.1f} mil millones"
    return f"S/ {v/1e6:,.1f} millones"


def _fecha(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{int(d)} de {MESES_ES[int(m)]} de {y}"


def digest(alertas: list[dict], resumen: dict, sitio: str, n: int = 5) -> str:
    """Telegram HTML message: what changed with this publication, in a few lines."""
    t = resumen["totales"]
    lineas = [f"<b>Nueva actualización del presupuesto ({_fecha(resumen['publicacion']['fecha'])})</b>",
              f"Presupuesto vigente {resumen['ano']}: {_fmt(t['pim'])}"
              + (f" ({'+' if t['pim'] >= t['pim_pub_ant'] else '−'}{_fmt(abs(t['pim'] - t['pim_pub_ant']))} "
                 f"desde la actualización anterior)." if t.get("pim_pub_ant") else ".")]
    top = [a for a in alertas if a["severidad"] == "alta" and a["regla"] in DESTACAR][:n]
    if top:
        lineas += ["", "<b>Lo más importante:</b>"] + [f"• {escape(a['titulo'])}" for a in top]
    obras = sum(a["regla"] == "OBRA_SIN_AVANCE" for a in alertas)
    if obras:
        lineas += ["", f"{obras} proyectos de más de S/ 5 millones no registran gasto a "
                       f"{MESES_ES[resumen['mes_ult']]}."]
    lineas += ["", f"Compara y revisa tu región: {sitio}/comparar/"]
    return "\n".join(lineas)


def notificar(alertas: list[dict], resumen: dict) -> bool:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return False
    sitio = os.environ.get("SITE_URL", "").rstrip("/")
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=30, data={
        "chat_id": chat, "text": digest(alertas, resumen, sitio), "parse_mode": "HTML",
        "disable_web_page_preview": "true"})
    r.raise_for_status()
    print(f"  telegram: digest sent to {chat}")
    return True
