import os, tempfile
os.environ['DATABASE_URL']='sqlite:///'+tempfile.mktemp(suffix='.db')
os.environ['STORAGE_LOCAL_PATH']=tempfile.mkdtemp()
from fastapi.testclient import TestClient
from app.db import Base,engine
Base.metadata.create_all(engine)
from app.seed import seed
seed()
from app.main import app
c=TestClient(app)
def auth(name='ivanov'):
 r=c.post('/api/v1/auth/login',json={'external_id':name,'password':name}); assert r.status_code==200; return {'x-session':r.json()['session_id']}
def test_full_flow_and_versions():
 h=auth(); r=c.post('/api/v1/cases',headers=h,json={'title':'Лендинг'}); cid=r.json()['id']
 r=c.post(f'/api/v1/cases/{cid}/messages',headers=h,json={'content':'Нужно заказать разработку лендинга для мероприятия'}); assert r.json()['state']=='COLLECTING_SPEC_DATA'
 for answer in ['Продвижение мероприятия','Создать адаптивный лендинг','30 ноября 2026 года','Соответствие требованиям']:
  r=c.post(f'/api/v1/cases/{cid}/messages',headers=h,json={'content':answer})
 assert r.json()['state']=='SPEC_REVIEW'
 s=c.patch(f'/api/v1/cases/{cid}/technical-specification',headers=h,json={'changes':[{'field':'deadline','value':'2026-11-30'}]}); assert s.json()['version']==3 and s.json()['data']['purpose']=='Продвижение мероприятия'
 rec=c.post(f'/api/v1/cases/{cid}/technical-specification/confirm',headers=h); assert rec.json()['status']=='matched'
 assert c.get(f'/api/v1/cases/{cid}/technical-specification/download',headers=h).status_code==200
def test_permissions_and_escalation():
 h=auth(); cid=c.post('/api/v1/cases',headers=h,json={}).json()['id']; assert c.get(f'/api/v1/cases/{cid}',headers=auth('petrova')).status_code==404
 r=c.post(f'/api/v1/cases/{cid}/messages',headers=h,json={'content':'Мне нужен личный юридический совет'}); assert r.json()['state']=='ESCALATED_TO_DPO'
def test_upload_docx_analysis_and_contract_download():
 from docx import Document
 import io
 d=Document(); d.add_paragraph('Техническое задание: разработка корпоративного лендинга. Срок 30 ноября 2026 года.'); buf=io.BytesIO(); d.save(buf)
 h=auth(); cid=c.post('/api/v1/cases',headers=h,json={'title':'Готовое ТЗ'}).json()['id']
 r=c.post(f'/api/v1/cases/{cid}/attachments',headers=h,files={'file':('tz.docx',buf.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}); assert r.status_code==200 and r.json()['analysis_ready']
 r=c.post(f'/api/v1/cases/{cid}/technical-specification/confirm',headers=h); assert r.json()['status']=='matched'
 assert c.get('/api/v1/templates/'+r.json()['template_id']+'/download',headers=h).status_code==200
def test_sessions_case_ownership_and_switching():
 ivan=auth('ivanov'); assert c.get('/api/v1/auth/me',headers=ivan).json()['email']=='ivanov@nspk.local'
 case=c.post('/api/v1/cases',headers=ivan,json={}).json()['id']
 c.post(f'/api/v1/cases/{case}/messages',headers=ivan,json={'content':'Нам нужно купить велосипеды'})
 assert c.get(f'/api/v1/cases/{case}',headers=ivan).json()['title']=='Закупка велосипедов'
 assert c.post('/api/v1/auth/logout',headers=ivan).status_code==200
 assert c.get('/api/v1/auth/me',headers=ivan).status_code==401
 anna=auth('petrova'); own=c.get('/api/v1/cases',headers=anna).json(); assert case not in [x['id'] for x in own]
 for method,url in [('get',f'/api/v1/cases/{case}'),('patch',f'/api/v1/cases/{case}'),('post',f'/api/v1/cases/{case}/messages'),('post',f'/api/v1/cases/{case}/attachments'),('get',f'/api/v1/cases/{case}/technical-specification/download')]:
  kwargs={'headers':anna}
  if method=='patch': kwargs['json']={'title':'чужое'}
  if url.endswith('/messages'): kwargs['json']={'content':'чужое'}
  if url.endswith('/attachments'): kwargs['files']={'file':('x.docx',b'x','application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
  assert getattr(c,method)(url,**kwargs).status_code==404
 anna_case=c.post('/api/v1/cases',headers=anna,json={'title':'Обучение сотрудников'}).json()['id']
 c.post('/api/v1/auth/logout',headers=anna); ivan2=auth('ivanov'); ids=[x['id'] for x in c.get('/api/v1/cases',headers=ivan2).json()]; assert case in ids and anna_case not in ids
