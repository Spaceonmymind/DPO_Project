"""separate procurement context and contract recommendation"""
from alembic import op
import sqlalchemy as sa

revision = '005_procurement_context'
down_revision = '004_invalidate_legacy_sessions'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'procurement_contexts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('case_id', sa.String(36), sa.ForeignKey('cases.id'), nullable=False),
        sa.Column('intent', sa.String(60), nullable=False, server_default='GENERAL_PROCUREMENT_DIALOGUE'),
        sa.Column('subject', sa.String(500), nullable=False, server_default=''),
        sa.Column('category', sa.String(80), nullable=False, server_default=''),
        sa.Column('data', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('missing_fields', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('source_confidence', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('case_id'),
    )
    op.create_index('ix_procurement_contexts_case_id', 'procurement_contexts', ['case_id'])
    op.create_table(
        'contract_recommendations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('case_id', sa.String(36), sa.ForeignKey('cases.id'), nullable=False),
        sa.Column('template_id', sa.String(36), sa.ForeignKey('contract_templates.id'), nullable=True),
        sa.Column('status', sa.String(40), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('case_id'),
    )
    op.create_index('ix_contract_recommendations_case_id', 'contract_recommendations', ['case_id'])


def downgrade():
    op.drop_index('ix_contract_recommendations_case_id', table_name='contract_recommendations')
    op.drop_table('contract_recommendations')
    op.drop_index('ix_procurement_contexts_case_id', table_name='procurement_contexts')
    op.drop_table('procurement_contexts')
