"""extend contract platform for end-to-end drafting"""
from alembic import op
import sqlalchemy as sa

revision='008_contract_platform_e2e'; down_revision='007_contract_platform'; branch_labels=None; depends_on=None

def upgrade():
 op.add_column('document_templates',sa.Column('category',sa.String(120),nullable=False,server_default='Другое'))
 op.drop_constraint('uq_document_binding_key','document_bindings',type_='unique')
 op.add_column('document_bindings',sa.Column('occurrence_index',sa.Integer(),nullable=False,server_default='1'))
 op.create_unique_constraint('uq_document_binding_occurrence','document_bindings',['template_version_id','binding_key','occurrence_index'])

def downgrade():
 op.drop_constraint('uq_document_binding_occurrence','document_bindings',type_='unique')
 op.drop_column('document_bindings','occurrence_index')
 op.create_unique_constraint('uq_document_binding_key','document_bindings',['template_version_id','binding_key'])
 op.drop_column('document_templates','category')
