"""GeoNames dump for Croatia (CC BY 4.0), filtered to populated places."""

import csv
import io
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

GEONAMES_HR_URL = "https://download.geonames.org/export/dump/HR.zip"

# Populated place feature codes; PPLX (section of populated place) and PPLH (historical) excluded.
_POPULATED = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLL", "PPLF", "PPLS"}


@dataclass(frozen=True)
class GeoNamesPlace:
    geoname_id: int
    name: str
    names: tuple[str, ...]  # name, asciiname and Latin alternate names
    lat: float
    lon: float
    feature_code: str
    population: int


def _is_latin(text: str) -> bool:
    return all(ord(c) < 0x250 for c in text)


def parse_lines(lines: Iterator[str]) -> Iterator[GeoNamesPlace]:
    reader = csv.reader(lines, delimiter="\t", quoting=csv.QUOTE_NONE)
    for row in reader:
        if len(row) < 15 or row[6] != "P" or row[7] not in _POPULATED:
            continue
        alternates = [a for a in row[3].split(",") if a and _is_latin(a)] if row[3] else []
        names = tuple(dict.fromkeys([row[1], row[2], *alternates]))
        yield GeoNamesPlace(
            geoname_id=int(row[0]),
            name=row[1],
            names=names,
            lat=float(row[4]),
            lon=float(row[5]),
            feature_code=row[7],
            population=int(row[14] or 0),
        )


def parse_zip(path: Path) -> Iterator[GeoNamesPlace]:
    with zipfile.ZipFile(path) as zf, zf.open("HR.txt") as fh:
        yield from parse_lines(io.TextIOWrapper(fh, encoding="utf-8"))


def parse_txt(path: Path) -> Iterator[GeoNamesPlace]:
    with path.open(encoding="utf-8") as fh:
        yield from parse_lines(fh)
