from pathlib import Path
import os
from app.db import SessionLocal,User,settings
from app.documents.service import generate_spec
from app.contract_registry import sync_contract_registry
from app.security import hash_password,verify_password
USERS=[('ivanov','Иванов Иван Иванович','ivanov@nspk.local','ДПО','Ivanov'),('petrova','Петрова Анна Сергеевна','petrova@nspk.local','Маркетинг','Petrova')]
def seed():
 db=SessionLocal(); root=Path(settings.storage)
 if os.getenv('SEED_DEMO_USERS',str(settings.app_env=='development')).lower()=='true':
  for ext,name,email,dept,pw in USERS:
   user=db.query(User).filter_by(external_id=ext).first()
   if not user: db.add(User(external_id=ext,full_name=name,email=email,department=dept,roles=['employee'],password=hash_password(pw),is_active=True))
   elif verify_password(user.password,ext)[0]: user.password=hash_password(pw)
 sync_contract_registry(db)
 sample=Path('/app/docs/samples/sample_technical_specification.docx')
 if not sample.exists():
  sample.parent.mkdir(parents=True,exist_ok=True); generate_spec({'subject':'Разработка корпоративного лендинга','purpose':'Информирование участников мероприятия','scope':'Адаптивная веб-страница и административная панель','functional_requirements':'Форма регистрации и административная панель','deadline':'30 ноября 2026 года','acceptance_criteria':'Соответствие требованиям и успешное тестирование'},sample)
 db.commit(); db.close()
if __name__=='__main__': seed()
