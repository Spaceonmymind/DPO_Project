"""Persist per-user onboarding completion.

Revision ID: 016_user_onboarding
Revises: 015_draft_titles
"""
from alembic import op
import sqlalchemy as sa

revision = '016_user_onboarding'
down_revision = '015_draft_titles'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('user_onboarding',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('tour_id', sa.String(20), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('user_id', 'tour_id', name='uq_user_onboarding_tour'),
        sa.CheckConstraint("status IN ('COMPLETED','SKIPPED')", name='ck_user_onboarding_status'))
    op.create_index('ix_user_onboarding_user_id', 'user_onboarding', ['user_id'])

def downgrade():
    op.drop_index('ix_user_onboarding_user_id', table_name='user_onboarding')
    op.drop_table('user_onboarding')
