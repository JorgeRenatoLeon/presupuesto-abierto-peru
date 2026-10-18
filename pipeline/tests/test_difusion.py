"""Outward-facing outputs: RSS feeds and the Telegram digest."""
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from exportar import rss
from notify import digest, notificar

RESUMEN = {"ano": 2026, "mes_ult": 8, "publicacion": {"id": "20260903T200428Z", "fecha": "2026-09-03"},
           "totales": {"pim": 286.8e9, "pim_pub_ant": 273.2e9}}
ALERTAS = [
    {"regla": "CAMBIO_TEMA", "severidad": "alta", "titulo": "«Obras por contrata» aumentó S/ 5.9 mil millones <&>"},
    {"regla": "PIA_PIM", "severidad": "alta", "titulo": "no es un cambio nacional"},
    {"regla": "OBRA_SIN_AVANCE", "severidad": "media", "titulo": "Proyecto sin gasto"},
]


def test_rss_is_valid_and_escaped():
    xml = rss("Título & más", "desc", "https://ejemplo.pe/", [
        {"title": "A <b> & c", "link": "https://ejemplo.pe/x/?a=1&b=2", "guid": "abc123",
         "pubDate": datetime(2026, 9, 3, 20, 4, 28, tzinfo=timezone.utc), "description": "uno < dos"}])
    root = ET.fromstring(xml)
    item = root.find("channel/item")
    assert item.find("title").text == "A <b> & c"
    assert item.find("link").text == "https://ejemplo.pe/x/?a=1&b=2"
    assert item.find("pubDate").text == "Thu, 03 Sep 2026 20:04:28 +0000"


def test_digest_mentions_what_matters():
    texto = digest(ALERTAS, RESUMEN, "https://ejemplo.pe")
    assert "3 de septiembre de 2026" in texto
    assert "+S/ 13.6 mil millones" in texto
    assert "«Obras por contrata» aumentó S/ 5.9 mil millones &lt;&amp;&gt;" in texto  # HTML-escaped for Telegram
    assert "no es un cambio nacional" not in texto  # only national-scale alert types are highlighted
    assert "1 proyectos de más de S/ 5 millones" in texto
    assert texto.endswith("https://ejemplo.pe/comparar/") and len(texto) < 4096


def test_telegram_is_off_without_credentials(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notificar(ALERTAS, RESUMEN) is False
