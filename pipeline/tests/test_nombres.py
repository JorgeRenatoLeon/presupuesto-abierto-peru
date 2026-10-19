"""MEF capitals become readable Spanish names (same rules as apps/web/lib/nombres.ts)."""
from nombres import con_lugares, lugares_de, texto, titulo

LUGARES = lugares_de(["CUSCO", "URUBAMBA", "OLLANTAYTAMBO", "SAN MARTIN DE PORRES", "LIMA", "LA CONVENCION", "PICHARI"])


def test_accents_and_acronyms():
    assert texto("PLANEAMIENTO, GESTION Y RESERVA DE CONTINGENCIA") == "Planeamiento, gestión y reserva de contingencia"
    assert texto("MANTENIMIENTO PERIODICO DE CAMINOS") == "Mantenimiento periódico de caminos"
    assert titulo("MEF-ADMINISTRACION GENERAL") == "MEF-Administración General"
    assert titulo("SEGURO INTEGRAL DE SALUD - SIS") == "Seguro Integral de Salud - SIS"


def test_places_inside_project_titles():
    assert con_lugares("CALLES PALLPAMCARO, QUINTA CRUZ ESQUINA Y MASCABAMBA DE LA CIUDAD DE OLLANTAYTAMBO", LUGARES) == \
        "Calles Pallpamcaro, Quinta Cruz Esquina y Mascabamba de la ciudad de Ollantaytambo"
    assert con_lugares("EN EL PUENTE CALICANTO DEL DISTRITO DE OLLANTAYTAMBO - PROVINCIA DE URUBAMBA", LUGARES) == \
        "En el puente Calicanto del distrito de Ollantaytambo - provincia de Urubamba"
    assert con_lugares("EN EL AMBITO DEL DISTRITO DE SAN MARTIN DE PORRES - LIMA - LIMA", LUGARES) == \
        "En el ámbito del distrito de San Martín de Porres - Lima - Lima"
    assert con_lugares("PAGO DE PENSIONES", LUGARES) == "Pago de pensiones"
