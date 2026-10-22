"""Versioned contract products and deterministic DOCX variant resolution."""
from __future__ import annotations
import hashlib,re
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DBS
from app.conditions import ConditionConfigurationError,ConditionEngine
from app.calculations import CalculationError
from app.db import *
from app.contract_platform import (DOCX_MIME,FIELD_TYPES,calculated_document_values,condition_answers,formatted_bindings,render_docx,safe_file,schema_for,schema_out,validate_active_answers,validate_bindings,validate_condition_schema,validate_regions,validate_repeating_answers,validate_repeating_groups)

STATES={'SELECTED','NEED_MORE_INFORMATION','NOT_APPLICABLE','MANUAL_REVIEW_REQUIRED','AMBIGUOUS','CONFIGURATION_ERROR'}

def db():
 s=SessionLocal()
 try: yield s
 finally: s.close()
def roles(u): return set(u.roles or [])
def manager(u):
 if not roles(u)&{'dpo_specialist','administrator'}: raise HTTPException(403,detail='Управление договорными продуктами доступно специалистам ДПО')
def publisher(u):
 if not roles(u)&{'template_publisher','administrator'}: raise HTTPException(403,detail='Нет разрешения на публикацию договорного продукта')
def product_owned(pid,u,s):
 x=s.get(ContractProduct,pid)
 if not x or (x.owner_id!=u.id and 'administrator' not in roles(u)): raise HTTPException(404,detail='Договорный продукт не найден')
 return x
def version_owned(pid,vid,u,s):
 p=product_owned(pid,u,s); v=s.get(ContractProductVersion,vid)
 if not v or v.product_id!=p.id: raise HTTPException(404,detail='Версия продукта не найдена')
 return p,v
def draft_version(v):
 if v.status!='DRAFT': raise HTTPException(409,detail='Опубликованная версия продукта неизменяема')
def refs(node):
 if not node:return set()
 if node.get('operator') in {'AND','OR'}: return set().union(*(refs(x) for x in node['conditions']))
 if node.get('operator')=='NOT': return refs(node['condition'])
 return {node.get('field_key')}
def field_out(x): return {'id':x.id,'field_key':x.field_key,'label':x.label,'field_type':x.field_type,'required':x.required,'position':x.position,'config':x.config or {}}
def variant_out(x,s):
 tv=s.get(TemplateVersion,x.template_version_id); t=s.get(DocumentTemplate,tv.template_id) if tv else None
 mappings=[]
 for m in s.query(ContractProductFieldMapping).filter_by(variant_id=x.id).all():
  pf=s.get(ContractProductField,m.product_field_id); tf=s.get(QuestionnaireField,m.target_field_id)
  mappings.append({'id':m.id,'product_field_id':m.product_field_id,'product_field_key':pf.field_key if pf else None,'target_field_id':m.target_field_id,'target_field_key':tf.field_key if tf else None})
 return {'id':x.id,'code':x.code,'name':x.name,'template_version_id':x.template_version_id,'template_name':t.name if t else None,'template_version':tv.version_number if tv else None,'condition':x.selection_condition,'status':x.status,'position':x.position,'mappings':mappings}
def version_out(v,s):
 return {'id':v.id,'product_id':v.product_id,'version_number':v.version_number,'status':v.status,'rules':v.rules or {},'fields':[field_out(x) for x in s.query(ContractProductField).filter_by(product_version_id=v.id).order_by(ContractProductField.position)],'variants':[variant_out(x,s) for x in s.query(ContractProductVariant).filter_by(product_version_id=v.id).order_by(ContractProductVariant.position)]}
def product_out(p,s): return {'id':p.id,'code':p.code,'name':p.name,'description':p.description,'category':p.category,'status':p.status,'current_version_id':p.current_version_id,'version_count':s.query(ContractProductVersion).filter_by(product_id=p.id).count()}

