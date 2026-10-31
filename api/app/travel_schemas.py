from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.catalogue import COVERAGE_START, MAX_DATE


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SegmentInput(StrictModel):
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    start_date: date = Field(ge=COVERAGE_START, le=MAX_DATE)
    end_date: date = Field(ge=COVERAGE_START, le=MAX_DATE)

    @model_validator(mode="after")
    def date_order(self):
        if self.end_date < self.start_date:
            raise ValueError("Segment exit date must be on or after entry date")
        return self


class ParticipantInput(StrictModel):
    traveller_id: UUID
    entry_date: date = Field(ge=COVERAGE_START, le=MAX_DATE)
    exit_date: date = Field(ge=COVERAGE_START, le=MAX_DATE)
    segments: list[SegmentInput] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def date_order(self):
        if self.exit_date < self.entry_date or (self.exit_date - self.entry_date).days > 3660:
            raise ValueError("Participant dates must be ordered and span at most 3661 days")
        return self


class TripInput(StrictModel):
    title: str = Field(min_length=1, max_length=150)
    status: Literal["HISTORY", "PLANNED"]
    participants: list[ParticipantInput] = Field(min_length=1, max_length=2)


class TripUpdate(TripInput):
    version: int = Field(ge=1)


class EvaluationInput(StrictModel):
    candidate: TripInput
    included_plan_ids: list[UUID] = Field(default_factory=list, max_length=500)
    exclude_trip_id: UUID | None = None
    search_days: int = Field(default=365, ge=1, le=365)
