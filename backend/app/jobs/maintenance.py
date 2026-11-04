import logging

from app.db import session_scope
from app.services.cards import purge_cards

log = logging.getLogger(__name__)


def purge_old_cards() -> None:
    with session_scope() as session:
        n = purge_cards(session)
    if n:
        log.info("purged %s cards older than 24 h", n)
