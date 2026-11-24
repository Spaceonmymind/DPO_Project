"""Allow audit events for authorizing the next contract stage.

Revision ID: 021_stage_authorization
Revises: 020_completed_contract_stages
"""
from alembic import op
import sqlalchemy as sa

revision = '021_stage_authorization'
down_revision = '020_completed_contract_stages'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_draft_stage_event_type', 'draft_stage_events', type_='check')
    op.create_check_constraint(
        'ck_draft_stage_event_type', 'draft_stage_events',
        "event_type IN ('COMPLETED','UNLOCKED','AUTHORIZED')",
    )


def downgrade():
    count = op.get_bind().execute(sa.text(
        "SELECT COUNT(*) FROM draft_stage_events WHERE event_type = 'AUTHORIZED'"
    )).scalar_one()
    if count:
        raise RuntimeError('Cannot downgrade while AUTHORIZED draft stage audit events exist')
    op.drop_constraint('ck_draft_stage_event_type', 'draft_stage_events', type_='check')
    op.create_check_constraint(
        'ck_draft_stage_event_type', 'draft_stage_events',
        "event_type IN ('COMPLETED','UNLOCKED')",
    )
