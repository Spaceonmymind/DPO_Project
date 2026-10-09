"""extend approved contract registry"""
from alembic import op
import sqlalchemy as sa

revision = '006_contract_registry'
down_revision = '005_procurement_context'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contract_templates', sa.Column('filename', sa.String(300), nullable=False, server_default=''))
    op.add_column('contract_templates', sa.Column('file_format', sa.String(20), nullable=False, server_default='docx'))
    op.add_column('contract_templates', sa.Column('checksum_sha256', sa.String(64), nullable=False, server_default=''))
    op.add_column('contract_templates', sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('contract_templates', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('contract_recommendations', sa.Column('template_code', sa.String(40), nullable=False, server_default=''))
    op.add_column('contract_recommendations', sa.Column('template_title', sa.String(200), nullable=False, server_default=''))
    op.add_column('contract_recommendations', sa.Column('rules_triggered', sa.JSON(), nullable=False, server_default='[]'))


def downgrade():
    op.drop_column('contract_recommendations', 'rules_triggered')
    op.drop_column('contract_recommendations', 'template_title')
    op.drop_column('contract_recommendations', 'template_code')
    op.drop_column('contract_templates', 'updated_at')
    op.drop_column('contract_templates', 'created_at')
    op.drop_column('contract_templates', 'checksum_sha256')
    op.drop_column('contract_templates', 'file_format')
    op.drop_column('contract_templates', 'filename')
