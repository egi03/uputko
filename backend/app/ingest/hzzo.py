"""HZZO registries of contracted health care.

Source page: hzzo.hr, "Ugovoreni sadržaji zdravstvene zaštite u RH". It links the current
files and their names change every month, so the links are read from the page, with the last
known URLs as a fallback:
- primary care practices per activity (web_opca|ped|gin|dent_MMYYYY.xlsx), with address and
  the number of insured persons;
- outpatient specialist care and MR/CT/UZV diagnostics outside hospitals (SKZZ, with addresses);
- the hospital network: contracted specialist activities per hospital ("Postelje,
  specijalističke ordinacije, dijagnostičke jedinice, mjesta dnevne bolnice");
- hospital addresses: the only list with addresses is the 2017 address book (adresar bolnica).

Doctor names are never stored: private practices are identified by their type and address.
"""

import re
import warnings
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urljoin

import openpyxl
import xlrd
from lxml import html

from app.geo.normalize import strip_diacritics

SOURCE = "HZZO"
# The PZZ workbooks define a print area openpyxl cannot read; harmless.
warnings.filterwarnings("ignore", message="Print area cannot be set", module="openpyxl")
PAGE_URL = (
    "https://hzzo.hr/zdravstvena-zastita/zdravstvena-zastita-pokrivena-obveznim-zdravstvenim-"
    "osiguranjem/ugovoreni"
)
_FILES = "https://hzzo.hr/sites/default/files/"
# Last known links (27 Oct 2026), used when the page cannot be read.
FALLBACK_URLS = {
    "family_medicine": _FILES + "web_opca_092026_0.xlsx",
    "pediatrics": _FILES + "web_ped_092026_0.xlsx",
    "gynecology": _FILES + "web_gin_092026_1.xlsx",
    "dentistry": _FILES + "web_dent_092026_0.xlsx",
    "skzz": _FILES
    + "Ugovoreni%20sadr%C5%BEaji%20izvanbolni%C4%8Dke%20specijalisti%C4%8Dko-konzilijarne"
    "%20zdravstvene%20za%C5%A1tite%20s%20adresama%20-%20listopad%202026._2.xlsx",
    "hospital_network": _FILES
    + "Postelje%2C%20specijalisti%C4%8Dke%20ordinacije%2C%20dijagnosti%C4%8Dke%20jedinice"
    "%2C%20mjesta%20dnevne%20bolnice%20-%20velja%C4%8Da%202026..xlsx",
    "hospital_addresses": "https://hzzo.hr/wp-content/uploads/2013/10/adresar-bolnica-1.xls",
}
PZZ_TYPES = {
    "family_medicine": "opca",
    "pediatrics": "ped",
    "gynecology": "gin",
    "dentistry": "dent",
}
MONTHS = {
    "sijecanj": 1,
    "veljaca": 2,
    "ozujak": 3,
    "travanj": 4,
    "svibanj": 5,
    "lipanj": 6,
    "srpanj": 7,
    "kolovoz": 8,
    "rujan": 9,
    "listopad": 10,
    "studeni": 11,
    "prosinac": 12,
}

# HZZO regional (RU) and area (PU, PS) offices -> counties they cover.
OFFICE_COUNTIES = {
    "Zagreb": ("Grad Zagreb", "Zagrebačka"),
    "Split": ("Splitsko-dalmatinska",),
    "Rijeka": ("Primorsko-goranska",),
    "Osijek": ("Osječko-baranjska",),
    "Pazin": ("Istarska",),
    "Zadar": ("Zadarska",),
    "Sisak": ("Sisačko-moslavačka",),
    "Vinkovci": ("Vukovarsko-srijemska",),
    "Varaždin": ("Varaždinska",),
    "Dubrovnik": ("Dubrovačko-neretvanska",),
    "Slavonski Brod": ("Brodsko-posavska",),
    "Karlovac": ("Karlovačka",),
    "Krapina": ("Krapinsko-zagorska",),
    "Bjelovar": ("Bjelovarsko-bilogorska",),
    "Šibenik": ("Šibensko-kninska",),
    "Koprivnica": ("Koprivničko-križevačka",),
    "Čakovec": ("Međimurska",),
    "Virovitica": ("Virovitičko-podravska",),
    "Požega": ("Požeško-slavonska",),
    "Gospić": ("Ličko-senjska",),
}
SKZZ_SUBTYPES = {
    "dz": "health_center",
    "pol": "polyclinic",
    "ppv": "private_practice",
    "ppz": "private_practice",
    "zjz": "public_health",
    "lab": "laboratory",
}
# Private practices and laboratories carry the owner's name: they get a generic name instead.
GENERIC_NAMES = {
    "private_practice": "privatna specijalistička ordinacija u mreži HZZO-a",
    "laboratory": "medicinsko-biokemijski laboratorij u mreži HZZO-a",
}
GENERAL_HOSPITAL_TYPES = {"KLINIČKI BOLNIČKI CENTAR", "KLINIČKA BOLNICA", "OPĆA BOLNICA"}
# The file's type cells are merged across columns, so a specialty clinic after a clinical hospital
# reads as one ('KLINIKA ZA ORTOPEDIJU LOVRAN', 'KLINIKA ZA PSIHIJATRIJU VRAPČE'): the name decides.
_SPECIAL_NAME_STARTS = ("klinika",)
_SPECIAL_NAME_WORDS = ("specijaln", "psihijatr", "djecj", "lijeciliste", "ljeciliste")

