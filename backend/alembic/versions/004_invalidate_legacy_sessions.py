"""invalidate sessions created before cookie/CSRF enforcement"""
from alembic import op

revision = '004_invalidate_legacy_sessions'
down_revision = '003_secure_auth'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('DELETE FROM sessions WHERE expires_at IS NULL OR csrf_token IS NULL')


def downgrade():
    pass
