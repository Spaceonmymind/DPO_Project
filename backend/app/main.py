import hmac
import hashlib
import logging
import os
from datetime import timedelta, timezone
from pathlib import Path
from fastapi import FastAPI,Depends,HTTPException,UploadFile,File,Request,Response,Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBS
from sqlalchemy import or_
from app.db import *
from app.ai.orchestrator import AIOrchestrator
from app.ai.config import get_llm_settings
from app.ai.errors import LLMError
from app.documents.service import extract,render_specification,SpreadsheetSpecificationParser
from app.contracts import select_contract
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
def contextout(c,d):
 p=d.query(ProcurementContextRecord).filter_by(case_id=c.id).first()
 return p.data if p else (c.context or {})
def rec(c,d):
 stored=d.query(ContractRecommendation).filter_by(case_id=c.id).first()
 if stored:
  template=d.get(ContractTemplate,stored.template_id) if stored.template_id else None
  return {'status':stored.status,'reason':stored.reason,'rules_triggered':stored.rules_triggered,'template_id':template.id if template else None,'template_code':stored.template_code,'template_title':stored.template_title,'name':template.name if template else stored.template_title,'description':template.description if template else None,'filename':template.filename if template else None,'file_format':template.file_format if template else None}
 decision=select_contract(d,contextout(c,d))
 if decision.status!='MATCHED': return None
 return {'status':'MATCHED','reason':decision.reason,'rules_triggered':decision.rules_triggered,'template_id':decision.template.id,'template_code':decision.template.code,'template_title':decision.template.name,'name':decision.template.name,'description':decision.template.description,'filename':decision.template.filename,'file_format':decision.template.file_format}
def detail(c,d):
 out=caseout(c); out['messages']=[{'id':m.id,'role':m.role,'content':m.content,'created_at':m.created_at} for m in d.query(Message).filter_by(case_id=c.id).order_by(Message.created_at)]; s=d.query(TechnicalSpecification).filter_by(case_id=c.id).first(); out['technical_specification']=specout(s) if s else None; out['procurement_context']=contextout(c,d); out['recommendation']=rec(c,d); out['attachment']=({'id':a.id,'original_name':a.original_name} if (a:=d.query(Attachment).filter_by(case_id=c.id).first()) else None); return out
class Login(BaseModel): external_id:str; password:str
class CreateCase(BaseModel): title:str='Новое обращение'; initial_intent:str='GENERAL_PROCUREMENT_DIALOGUE'
class UpdateCase(BaseModel): title:str
class Text(BaseModel): content:str
class Change(BaseModel): field:str; operation:str='replace'; value:object|None=None
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
 allowed={'GET_CONTRACT','CREATE_SPECIFICATION','ANALYZE_SPECIFICATION','CREATE_SPEC_AND_GET_CONTRACT','GENERAL_PROCUREMENT_DIALOGUE'}
 intent=x.initial_intent.upper() if x.initial_intent.upper() in allowed else 'GENERAL_PROCUREMENT_DIALOGUE'
 c=Case(user_id=u.id,title=x.title,context={'intent':intent}); d.add(c); d.flush(); d.add(ProcurementContextRecord(case_id=c.id,intent=intent,data={'intent':intent,'is_procurement':True,'missing_fields':[]})); audit(d,u.id,c.id,'CASE_CREATED',{'initial_intent':intent}); d.commit(); return caseout(c)
@app.get('/api/v1/cases')
def cases(q:str|None=Query(default=None,max_length=200),u=Depends(current),d:DBS=Depends(db)):
 query=d.query(Case).outerjoin(ProcurementContextRecord,ProcurementContextRecord.case_id==Case.id).filter(Case.user_id==u.id)
 if q and q.strip():
  pattern=f'%{q.strip()}%'; own_message_cases=d.query(Message.case_id).join(Case,Case.id==Message.case_id).filter(Case.user_id==u.id,Message.content.ilike(pattern))
  query=query.filter(or_(Case.title.ilike(pattern),ProcurementContextRecord.subject.ilike(pattern),Case.id.in_(own_message_cases)))
 return [caseout(c) for c in query.order_by(Case.created_at.desc()).distinct()]
