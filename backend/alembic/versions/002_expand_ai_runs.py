from alembic import op
import sqlalchemy as sa
revision='002_expand_ai_runs'; down_revision='001_initial'; branch_labels=None; depends_on=None
def upgrade():
    with op.batch_alter_table('ai_runs') as b:
        b.add_column(sa.Column('user_id',sa.String(36),nullable=True)); b.add_column(sa.Column('operation',sa.String(100),nullable=True)); b.add_column(sa.Column('status',sa.String(30),nullable=True)); b.add_column(sa.Column('started_at',sa.DateTime(timezone=True),nullable=True)); b.add_column(sa.Column('finished_at',sa.DateTime(timezone=True),nullable=True)); b.add_column(sa.Column('prompt_tokens',sa.Integer,nullable=True)); b.add_column(sa.Column('completion_tokens',sa.Integer,nullable=True)); b.add_column(sa.Column('total_tokens',sa.Integer,nullable=True)); b.add_column(sa.Column('retry_count',sa.Integer,nullable=False,server_default='0')); b.add_column(sa.Column('error_code',sa.String(100),nullable=True)); b.add_column(sa.Column('error_message',sa.Text,nullable=True)); b.add_column(sa.Column('request_id',sa.String(200),nullable=True)); b.add_column(sa.Column('input_hash',sa.String(64),nullable=True)); b.add_column(sa.Column('output_hash',sa.String(64),nullable=True)); b.add_column(sa.Column('metadata_json',sa.JSON,nullable=False,server_default='{}'))
        b.drop_column('request_type'); b.drop_column('success'); b.alter_column('operation',nullable=False); b.alter_column('status',nullable=False)
def downgrade():
    with op.batch_alter_table('ai_runs') as b:
        b.add_column(sa.Column('request_type',sa.String(100),nullable=True)); b.add_column(sa.Column('success',sa.Boolean,nullable=True))
        for name in ['metadata_json','output_hash','input_hash','request_id','error_message','error_code','retry_count','total_tokens','completion_tokens','prompt_tokens','finished_at','started_at','status','operation','user_id']: b.drop_column(name)
