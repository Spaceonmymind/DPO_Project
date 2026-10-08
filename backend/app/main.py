import hmac
import logging
import os
from datetime import timedelta, timezone
from pathlib import Path
from fastapi import FastAPI,Depends,HTTPException,UploadFile,File,Request,Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBS
from app.db import *
from app.ai.orchestrator import AIOrchestrator
from app.ai.config import get_llm_settings
from app.ai.errors import LLMError
from app.documents.service import extract,generate_spec
from app.security import csrf_token, session_token, verify_password
logging.basicConfig(level=os.getenv('LOG_LEVEL','INFO').upper(),format='%(asctime)s %(levelname)s %(name)s %(message)s')
log=logging.getLogger('dpo.backend')
app=FastAPI(title='ДПО Ассистент API',version='1.1.0')
orchestrator=AIOrchestrator()
app.add_middleware(CORSMiddleware,allow_origins=os.getenv('CORS_ORIGINS','http://localhost:5173').split(','),allow_credentials=True,allow_methods=['*'],allow_headers=['*'])
@app.middleware('http')
async def headers(req,call):
 r=await call(req); r.headers['X-Content-Type-Options']='nosniff'; r.headers['X-Frame-Options']='DENY'; return r
def db():
 d=SessionLocal()
 try: yield d
 finally: d.close()
def current(req:Request,d:DBS=Depends(db)):
 token=req.cookies.get('dpo_session','')
 s=d.get(Session,token)
 expires=s.expires_at.replace(tzinfo=timezone.utc) if s and s.expires_at and s.expires_at.tzinfo is None else (s.expires_at if s else None)
 if not s or (expires and expires<=now()):
  if s: d.delete(s); d.commit()
  raise HTTPException(401,detail='Требуется авторизация')
 u=d.get(User,s.user_id)
 if not u or not u.is_active: raise HTTPException(401,detail='Учётная запись недоступна')
 if req.method not in {'GET','HEAD','OPTIONS'} and not hmac.compare_digest(req.headers.get('x-csrf-token',''),s.csrf_token or ''): raise HTTPException(403,detail='Недействительный CSRF-токен')
 return u
def own(cid,u,d):
 c=d.get(Case,cid)
 if not c: raise HTTPException(404,detail='Обращение не найдено')
 if c.user_id!=u.id: raise HTTPException(404,detail='Обращение не найдено')
 return c
def userout(u): return {'id':u.id,'full_name':u.full_name,'email':u.email,'department':u.department,'roles':u.roles}
def specout(s): return {'id':s.id,'version':s.version,'data':s.data,'status':s.status}
def caseout(c): return {'id':c.id,'title':c.title,'state':c.state,'context':c.context,'created_at':c.created_at}
def rec(c,d):
 rule=next((r for r in d.query(ContractRule).all() if r.conditions.get('category')==(c.context or {}).get('category')),None)
 if not rule:return None
 t=d.get(ContractTemplate,rule.template_id); return {'template_id':t.id,'name':t.name,'description':t.description}
def detail(c,d):
 out=caseout(c); out['messages']=[{'id':m.id,'role':m.role,'content':m.content,'created_at':m.created_at} for m in d.query(Message).filter_by(case_id=c.id).order_by(Message.created_at)]; s=d.query(TechnicalSpecification).filter_by(case_id=c.id).first(); out['technical_specification']=specout(s) if s else None; out['recommendation']=rec(c,d) if c.state=='COMPLETED' else None; return out
class Login(BaseModel): external_id:str; password:str
class CreateCase(BaseModel): title:str='Новое обращение'
class UpdateCase(BaseModel): title:str
class Text(BaseModel): content:str
class Change(BaseModel): field:str; operation:str='replace'; value:str|None=None
class Changes(BaseModel): changes:list[Change]
@app.get('/health')
def health(): return {'status':'ok'}
@app.get('/api/v1/system/llm-status')
def llmstatus(u=Depends(current)):
 s=get_llm_settings(); valid,error=s.validate_provider(); kind='simulated' if s.provider=='mock' else ('internal' if s.provider_is_internal else 'external'); return {'configured_provider':s.provider,'configured_model':s.model,'configuration_valid':valid,'provider_type':kind,'error':error}