class ContractVariantResolver:
 @classmethod
 def resolve(cls,v,fields,variants,answers):
  try:
   ConditionEngine.validate_schema(fields)
   rules=v.rules or {}
   conditions=[rules.get('applicable_when')]+[x.get('condition') for x in rules.get('blocking_rules',[])]+[x.get('condition') for x in rules.get('manual_review_rules',[])]+[x.selection_condition for x in variants]
   for condition in conditions:
    if condition: ConditionEngine.validate_condition(condition,fields)
  except (ConditionConfigurationError,KeyError,TypeError) as exc: return {'state':'CONFIGURATION_ERROR','reason':'Конфигурация правил повреждена','details':[str(exc)]}
  required=set()
  for condition in conditions: required|=refs(condition)
  missing=sorted(k for k in required if k not in answers or answers.get(k) in (None,''))
  if missing:return {'state':'NEED_MORE_INFORMATION','reason':'Нужны дополнительные сведения для выбора договора','missing_fields':missing}
  if rules.get('applicable_when') and not ConditionEngine.evaluate(rules['applicable_when'],answers): return {'state':'NOT_APPLICABLE','reason':rules.get('not_applicable_message','Условия использования договорного продукта не выполнены')}
  for rule in rules.get('blocking_rules',[]):
   if ConditionEngine.evaluate(rule['condition'],answers): return {'state':'NOT_APPLICABLE','reason':rule.get('message','Автоматическое формирование договора недоступно'),'reason_code':rule.get('code')}
  for rule in rules.get('manual_review_rules',[]):
   if ConditionEngine.evaluate(rule['condition'],answers): return {'state':'MANUAL_REVIEW_REQUIRED','reason':rule.get('message','Требуется проверка специалиста ДПО'),'reason_code':rule.get('code')}
  matched=[x for x in variants if x.status=='ACTIVE' and ConditionEngine.evaluate(x.selection_condition,answers)]
  if len(matched)>1:return {'state':'AMBIGUOUS','reason':'Одновременно подходят несколько вариантов договора','variant_ids':[x.id for x in matched]}
  if not matched:return {'state':'NOT_APPLICABLE','reason':'Ни один утверждённый вариант не соответствует указанным сведениям'}
  return {'state':'SELECTED','reason':f'Выбран вариант «{matched[0].name}»','variant_id':matched[0].id,'template_version_id':matched[0].template_version_id}

def resolve(v,s,answers):
 fields=s.query(ContractProductField).filter_by(product_version_id=v.id).order_by(ContractProductField.position).all(); variants=s.query(ContractProductVariant).filter_by(product_version_id=v.id).all()
 return ContractVariantResolver.resolve(v,fields,variants,answers)
def validate_common(fields,answers,complete=False):
 known={x.field_key for x in fields}
 if set(answers)-known: raise HTTPException(422,detail='Анкета продукта содержит неизвестные поля')
 errors={}
 for f in fields:
  state=ConditionEngine.field_state(f,answers); value=answers.get(f.field_key)
  if complete and state['required'] and value in (None,''):errors[f.field_key]='Обязательное поле'
 return errors
def own_product_draft(id,u,s):
 d=s.get(ContractProductDraft,id)
 if not d or d.owner_id!=u.id:raise HTTPException(404,detail='Черновик продукта не найден')
 return d
def draft_out(d,s):
 v=s.get(ContractProductVersion,d.product_version_id); p=s.get(ContractProduct,v.product_id); decision=resolve(v,s,d.common_answers or {}); variant=s.get(ContractProductVariant,decision.get('variant_id')) if decision.get('variant_id') else None; schema=None
 if variant:
  schema=schema_for(variant.template_version_id,s)
 mapped=[s.get(QuestionnaireField,m.target_field_id).field_key for m in s.query(ContractProductFieldMapping).filter_by(variant_id=variant.id) if s.get(QuestionnaireField,m.target_field_id)] if variant else []
 generated=[{'id':g.id,'generation_number':g.generation_number,'created_at':g.created_at,'download_url':f'/api/v1/generated-documents/{g.id}/download'} for g in s.query(GeneratedDocument).filter_by(product_draft_id=d.id).order_by(GeneratedDocument.created_at.desc())]
 return {'id':d.id,'status':d.status,'product':product_out(p,s),'product_version':v.version_number,'common_answers':d.common_answers or {},'variant_answers':(d.variant_answers or {}).get(variant.id,{}) if variant else {},'decision':decision,'common_fields':[field_out(x) for x in s.query(ContractProductField).filter_by(product_version_id=v.id).order_by(ContractProductField.position)],'selected_variant':variant_out(variant,s) if variant else None,'mapped_field_keys':mapped,'schema':schema_out(schema,s) if schema else None,'generated_documents':generated}