_COMMON_LAST_WORDS = {
    "bolnica",
    "županije",
    "skrb",
    "smetnjama",
    "bolesti",
    "dobi",
    "reumatizma",
    "rehabilitaciju",
    "liječenje",
    "mladež",
    "veterana",
    "osijeku",
    "rata",
    "ortopediju",
    "psihijatriju",
    "zdravlja",
    "zdravstvo",
}
# A word before these is part of a proper name: "Daruvarske Toplice", "Šibensko-kninske županije".
_NAME_BEFORE = {"TOPLICE", "ŽUPANIJE"}


@dataclass(frozen=True)
class Offer:
    activity_code: str
    activity_name: str
    dtp_code: str = ""


@dataclass(frozen=True)
class FacilityRow:
    source_id: str
    type: str  # family_medicine | pediatrics | gynecology | dentistry | hospital | specialist
    subtype: str
    name: str
    street: str  # "Kralja Zvonimira 3" (may be empty)
    settlement: str  # place of the address, as written by HZZO
    municipality: str  # JLS (or Zagreb district) column, or town
    counties: tuple[str, ...]  # candidates from the HZZO office or the file; empty if unknown
    phone: str = ""
    hzzo_code: str = ""
    insured_count: int | None = None
    offers: tuple[Offer, ...] = ()


@dataclass(frozen=True)
class HospitalAddress:
    name: str
    town: str
    street: str
    phone: str


# ------------------------------------------------------------------ helpers


