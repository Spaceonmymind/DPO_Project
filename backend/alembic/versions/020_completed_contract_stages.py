"""Optional immutable completion of selected contract stages.

Revision ID: 020_completed_contract_stages
Revises: 019_contract_stages
"""
from alembic import op
import sqlalchemy as sa

revision = '020_completed_contract_stages'
down_revision = '019_contract_stages'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('document_template_versions', sa.Column('lock_completed_stages', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('document_drafts', sa.Column('completed_stage_ids', sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
    op.create_table('draft_stage_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('draft_id', sa.String(36), sa.ForeignKey('document_drafts.id'), nullable=False),
        sa.Column('stage_id', sa.String(36), sa.ForeignKey('contract_stages.id'), nullable=False),
        sa.Column('actor_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('event_type', sa.String(24), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("event_type IN ('COMPLETED','UNLOCKED')", name='ck_draft_stage_event_type'),
    )
    op.create_index('ix_draft_stage_events_draft_id', 'draft_stage_events', ['draft_id'])


def downgrade():
    op.drop_index('ix_draft_stage_events_draft_id', table_name='draft_stage_events')
    op.drop_table('draft_stage_events')
    op.drop_column('document_drafts', 'completed_stage_ids')
    op.drop_column('document_template_versions', 'lock_completed_stages')
