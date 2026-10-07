"""initial schema"""
from alembic import op
import sqlalchemy as sa
revision='001_initial'; down_revision=None; branch_labels=None; depends_on=None
def upgrade():
 op.create_table('users',sa.Column('id',sa.String(36),primary_key=True),sa.Column('external_id',sa.String(100),unique=True),sa.Column('full_name',sa.String(200)),sa.Column('email',sa.String(200)),sa.Column('department',sa.String(200)),sa.Column('roles',sa.JSON),sa.Column('password',sa.String(100)))
 op.create_table('sessions',sa.Column('id',sa.String(36),primary_key=True),sa.Column('user_id',sa.String(36),sa.ForeignKey('users.id')),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('cases',sa.Column('id',sa.String(36),primary_key=True),sa.Column('user_id',sa.String(36),sa.ForeignKey('users.id')),sa.Column('title',sa.String(300)),sa.Column('state',sa.String(50)),sa.Column('context',sa.JSON),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('messages',sa.Column('id',sa.String(36),primary_key=True),sa.Column('case_id',sa.String(36),sa.ForeignKey('cases.id')),sa.Column('role',sa.String(20)),sa.Column('content',sa.Text),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('attachments',sa.Column('id',sa.String(36),primary_key=True),sa.Column('case_id',sa.String(36),sa.ForeignKey('cases.id')),sa.Column('original_name',sa.String(300)),sa.Column('path',sa.String(500)),sa.Column('mime_type',sa.String(100)),sa.Column('extracted_text',sa.Text),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('technical_specifications',sa.Column('id',sa.String(36),primary_key=True),sa.Column('case_id',sa.String(36),sa.ForeignKey('cases.id'),unique=True),sa.Column('version',sa.Integer),sa.Column('data',sa.JSON),sa.Column('status',sa.String(30)),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('technical_specification_versions',sa.Column('id',sa.String(36),primary_key=True),sa.Column('spec_id',sa.String(36),sa.ForeignKey('technical_specifications.id')),sa.Column('version',sa.Integer),sa.Column('data',sa.JSON),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('contract_templates',sa.Column('id',sa.String(36),primary_key=True),sa.Column('code',sa.String(80),unique=True),sa.Column('name',sa.String(200)),sa.Column('description',sa.Text),sa.Column('path',sa.String(500)),sa.Column('active',sa.Boolean),sa.Column('version',sa.String(30)))
 op.create_table('contract_template_rules',sa.Column('id',sa.String(36),primary_key=True),sa.Column('template_id',sa.String(36),sa.ForeignKey('contract_templates.id')),sa.Column('conditions',sa.JSON))
 op.create_table('ai_runs',sa.Column('id',sa.String(36),primary_key=True),sa.Column('case_id',sa.String(36),nullable=True),sa.Column('provider',sa.String(100)),sa.Column('model',sa.String(100)),sa.Column('request_type',sa.String(100)),sa.Column('latency_ms',sa.Integer),sa.Column('success',sa.Boolean),sa.Column('created_at',sa.DateTime(timezone=True)))
 op.create_table('audit_events',sa.Column('id',sa.String(36),primary_key=True),sa.Column('user_id',sa.String(36),nullable=True),sa.Column('case_id',sa.String(36),nullable=True),sa.Column('event_type',sa.String(100)),sa.Column('metadata_json',sa.JSON),sa.Column('timestamp',sa.DateTime(timezone=True)))
def downgrade():
 for t in ['audit_events','ai_runs','contract_template_rules','contract_templates','technical_specification_versions','technical_specifications','attachments','messages','cases','sessions','users']: op.drop_table(t)
