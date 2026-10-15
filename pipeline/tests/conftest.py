import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(PIPELINE))
