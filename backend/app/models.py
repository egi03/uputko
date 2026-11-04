"""Database tables."""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UtcDateTime


class County(Base):
    """County (županija) with a simplified WGS84 polygon, for the gazetteer and the map."""

    __tablename__ = "counties"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(2), unique=True)  # 01..21 (DZS order)
    name: Mapped[str] = mapped_column(String(80), unique=True)  # e.g. "Vukovarsko-srijemska"
    seat: Mapped[str] = mapped_column(String(80), default="")  # e.g. "Vukovar"
    geometry_wkt: Mapped[str] = mapped_column(Text)


class Place(Base):
    """Settlement (naselje) from DZS Census 2021 with coordinates."""

    __tablename__ = "places"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    name_norm: Mapped[str] = mapped_column(String(120), index=True)
    municipality: Mapped[str] = mapped_column(String(120))  # JLS name, e.g. "Vinkovci"
    municipality_type: Mapped[str] = mapped_column(String(8))  # Grad | Općina
    county: Mapped[str] = mapped_column(String(80))  # e.g. "Vukovarsko-srijemska"
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    coord_source: Mapped[str] = mapped_column(String(16))  # geonames | jls_seat | none
    population: Mapped[int] = mapped_column(Integer, default=0)
    is_municipality_seat: Mapped[bool] = mapped_column(Boolean, default=False)


class HealthFacility(Base):
    """A contracted practice, hospital or specialist provider from HZZO's registries.

    Private practices are stored without the doctor's name (type and address identify them)."""

    __tablename__ = "health_facilities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    # family_medicine | pediatrics | gynecology | dentistry | hospital | specialist
    type: Mapped[str] = mapped_column(String(32), index=True)
    # PZZ: dz | concession; hospital: general | special;
    # specialist: health_center | polyclinic | private_practice | public_health | laboratory
    subtype: Mapped[str] = mapped_column(String(20), default="")
    address: Mapped[str] = mapped_column(String(300))
    settlement: Mapped[str] = mapped_column(String(120), default="")
    municipality: Mapped[str] = mapped_column(String(120), default="")
    county: Mapped[str] = mapped_column(String(80), default="")
    place_id: Mapped[int | None] = mapped_column(Integer)  # places.id; relinked after a seed
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    coord_source: Mapped[str] = mapped_column(String(16), default="none")
    phone: Mapped[str] = mapped_column(String(80), default="")
    hzzo_code: Mapped[str] = mapped_column(String(12), default="", index=True)
    insured_count: Mapped[int | None] = mapped_column(Integer)  # PZZ: insured persons
    source_key: Mapped[str] = mapped_column(String(40))
    source_id: Mapped[str] = mapped_column(String(80), default="")
    fetched_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ServiceOffer(Base):
    """An activity a facility is contracted for (e.g. MR, ophthalmology), see app.categories."""

    __tablename__ = "service_offers"
    __table_args__ = (Index("ix_service_offers_category", "category"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("health_facilities.id", ondelete="CASCADE"))
    category: Mapped[str | None] = mapped_column(String(24))
    activity_code: Mapped[str] = mapped_column(String(12), default="")
    activity_name: Mapped[str] = mapped_column(String(200), default="")
    dtp_code: Mapped[str] = mapped_column(String(80), default="")
    source_key: Mapped[str] = mapped_column(String(40))


class WlProcedure(Base):
    """A procedure or exam with a waiting list on CEZIH (id = the portal's pId)."""

    __tablename__ = "wl_procedures"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(12), default="")  # HZZO code from the list header
    name: Mapped[str] = mapped_column(String(200))
    name_norm: Mapped[str] = mapped_column(String(200), index=True)
    category: Mapped[str | None] = mapped_column(String(24))  # app.categories key
    is_pediatric: Mapped[bool] = mapped_column(Boolean, default=False)
    # first | control | consult | preventive | other | "" (a plain procedure such as "MR koljena")
    variant: Mapped[str] = mapped_column(String(12), default="")
    institutions: Mapped[int] = mapped_column(Integer, default=0)  # with a list at last fetch
    median_days: Mapped[int | None] = mapped_column(Integer)  # over usable entries
    fetched_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class WlInstitution(Base):
    """An institution (or one of its locations) as named on the CEZIH lists.

    Private practices carry the doctor's name: `name` is then descriptive and `name_key` is a
    hash of the published name, so the name itself is never stored."""

    __tablename__ = "wl_institutions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_key: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(300))  # as on CEZIH ("OŽB Vinkovci")
    spoken_name: Mapped[str] = mapped_column(String(300))  # "Opća županijska bolnica Vinkovci"
    settlement: Mapped[str] = mapped_column(String(120), default="")
    county: Mapped[str] = mapped_column(String(80), default="")
    place_id: Mapped[int | None] = mapped_column(Integer)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    # cezih (city on the list) | registry (HZZO registry) | name (town in the name)
    # | county (county seat for county-wide institutions) | none
    geo_source: Mapped[str] = mapped_column(String(12), default="none")
    children_only: Mapped[bool] = mapped_column(Boolean, default=False)
    private_practice: Mapped[bool] = mapped_column(Boolean, default=False)
    facility_source_id: Mapped[str] = mapped_column(String(80), default="")  # HZZO registry


