"""secure cookie sessions and local accounts"""
from alembic import op
import sqlalchemy as sa

revision = '003_secure_auth'
down_revision = '002_expand_ai_runs'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users') as b:
        b.alter_column('password', type_=sa.String(255), existing_type=sa.String(100))
        b.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
    with op.batch_alter_table('sessions') as b:
        b.add_column(sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column('csrf_token', sa.String(64), nullable=True))
    op.create_table(
        'login_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('external_id', sa.String(100), nullable=False),
        sa.Column('ip_address', sa.String(64), nullable=False),
        sa.Column('success', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('attempted_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_login_attempts_external_id', 'login_attempts', ['external_id'])
    op.create_index('ix_login_attempts_attempted_at', 'login_attempts', ['attempted_at'])


def downgrade():
    op.drop_index('ix_login_attempts_attempted_at', table_name='login_attempts')
    op.drop_index('ix_login_attempts_external_id', table_name='login_attempts')
    op.drop_table('login_attempts')
    with op.batch_alter_table('sessions') as b:
        b.drop_column('csrf_token')
        b.drop_column('expires_at')
    with op.batch_alter_table('users') as b:
        b.drop_column('is_active')
        b.alter_column('password', type_=sa.String(100), existing_type=sa.String(255))
