"""repeating groups

Revision ID: 011_repeating_groups
Revises: 010_conditional_document_regions
"""
from alembic import op
import sqlalchemy as sa

revision='011_repeating_groups'
down_revision='010_conditional_document_regions'
branch_labels=None
depends_on=None

def upgrade():
 op.create_table('repeating_groups',
  sa.Column('id',sa.String(36),primary_key=True),sa.Column('template_version_id',sa.String(36),sa.ForeignKey('document_template_versions.id'),nullable=False),
  sa.Column('group_key',sa.String(120),nullable=False),sa.Column('name',sa.String(240),nullable=False),sa.Column('description',sa.Text(),nullable=False,server_default=''),
  sa.Column('min_items',sa.Integer(),nullable=False,server_default='0'),sa.Column('max_items',sa.Integer(),nullable=False,server_default='10'),sa.Column('required',sa.Boolean(),nullable=False,server_default=sa.false()),sa.Column('position',sa.Integer(),nullable=False),sa.Column('config',sa.JSON(),nullable=False),sa.Column('locator',sa.JSON(),nullable=False),sa.Column('status',sa.String(20),nullable=False,server_default='ACTIVE'),sa.Column('created_by_id',sa.String(36),sa.ForeignKey('users.id'),nullable=False),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
  sa.UniqueConstraint('template_version_id','group_key',name='uq_repeating_group_key'),sa.UniqueConstraint('template_version_id','position',name='uq_repeating_group_position'),sa.CheckConstraint("status IN ('ACTIVE','STALE','INVALID')",name='ck_repeating_group_status'),sa.CheckConstraint('min_items >= 0 AND max_items >= min_items AND max_items <= 50',name='ck_repeating_group_limits'))
 op.create_index('ix_repeating_groups_template_version_id','repeating_groups',['template_version_id'])
 op.create_table('repeating_group_fields',
  sa.Column('id',sa.String(36),primary_key=True),sa.Column('group_id',sa.String(36),sa.ForeignKey('repeating_groups.id'),nullable=False),sa.Column('field_key',sa.String(120),nullable=False),sa.Column('label',sa.String(300),nullable=False),sa.Column('field_type',sa.String(40),nullable=False),sa.Column('required',sa.Boolean(),nullable=False,server_default=sa.false()),sa.Column('position',sa.Integer(),nullable=False),sa.Column('config',sa.JSON(),nullable=False),sa.Column('locator',sa.JSON(),nullable=True),sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),sa.UniqueConstraint('group_id','field_key',name='uq_repeating_group_field_key'),sa.UniqueConstraint('group_id','position',name='uq_repeating_group_field_position'))
 op.create_index('ix_repeating_group_fields_group_id','repeating_group_fields',['group_id'])

def downgrade():
 op.drop_index('ix_repeating_group_fields_group_id',table_name='repeating_group_fields'); op.drop_table('repeating_group_fields')
 op.drop_index('ix_repeating_groups_template_version_id',table_name='repeating_groups'); op.drop_table('repeating_groups')