@app.post('/api/v1/auth/login')
def login(x:Login,req:Request,response:Response,d:DBS=Depends(db)):
 external_id=x.external_id.strip().lower(); ip=req.client.host if req.client else 'unknown'; cutoff=now()-timedelta(seconds=settings.login_window_seconds)
 failures=d.query(LoginAttempt).filter(LoginAttempt.external_id==external_id,LoginAttempt.ip_address==ip,LoginAttempt.success.is_(False),LoginAttempt.attempted_at>=cutoff).count()
 if failures>=settings.login_max_attempts:
  log.warning('Login rate limit reached for account=%s ip=%s',external_id,ip); raise HTTPException(429,detail='Слишком много попыток входа. Повторите позднее.')
 u=d.query(User).filter_by(external_id=external_id).first(); valid,upgraded=verify_password(u.password,x.password) if u and u.is_active else (False,None)
 d.add(LoginAttempt(external_id=external_id,ip_address=ip,success=valid))
 if not valid:
  d.commit(); log.warning('Failed login for account=%s ip=%s',external_id,ip); raise HTTPException(401,detail='Неверные учётные данные')
 if upgraded: u.password=upgraded
 token=session_token(); csrf=csrf_token(); expires=now()+timedelta(seconds=settings.session_max_age); s=Session(id=token,user_id=u.id,expires_at=expires,csrf_token=csrf); d.add(s); audit(d,u.id,None,'USER_LOGIN'); d.commit()
 response.set_cookie('dpo_session',token,max_age=settings.session_max_age,httponly=True,secure=settings.session_cookie_secure,samesite='lax',path='/')
 return {'user':userout(u),'csrf_token':csrf}
@app.get('/api/v1/auth/me')
def me(req:Request,u=Depends(current),d:DBS=Depends(db)):
 s=d.get(Session,req.cookies.get('dpo_session','')); return {'user':userout(u),'csrf_token':s.csrf_token}
@app.post('/api/v1/auth/logout')
def logout(req:Request,response:Response,u=Depends(current),d:DBS=Depends(db)):
 s=d.get(Session,req.cookies.get('dpo_session',''))
 if s: d.delete(s); audit(d,u.id,None,'USER_LOGOUT'); d.commit()
 response.delete_cookie('dpo_session',path='/',secure=settings.session_cookie_secure,samesite='lax')
 return {'ok':True}
@app.get('/api/v1/users/me')
def usersme(u=Depends(current)): return userout(u)
@app.post('/api/v1/cases')
def create(x:CreateCase,u=Depends(current),d:DBS=Depends(db)):
 c=Case(user_id=u.id,title=x.title); d.add(c); audit(d,u.id,c.id,'CASE_CREATED'); d.commit(); return caseout(c)
@app.get('/api/v1/cases')
def cases(u=Depends(current),d:DBS=Depends(db)): return [caseout(c) for c in d.query(Case).filter_by(user_id=u.id).order_by(Case.created_at.desc())]
@app.get('/api/v1/cases/{cid}')
def getcase(cid:str,u=Depends(current),d:DBS=Depends(db)): return detail(own(cid,u,d),d)
@app.patch('/api/v1/cases/{cid}')
def rename(cid:str,x:UpdateCase,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); title=x.title.strip()
 if not title or len(title)>300: raise HTTPException(422,detail='Укажите корректное название')
 c.title=title; d.commit(); return caseout(c)
def title_for(text,ctx):
 t=text.lower()
 if 'велосипед' in t:return 'Закупка велосипедов'
 if 'лендинг' in t:return 'Разработка корпоративного лендинга'
 if 'сайт' in t:return 'Разработка корпоративного сайта'
 if ctx.subject and ctx.subject!='Закупка услуг':return ctx.subject[:60]
 return text.strip()[:60]
QUESTIONS={'purpose':'Какова основная цель закупки?','scope':'Уточните, пожалуйста, какой объём требуется: количество товаров, объём работ или перечень услуг?','deadline':'До какой даты необходимо выполнить работы или осуществить поставку?','acceptance_criteria':'Как вы планируете принимать результат: по соответствию требованиям, количеству, срокам или другим критериям?'}
FIELDS=list(QUESTIONS)
@app.post('/api/v1/cases/{cid}/messages')
async def message(cid:str,x:Text,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); d.add(Message(case_id=cid,role='user',content=x.content)); audit(d,u.id,cid,'MESSAGE_SENT'); d.commit()
 s=d.query(TechnicalSpecification).filter_by(case_id=cid).first(); history=d.query(Message).filter_by(case_id=cid).order_by(Message.created_at).all()
 try: result=await orchestrator.process_message(c,u,x.content,history[:-1],s,d)
 except LLMError:
  d.rollback(); d.add(Message(case_id=cid,role='assistant',content='Не удалось обработать запрос. Попробуйте повторить позднее.')); d.commit(); return detail(c,d)
 c.context=result['context']; answer=result['answer']
 if not result['context'].get('is_procurement',True): c.state='ESCALATED_TO_DPO'
 else:
  if c.title=='Новое обращение': c.title=(result['data'].get('subject') or x.content.strip())[:60]
  if not s:
   s=TechnicalSpecification(case_id=cid,data=result['data']); d.add(s); d.flush(); d.add(SpecVersion(spec_id=s.id,version=1,data=result['data']))
  elif result['changed'] and s.status!='CONFIRMED':
   s.data=result['data']
   if result['ready'] and c.state!='SPEC_REVIEW': s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=result['data']))
  c.state='SPEC_REVIEW' if result['ready'] else 'COLLECTING_SPEC_DATA'
 d.add(Message(case_id=cid,role='assistant',content=answer)); d.commit(); return detail(c,d)
