from pathlib import Path
import os
from app.db import SessionLocal,User,ContractTemplate,ContractRule,settings
from app.documents.service import generate_spec,generate_contract
from app.security import hash_password,verify_password
USERS=[('ivanov','Иванов Иван Иванович','ivanov@nspk.local','ДПО','Ivanov'),('petrova','Петрова Анна Сергеевна','petrova@nspk.local','Маркетинг','Petrova')]
TEMPLATES=[('services','Договор оказания услуг','Для закупки услуг',{'category':'services'}),('works','Договор выполнения работ','Для выполнения работ',{'category':'works'}),('supply','Договор поставки','Для поставки товаров',{'category':'supply'}),('license','Лицензионный договор','Для лицензий ПО',{'category':'software_license'}),('consulting','Договор информационно-консультационных услуг','Для консультаций',{'category':'consulting'}),('universal','Универсальный шаблон договора','Для отдельных случаев',{'category':'other_demo'})]
def seed():
 db=SessionLocal(); root=Path(settings.storage); (root/'templates').mkdir(parents=True,exist_ok=True)
 if os.getenv('SEED_DEMO_USERS',str(settings.app_env=='development')).lower()=='true':
  for ext,name,email,dept,pw in USERS:
   user=db.query(User).filter_by(external_id=ext).first()
   if not user: db.add(User(external_id=ext,full_name=name,email=email,department=dept,roles=['employee'],password=hash_password(pw),is_active=True))
   elif verify_password(user.password,ext)[0]: user.password=hash_password(pw)
 for code,name,desc,cond in TEMPLATES:
  path=root/'templates'/f'{code}.docx'
  if not path.exists(): generate_contract(name,path)
  t=db.query(ContractTemplate).filter_by(code=code).first()
  if not t:
   t=ContractTemplate(code=code,name=name,description=desc,path=str(path),active=True); db.add(t); db.flush(); db.add(ContractRule(template_id=t.id,conditions=cond))
  else: t.name=name; t.description=desc; t.path=str(path)
 sample=Path('/app/docs/samples/sample_technical_specification.docx')
 if not sample.exists():
  sample.parent.mkdir(parents=True,exist_ok=True); generate_spec({'subject':'Разработка корпоративного лендинга','purpose':'Информирование участников мероприятия','scope':'Адаптивная веб-страница и административная панель','functional_requirements':'Форма регистрации и административная панель','deadline':'30 ноября 2026 года','acceptance_criteria':'Соответствие требованиям и успешное тестирование'},sample)
 db.commit(); db.close()
if __name__=='__main__': seed()
