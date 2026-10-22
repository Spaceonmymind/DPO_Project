"""calculated fields and binding formats

Revision ID: 012_calculated_fields
Revises: 011_repeating_groups
"""
from alembic import op
import sqlalchemy as sa

revision='012_calculated_fields'
down_revision='011_repeating_groups'
branch_labels=None
depends_on=None

def upgrade():
 op.add_column('questionnaire_schemas',sa.Column('calculation_schema_version',sa.Integer(),nullable=False,server_default='1'))
 op.add_column('document_bindings',sa.Column('format_config',sa.JSON(),nullable=False,server_default=sa.text("'{}'::json")))

def downgrade():
 op.drop_column('document_bindings','format_config')
 op.drop_column('questionnaire_schemas','calculation_schema_version')
