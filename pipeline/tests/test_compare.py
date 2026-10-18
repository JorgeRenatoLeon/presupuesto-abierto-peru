"""What "to date" means when MEF's daily files stop mid-month."""
from compare import avance_esperado, dias_cubiertos


def test_daily_file_published_mid_month():
    assert avance_esperado("20261017T133819Z", 2026, 10) == 0.7918  # 289 of 365 days, not 10/12
    assert dias_cubiertos("20261017T133819Z", 2026, 10) == (16, 31)  # last year's October prorated


def test_monthly_file_and_closed_year_cover_whole_months():
    assert avance_esperado("20260903T200428Z", 2026, 8) == round(8 / 12, 4)
    assert dias_cubiertos("20260903T200428Z", 2026, 8) == (31, 31)
    assert avance_esperado("20261017T135308Z", 2025, 12) == 1.0
    assert dias_cubiertos("20261017T135308Z", 2025, 12) == (31, 31)
