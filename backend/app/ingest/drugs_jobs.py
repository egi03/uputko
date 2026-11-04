"""Daily drugs ingest: the whole HALMED database and HZZO's lists of medicines, joined.

A list row belongs to a HALMED medicine when it has the same ATC code and the same protected
name ("Ultop 20 mg tvrde kapsule" ~ "Ultop"); a list row that matches no medicine exactly goes
to the one medicine whose code and name differ from it only in detail (join_lists). Of that
medicine's forms, the row is a package of those its strength and dosage form fit ("caps.
28x20 mg" is Ultop 20 mg, not Ultop 10 mg; drug_forms). A form without a row is "not found on
the lists", which the answer says in those words.
"""

import argparse
import gzip
import logging
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
from rapidfuzz import fuzz
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import session_scope
from app.geo.normalize import normalize
from app.ingest import halmed, hzzo_drugs
from app.ingest.drug_forms import FORM_WORDS, FormText, assign_rows
from app.ingest.http import fetch_bytes, fetch_to_file, http_client
from app.ingest.status import check_plausible, mark_error, mark_success
from app.models import Drug, HzzoListDrug
from app.timeutil import local_today, now_utc

log = logging.getLogger(__name__)

SOURCE_KEYS = {"halmed": "halmed_drugs", "lists": "hzzo_drug_lists"}
SPELLING_CUTOFF = 88  # list name vs HALMED name of the same ATC code (rapidfuzz ratio)
SPELLING_MARGIN = 5
# HALMED builds the result page of the empty search for 30–40 s before the first byte; the
# other requests keep the 10 s timeout.
HALMED_SEARCH_TIMEOUT_S = 90
CKAN_API = "https://data.gov.hr/ckan/api/3/action/package_show"


def brand_key(name: str) -> str:
    """'Andol PRO 100 mg želučanootporne tablete' -> 'andol pro' (protected name only)."""
    words = normalize(name, drop_words=False).split()
    out = []
    for w in words:
        if any(c.isdigit() for c in w) or w in FORM_WORDS:
            break
        out.append(w)
    return " ".join(out) or (words[0] if words else "")


def search_url(client: httpx.Client) -> str:
    """The database's address as the portal lists it (CKAN), else the known one."""
    try:
        resp = client.get(CKAN_API, params={"id": halmed.CKAN_DATASET})
        resp.raise_for_status()
        for res in resp.json()["result"]["resources"]:
            url = res.get("url") or ""
            if url.startswith(halmed.BASE_URL):
                return url
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("CKAN %s not readable: %s", halmed.CKAN_DATASET, exc)
    return halmed.SEARCH_URL


HALMED_PAGE = "results.html.gz"  # the result page of the empty search (gzip), as downloaded
HALMED_EXPORT = "halmed_export.xlsx"  # the export that page links to


def download_halmed(client: httpx.Client, raw: Path) -> None:
    """HALMED's result page of the empty search and its export, into `raw`."""
    page = fetch_bytes(
        search_url(client), client=client, form=halmed.EMPTY_SEARCH, timeout=HALMED_SEARCH_TIMEOUT_S
    )
    raw.mkdir(parents=True, exist_ok=True)
    (raw / HALMED_PAGE).write_bytes(gzip.compress(page))
    export_url, _listed = halmed.parse_results(page)
    if not export_url:
        raise ValueError("HALMED result page has no export link")
    fetch_to_file(export_url, raw / HALMED_EXPORT, refresh=True, client=client)


def read_halmed(raw: Path) -> list[tuple[halmed.DrugRow, halmed.ListedDrug | None]]:
    """The forms of a downloaded export, linked to their pages on the result page."""
    _export_url, listed = halmed.parse_results(gzip.decompress((raw / HALMED_PAGE).read_bytes()))
    return link_details(halmed.parse_export(raw / HALMED_EXPORT), listed)


def fetch_halmed(client: httpx.Client) -> list[tuple[halmed.DrugRow, halmed.ListedDrug | None]]:
    raw = get_settings().raw_dir / "halmed"
    download_halmed(client, raw)
    return read_halmed(raw)


