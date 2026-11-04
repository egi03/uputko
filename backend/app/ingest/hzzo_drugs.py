"""HZZO lists of medicines (hzzo.hr, "Objavljene liste lijekova").

The basic list (osnovna lista, OLL) holds medicines dispensed on prescription without a
co-payment; the supplementary list (dopunska lista, DLL) those for which the patient pays one
("Doplata za orig. pakiranje", in euros). The page links the list in force and often the next
one; the file name says from when it applies ("... stupa na snagu 01_10_2026.xlsx").
"""

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from urllib.parse import unquote, urljoin

import openpyxl
from lxml import html

PAGE_URL = "https://hzzo.hr/zdravstvena-zastita/objavljene-liste-lijekova"
_FILES = "https://hzzo.hr/sites/default/files/"
FALLBACK_URLS = {
    "OLL": _FILES + "web_OLL%20po%20dijelovima_stupa%20na%20snagu%2001_10_2026.xlsx",
    "DLL": _FILES + "web_DLL%20po%20dijelovima_stupa%20na%20snagu%2001_10_2026.xlsx",
}
# Hospital use only (legend): KL clinics, KS and DS other hospitals; PR, PO and DSPR/DSPO
# can also be used in primary care. Codes combine ("KLDS", "KLKSDS").
HOSPITAL_ONLY = {"KL", "KS", "DS"}


def is_hospital_only(restriction: str) -> bool:
    """'KLDS' -> True (clinics and hospitals), 'DSPR' -> False (also primary care)."""
    codes = {restriction[i : i + 2] for i in range(0, len(restriction), 2)}
    return bool(restriction) and len(restriction) % 2 == 0 and codes <= HOSPITAL_ONLY


@dataclass(frozen=True)
class ListRow:
    list: str  # OLL | DLL
    code: str  # "A02BC01 112"
    atc: str  # "A02BC01"
    restriction: str  # KL, KS, DS, PR, PO, DSPO, DSPR or ""
    inn: str  # nezaštićeni naziv, e.g. "omeprazol"
    holder: str
    brand: str  # zaštićeni naziv, e.g. "Ultop" (empty for some hospital entries)
    pack: str  # "caps. 28x20 mg"
    copay_eur: float | None  # DLL only
    rx_mark: str  # R | RS


def _clean(value: object) -> str:
    return " ".join(str(value or "").replace("\xa0", " ").split())


def in_force_from(url: str) -> date | None:
    """'..._stupa na snagu 01_10_2026.xlsx' -> 2026-10-01."""
    m = re.search(r"(\d{2})_(\d{2})_(\d{4})", unquote(url))
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def discover_lists(page: bytes, today: date, base_url: str = PAGE_URL) -> dict[str, str]:
    """'OLL'/'DLL' -> URL of the list in force today (the newest that already applies)."""
    doc = html.fromstring(page)
    best: dict[str, tuple[date, str]] = {}
    for href in doc.xpath("//a/@href"):
        url = urljoin(base_url, href)
        name = unquote(url.rsplit("/", 1)[-1])
        m = re.match(r"web_(OLL|DLL)\b.*\.xlsx$", name)
        start = in_force_from(url)
        if not m or start is None or start > today:
            continue
        key = m.group(1)
        if key not in best or start > best[key][0]:
            best[key] = (start, url)
    return {key: url for key, (_start, url) in best.items()}


def parse_list(path: Path, key: str) -> list[ListRow]:
    """First sheet ('OLL-1. dio' / 'DLL-1. dio'): one row per medicine and package."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = list(wb.worksheets[0].iter_rows(values_only=True, max_col=13))
    finally:
        wb.close()
    header = [_clean(c) for c in rows[0]]
    if header[0] != "ATK šifra" or header[5] != "Zaštićeni naziv lijeka":
        raise ValueError(f"{path.name}: unexpected header {header}")
    copay_col = header.index("Doplata za orig. pakiranje") if key == "DLL" else None
    rx_col = header.index("R/RS")
    out = []
    for r in rows[1:]:
        code = _clean(r[0])
        if not re.match(r"^[A-Z]\d{2}[A-Z]{2}\d{2}\b", code):
            continue
        copay = r[copay_col] if copay_col is not None else None
        out.append(
            ListRow(
                list=key,
                code=code,
                atc=code[:7],
                restriction=_clean(r[1]),
                inn=_clean(r[2]),
                holder=_clean(r[4]),
                brand=_clean(r[5]),
                pack=_clean(r[6]),
                copay_eur=float(copay) if isinstance(copay, int | float) else None,
                rx_mark=_clean(r[rx_col]),
            )
        )
    return out
