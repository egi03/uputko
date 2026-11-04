"""Tool contract models (agent/tools.schema.json) and the common response."""

from typing import Any, Literal, Self

from pydantic import BaseModel, Field, PrivateAttr

Status = Literal["ok", "ambiguous", "not_found", "no_data", "error"]
CandidateKind = Literal["place", "procedure", "drug"]
FacilityType = Literal[
    "family_medicine", "pediatrics", "gynecology", "dentistry", "hospital", "any"
]


class LocationOut(BaseModel):
    name: str
    municipality: str
    county: str


class CandidateOut(BaseModel):
    name: str
    county: str | None = None
    # A place's city or municipality ("Grad Vrbovec"): one name can repeat inside a county.
    municipality: str | None = None
    kind: CandidateKind = "place"


class ToolResponse(BaseModel):
    status: Status
    location: LocationOut | None = None
    candidates: list[CandidateOut] = Field(default_factory=list, max_length=3)
    summary_hr: str
    data: dict[str, Any] = Field(default_factory=dict)
    source: str
    updated_at: str | None = None
    card_id: str | None = None
    # Extra card-only content (e.g. the full list behind a short answer); never sent to the agent.
    _card_extra: dict[str, Any] = PrivateAttr(default_factory=dict)

    def with_card_extra(self, **extra: object) -> Self:
        self._card_extra = extra
        return self

    @property
    def card_extra(self) -> dict[str, Any]:
        return self._card_extra


class _ToolRequest(BaseModel):
    conversation_id: str | None = Field(default=None, max_length=80)


class HealthRequest(_ToolRequest):
    location: str = Field(min_length=1, max_length=120)
    facility_type: FacilityType = "any"
    limit: int = Field(default=3, ge=1, le=5)


class WaitingRequest(_ToolRequest):
    procedure: str = Field(min_length=1, max_length=160)
    location: str | None = Field(default=None, max_length=120)
    limit: int = Field(default=3, ge=1, le=5)


class DrugRequest(_ToolRequest):
    name: str = Field(min_length=1, max_length=120)