@app.get('/api/v1/cases/{cid}')
def getcase(cid:str,u=Depends(current),d:DBS=Depends(db)): return detail(own(cid,u,d),d)
@app.patch('/api/v1/cases/{cid}')
def rename(cid:str,x:UpdateCase,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); title=x.title.strip()
 if not title or len(title)>300: raise HTTPException(422,detail='Укажите корректное название')
 c.title=title; d.commit(); return caseout(c)
@app.delete('/api/v1/cases/{cid}',status_code=204)
def delete_case(cid:str,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); attachments=d.query(Attachment).filter_by(case_id=cid).all(); spec=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 for attachment in attachments:
  try:
   path=Path(attachment.path).resolve(); root=Path(settings.storage).resolve()
   if path.is_relative_to(root): path.unlink(missing_ok=True)
  except OSError: log.exception('Failed to remove attachment for case=%s',cid)
 if spec: d.query(SpecVersion).filter_by(spec_id=spec.id).delete(); d.delete(spec)
 d.query(Message).filter_by(case_id=cid).delete(); d.query(Attachment).filter_by(case_id=cid).delete(); d.query(ProcurementContextRecord).filter_by(case_id=cid).delete(); d.query(ContractRecommendation).filter_by(case_id=cid).delete(); d.query(AuditEvent).filter_by(case_id=cid).delete(); d.query(AIRun).filter_by(case_id=cid).delete()
 for path in (Path(settings.storage)/'generated').glob(f'{cid}.*'): path.unlink(missing_ok=True)
 d.flush(); d.delete(c); d.commit(); return Response(status_code=204)
def title_for(text,ctx):
 t=text.lower()
 if 'велосипед' in t:return 'Закупка велосипедов'
 if 'лендинг' in t:return 'Разработка корпоративного лендинга'
 if 'сайт' in t:return 'Разработка корпоративного сайта'
 if ctx.subject and ctx.subject!='Закупка услуг':return ctx.subject[:60]
 return text.strip()[:60]
QUESTIONS={'purpose':'Какова основная цель закупки?','scope':'Уточните, пожалуйста, какой объём требуется: количество товаров, объём работ или перечень услуг?','deadline':'До какой даты необходимо выполнить работы или осуществить поставку?','acceptance_criteria':'Как вы планируете принимать результат: по соответствию требованиям, количеству, срокам или другим критериям?'}
FIELDS=list(QUESTIONS)
def save_context(c,data,d):
 p=d.query(ProcurementContextRecord).filter_by(case_id=c.id).first()
 if not p: p=ProcurementContextRecord(case_id=c.id); d.add(p)
 p.intent=data.get('intent','GENERAL_PROCUREMENT_DIALOGUE'); p.subject=data.get('subject',''); p.category=data.get('category',''); p.data=data; p.missing_fields=data.get('missing_fields',[]); p.source_confidence=data.get('source_confidence'); c.context={'intent':p.intent,'subject':p.subject,'category':p.category}
 return p
def apply_contract_decision(c,context,d):
 decision=select_contract(d,context); stored=d.query(ContractRecommendation).filter_by(case_id=c.id).first()
 if not stored: stored=ContractRecommendation(case_id=c.id,status=decision.status,reason=decision.reason); d.add(stored)
 stored.status=decision.status; stored.reason=decision.reason; stored.template_id=decision.template.id if decision.template else None
 stored.template_code=decision.template.code if decision.template else ''; stored.template_title=decision.template.name if decision.template else ''; stored.rules_triggered=decision.rules_triggered
 if decision.status=='MATCHED': c.state='COMPLETED'
 elif decision.status in {'NO_MATCH','LEGAL_REVIEW_REQUIRED'}: c.state='ESCALATED_TO_DPO'
 return decision
