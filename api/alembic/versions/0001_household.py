"""Household, server-side sessions, two traveller slots and profile audit trail."""

import sqlalchemy as sa

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "household_user",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("singleton", sa.Integer(), nullable=False, unique=True),
        sa.Column("username", sa.String(100), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("failed_logins", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("singleton = 1", name="one_household_user"),
    )
    op.create_table(
        "household_session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("household_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_household_session_expires_at", "household_session", ["expires_at"])
    op.create_table(
        "traveller",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slot", sa.Integer(), unique=True, nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("rule_applicable", sa.Boolean()),
        sa.Column("history_complete", sa.Boolean(), nullable=False),
        sa.Column("history_reviewed_on", sa.Date()),
        sa.Column("notes", sa.String(2000), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("slot IN (1, 2)", name="two_traveller_slots"),
    )
    op.create_table(
        "audit_event",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("household_user.id"), nullable=False),
        sa.Column("entity", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(30), nullable=False),
        sa.Column("before_json", sa.JSON()),
        sa.Column("after_json", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("audit_event")
    op.drop_table("traveller")
    op.drop_table("household_session")
    op.drop_table("household_user")