def store_halmed(
    drugs: list[tuple[halmed.DrugRow, halmed.ListedDrug | None]], lists: list[hzzo_drugs.ListRow]
) -> None:
    with session_scope() as session:
        check_plausible(session, SOURCE_KEYS["halmed"], len(drugs))
        stored, on_list = store_drugs(session, drugs, lists)
        mark_success(session, SOURCE_KEYS["halmed"], stored)
    log.info("%s: %s drugs, %s on an HZZO list", SOURCE_KEYS["halmed"], stored, on_list)


def link_details(
    rows: list[halmed.DrugRow], listed: list[halmed.ListedDrug]
) -> list[tuple[halmed.DrugRow, halmed.ListedDrug | None]]:
    """Each exported drug with its row on the result page: by name and revocation, and in page
    order where an old and a new authorisation share a name."""
    by_key: dict[tuple[str, bool], list[halmed.ListedDrug]] = defaultdict(list)
    for item in listed:
        by_key[(normalize(item.name, drop_words=False), item.revoked)].append(item)
    out = []
    for r in rows:
        name = normalize(r.name, drop_words=False)
        # The export also counts a set withdrawal date as revoked; the page may not mark it yet.
        queue = by_key.get((name, r.revoked)) or by_key.get((name, not r.revoked))
        out.append((r, queue.pop(0) if queue else None))
    return out


def fetch_lists(client: httpx.Client) -> tuple[list[hzzo_drugs.ListRow], datetime | None]:
    urls = dict(hzzo_drugs.FALLBACK_URLS)
    try:
        page = fetch_bytes(hzzo_drugs.PAGE_URL, client=client)
        urls.update(hzzo_drugs.discover_lists(page, local_today()))
    # Unreachable or changed page: the last known links still work.
    except Exception as exc:  # noqa: BLE001
        log.warning("HZZO drug lists page not readable, using last known links: %s", exc)
    raw = get_settings().raw_dir / "hzzo"
    rows: list[hzzo_drugs.ListRow] = []
    starts = []
    for key, url in urls.items():
        path = fetch_to_file(url, raw / f"{key}.xlsx", refresh=True, client=client)
        rows += hzzo_drugs.parse_list(path, key)
        if (start := hzzo_drugs.in_force_from(url)) is not None:
            starts.append(start)
    in_force = datetime.combine(min(starts), datetime.min.time(), tzinfo=UTC) if starts else None
    return rows, in_force


def stored_lists(session: Session) -> list[hzzo_drugs.ListRow]:
    """The lists from the last successful download, to join a fresh HALMED export with."""
    return [
        hzzo_drugs.ListRow(
            list=r.list,
            code=r.code,
            atc=r.atc,
            restriction=r.restriction,
            inn=r.inn,
            holder=r.holder,
            brand=r.brand,
            pack=r.pack,
            copay_eur=r.copay_eur,
            rx_mark=r.rx_mark,
        )
        for r in session.scalars(select(HzzoListDrug))
    ]


def store_lists(session: Session, rows: list[hzzo_drugs.ListRow]) -> int:
    session.execute(delete(HzzoListDrug))
    session.add_all(
        HzzoListDrug(
            list=r.list,
            code=r.code,
            atc=r.atc,
            inn=r.inn,
            brand=r.brand,
            brand_key=brand_key(r.brand) if r.brand else "",
            pack=r.pack,
            holder=r.holder,
            copay_eur=r.copay_eur,
            rx_mark=r.rx_mark,
            restriction=r.restriction,
        )
        for r in rows
    )
    return len(rows)


def _atc_fits(a: str, b: str) -> bool:
    """Same ATC code, or one a level of the other (HALMED has 'B03AC' for 'B03AC01')."""
    return min(len(a), len(b)) >= 5 and (a.startswith(b) or b.startswith(a))


def _brand_fits(a: str, b: str) -> bool:
    """'salazopyrin' (list) ~ 'salazopyrin en' (HALMED); 'humalog mix' ~ 'humalog'."""
    return a.startswith(b + " ") or b.startswith(a + " ")