@app.post('/api/v1/cases/{cid}/messages')
async def message(cid:str,x:Text,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); d.add(Message(case_id=cid,role='user',content=x.content)); audit(d,u.id,cid,'MESSAGE_SENT'); d.commit()
 s=d.query(TechnicalSpecification).filter_by(case_id=cid).first(); p=d.query(ProcurementContextRecord).filter_by(case_id=cid).first(); history=d.query(Message).filter_by(case_id=cid).order_by(Message.created_at).all()
 try: result=await orchestrator.process_message(c,u,x.content,history[:-1],s,d,p)
 except LLMError:
  d.rollback(); d.add(Message(case_id=cid,role='assistant',content='Не удалось обработать запрос. Попробуйте повторить позднее.')); d.commit(); return detail(c,d)
 context=result['context']; save_context(c,context,d); answer=result['answer']
 if not result['context'].get('is_procurement',True): c.state='ESCALATED_TO_DPO'
 else:
  if c.title=='Новое обращение': c.title=(context.get('subject') or x.content.strip())[:60]
  if result['create_spec']:
   data=result['spec_data']
   if not s: s=TechnicalSpecification(case_id=cid,data=data); d.add(s); d.flush(); d.add(SpecVersion(spec_id=s.id,version=1,data=data))
   elif result['changed'] and s.status!='CONFIRMED':
    was_incomplete=any(not s.data.get(field) for field in ('purpose','scope','deadline','acceptance_criteria')); s.data=data
    if not context.get('missing_fields') or not was_incomplete:
     s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=data))
   c.state='SPEC_REVIEW' if not context.get('missing_fields') else 'COLLECTING_SPEC_DATA'
  elif context.get('missing_fields'): c.state='COLLECTING_SPEC_DATA'
  if result['run_contract']:
   decision=apply_contract_decision(c,context,d)
   if decision.status=='MATCHED': answer=f'Подходящий шаблон найден: {decision.template.name}. {decision.reason}'
   elif decision.status=='AMBIGUOUS': answer=decision.reason
   else: answer='Для этого обращения требуется участие специалиста ДПО.'
 d.add(Message(case_id=cid,role='assistant',content=answer)); d.commit(); return detail(c,d)
@app.patch('/api/v1/cases/{cid}/technical-specification')
def edit(cid:str,x:Changes,u=Depends(current),d:DBS=Depends(db)):
 own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 allowed={'subject','purpose','scope','functional_requirements','nonfunctional_requirements','deadline','acceptance_criteria','other_conditions','items','common_requirements','blocking_requirements','additional_conditions','delivery_terms','total_amount'}; data=dict(s.data)
 for ch in x.changes:
  if ch.field not in allowed or ch.operation not in {'replace','delete'}: raise HTTPException(422,detail='Недопустимое изменение')
  data[ch.field]=([] if ch.field in {'items','common_requirements','blocking_requirements','additional_conditions'} else '') if ch.operation=='delete' else ch.value
 s.data=data; s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=data)); audit(d,u.id,cid,'SPEC_UPDATED'); d.commit(); return specout(s)
