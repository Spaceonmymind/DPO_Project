"""Add centrally managed requisite sets without changing existing drafts.

Revision ID: 018_requisite_sets
Revises: 017_soft_deletion
"""
from alembic import op
import sqlalchemy as sa

revision = '018_requisite_sets'
down_revision = '017_soft_deletion'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('requisite_sets',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(240), nullable=False, unique=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('entries', sa.JSON(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('created_by_id', sa.String(36), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('ACTIVE','ARCHIVED')", name='ck_requisite_sets_status'),
        sa.CheckConstraint('revision >= 1', name='ck_requisite_sets_revision'),
    )

def downgrade():
    op.drop_table('requisite_sets')