def _clean(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return " ".join(str(value or "").split())


def _fold(text: str) -> str:
    """Lowercase ASCII for matching file names, headers and town names."""
    return strip_diacritics(text.lower()).strip()


def smart_case(text: str) -> str:
    """'UL. PETRA ZRINSKOG' -> 'Ul. Petra Zrinskog'; 'Z.J.JOVANOVIĆA' -> 'Z.J.Jovanovića'."""
    small = {"I", "NA", "U", "OD", "KOD", "ZA", "S"}
    out = re.sub(
        r"[A-ZČĆĐŠŽa-zčćđšž]+",
        lambda m: (
            m.group(0).lower()
            if m.group(0).upper() in small and m.start() > 0
            else m.group(0).capitalize()
        ),
        text,
    )
    return re.sub(r"\bBb\b|\bbb\b", "bb", out)


def is_general_hospital(name: str, *, listed_general: bool) -> bool:
    """A general or clinical hospital (OB, ŽB, KB, KBC), where 'bolnica' sends people; not a
    specialty clinic ('Klinika za …'), a psychiatric, children's or other special hospital."""
    folded = _fold(name)
    if folded.startswith(_SPECIAL_NAME_STARTS) or any(w in folded for w in _SPECIAL_NAME_WORDS):
        return False
    return listed_general


def hospital_name(raw: str, town: str = "") -> str:
    """'OPĆA ŽUPANIJSKA BOLNICA VINKOVCI' -> 'Opća županijska bolnica Vinkovci'.

    Sentence case; words inside quotes, the town name and a person after 'DR.' stay
    capitalized ('Opća bolnica dr. Josip Benčević Slavonski Brod')."""
    raw = raw.replace("˝", '"').replace("»", '"').replace("«", '"')
    raw = re.sub(r"(?<![^\s\"])(PRIM\.\s*)?DR\.\s*", " dr. ", raw, flags=re.IGNORECASE)
    town_words = {w.upper() for w in town.split()}
    words = raw.split()
    out, quoted, person = [], False, 0
    for i, w in enumerate(words):
        opens = w.startswith('"')
        bare = w.strip('"')
        if bare == "dr.":
            out.append(bare)
            person = 2  # first name and surname follow
            continue
        # Trailing proper names: "Klinička bolnica Dubrava", "Klinika za psihijatriju Vrapče".
        is_last_name = i == len(words) - 1 and bare.lower() not in _COMMON_LAST_WORDS
        before_name = i + 1 < len(words) and words[i + 1].strip('"').upper() in _NAME_BEFORE
        keep = (
            i == 0
            or quoted
            or opens
            or person > 0
            or before_name
            or bare.upper() in town_words
            or is_last_name
        )
        if keep and (person > 0 or bare.upper() in town_words):  # "Horvat-Rovinj"
            word = "-".join(p.capitalize() for p in bare.split("-"))
        else:  # "Šibensko-kninske", "Magdalena-klinika"
            word = bare.capitalize() if keep else bare.lower()
        out.append(('"' if opens else "") + word + ('"' if w.endswith('"') and len(w) > 1 else ""))
        quoted = (quoted or opens) and not (w.endswith('"') and len(w) > 1)
        person = max(0, person - 1)
    return " ".join(out)


def _office_counties(office: str) -> tuple[str, ...]:
    """'PU Vinkovci', 'RU Zagreb', 'Osijek' -> counties of that HZZO office."""
    name = re.sub(r"^(PU|RU|PS)\s+", "", office.strip())
    return OFFICE_COUNTIES.get(name, ())


def _activity_name(raw: str) -> str:
    """'ortodoncija20', 'oralna kirurgija*', 'ortodoncija/ ortodoncija18' -> clean name."""
    name = raw.partition("/")[0]
    return re.sub(r"[\d*]+$", "", name).strip()


def _house_number(value: str) -> str:
    value = value.strip().strip("\\").strip()
    return "bb" if value.upper() in {"BB", "B.B.", ""} else value


# ------------------------------------------------------------------ discovery


def discover_files(page: bytes, base_url: str = PAGE_URL) -> dict[str, str]:
    """File key -> URL from the 'Ugovoreni sadržaji' page; the newest PZZ list wins."""
    doc = html.fromstring(page)
    found: dict[str, tuple[tuple[int, int], str]] = {}

    def keep(key: str, url: str, rank: tuple[int, int] = (0, 0)) -> None:
        if key not in found or rank > found[key][0]:
            found[key] = (rank, url)

    for href in doc.xpath("//a/@href"):
        url = urljoin(base_url, href)
        name = _fold(unquote(url.rsplit("/", 1)[-1]))
        for ftype, short in PZZ_TYPES.items():
            m = re.match(rf"web_{short}_(\d{{2}})(\d{{4}})[^/]*\.xlsx?$", name)
            if m:
                keep(ftype, url, (int(m.group(2)), int(m.group(1))))
        if "izvanbolnicke specijalisticko" in name and "adresama" in name:
            keep("skzz", url)
        elif name.startswith("postelje") and "dijagnosticke jedinice" in name:
            keep("hospital_network", url)
    return {key: url for key, (_rank, url) in found.items()}


def file_as_of(url: str) -> date | None:
    """Month of the data from the file name: '_092026' or '- listopad 2026'."""
    name = _fold(unquote(url.rsplit("/", 1)[-1]))
    m = re.search(r"_(\d{2})(\d{4})(?:_\d+)?\.xlsx?$", name)
    if m and 1 <= int(m.group(1)) <= 12:
        return date(int(m.group(2)), int(m.group(1)), 1)
    m = re.search(r"(" + "|".join(MONTHS) + r")\s+(\d{4})", name)
    if m:
        return date(int(m.group(2)), MONTHS[m.group(1)], 1)
    return None


# ------------------------------------------------------------------ primary care


def parse_pzz(path: Path, facility_type: str) -> list[FacilityRow]:
    """One row per contracted team; header in rows 1-2, address columns 10-13 (2026 layout)."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = list(wb.worksheets[0].iter_rows(values_only=True, max_col=14))
    finally:
        wb.close()
    if _clean(rows[0][0]) != "Naziv PU" or _clean(rows[1][10]) != "Naselje":
        raise ValueError(f"{path.name}: unexpected header {rows[:2]}")
    out = []
    seen: dict[str, int] = {}
    for r in rows[2:]:
        v = [_clean(x) for x in r]
        office, code = v[0], v[1]  # v[4] is the doctor's own code: never stored
        public = v[8].lower() == "javno"
        settlement, street, number, jls = v[10], v[11], v[12], v[13]
        if not code or not settlement:
            continue
        insured = r[9] if isinstance(r[9], int | float) else None
        seen[code] = seen.get(code, 0) + 1
        out.append(
            FacilityRow(
                source_id=f"{facility_type}:{code}:{seen[code]}",
                type=facility_type,
                subtype="dz" if public else "concession",
                name="dom zdravlja" if public else "privatna ordinacija u mreži HZZO-a",
                street=f"{smart_case(street)} {_house_number(number)}".strip() if street else "",
                settlement=smart_case(settlement),
                municipality=smart_case(jls),
                counties=_office_counties(office),
                insured_count=int(insured) if insured is not None else None,
            )
        )
    return out


# ------------------------------------------------------------------ specialist care (SKZZ)

_SKZZ_SHEETS = ("izvanbolnički skzz", "dijagnostika MR, CT, UZV")


def _towns(town_field: str) -> list[str]:
    """'Beli Manastir, Đakovo, Osijek (Čepin) i Belišće' -> ['Beli Manastir', 'Đakovo', ...]."""
    towns = re.split(r",|\bi\b", re.sub(r"\(.*?\)", "", town_field))
    return [t.strip() for t in towns if t.strip()]


def _locations(town_field: str, address_field: str) -> list[tuple[str, str]]:
    """(street, town) pairs. Besides 'Strossmayera 141' (town in its own column) one cell can
    hold several locations: 'Školska 5, Beli Manastir; Petra Preradovića 2, Đakovo',
    'A 6, Osijek, B 4, Valpovo' or 'Pula, Kochova 1 a; Zagreb, Avenija Gojka Šuška 6'."""
    towns = _towns(town_field)
    known = {_fold(t) for t in towns}
    single_town = towns[0] if len(towns) == 1 else ""
    pairs: list[tuple[str, str]] = []
    for chunk in (c for c in address_field.split(";") if c.strip()):
        # Postal codes ("10431") carry no information the town does not.
        parts = [p.strip() for p in chunk.split(",") if p.strip() and not p.strip().isdigit()]
        if len(parts) > 1 and _fold(parts[0]) in known:  # town first: "Pula, Kochova 1 a"
            pairs.append((", ".join(parts[1:]), parts[0]))
            continue
        street: list[str] = []
        for part in parts:
            if street and (_fold(part) in known or not re.search(r"\d", part)):
                pairs.append((", ".join(street), part))
                street = []
            else:
                street.append(part)
        if street:
            pairs.append((", ".join(street), single_town))
    return pairs or [("", single_town)]


def parse_skzz(path: Path) -> list[FacilityRow]:
    """Specialist providers outside hospitals with the activities they are contracted for."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    try:
        for sheet in _SKZZ_SHEETS:
            ws = wb[sheet]
            diagnostics = sheet != _SKZZ_SHEETS[0]
            for i, r in enumerate(ws.iter_rows(values_only=True, max_col=11)):
                if i == 0:
                    if _clean(r[4]) != "Ustanova/privatna praksa":
                        raise ValueError(f"{path.name}/{sheet}: unexpected header {r}")
                    continue
                v = [_clean(x) for x in r]
                kind, code, name = v[2].lower(), v[3], v[4]
                if not name or kind not in SKZZ_SUBTYPES:
                    continue
                dtp = re.split(r"[\s,]+", v[9])[0] if diagnostics and v[9] else ""
                offer = Offer(v[7], _activity_name(v[8] or v[10]), dtp)
                first_town = next(iter(_towns(v[5])), "")
                for street, town in _locations(v[5], v[6]):
                    key = (code or name, _fold(town), _fold(street))
                    entry = grouped.setdefault(
                        key,
                        {
                            "kind": kind,
                            "name": name,
                            "street": street,
                            "town": town or first_town,
                            "fallback_town": first_town,
                            "office": v[1] or v[0],
                            "code": code,
                            "offers": [],
                        },
                    )
                    if offer not in entry["offers"]:
                        entry["offers"].append(offer)
    finally:
        wb.close()
    out = []
    for (code, town, street), e in grouped.items():
        subtype = SKZZ_SUBTYPES[e["kind"]]
        out.append(
            FacilityRow(
                source_id=f"specialist:{code}:{town}:{street}"[:80],
                type="specialist",
                subtype=subtype,
                name=GENERIC_NAMES.get(subtype, e["name"]),
                street=e["street"],
                settlement=e["town"],
                municipality=e["fallback_town"],
                counties=_office_counties(e["office"]),
                hzzo_code=e["code"],
                offers=tuple(e["offers"]),
            )
        )
    return out


# ------------------------------------------------------------------ hospitals


def _network_sheet(wb: openpyxl.Workbook) -> Sequence[tuple[object, ...]]:
    """The sheet with one column per hospital ('023902396 KLINIČKI BOLNIČKI CENTAR OSIJEK')."""
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        for r in rows[:8]:
            if _clean(r[0]) == "Djelatnost" and any(re.match(r"^\d{9} ", _clean(c)) for c in r[1:]):
                return rows
    raise ValueError("hospital network: no sheet with per-hospital columns")


def parse_hospital_network(path: Path) -> list[FacilityRow]:
    """Hospitals with their contracted outpatient activities. Names stay upper case as in the
    file; addresses come from the address book (hzzo_jobs.build_hospitals)."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        rows = _network_sheet(wb)
    finally:
        wb.close()
    header_at = next(i for i, r in enumerate(rows) if _clean(r[0]) == "Djelatnost")
    county_row = next(r for r in rows[:header_at] if _clean(r[0]) == "ŽUPANIJA")
    type_row = next(r for r in rows[:header_at] if _clean(r[0]).startswith("BOLNICA"))
    county = kind = ""
    hospitals: dict[int, dict[str, Any]] = {}
    for j, cell in enumerate(rows[header_at]):
        if j == 0:
            continue
        county = _clean(county_row[j]) or county
        kind = _clean(type_row[j]) or kind
        m = re.match(r"^(\d{9}) (.+)$", _clean(cell))
        if m:
            hospitals[j] = {
                "code": m.group(1),
                "name": m.group(2),
                "county": county,
                "kind": kind,
                "offers": [],
            }
    for r in rows[header_at + 1 :]:
        m = re.match(r"^(\d{7}) (.+)$", _clean(r[0]))
        if not m:
            continue
        offer = Offer(m.group(1), _activity_name(m.group(2)))
        for j, h in hospitals.items():
            value = r[j] if j < len(r) else None
            if value not in (None, "", 0):
                h["offers"].append(offer)
    out = []
    for h in hospitals.values():
        general = is_general_hospital(h["name"], listed_general=h["kind"] in GENERAL_HOSPITAL_TYPES)
        out.append(
            FacilityRow(
                source_id=f"hospital:{h['code']}",
                type="hospital",
                subtype="general" if general else "special",
                name=h["name"],  # formatted with the town once the address is known
                street="",
                settlement="",
                municipality="",
                counties=_county_names(h["county"]),
                hzzo_code=h["code"],
                offers=tuple(h["offers"]),
            )
        )
    return out


def _county_names(header: str) -> tuple[str, ...]:
    """'GRAD ZAGREB I ZAGREBAČKA' -> ('Grad Zagreb', 'Zagrebačka'); 'POŽEŠKO-SLAVONSKA ' ->
    ('Požeško-slavonska',)."""
    text = header.strip().removesuffix(" ŽUPANIJA")
    if text.startswith("GRAD ZAGREB"):
        return ("Grad Zagreb", "Zagrebačka") if "ZAGREBAČKA" in text else ("Grad Zagreb",)
    return (text.capitalize(),) if text else ()


def parse_hospital_addresses(path: Path) -> list[HospitalAddress]:
    """HZZO address book of hospitals (April 2017): the only hospital list with addresses."""
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    header = [_clean(v) for v in sheet.row_values(0)]
    if header[:5] != ["Rb", "Ustanova", "Pošta", "Mjesto", "Adresa"]:
        raise ValueError(f"{path.name}: unexpected header {header}")
    out = []
    for r in range(1, sheet.nrows):
        v = [_clean(x) for x in sheet.row_values(r)]
        name, town, address, phone = v[1], v[3], v[4], v[5]
        if name and town:
            town = smart_case(re.sub(r"^GRAD\s+", "", town, flags=re.IGNORECASE))
            out.append(HospitalAddress(name, town, smart_case(address), phone))
    return out
