"""Medicines for the premium UI (/lijekovi page). Not logged as tool calls."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_db
from app.geo.normalize import normalize
from app.models import Drug
from app.services import drugs

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]


@router.get("/drugs")
def drug_search(
    db: Db,
    q: Annotated[str, Query(min_length=2, max_length=80)],
    limit: Annotated[int, Query(ge=1, le=15)] = 8,
) -> list[dict[str, Any]]:
    """Autocomplete: protected names starting with the query, then active substances."""
    key = normalize(q, drop_words=False)
    if len(key) < 2:  # '--' or '..' would match every name
        return []
    seen: dict[str, dict[str, Any]] = {}
    rows = list(
        db.scalars(
            select(Drug).where(Drug.brand_key.startswith(key)).order_by(Drug.brand_key).limit(200)
        )
    )
    rows += db.scalars(
        select(Drug).where(Drug.substance_norm.startswith(key)).order_by(Drug.name).limit(100)
    ).all()
    for d in rows:
        label = drugs.display_brand(d)
        if label not in seen:
            seen[label] = {
                "label": label,
                "substance": d.active_substance,
                "hzzo_list": d.hzzo_list or None,
                "rx": d.rx or None,
            }
        if len(seen) == limit:
            break
    return list(seen.values())


@router.get("/drugs/overview")
def drug_overview(db: Db) -> dict[str, Any]:
    return drugs.overview(db)


@router.get("/drugs/lookup")
def drug_lookup(
    db: Db, name: Annotated[str, Query(min_length=1, max_length=120)]
) -> dict[str, Any]:
    res = drugs.get_drug_info(db, name)
    return {**res.model_dump(), "extra": res.card_extra}