@app.patch('/api/v1/cases/{cid}/technical-specification')
def edit(cid:str,x:Changes,u=Depends(current),d:DBS=Depends(db)):
 own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 allowed={'subject','purpose','scope','functional_requirements','nonfunctional_requirements','deadline','acceptance_criteria','other_conditions'}; data=dict(s.data)
 for ch in x.changes:
  if ch.field not in allowed or ch.operation not in {'replace','delete'}: raise HTTPException(422,detail='Недопустимое изменение')
  data[ch.field]='' if ch.operation=='delete' else (ch.value or '')
 s.data=data; s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=data)); audit(d,u.id,cid,'SPEC_UPDATED'); d.commit(); return specout(s)
@app.post('/api/v1/cases/{cid}/technical-specification/confirm')
def confirm(cid:str,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 s.status='CONFIRMED'; r=rec(c,d)
 if not r: c.state='ESCALATED_TO_DPO'; d.commit(); return {'status':'no_match','reason':'Для этого обращения требуется участие специалиста ДПО.'}
 c.state='COMPLETED'; audit(d,u.id,cid,'CONTRACT_SELECTED',{'template_id':r['template_id']}); d.commit(); return {'status':'matched',**r}
@app.get('/api/v1/cases/{cid}/contract-recommendation')
def recommendation(cid:str,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); r=rec(c,d)
 return {'status':'matched',**r} if r else {'status':'no_match','reason':'Для этого обращения требуется участие специалиста ДПО.'}
@app.get('/api/v1/cases/{cid}/technical-specification/download')
def downloadspec(cid:str,u=Depends(current),d:DBS=Depends(db)):
 own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 p=Path(settings.storage)/'generated'/f'{cid}.docx'; p.parent.mkdir(parents=True,exist_ok=True); generate_spec(s.data,p); return FileResponse(p,filename='Техническое_задание.docx')
@app.get('/api/v1/templates/{tid}/download')
def downloadtemplate(tid:str,u=Depends(current),d:DBS=Depends(db)):
 t=d.get(ContractTemplate,tid)
 if not t: raise HTTPException(404,detail='Шаблон не найден')
 return FileResponse(t.path,filename=t.name+'.docx')
@app.post('/api/v1/cases/{cid}/attachments')
async def upload(cid:str,file:UploadFile=File(...),u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); ext=Path(file.filename or '').suffix.lower()
 if ext not in {'.docx','.pdf','.xlsx'}: raise HTTPException(415,detail='Поддерживаются DOCX, PDF и XLSX')
 raw=await file.read()
 if not raw or len(raw)>settings.max_upload: raise HTTPException(422,detail='Файл пустой или слишком большой')
 p=Path(settings.storage)/'uploads'/f'{uid()}{ext}'; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(raw)
 try: text=extract(p,ext)
 except Exception: p.unlink(missing_ok=True); raise HTTPException(422,detail='Не удалось прочитать файл')
 a=Attachment(case_id=cid,original_name=Path(file.filename).name,path=str(p),mime_type=file.content_type or '',extracted_text=text); d.add(a)
 try: result=await orchestrator.analyse_document(c,u,text,d)
 except LLMError:
  d.rollback(); p.unlink(missing_ok=True); raise HTTPException(503,detail='Не удалось обработать запрос. Попробуйте повторить позднее.')
 specdata={k:v for k,v in result.specification.model_dump().items() if k in {'subject','purpose','scope','functional_requirements','nonfunctional_requirements','deadline','acceptance_criteria','other_conditions'}}; c.context=result.context.model_dump(); c.state='SPEC_REVIEW'; s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: s=TechnicalSpecification(case_id=cid,data=specdata); d.add(s); d.flush(); d.add(SpecVersion(spec_id=s.id,version=1,data=s.data))
 elif s.status!='CONFIRMED': s.data=specdata; s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=s.data))
 msg=result.summary+'\n\nПредмет закупки: '+(s.data.get('subject') or 'требуется уточнение')+'\nСрок выполнения: '+(s.data.get('deadline') or 'требуется уточнение')+'\nКритерии приёмки: '+(s.data.get('acceptance_criteria') or 'требуется уточнение')+'\n\nВсё верно? Подтвердите техническое задание или внесите изменения.'; d.add(Message(case_id=cid,role='assistant',content=msg)); audit(d,u.id,cid,'FILE_UPLOADED'); d.commit(); return {'id':a.id,'original_name':a.original_name,'analysis_ready':True,'case':detail(c,d)}