def build_contract_product_router(current_dependency):
 r=APIRouter(tags=['contract-products']); prefix='/api/v1/contract-products'
 @r.get(prefix)
 def products(u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); q=s.query(ContractProduct)
  if 'administrator' not in roles(u):q=q.filter_by(owner_id=u.id)
  return [product_out(x,s) for x in q.order_by(ContractProduct.updated_at.desc())]
 @r.post(prefix,status_code=201)
 def create(payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); code=str(payload.get('code','')).strip().upper(); name=str(payload.get('name','')).strip()
  if not re.fullmatch(r'[A-Z0-9_-]{2,80}',code) or len(name)<2:raise HTTPException(422,detail='Заполните название и корректный код продукта')
  if s.query(ContractProduct).filter_by(owner_id=u.id,code=code).first():raise HTTPException(409,detail='Продукт с таким кодом уже существует')
  p=ContractProduct(owner_id=u.id,code=code,name=name,description=str(payload.get('description','')).strip()[:2000],category=str(payload.get('category','Другое')).strip()[:120]); s.add(p); s.flush(); v=ContractProductVersion(product_id=p.id,version_number=1,created_by_id=u.id,rules={}); s.add(v); s.flush(); s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_CREATED')); s.commit(); out=product_out(p,s); out['version']=version_out(v,s); return out
 @r.patch(prefix+'/{pid}')
 def update_product(pid:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);p=product_owned(pid,u,s)
  if 'name' in payload and len(str(payload['name']).strip())>=2:p.name=str(payload['name']).strip()[:240]
  if 'description' in payload:p.description=str(payload['description']).strip()[:2000]
  if 'category' in payload:p.category=str(payload['category']).strip()[:120]
  s.add(ContractProductAuditEvent(product_id=p.id,actor_id=u.id,event_type='PRODUCT_UPDATED'));s.commit();return product_out(p,s)
 @r.get(prefix+'/{pid}/versions')
 def versions(pid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  p=product_owned(pid,u,s); return [version_out(x,s) for x in s.query(ContractProductVersion).filter_by(product_id=p.id).order_by(ContractProductVersion.version_number.desc())]
 @r.post(prefix+'/{pid}/versions',status_code=201)
 def new_version(pid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); p=product_owned(pid,u,s); previous=s.get(ContractProductVersion,p.current_version_id) if p.current_version_id else None; number=(s.query(ContractProductVersion).filter_by(product_id=p.id).count()+1); v=ContractProductVersion(product_id=p.id,version_number=number,created_by_id=u.id,rules=dict(previous.rules or {}) if previous else {}); s.add(v); s.flush()
  if previous:
   field_map={}
   for old in s.query(ContractProductField).filter_by(product_version_id=previous.id).all():
    x=ContractProductField(product_version_id=v.id,field_key=old.field_key,label=old.label,field_type=old.field_type,required=old.required,position=old.position,config=dict(old.config or {})); s.add(x); s.flush(); field_map[old.id]=x.id
   for old in s.query(ContractProductVariant).filter_by(product_version_id=previous.id).all():
    x=ContractProductVariant(product_version_id=v.id,code=old.code,name=old.name,template_version_id=old.template_version_id,selection_condition=dict(old.selection_condition),status=old.status,position=old.position); s.add(x); s.flush()
    for m in s.query(ContractProductFieldMapping).filter_by(variant_id=old.id):s.add(ContractProductFieldMapping(variant_id=x.id,product_field_id=field_map[m.product_field_id],target_field_id=m.target_field_id))
  s.commit(); return version_out(v,s)
 @r.get(prefix+'/{pid}/versions/{vid}')
 def get_version(pid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  _,v=version_owned(pid,vid,u,s); return version_out(v,s)
 @r.post(prefix+'/{pid}/versions/{vid}/fields',status_code=201)
 def add_field(pid:str,vid:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); p,v=version_owned(pid,vid,u,s); draft_version(v); kind=payload.get('field_type','TEXT'); key=str(payload.get('field_key',''))
  if kind not in FIELD_TYPES or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{1,119}',key):raise HTTPException(422,detail='Некорректный ключ или тип поля')
  x=ContractProductField(product_version_id=v.id,field_key=key,label=str(payload.get('label','')).strip(),field_type=kind,required=bool(payload.get('required')),position=int(payload.get('position',1)),config={'options':payload.get('options',[]),'visible_when':payload.get('visible_when'),'required_when':payload.get('required_when'),'group':payload.get('group','Применимость')}); s.add(x)
  try:s.flush(); ConditionEngine.validate_schema(s.query(ContractProductField).filter_by(product_version_id=v.id).all())
  except Exception as exc:s.rollback(); raise HTTPException(422,detail=str(getattr(exc,'orig',exc)))
  s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_FIELD_CREATED',metadata_json={'field_key':x.field_key}));s.commit(); return field_out(x)
 @r.patch(prefix+'/{pid}/versions/{vid}/rules')
 def rules(pid:str,vid:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); _,v=version_owned(pid,vid,u,s); draft_version(v); fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all()
  try:
   for condition in [payload.get('applicable_when')]+[x.get('condition') for x in payload.get('blocking_rules',[])]+[x.get('condition') for x in payload.get('manual_review_rules',[])]:
    if condition:ConditionEngine.validate_condition(condition,fields)
  except ConditionConfigurationError as exc:raise HTTPException(422,detail=str(exc))
  v.rules=payload;s.add(ContractProductAuditEvent(product_id=v.product_id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_RULES_UPDATED'));s.commit(); return version_out(v,s)
 @r.patch(prefix+'/{pid}/versions/{vid}/fields/{field_id}')
 def update_field(pid:str,vid:str,field_id:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);p,v=version_owned(pid,vid,u,s);draft_version(v);x=s.get(ContractProductField,field_id)
  if not x or x.product_version_id!=v.id:raise HTTPException(404,detail='Общий вопрос не найден')
  for key in ('label','field_type','required','position'):
   if key in payload:setattr(x,key,payload[key])
  cfg=dict(x.config or {})
  for key in ('options','visible_when','required_when','group'):
   if key in payload:cfg[key]=payload[key]
  x.config=cfg
  try:ConditionEngine.validate_schema(s.query(ContractProductField).filter_by(product_version_id=v.id).all())
  except ConditionConfigurationError as exc:s.rollback();raise HTTPException(422,detail=str(exc))
  s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_FIELD_UPDATED',metadata_json={'field_key':x.field_key}));s.commit();return field_out(x)
 @r.delete(prefix+'/{pid}/versions/{vid}/fields/{field_id}',status_code=204)
 def delete_field(pid:str,vid:str,field_id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);p,v=version_owned(pid,vid,u,s);draft_version(v);x=s.get(ContractProductField,field_id)
  if not x or x.product_version_id!=v.id:raise HTTPException(404,detail='Общий вопрос не найден')
  if any(x.field_key in refs(c) for c in [*(z.selection_condition for z in s.query(ContractProductVariant).filter_by(product_version_id=v.id)),(v.rules or {}).get('applicable_when'),*[(z.get('condition')) for z in (v.rules or {}).get('blocking_rules',[])],*[(z.get('condition')) for z in (v.rules or {}).get('manual_review_rules',[])]] if c):raise HTTPException(409,detail='Вопрос используется в правилах применимости')
  s.query(ContractProductFieldMapping).filter_by(product_field_id=x.id).delete();s.delete(x);s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_FIELD_DELETED',metadata_json={'field_key':x.field_key}));s.commit()
 @r.post(prefix+'/{pid}/versions/{vid}/variants',status_code=201)
 def add_variant(pid:str,vid:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); _,v=version_owned(pid,vid,u,s); draft_version(v); tv=s.get(TemplateVersion,payload.get('template_version_id'))
  template=s.get(DocumentTemplate,tv.template_id) if tv else None
  if not tv or tv.status!='PUBLISHED' or not template or (template.owner_id!=u.id and 'administrator' not in roles(u)):raise HTTPException(422,detail='Вариант должен ссылаться на доступную опубликованную версию DOCX')
  fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all()
  try:ConditionEngine.validate_condition(payload.get('condition'),fields)
  except ConditionConfigurationError as exc:raise HTTPException(422,detail=str(exc))
  x=ContractProductVariant(product_version_id=v.id,code=str(payload.get('code','')).upper(),name=str(payload.get('name','')).strip(),template_version_id=tv.id,selection_condition=payload['condition'],position=int(payload.get('position',1)));s.add(x);s.flush();s.add(ContractProductAuditEvent(product_id=v.product_id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_VARIANT_CREATED',metadata_json={'variant_id':x.id}));s.commit(); return variant_out(x,s)
 @r.put(prefix+'/{pid}/versions/{vid}/variants/{variant_id}/mappings/{field_id}')
 def map_field(pid:str,vid:str,variant_id:str,field_id:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); _,v=version_owned(pid,vid,u,s); draft_version(v); variant=s.get(ContractProductVariant,variant_id); pf=s.get(ContractProductField,field_id); tf=s.get(QuestionnaireField,payload.get('target_field_id'))
  schema=schema_for(variant.template_version_id,s) if variant else None
  if not variant or variant.product_version_id!=v.id or not pf or pf.product_version_id!=v.id or not tf or not schema or tf.schema_id!=schema.id:raise HTTPException(404,detail='Поле или вариант не найден')
  compatible=pf.field_type==tf.field_type or {pf.field_type,tf.field_type}<={'INTEGER','DECIMAL','MONEY'}
  if not compatible:raise HTTPException(422,detail='Типы общего и вариантного поля несовместимы')
  x=s.query(ContractProductFieldMapping).filter_by(variant_id=variant.id,product_field_id=pf.id).first()
  if x:x.target_field_id=tf.id
  else:x=ContractProductFieldMapping(variant_id=variant.id,product_field_id=pf.id,target_field_id=tf.id);s.add(x)
  s.add(ContractProductAuditEvent(product_id=v.product_id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_MAPPING_UPDATED',metadata_json={'variant_id':variant.id,'field_key':pf.field_key}));s.commit(); return variant_out(variant,s)
 @r.patch(prefix+'/{pid}/versions/{vid}/variants/{variant_id}')
 def update_variant(pid:str,vid:str,variant_id:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);p,v=version_owned(pid,vid,u,s);draft_version(v);x=s.get(ContractProductVariant,variant_id);fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all()
  if not x or x.product_version_id!=v.id:raise HTTPException(404,detail='Вариант не найден')
  condition=payload.get('condition',x.selection_condition)
  try:ConditionEngine.validate_condition(condition,fields)
  except ConditionConfigurationError as exc:raise HTTPException(422,detail=str(exc))
  x.selection_condition=condition
  for key in ('name','status','position'):
   if key in payload:setattr(x,key,payload[key])
  s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_VARIANT_UPDATED',metadata_json={'variant_id':x.id}));s.commit();return variant_out(x,s)
 @r.delete(prefix+'/{pid}/versions/{vid}/variants/{variant_id}',status_code=204)
 def delete_variant(pid:str,vid:str,variant_id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);p,v=version_owned(pid,vid,u,s);draft_version(v);x=s.get(ContractProductVariant,variant_id)
  if not x or x.product_version_id!=v.id:raise HTTPException(404,detail='Вариант не найден')
  s.query(ContractProductFieldMapping).filter_by(variant_id=x.id).delete();s.delete(x);s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_VARIANT_DELETED',metadata_json={'variant_id':variant_id}));s.commit()
 @r.delete(prefix+'/{pid}/versions/{vid}/variants/{variant_id}/mappings/{field_id}',status_code=204)
 def delete_mapping(pid:str,vid:str,variant_id:str,field_id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u);_,v=version_owned(pid,vid,u,s);draft_version(v);x=s.query(ContractProductFieldMapping).filter_by(variant_id=variant_id,product_field_id=field_id).first()
  if not x:raise HTTPException(404,detail='Сопоставление не найдено')
  s.delete(x);s.commit()
 @r.post(prefix+'/{pid}/versions/{vid}/resolve')
 def preview(pid:str,vid:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  _,v=version_owned(pid,vid,u,s); return resolve(v,s,payload.get('answers') or {})
 @r.post(prefix+'/{pid}/versions/{vid}/publish')
 def publish(pid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  manager(u); publisher(u); p,v=version_owned(pid,vid,u,s); draft_version(v); fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all(); variants=s.query(ContractProductVariant).filter_by(product_version_id=v.id,status='ACTIVE').all()
  if not fields or len(variants)<2:raise HTTPException(422,detail='Добавьте общие вопросы и не менее двух вариантов')
  result=resolve(v,s,{})
  if result['state']=='CONFIGURATION_ERROR':raise HTTPException(422,detail=result['reason'])
  for x in variants:
   tv=s.get(TemplateVersion,x.template_version_id); schema=schema_for(tv.id,s) if tv else None
   if not tv or tv.status!='PUBLISHED' or not schema or schema.status!='PUBLISHED':raise HTTPException(422,detail=f'Вариант «{x.name}» не готов к использованию')
   mappings=s.query(ContractProductFieldMapping).filter_by(variant_id=x.id).all()
   for m in mappings:
    pf=s.get(ContractProductField,m.product_field_id);tf=s.get(QuestionnaireField,m.target_field_id)
    if not pf or not tf or (pf.field_type!=tf.field_type and not {pf.field_type,tf.field_type}<={'INTEGER','DECIMAL','MONEY'}):raise HTTPException(422,detail=f'Сопоставление варианта «{x.name}» повреждено')
  scenarios=(v.rules or {}).get('test_scenarios',[])
  if not scenarios:raise HTTPException(422,detail='Добавьте контрольные сценарии применимости')
  for scenario in scenarios:
   actual=resolve(v,s,scenario.get('answers',{}))['state']
   if actual!=scenario.get('expected_state'):raise HTTPException(422,detail=f'Сценарий «{scenario.get("name","Без названия")}» завершился состоянием {actual}')
  for old in s.query(ContractProductVersion).filter_by(product_id=p.id,status='PUBLISHED'):old.status='SUPERSEDED'
  v.status='PUBLISHED';v.published_by_id=u.id;v.published_at=now();p.status='ACTIVE';p.current_version_id=v.id;s.add(ContractProductAuditEvent(product_id=p.id,product_version_id=v.id,actor_id=u.id,event_type='PRODUCT_VERSION_PUBLISHED'));s.commit();return version_out(v,s)
 @r.get('/api/v1/contract-product-catalog')
 def catalog(u=Depends(current_dependency),s:DBS=Depends(db)):
  return [product_out(x,s) for x in s.query(ContractProduct).filter_by(status='ACTIVE').filter(ContractProduct.current_version_id.is_not(None)).order_by(ContractProduct.name)]
 @r.post('/api/v1/contract-product-drafts',status_code=201)
 def create_draft(payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  p=s.get(ContractProduct,payload.get('product_id'))
  if not p or p.status!='ACTIVE' or not p.current_version_id:raise HTTPException(404,detail='Опубликованный договорный продукт не найден')
  d=ContractProductDraft(owner_id=u.id,product_version_id=p.current_version_id);s.add(d);s.commit();return draft_out(d,s)
 @r.get('/api/v1/contract-product-drafts')
 def drafts(u=Depends(current_dependency),s:DBS=Depends(db)):
  return [{'id':d.id,'product_name':s.get(ContractProduct,s.get(ContractProductVersion,d.product_version_id).product_id).name,'status':d.status,'decision':d.decision_snapshot,'updated_at':d.updated_at} for d in s.query(ContractProductDraft).filter_by(owner_id=u.id).order_by(ContractProductDraft.updated_at.desc())]
 @r.get('/api/v1/contract-product-drafts/{id}')
 def get_draft(id:str,u=Depends(current_dependency),s:DBS=Depends(db)):return draft_out(own_product_draft(id,u,s),s)
 @r.patch('/api/v1/contract-product-drafts/{id}')
 def save_draft(id:str,payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  d=own_product_draft(id,u,s);v=s.get(ContractProductVersion,d.product_version_id);fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all();common=payload.get('common_answers',d.common_answers or {});validate_common(fields,common);decision=resolve(v,s,common);old=d.selected_variant_id;d.common_answers=common;incoming=payload.get('variant_answers');all_answers=dict(d.variant_answers or {})
  if incoming is not None and old:all_answers[old]=incoming
  d.variant_answers=all_answers
  if decision['state']=='SELECTED':
   variant=s.get(ContractProductVariant,decision['variant_id']);d.selected_variant_id=variant.id;d.selected_template_version_id=variant.template_version_id
  else:d.selected_variant_id=None;d.selected_template_version_id=None
  if old!=d.selected_variant_id:d.status='DRAFT'
  d.decision_snapshot=decision;d.updated_at=now();s.commit();return draft_out(d,s)
 @r.post('/api/v1/contract-product-drafts/{id}/generate',status_code=201)
 def generate(id:str,payload:dict|None=None,u=Depends(current_dependency),s:DBS=Depends(db)):
  d=own_product_draft(id,u,s);v=s.get(ContractProductVersion,d.product_version_id);fields=s.query(ContractProductField).filter_by(product_version_id=v.id).all();errors=validate_common(fields,d.common_answers or {},True);decision=resolve(v,s,d.common_answers or {})
  if errors:raise HTTPException(422,detail={'message':'Заполните обязательные сведения','fields':errors})
  if decision['state']!='SELECTED':raise HTTPException(409,detail={'message':decision['reason'],'decision':decision})
  variant=s.get(ContractProductVariant,decision['variant_id']);tv=s.get(TemplateVersion,variant.template_version_id);schema=schema_for(tv.id,s);answers=dict((d.variant_answers or {}).get(variant.id,{}))
  for m in s.query(ContractProductFieldMapping).filter_by(variant_id=variant.id):
   pf=s.get(ContractProductField,m.product_field_id);tf=s.get(QuestionnaireField,m.target_field_id);answers[tf.field_key]=(d.common_answers or {}).get(pf.field_key)
  qfields=s.query(QuestionnaireField).filter_by(schema_id=schema.id).all();validate_condition_schema(qfields);qerrors=validate_active_answers(qfields,answers);groups=s.query(RepeatingGroup).filter_by(template_version_id=tv.id,status='ACTIVE').all();qerrors.update(validate_repeating_answers(groups,s,qfields,answers,True))
  if qerrors:raise HTTPException(422,detail={'message':'Заполните вопросы выбранного варианта','fields':qerrors})
  bindings=validate_bindings(tv,s);regions=validate_regions(tv,s,bindings);groups=validate_repeating_groups(tv,s,bindings,regions);active={x.field_key for x in ConditionEngine.active_fields(qfields,answers)};bindings=[x for x in bindings if x.binding_key in active];legal=condition_answers(qfields,answers);included={x.id for x in regions if ConditionEngine.evaluate(x.include_when,legal)};groups,values,repeated=calculated_document_values(tv.id,s,qfields,answers);formatted=formatted_bindings(bindings,values,qfields);group_fields={x.id:x.fields for x in groups}
  child=DocumentDraft(owner_id=u.id,template_version_id=tv.id,questionnaire_schema_id=schema.id,answers=answers,status='GENERATED');s.add(child);s.flush();root=(Path(settings.storage)/'generated_contracts'/child.id).resolve();root.mkdir(parents=True,exist_ok=True);target=root/'1.docx'
  try:render_docx(tv,bindings,formatted,target,regions,included,groups,repeated,group_fields)
  except (ValueError,IndexError,KeyError,CalculationError) as exc:s.rollback();raise HTTPException(422,detail=f'Не удалось безопасно сформировать DOCX: {exc}')
  raw=target.read_bytes();number=s.query(GeneratedDocument).filter_by(product_draft_id=d.id).count()+1;g=GeneratedDocument(draft_id=child.id,template_version_id=tv.id,product_draft_id=d.id,product_version_id=v.id,product_variant_id=variant.id,generation_number=number,path=str(target),sha256=hashlib.sha256(raw).hexdigest(),mime_type=DOCX_MIME,size=len(raw),created_by_id=u.id);s.add(g);d.status='GENERATED';d.decision_snapshot=decision;s.commit();return {'id':g.id,'generation_number':number,'variant_name':variant.name,'download_url':f'/api/v1/generated-documents/{g.id}/download'}
 return r