@app.post('/api/v1/cases/{cid}/technical-specification/confirm')
def confirm(cid:str,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 s.status='CONFIRMED'; context=contextout(c,d); decision=apply_contract_decision(c,context,d)
 if decision.status!='MATCHED': d.commit(); return {'status':decision.status.lower(),'reason':decision.reason,'rules_triggered':decision.rules_triggered}
 audit(d,u.id,cid,'CONTRACT_SELECTED',{'template_id':decision.template.id}); d.commit(); return {'status':'matched','template_id':decision.template.id,'template_code':decision.template.code,'template_title':decision.template.name,'name':decision.template.name,'description':decision.template.description,'filename':decision.template.filename,'file_format':decision.template.file_format,'reason':decision.reason,'rules_triggered':decision.rules_triggered}
@app.get('/api/v1/cases/{cid}/contract-recommendation')
def recommendation(cid:str,u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); decision=apply_contract_decision(c,contextout(c,d),d); d.commit()
 if decision.status=='MATCHED': return {'status':'matched','template_id':decision.template.id,'template_code':decision.template.code,'template_title':decision.template.name,'name':decision.template.name,'description':decision.template.description,'filename':decision.template.filename,'file_format':decision.template.file_format,'reason':decision.reason,'rules_triggered':decision.rules_triggered}
 return {'status':decision.status.lower(),'reason':decision.reason,'missing_fields':decision.missing_fields,'rules_triggered':decision.rules_triggered}
@app.get('/api/v1/cases/{cid}/technical-specification/download')
def downloadspec(cid:str,format:str='docx',u=Depends(current),d:DBS=Depends(db)):
 own(cid,u,d); s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: raise HTTPException(404,detail='Техническое задание не создано')
 fmt=format.lower();
 if fmt not in {'docx','pdf','xlsx'}: raise HTTPException(422,detail='Доступны DOCX, PDF и XLSX')
 p=Path(settings.storage)/'generated'/f'{cid}.{fmt}'; p.parent.mkdir(parents=True,exist_ok=True); render_specification(s.data,p,fmt); media={'docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','pdf':'application/pdf','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[fmt]; return FileResponse(p,filename=f'Техническое_задание.{fmt}',media_type=media)
@app.get('/api/v1/cases/{cid}/contract-template')
def downloadtemplate(cid:str,u=Depends(current),d:DBS=Depends(db)):
 own(cid,u,d); recommendation=d.query(ContractRecommendation).filter_by(case_id=cid,status='MATCHED').first()
 if not recommendation or not recommendation.template_id: raise HTTPException(404,detail='Для обращения нет выбранного шаблона')
 template=d.get(ContractTemplate,recommendation.template_id)
 if not template or not template.active: raise HTTPException(404,detail='Шаблон недоступен')
 root=Path(settings.contract_templates_path).resolve(); path=Path(template.path).resolve()
 if not path.is_relative_to(root) or not path.is_file(): raise HTTPException(404,detail='Файл шаблона недоступен')
 digest=hashlib.sha256(path.read_bytes()).hexdigest()
 if not hmac.compare_digest(digest,template.checksum_sha256): raise HTTPException(409,detail='Нарушена целостность шаблона')
 media={'docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','rtf':'application/rtf'}.get(template.file_format,'application/octet-stream')
 return FileResponse(path,filename=template.filename,media_type=media)
@app.post('/api/v1/cases/{cid}/attachments')
async def upload(cid:str,file:UploadFile=File(...),u=Depends(current),d:DBS=Depends(db)):
 c=own(cid,u,d); ext=Path(file.filename or '').suffix.lower()
 if d.query(Attachment).filter_by(case_id=cid).first(): raise HTTPException(409,detail='В обращении уже есть загруженный документ.')
 if ext not in {'.docx','.pdf','.xlsx','.xls'}: raise HTTPException(415,detail='Поддерживаются DOCX, PDF, XLSX и XLS')
 raw=await file.read()
 if not raw or len(raw)>settings.max_upload: raise HTTPException(422,detail='Файл пустой или слишком большой')
 p=Path(settings.storage)/'uploads'/f'{uid()}{ext}'; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(raw)
 try:
  structured=SpreadsheetSpecificationParser().parse(p,ext) if ext in {'.xlsx','.xls'} else None
  text=extract(p,ext)
 except Exception: p.unlink(missing_ok=True); raise HTTPException(422,detail='Не удалось прочитать файл')
 a=Attachment(case_id=cid,original_name=Path(file.filename).name,path=str(p),mime_type=file.content_type or '',extracted_text=text); d.add(a)
 try: result,specdata=await orchestrator.analyse_document(c,u,text,d,structured)
 except LLMError:
  d.rollback(); p.unlink(missing_ok=True); raise HTTPException(503,detail='Не удалось обработать запрос. Попробуйте повторить позднее.')
 context=result.context.model_dump(); save_context(c,context,d); c.state='SPEC_REVIEW'; s=d.query(TechnicalSpecification).filter_by(case_id=cid).first()
 if not s: s=TechnicalSpecification(case_id=cid,data=specdata); d.add(s); d.flush(); d.add(SpecVersion(spec_id=s.id,version=1,data=s.data))
 elif s.status!='CONFIRMED': s.data=specdata; s.version+=1; d.add(SpecVersion(spec_id=s.id,version=s.version,data=s.data))
 items=f"\nПозиции: {len(s.data.get('items',[]))}." if s.data.get('items') else ''
 msg=result.summary+'\n\nПредмет закупки: '+(s.data.get('subject') or 'требуется уточнение')+items+'\nСрок выполнения: '+(s.data.get('deadline') or s.data.get('delivery_terms') or 'требуется уточнение')+'\n\nВсё верно? Подтвердите техническое задание или напишите, что нужно исправить.'; d.add(Message(case_id=cid,role='assistant',content=msg)); audit(d,u.id,cid,'FILE_UPLOADED'); d.commit(); return {'id':a.id,'original_name':a.original_name,'analysis_ready':True,'case':detail(c,d)}
