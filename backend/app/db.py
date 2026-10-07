import os, uuid
from datetime import datetime, timezone
from sqlalchemy import create_engine, String, Text, DateTime, Integer, Boolean, ForeignKey, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
class Settings:
 database_url=os.getenv('DATABASE_URL','sqlite:///./dpo.db'); storage=os.getenv('STORAGE_LOCAL_PATH','../storage'); max_upload=int(os.getenv('MAX_UPLOAD_SIZE_MB','20'))*1024*1024
settings=Settings()
connect_args={'check_same_thread':False} if settings.database_url.startswith('sqlite') else {}
engine=create_engine(settings.database_url,connect_args=connect_args); SessionLocal=sessionmaker(bind=engine,autoflush=False)
def now(): return datetime.now(timezone.utc)
def uid(): return str(uuid.uuid4())
class Base(DeclarativeBase): pass
class User(Base):
 __tablename__='users'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); external_id:Mapped[str]=mapped_column(String(100),unique=True); full_name:Mapped[str]=mapped_column(String(200)); email:Mapped[str]=mapped_column(String(200)); department:Mapped[str]=mapped_column(String(200)); roles:Mapped[dict]=mapped_column(JSON,default=list); password:Mapped[str]=mapped_column(String(100))
class Session(Base):
 __tablename__='sessions'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); user_id:Mapped[str]=mapped_column(ForeignKey('users.id')); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class Case(Base):
 __tablename__='cases'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); user_id:Mapped[str]=mapped_column(ForeignKey('users.id')); title:Mapped[str]=mapped_column(String(300)); state:Mapped[str]=mapped_column(String(50),default='NEW'); context:Mapped[dict]=mapped_column(JSON,default=dict); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class Message(Base):
 __tablename__='messages'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); case_id:Mapped[str]=mapped_column(ForeignKey('cases.id')); role:Mapped[str]=mapped_column(String(20)); content:Mapped[str]=mapped_column(Text); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class Attachment(Base):
 __tablename__='attachments'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); case_id:Mapped[str]=mapped_column(ForeignKey('cases.id')); original_name:Mapped[str]=mapped_column(String(300)); path:Mapped[str]=mapped_column(String(500)); mime_type:Mapped[str]=mapped_column(String(100)); extracted_text:Mapped[str]=mapped_column(Text,default=''); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class TechnicalSpecification(Base):
 __tablename__='technical_specifications'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); case_id:Mapped[str]=mapped_column(ForeignKey('cases.id'),unique=True); version:Mapped[int]=mapped_column(Integer,default=1); data:Mapped[dict]=mapped_column(JSON,default=dict); status:Mapped[str]=mapped_column(String(30),default='DRAFT'); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class SpecVersion(Base):
 __tablename__='technical_specification_versions'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); spec_id:Mapped[str]=mapped_column(ForeignKey('technical_specifications.id')); version:Mapped[int]=mapped_column(Integer); data:Mapped[dict]=mapped_column(JSON); created_at:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
class ContractTemplate(Base):
 __tablename__='contract_templates'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); code:Mapped[str]=mapped_column(String(80),unique=True); name:Mapped[str]=mapped_column(String(200)); description:Mapped[str]=mapped_column(Text); path:Mapped[str]=mapped_column(String(500)); active:Mapped[bool]=mapped_column(Boolean,default=True); version:Mapped[str]=mapped_column(String(30),default='1.0')
class ContractRule(Base):
 __tablename__='contract_template_rules'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); template_id:Mapped[str]=mapped_column(ForeignKey('contract_templates.id')); conditions:Mapped[dict]=mapped_column(JSON)
class AuditEvent(Base):
 __tablename__='audit_events'; id:Mapped[str]=mapped_column(String(36),primary_key=True,default=uid); user_id:Mapped[str|None]=mapped_column(String(36),nullable=True); case_id:Mapped[str|None]=mapped_column(String(36),nullable=True); event_type:Mapped[str]=mapped_column(String(100)); metadata_json:Mapped[dict]=mapped_column(JSON,default=dict); timestamp:Mapped[datetime]=mapped_column(DateTime(timezone=True),default=now)
def audit(db,user,case,event,meta={}): db.add(AuditEvent(user_id=user,case_id=case,event_type=event,metadata_json=meta))