def join_lists(
    drugs: list[tuple[str, str]], lists: list[hzzo_drugs.ListRow]
) -> dict[tuple[str, str], list[hzzo_drugs.ListRow]]:
    """List rows per HALMED (ATC, protected name): the same pair, else, for a list row no
    HALMED pair equals, the one pair whose code and name differ only in detail."""
    pairs = set(drugs)
    by_first: dict[str, set[tuple[str, str]]] = defaultdict(set)
    by_atc: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for atc, key in pairs:
        by_first[key.split()[0] if key else ""].add((atc, key))
        by_atc[atc].append((atc, key))
    joined: dict[tuple[str, str], list[hzzo_drugs.ListRow]] = defaultdict(list)
    for r in lists:
        key = brand_key(r.brand) if r.brand else ""
        if not key or not r.atc:
            continue
        if (r.atc, key) in pairs:
            joined[(r.atc, key)].append(r)
            continue
        near = {
            (atc, k)
            for atc, k in by_first.get(key.split()[0], ())
            if _atc_fits(atc, r.atc) and (k == key or _brand_fits(k, key))
        }
        if not near:  # 'Pioglitazon Actavis' ~ 'Pioglitazone Actavis', same ATC
            near = _spelled_alike(key, [p for p in by_atc.get(r.atc, ()) if p[1]])
        if len({k for _atc, k in near}) == 1:
            for pair in near:
                joined[pair].append(r)
    return joined


def _spelled_alike(key: str, pairs: list[tuple[str, str]]) -> set[tuple[str, str]]:
    """The one name of the same ATC code spelled almost the same, clearly closer than others."""
    scored = sorted(((fuzz.ratio(key, k), (atc, k)) for atc, k in pairs), reverse=True)
    if not scored or scored[0][0] < SPELLING_CUTOFF:
        return set()
    if len(scored) > 1 and scored[1][0] > scored[0][0] - SPELLING_MARGIN:
        return set()
    return {scored[0][1]}


@dataclass(frozen=True)
class FormOf:
    """A HALMED form, as the join with the lists sees it."""

    atc: str
    key: str  # brand_key of the name
    name: str
    form: str  # HALMED's dosage form ("filmom obložena tableta")


def rows_per_form(
    forms: Sequence[FormOf], lists: list[hzzo_drugs.ListRow]
) -> list[list[hzzo_drugs.ListRow]]:
    """The list rows of each form: its medicine's (ATC code and protected name), and of those
    the packages of this very form."""
    joined = join_lists([(f.atc, f.key) for f in forms], lists)
    medicines: dict[tuple[str, str], list[int]] = defaultdict(list)
    for i, f in enumerate(forms):
        if f.atc:
            medicines[(f.atc, f.key)].append(i)
    out: list[list[hzzo_drugs.ListRow]] = [[] for _f in forms]
    for pair, members in medicines.items():
        rows = joined.get(pair, [])
        if not rows:
            continue
        chosen = assign_rows(
            [FormText(forms[i].name, forms[i].form) for i in members],
            [FormText(r.brand, r.pack) for r in rows],
            brand_words=len(pair[1].split()),
        )
        for row, picked in zip(rows, chosen, strict=True):
            for j in picked:
                out[members[j]].append(row)
    return out


def list_columns(rows: list[hzzo_drugs.ListRow]) -> dict[str, str | float | bool | None]:
    """A form's columns from its list rows: the lists ("DLL+OLL" when its packages are on both),
    the co-payment on the supplementary list, and whether it is for hospital use only."""
    copays = [r.copay_eur for r in rows if r.list == "DLL" and r.copay_eur is not None]
    return {
        "hzzo_list": "+".join(sorted({r.list for r in rows})),
        "hzzo_copay_min": min(copays) if copays else None,
        "hzzo_copay_max": max(copays) if copays else None,
        "hzzo_hospital_only": bool(rows)
        and all(hzzo_drugs.is_hospital_only(r.restriction) for r in rows),
    }


def store_drugs(
    session: Session,
    drugs: list[tuple[halmed.DrugRow, halmed.ListedDrug | None]],
    lists: list[hzzo_drugs.ListRow],
) -> tuple[int, int]:
    """Replace the drugs; returns (stored, on an HZZO list)."""
    keys = [brand_key(row.name) for row, _l in drugs]
    forms = [
        FormOf(row.atc, key, row.name, row.form) for (row, _l), key in zip(drugs, keys, strict=True)
    ]
    fetched = now_utc()
    session.execute(delete(Drug))
    on_list = 0
    for (row, listed), key, rows in zip(drugs, keys, rows_per_form(forms, lists), strict=True):
        on_list += bool(rows)
        session.add(
            Drug(
                halmed_id=listed.halmed_id if listed else "",
                name=row.name,
                brand_key=key,
                former_name=row.former_name,
                approval_number=row.approval_number,
                active_substance=row.active_substance,
                substance_norm=normalize(row.active_substance, drop_words=False),
                form=row.form,
                holder=row.holder,
                rx=row.rx,
                prescription=row.prescription,
                atc=row.atc,
                market_status=row.market_status,
                shortage=row.shortage,
                central=row.central,
                revoked=row.revoked,
                detail_url=f"{halmed.BASE_URL}{listed.detail_path}" if listed else "",
                fetched_at=fetched,
                **list_columns(rows),
            )
        )
    return len(drugs), on_list


