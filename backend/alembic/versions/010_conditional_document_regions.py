"""conditional document regions

Revision ID: 010_conditional_document_regions
Revises: 009_questionnaire_conditions
"""
from alembic import op
import sqlalchemy as sa

revision='010_conditional_document_regions'
down_revision='009_questionnaire_conditions'
branch_labels=None
depends_on=None

def upgrade():
 op.create_table('conditional_document_regions',
  sa.Column('id',sa.String(36),primary_key=True),
  sa.Column('template_version_id',sa.String(36),sa.ForeignKey('document_template_versions.id'),nullable=False),
  sa.Column('region_key',sa.String(120),nullable=False),
  sa.Column('region_type',sa.String(40),nullable=False),
  sa.Column('locator',sa.JSON(),nullable=False),
  sa.Column('include_when',sa.JSON(),nullable=False),
  sa.Column('original_text',sa.Text(),nullable=False),
  sa.Column('status',sa.String(20),nullable=False,server_default='ACTIVE'),
  sa.Column('created_by_id',sa.String(36),sa.ForeignKey('users.id'),nullable=False),
  sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
  sa.CheckConstraint("region_type IN ('CONDITIONAL_RUN','CONDITIONAL_PARAGRAPH','CONDITIONAL_PARAGRAPH_GROUP','CONDITIONAL_TABLE_ROW','CONDITIONAL_TABLE')",name='ck_conditional_region_type'),
  sa.CheckConstraint("status IN ('ACTIVE','STALE','INVALID')",name='ck_conditional_region_status'),
  sa.UniqueConstraint('template_version_id','region_key',name='uq_conditional_region_key'))
 op.create_index('ix_conditional_document_regions_template_version_id','conditional_document_regions',['template_version_id'])

def downgrade():
 op.drop_index('ix_conditional_document_regions_template_version_id',table_name='conditional_document_regions')
 op.drop_table('conditional_document_regions')
