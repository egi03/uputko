"""HZZO waiting lists on CEZIH (https://liste.cezih.hr), published for every procedure.

The portal has JSON lookups for its search boxes (procedures, institutions, regions) and one
HTML page per procedure with all institutions that publish a list for it: up to five first free
appointments, the number of days to wait, booking contacts and when the institution last
updated its list. HZZO notes that the institutions are responsible for the accuracy and that the
data are refreshed every two hours.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime

from lxml import etree, html

from app.timeutil import tz

BASE_URL = "https://liste.cezih.hr"
PROCEDURES_URL = f"{BASE_URL}/Home/DohvatZahvata?query="
SOURCE = "HZZO, liste čekanja (CEZIH)"
NOT_UPDATED = "Ustanova nije ažurirala podatke"
NO_LISTS = "Nema rezultata"  # "Nema rezultata za odabrani medicinski postupak."


def list_url(procedure_id: int) -> str:
    """All regions: one page lists every institution with a list for the procedure."""
    return f"{BASE_URL}/Postupak?pId={procedure_id}&regId="


@dataclass(frozen=True)
class Lookup:
    id: int
    name: str


@dataclass
class EntryRow:
    institution: str  # as published, e.g. "KBC Split (KBC SPLIT FIRULE)"
    slots: list[datetime] = field(default_factory=list)  # first free appointments, local time
    wait_days: int | None = None
    list_updated_at: datetime | None = None
    not_updated: bool = False
    email: str = ""
    phone: str = ""
    web: str = ""
    street: str = ""
    city: str = ""


@dataclass
class ListPage:
    code: str  # HZZO code of the procedure as printed in the header ("1739")
    name: str  # "MR koljena"
    entries: list[EntryRow]


def parse_lookup(data: bytes) -> list[Lookup]:
    """[{"Id": 1233, "Naziv": "MR koljena"}, ...] from the portal's search boxes."""
    try:
        items = json.loads(data)
        return [Lookup(int(i["Id"]), " ".join(str(i["Naziv"]).split())) for i in items]
    except (KeyError, TypeError, AttributeError) as exc:
        raise ValueError(f"unexpected lookup shape: {exc!r}") from exc


def _text(el: html.HtmlElement) -> str:
    return " ".join(el.text_content().split())


def _local(value: str, fmt: str) -> datetime | None:
    try:
        return datetime.strptime(value, fmt).replace(tzinfo=tz())
    except ValueError:
        return None


def _slots(values: list[str]) -> list[datetime]:
    out = [_local(v, "%d.%m.%Y. %H:%M") for v in values]
    return sorted(s for s in out if s is not None)


def parse_list_page(page: bytes) -> ListPage:
    """One procedure's lists. A page without lists says so ("Nema rezultata ..."); a page with
    neither lists nor that notice means the markup changed, and must not empty the lists."""
    try:
        doc = html.fromstring(page)
    except etree.ParserError as exc:  # an empty or truncated body
        raise ValueError(f"list page not parsable: {exc}") from exc
    header = doc.xpath('//div[@id="header-container"]//h3')
    title = _text(header[0]) if header else ""
    m = re.search(r"Medicinski postupak:\s*(\d+)\s*-\s*(.+?)\s*Regija:", title)
    if not m:
        raise ValueError(f"unexpected list page header: {title[:120]!r}")
    entries = []
    for well in doc.xpath('//div[contains(@class, "well")]'):
        heads = well.xpath('.//div[contains(@class, "infoHeader")]')
        if not heads:
            continue
        entry = EntryRow(institution=_text(heads[0]))
        links = heads[0].xpath(".//a/@href")
        entry.web = links[0] if links else ""
        blocks = well.xpath('.//div[contains(@class, "slotHeader")]')
        datas = well.xpath('.//div[contains(@class, "slotData")]')
        for head, data in zip(blocks, datas, strict=False):
            label = _text(head)
            if label.startswith("Prvi slobodni termin"):
                entry.slots = _slots([_text(d) for d in data.xpath("./div")])
            elif label.startswith("Broj dana"):
                days = _text(data)
                entry.wait_days = int(days) if days.isdigit() else None
        names = [_text(x) for x in well.xpath('.//div[contains(@class, "propName")]')]
        values = [_text(x) for x in well.xpath('.//div[contains(@class, "propValue")]')]
        props = dict(zip(names, values, strict=False))
        updated = props.get("Vrijeme zadnjeg ažuriranja liste", "")
        entry.not_updated = updated == NOT_UPDATED
        entry.list_updated_at = _local(updated, "%d.%m.%Y. %H:%M:%S")
        entry.email = props.get("E-mail", "")
        entry.phone = props.get("Telefon", "")
        entry.web = props.get("Web adresa", "") or entry.web
        entry.street = props.get("Adresa", "")
        entry.city = props.get("Grad", "")
        entries.append(entry)
    if not entries and NO_LISTS not in _text(doc):
        raise ValueError("list page has no lists and no 'no results' notice")
    return ListPage(code=m.group(1), name=" ".join(m.group(2).split()), entries=entries)
