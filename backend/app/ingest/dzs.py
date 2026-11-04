"""DZS Census 2021 parsers."""

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import openpyxl

DZS_SETTLEMENTS_URL = (
    "https://podaci.dzs.hr/media/rqybclnx/popis_2021-stanovnistvo_po_naseljima.xlsx"
)
DZS_MUNICIPALITIES_URL = (
    "https://podaci.dzs.hr/media/td3jvrbu/popis_2021-stanovnistvo_po_gradovima_opcinama.xlsx"
)
SOURCE_LABEL = "DZS, Popis 2021."

# Sheet "1." of the settlements file: one row per (unit, sex).
_COL_COUNTY, _COL_JLS_TYPE, _COL_JLS, _COL_SETTLEMENT, _COL_SEX, _COL_TOTAL = 0, 1, 4, 5, 6, 8
_COL_AGE_65 = 22  # "65 – 69"; columns 22..28 are 65+
_SEX_ALL = "sv."
# Grad Zagreb is both a county and a town: its rows have no JLS columns.
ZAGREB_COUNTY = "Grad Zagreb"
ZAGREB_JLS = "Zagreb"


@dataclass(frozen=True)
class SettlementRow:
    county: str
    municipality: str
    municipality_type: str  # Grad | Općina
    name: str
    population: int
    population_65_plus: int


@dataclass(frozen=True)
class MunicipalityRow:
    county: str
    municipality: str
    municipality_type: str
    population_total: int
    population_65_plus: int | None


def _as_int(value: object) -> int:
    if isinstance(value, int | float):
        return int(value)
    return 0  # "-" means "nema pojave" (zero)


def _clean(value: object) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def parse_settlements(path: Path) -> Iterator[SettlementRow]:
    """Rows with a settlement name and sex 'sv.' (all). County/JLS totals are skipped."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb["1."]
        for row in ws.iter_rows(min_row=9, values_only=True):
            if len(row) <= _COL_AGE_65 or _clean(row[_COL_SEX]) != _SEX_ALL:
                continue
            settlement = _clean(row[_COL_SETTLEMENT])
            county = _clean(row[_COL_COUNTY])
            jls, jls_type = _clean(row[_COL_JLS]), _clean(row[_COL_JLS_TYPE])
            if county == ZAGREB_COUNTY and not jls:
                jls, jls_type = ZAGREB_JLS, "Grad"
            if not settlement or not jls:
                continue
            yield SettlementRow(
                county=county,
                municipality=jls,
                municipality_type=jls_type,
                name=settlement,
                population=_as_int(row[_COL_TOTAL]),
                population_65_plus=sum(_as_int(v) for v in row[_COL_AGE_65 : _COL_AGE_65 + 7]),
            )
    finally:
        wb.close()


# Sheet "6." of the municipalities file (population contingents).
_M_COL_TOTAL = 7
_M_COL_65_PLUS = 16
_M_HEADER_65 = "65 i više"


def parse_municipalities(path: Path) -> Iterator[MunicipalityRow]:
    """Total and 65+ population per town/municipality (table 6, 'Kontingenti stanovništva')."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb["6."]
        header_ok = False
        for row in ws.iter_rows(min_row=1, values_only=True):
            if not header_ok:
                header = _clean(row[_M_COL_65_PLUS]) if len(row) > _M_COL_65_PLUS else ""
                header_ok = header.startswith(_M_HEADER_65)
                continue
            if len(row) <= _M_COL_65_PLUS or _clean(row[5]) != _SEX_ALL:
                continue
            county = _clean(row[_COL_COUNTY])
            jls, jls_type = _clean(row[_COL_JLS]), _clean(row[_COL_JLS_TYPE])
            if county == ZAGREB_COUNTY:
                # Use the city total; the table also lists its 17 districts (Gradska četvrt).
                if jls:
                    continue
                jls, jls_type = ZAGREB_JLS, "Grad"
            if not jls:
                continue
            yield MunicipalityRow(
                county=county,
                municipality=jls,
                municipality_type=jls_type,
                population_total=_as_int(row[_M_COL_TOTAL]),
                population_65_plus=_as_int(row[_M_COL_65_PLUS]),
            )
        if not header_ok:
            raise ValueError("DZS table 6: column '65 i više godina' not found")
    finally:
        wb.close()
