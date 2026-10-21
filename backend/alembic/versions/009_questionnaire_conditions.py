"""add questionnaire condition schema version

Revision ID: 009_questionnaire_conditions
Revises: 008_contract_platform_e2e
"""
from alembic import op
import sqlalchemy as sa

revision='009_questionnaire_conditions'
down_revision='008_contract_platform_e2e'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('questionnaire_schemas',sa.Column('condition_schema_version',sa.Integer(),nullable=False,server_default='1'))

def downgrade():
    op.drop_column('questionnaire_schemas','condition_schema_version')
