"""user titles for filled contract drafts

Revision ID: 015_draft_titles
Revises: 014_table_column_regions
"""
from alembic import op
import sqlalchemy as sa

revision = '015_draft_titles'
down_revision = '014_table_column_regions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('document_drafts', sa.Column('title', sa.String(200), nullable=True))
    op.add_column('contract_product_drafts', sa.Column('title', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('contract_product_drafts', 'title')
    op.drop_column('document_drafts', 'title')
