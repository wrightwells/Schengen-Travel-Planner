from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class HouseholdUser(Base):
    __tablename__ = "household_user"
    __table_args__ = (CheckConstraint("singleton = 1", name="one_household_user"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    singleton: Mapped[int] = mapped_column(unique=True, default=1)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    failed_logins: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = "household_session"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("household_user.id", ondelete="CASCADE"))
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Traveller(Base):
    __tablename__ = "traveller"
    __table_args__ = (CheckConstraint("slot IN (1, 2)", name="two_traveller_slots"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    slot: Mapped[int] = mapped_column(unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    rule_applicable: Mapped[bool | None] = mapped_column(Boolean)
    history_complete: Mapped[bool] = mapped_column(default=False)
    history_reviewed_on: Mapped[date | None]
    notes: Mapped[str] = mapped_column(String(2000), default="")
    version: Mapped[int] = mapped_column(default=1)


class AuditEvent(Base):
    __tablename__ = "audit_event"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("household_user.id"))
    entity: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[UUID]
    operation: Mapped[str] = mapped_column(String(30))
    before_json: Mapped[dict | None] = mapped_column(JSON)
    after_json: Mapped[dict] = mapped_column(JSON)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Country(Base):
    __tablename__ = "country"
    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    note: Mapped[str] = mapped_column(String(500), default="")


class Membership(Base):
    __tablename__ = "schengen_membership"
    __table_args__ = (
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from", name="membership_date_order"
        ),
    )
    country_code: Mapped[str] = mapped_column(ForeignKey("country.code"), primary_key=True)
    effective_from: Mapped[date] = mapped_column(primary_key=True)
    effective_to: Mapped[date | None]
    is_schengen: Mapped[bool]


class Trip(Base):
    __tablename__ = "trip"
    __table_args__ = (CheckConstraint("status IN ('HISTORY', 'PLANNED')", name="trip_status"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(150))
    status: Mapped[str] = mapped_column(String(10), index=True)
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    participants: Mapped[list["TripParticipant"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="TripParticipant.traveller_id"
    )


class TripParticipant(Base):
    __tablename__ = "trip_participant"
    __table_args__ = (CheckConstraint("entry_date <= exit_date", name="participant_date_order"),)
    trip_id: Mapped[UUID] = mapped_column(
        ForeignKey("trip.id", ondelete="CASCADE"), primary_key=True
    )
    traveller_id: Mapped[UUID] = mapped_column(ForeignKey("traveller.id"), primary_key=True)
    entry_date: Mapped[date]
    exit_date: Mapped[date]
    trip: Mapped[Trip] = relationship(back_populates="participants")
    segments: Mapped[list["TripSegment"]] = relationship(
        back_populates="participant",
        cascade="all, delete-orphan",
        order_by="TripSegment.start_date",
    )


class TripSegment(Base):
    __tablename__ = "trip_segment"
    __table_args__ = (
        ForeignKeyConstraint(
            ["trip_id", "traveller_id"],
            ["trip_participant.trip_id", "trip_participant.traveller_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("start_date <= end_date", name="segment_date_order"),
        UniqueConstraint(
            "trip_id",
            "traveller_id",
            "country_code",
            "start_date",
            "end_date",
            name="unique_segment",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    trip_id: Mapped[UUID]
    traveller_id: Mapped[UUID]
    country_code: Mapped[str] = mapped_column(ForeignKey("country.code"))
    start_date: Mapped[date]
    end_date: Mapped[date]
    participant: Mapped[TripParticipant] = relationship(back_populates="segments")
