"""allow conditional DOCX table columns

Revision ID: 014_table_column_regions
Revises: 013_contract_products
"""
from alembic import op

revision='014_table_column_regions'
down_revision='013_contract_products'
branch_labels=None
depends_on=None

def upgrade():
 op.drop_constraint('ck_conditional_region_type','conditional_document_regions',type_='check')
 op.create_check_constraint('ck_conditional_region_type','conditional_document_regions',"region_type IN ('CONDITIONAL_RUN','CONDITIONAL_PARAGRAPH','CONDITIONAL_PARAGRAPH_GROUP','CONDITIONAL_TABLE_ROW','CONDITIONAL_TABLE','CONDITIONAL_TABLE_COLUMN')")

def downgrade():
 op.drop_constraint('ck_conditional_region_type','conditional_document_regions',type_='check')
 op.create_check_constraint('ck_conditional_region_type','conditional_document_regions',"region_type IN ('CONDITIONAL_RUN','CONDITIONAL_PARAGRAPH','CONDITIONAL_PARAGRAPH_GROUP','CONDITIONAL_TABLE_ROW','CONDITIONAL_TABLE')")
