"""Soft deletion for user documents and unused draft configurations.

Revision ID: 017_soft_deletion
Revises: 016_user_onboarding
"""
from alembic import op
import sqlalchemy as sa

revision = '017_soft_deletion'
down_revision = '016_user_onboarding'
branch_labels = None
depends_on = None

def upgrade():
    for table in ('document_drafts', 'contract_product_drafts', 'document_templates', 'contract_products'):
        op.add_column(table, sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))

def downgrade():
    for table in ('contract_products', 'document_templates', 'contract_product_drafts', 'document_drafts'):
        op.drop_column(table, 'deleted_at')