class WlEntry(Base):
    """Current waiting-list entry of one institution for one procedure (replaced per fetch)."""

    __tablename__ = "wl_entries"
    __table_args__ = (UniqueConstraint("procedure_id", "institution_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    procedure_id: Mapped[int] = mapped_column(ForeignKey("wl_procedures.id"), index=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("wl_institutions.id"), index=True)
    slots_json: Mapped[str] = mapped_column(Text, default="[]")  # ISO local times, ascending
    first_slot_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    wait_days: Mapped[int | None] = mapped_column(Integer)  # as published by CEZIH
    list_updated_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    not_updated: Mapped[bool] = mapped_column(Boolean, default=False)
    email: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(120), default="")
    web: Mapped[str] = mapped_column(String(200), default="")
    fetched_at: Mapped[datetime] = mapped_column(UtcDateTime())


class WlSnapshot(Base):
    """Daily waiting time per list, kept for trends (CEZIH keeps no history)."""

    __tablename__ = "wl_snapshots"
    __table_args__ = (UniqueConstraint("day", "procedure_id", "institution_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    procedure_id: Mapped[int] = mapped_column(Integer, index=True)
    institution_id: Mapped[int] = mapped_column(Integer)
    wait_days: Mapped[int | None] = mapped_column(Integer)
    first_slot_on: Mapped[date | None] = mapped_column(Date)


class Demographics(Base):
    __tablename__ = "demographics"
    __table_args__ = (UniqueConstraint("municipality", "county"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    municipality: Mapped[str] = mapped_column(String(120))
    municipality_type: Mapped[str] = mapped_column(String(8))
    county: Mapped[str] = mapped_column(String(80))
    population_total: Mapped[int] = mapped_column(Integer)
    population_65_plus: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(80))
    census_year: Mapped[int] = mapped_column(Integer, default=2021)


class Drug(Base):
    """A medicine authorised in Croatia (HALMED export), with its place on HZZO's lists."""

    __tablename__ = "drugs"

    id: Mapped[int] = mapped_column(primary_key=True)
    halmed_id: Mapped[str] = mapped_column(String(12), default="")
    name: Mapped[str] = mapped_column(String(300))
    brand_key: Mapped[str] = mapped_column(String(160), index=True)  # "andol pro"
    former_name: Mapped[str] = mapped_column(String(300), default="")
    approval_number: Mapped[str] = mapped_column(String(80), default="")
    active_substance: Mapped[str] = mapped_column(String(400), default="")
    substance_norm: Mapped[str] = mapped_column(String(400), default="", index=True)
    form: Mapped[str] = mapped_column(String(200), default="")
    holder: Mapped[str] = mapped_column(String(300), default="")
    rx: Mapped[str] = mapped_column(String(20), default="")  # na recept | bez recepta
    prescription: Mapped[str] = mapped_column(String(60), default="")
    atc: Mapped[str] = mapped_column(String(7), default="", index=True)
    market_status: Mapped[str] = mapped_column(String(40), default="")
    shortage: Mapped[str] = mapped_column(String(20), default="")
    central: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    detail_url: Mapped[str] = mapped_column(String(300), default="")
    hzzo_list: Mapped[str] = mapped_column(String(8), default="")  # OLL | DLL | OLL+DLL | ""
    hzzo_copay_min: Mapped[float | None] = mapped_column(Float)
    hzzo_copay_max: Mapped[float | None] = mapped_column(Float)
    hzzo_hospital_only: Mapped[bool] = mapped_column(Boolean, default=False)
    fetched_at: Mapped[datetime] = mapped_column(UtcDateTime())


class HzzoListDrug(Base):
    """A medicine and package on HZZO's basic (OLL) or supplementary (DLL) list."""

    __tablename__ = "hzzo_list_drugs"

    id: Mapped[int] = mapped_column(primary_key=True)
    list: Mapped[str] = mapped_column(String(3))
    code: Mapped[str] = mapped_column(String(20))
    atc: Mapped[str] = mapped_column(String(7), index=True)
    inn: Mapped[str] = mapped_column(String(300), default="")
    brand: Mapped[str] = mapped_column(String(200), default="")
    brand_key: Mapped[str] = mapped_column(String(160), default="", index=True)
    pack: Mapped[str] = mapped_column(String(300), default="")
    holder: Mapped[str] = mapped_column(String(300), default="")
    copay_eur: Mapped[float | None] = mapped_column(Float)
    rx_mark: Mapped[str] = mapped_column(String(4), default="")
    restriction: Mapped[str] = mapped_column(String(8), default="")


class SourceStatus(Base):
    __tablename__ = "source_status"

    source_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    last_success_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    last_error_at: Mapped[datetime | None] = mapped_column(UtcDateTime())
    last_error: Mapped[str | None] = mapped_column(Text)
    record_count: Mapped[int | None] = mapped_column(Integer)
    # The date the data describe, as the source states it (file month, list in force), if any.
    source_updated_at: Mapped[datetime | None] = mapped_column(UtcDateTime())


class ToolCall(Base):
    """Anonymous tool usage log. No transcripts, IPs or precise coordinates."""

    __tablename__ = "tool_calls"
    __table_args__ = (Index("ix_tool_calls_ts", "ts"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(UtcDateTime())
    tool: Mapped[str] = mapped_column(String(40))
    topic: Mapped[str | None] = mapped_column(String(40))
    place_id: Mapped[int | None] = mapped_column(Integer)
    municipality: Mapped[str | None] = mapped_column(String(120))
    county: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(16))
    latency_ms: Mapped[int] = mapped_column(Integer)
    conversation_id: Mapped[str | None] = mapped_column(String(80))
    profile: Mapped[str | None] = mapped_column(String(16))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    conversation_id: Mapped[str | None] = mapped_column(String(80), index=True)
    tool: Mapped[str] = mapped_column(String(40))
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
