"""HALMED drug database (https://www.halmed.hr/Lijekovi/Baza-lijekova/).

An empty search returns every authorised medicine as an HTML list (with links to the medicine's
page, where the patient leaflet and the summary of product characteristics are) and a link to
export the same result as XLSX with all fields. The export marks centrally authorised medicines
with "*" and revoked authorisations with "**" after the name. HALMED asks that integrated data
be refreshed daily.
"""

import html as htmllib
import re
from dataclasses import dataclass
from pathlib import Path

import openpyxl

BASE_URL = "https://www.halmed.hr"
SEARCH_URL = f"{BASE_URL}/Lijekovi/Baza-lijekova/"
CKAN_DATASET = "baza-lijekova"
# The form of the "Pretražite bazu lijekova" box with every criterion empty.
EMPTY_SEARCH = {
    "naziv": "",
    "broj_odobrenja": "",
    "djelatna_tvar": "",
    "farmaceutski_oblik": "",
    "proizvodac": "",
    "nositelj_odobrenja": "",
    "datum_rjesenja_od": "",
    "datum_rjesenja_do": "",
    "rok_rjesenja_od": "",
    "rok_rjesenja_do": "",
    "klasa": "",
    "urbroj": "",
    "sastav": "",
    "nacin_izdavanja": "0",
    "nacin_propisivanja": "0",
    "mjesto_izdavanja": "0",
    "nacin_oglasavanja": "0",
    "atk": "",
    "status_lijeka": "0",
    "status_nestasice": "0",
    "trazi_baza": "OK",
}
EXPORT_HEADER = ("Naziv", "Raniji naziv", "Broj odobrenja", "Djelatna tvar")


@dataclass(frozen=True)
class ListedDrug:
    """One row of the search result list."""

    halmed_id: str
    detail_path: str  # "/Lijekovi/Baza-lijekova/Andol-300-mg-tablete/12185/"
    name: str
    revoked: bool = False  # '<span class="zvj">**</span>' after the name


@dataclass(frozen=True)
class DrugRow:
    """One row of the XLSX export."""

    name: str
    former_name: str
    approval_number: str
    active_substance: str
    form: str
    holder: str
    rx: str  # "na recept" | "bez recepta" | ""
    prescription: str  # "ponovljivi recept", ...
    atc: str
    market_status: str  # "stavljeno u promet", "trajni prekid opskrbe", ...
    shortage: str  # "u tijeku" | "nema nestašice" | ""
    central: bool  # authorised by the European Commission ("*")
    revoked: bool  # authorisation revoked ("**")


def _clean(value: object) -> str:
    return " ".join(str(value or "").split())


def parse_results(page: bytes) -> tuple[str | None, list[ListedDrug]]:
    """(export link, listed medicines) from the result page of the empty search."""
    text = page.decode("utf-8", errors="replace")
    m = re.search(r'href="(/hr/Download/xls/lijekovi/[^"]+\.xlsx)"', text)
    export = f"{BASE_URL}{m.group(1)}" if m else None
    rows = []
    for path, pid, name, stars in re.findall(
        r'<th><a href="(/Lijekovi/Baza-lijekova/[^"/]+/(\d+)/)">(.*?)</a>'
        r'\s*(?:<span class="zvj">(\*+)</span>)?',
        text,
        re.DOTALL,
    ):
        main = htmllib.unescape(re.sub(r"<br\s*/?>.*", "", name, flags=re.DOTALL))
        rows.append(ListedDrug(pid, path, _clean(main), revoked=stars == "**"))
    return export, rows


def split_name(raw: str) -> tuple[str, bool, bool]:
    """'Abilify*' -> ('Abilify', central, revoked); '**' marks a revoked authorisation."""
    name = raw.rstrip()
    revoked = name.endswith("**")
    central = not revoked and name.endswith("*")
    return name.rstrip("*").strip(), central, revoked


def parse_export(path: Path) -> list[DrugRow]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = list(wb.worksheets[0].iter_rows(values_only=True, max_col=21))
    finally:
        wb.close()
    header_at = next(
        (i for i, r in enumerate(rows[:30]) if tuple(_clean(c) for c in r[:4]) == EXPORT_HEADER),
        None,
    )
    if header_at is None:
        raise ValueError(f"{path.name}: export header not found")
    out = []
    for r in rows[header_at + 1 :]:
        v = [_clean(x) for x in r]
        if not v[0] or v[0].startswith("*"):  # the legend below the table ('**Rješenje ...')
            continue
        name, central, revoked = split_name(v[0])
        out.append(
            DrugRow(
                name=name,
                former_name=v[1],
                approval_number=v[2],
                active_substance=v[3],
                form=v[5],
                holder=v[8],
                rx=v[14],
                prescription=v[15],
                atc=v[18][:7],
                market_status=v[19],
                shortage=v[20],
                central=central,
                revoked=revoked or bool(v[11]),
            )
        )
    return out
