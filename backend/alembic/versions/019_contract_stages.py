"""Version-pinned contract stages and draft selection.

Revision ID: 019_contract_stages
Revises: 018_requisite_sets
"""
from alembic import op
import sqlalchemy as sa

revision = '019_contract_stages'
down_revision = '018_requisite_sets'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('contract_stages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('template_version_id', sa.String(36), sa.ForeignKey('document_template_versions.id'), nullable=False),
        sa.Column('name', sa.String(240), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_by_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('template_version_id', 'position', name='uq_contract_stage_position'),
        sa.CheckConstraint("status IN ('ACTIVE','INACTIVE')", name='ck_contract_stage_status'),
    )
    op.create_index('ix_contract_stages_template_version_id', 'contract_stages', ['template_version_id'])
    op.add_column('document_drafts', sa.Column('selected_stage_ids', sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))

def downgrade():
    op.drop_column('document_drafts', 'selected_stage_ids')
    op.drop_index('ix_contract_stages_template_version_id', table_name='contract_stages')
    op.drop_table('contract_stages')