def rejoin_drugs(session: Session, lists: list[hzzo_drugs.ListRow]) -> int:
    """Join the stored HALMED forms with these lists again: newer lists while HALMED could not
    be read, or a change to the join. Returns how many forms are on a list."""
    stored = session.scalars(select(Drug)).all()
    forms = [FormOf(d.atc, d.brand_key, d.name, d.form) for d in stored]
    on_list = 0
    for drug, rows in zip(stored, rows_per_form(forms, lists), strict=True):
        on_list += bool(rows)
        for column, value in list_columns(rows).items():
            setattr(drug, column, value)
    return on_list


def fetch_drugs() -> None:
    with http_client() as client:
        lists: list[hzzo_drugs.ListRow] = []
        try:
            lists, in_force = fetch_lists(client)
            with session_scope() as session:
                check_plausible(session, SOURCE_KEYS["lists"], len(lists))
                n = store_lists(session, lists)
                mark_success(session, SOURCE_KEYS["lists"], n, in_force)
            log.info("%s: %s list rows", SOURCE_KEYS["lists"], n)
        except Exception as exc:
            log.exception("%s failed", SOURCE_KEYS["lists"])
            with session_scope() as session:
                mark_error(session, SOURCE_KEYS["lists"], f"{type(exc).__name__}: {exc}")
            lists = []  # not stored (an implausibly short download): never joined either
        if not lists:  # keep HALMED fresh with the lists of the last successful download
            with session_scope() as session:
                lists = stored_lists(session)
        if not lists:  # without any lists every drug would look "not on the list"
            return
        if not get_settings().halmed_download:
            # HALMED does not serve this server (a cloud address times out): its database is
            # downloaded on a computer it serves and stored here (scripts/push_halmed.py).
            with session_scope() as session:
                on_list = rejoin_drugs(session, lists)
            log.info(
                "%s: not downloaded here (HALMED_DOWNLOAD=false); stored forms joined again, "
                "%s on an HZZO list",
                SOURCE_KEYS["halmed"],
                on_list,
            )
            return
        try:
            store_halmed(fetch_halmed(client), lists)
        except Exception as exc:
            log.exception("%s failed", SOURCE_KEYS["halmed"])
            with session_scope() as session:
                mark_error(session, SOURCE_KEYS["halmed"], f"{type(exc).__name__}: {exc}")
            with session_scope() as session:  # the forms already stored, with these lists
                on_list = rejoin_drugs(session, lists)
            log.info(
                "%s: stored forms joined again, %s on an HZZO list", SOURCE_KEYS["halmed"], on_list
            )


def main() -> None:
    """Without options: the stored forms joined with the stored lists again, nothing downloaded
    (after a change to the join; then export the snapshot). HALMED on a server it does not serve:
    --download-halmed on a computer it serves, --from-raw on the server (scripts/push_halmed.py)."""
    settings = get_settings()
    parser = argparse.ArgumentParser(description=main.__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--download-halmed",
        type=Path,
        metavar="DIR",
        help="download HALMED's result page and export into DIR (no database)",
    )
    group.add_argument(
        "--from-raw",
        action="store_true",
        help="store the result page and export in data/raw/halmed, with the stored lists",
    )
    args = parser.parse_args()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s: %(message)s")
    if args.download_halmed:
        with http_client() as client:
            download_halmed(client, args.download_halmed)
        log.info("HALMED downloaded into %s", args.download_halmed)
        return
    with session_scope() as session:
        lists = stored_lists(session)
    if not lists:
        log.warning("no stored lists: nothing to join")
        return
    if args.from_raw:
        store_halmed(read_halmed(settings.raw_dir / "halmed"), lists)
        return
    with session_scope() as session:
        on_list = rejoin_drugs(session, lists)
    log.info("%s list rows; %s forms on an HZZO list", len(lists), on_list)


if __name__ == "__main__":
    main()
