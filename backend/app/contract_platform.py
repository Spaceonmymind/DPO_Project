"""Deterministic, non-AI contract-template platform."""
from __future__ import annotations
import hashlib,re,zipfile
from abc import ABC,abstractmethod
from datetime import date
from decimal import Decimal,InvalidOperation
from io import BytesIO
from pathlib import Path
from typing import Any,Callable
from xml.etree import ElementTree as ET
from fastapi import APIRouter,Depends,File,HTTPException,UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel,Field
from sqlalchemy.orm import Session as DBS
from app.db import DocumentBinding,DocumentDraft,DocumentTemplate,GeneratedDocument,QuestionnaireField,QuestionnaireSchema,SessionLocal,TemplateAuditEvent,TemplateVersion,now,settings

DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document'; DOCX_MIMES={DOCX_MIME,'application/octet-stream','application/zip'}
WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; NS={'w':WORD_NS}; FIELD_TYPES={'TEXT','MULTILINE_TEXT','INTEGER','DECIMAL','MONEY','DATE','BOOLEAN','SINGLE_SELECT'}

def db():
 s=SessionLocal()
 try: yield s
 finally: s.close()
def roles(u): return set(u.roles or [])
def require_manager(u):
 if not roles(u)&{'dpo_specialist','administrator'}: raise HTTPException(403,detail='Управление шаблонами доступно специалистам ДПО')
def require_publisher(u):
 if not roles(u)&{'template_publisher','administrator'}: raise HTTPException(403,detail='Нет разрешения на публикацию шаблонов')
def require_draft(v):
 if v.status!='DRAFT': raise HTTPException(409,detail='Опубликованная версия неизменяема. Загрузите новую версию DOCX.')
def owned_template(id,u,s):
 x=s.get(DocumentTemplate,id)
 if not x or (x.owner_id!=u.id and 'administrator' not in roles(u)): raise HTTPException(404,detail='Шаблон не найден')
 return x
def owned_version(id,u,s):
 v=s.get(TemplateVersion,id)
 if not v: raise HTTPException(404,detail='Версия не найдена')
 return v,owned_template(v.template_id,u,s)
def own_draft(id,u,s):
 x=s.get(DocumentDraft,id)
 if not x or x.owner_id!=u.id: raise HTTPException(404,detail='Черновик не найден')
 return x
def safe_file(value,root_name,checksum):
 root=(Path(settings.storage)/root_name).resolve(); path=Path(value).resolve()
 if not path.is_relative_to(root) or not path.is_file(): raise HTTPException(404,detail='Файл недоступен')
 if hashlib.sha256(path.read_bytes()).hexdigest()!=checksum: raise HTTPException(409,detail='Нарушена целостность файла')
 return path
def safe_source(v): return safe_file(v.source_path,'template_sources',v.source_sha256)
def validate_docx(filename,mime,raw):
 if Path(filename).suffix.lower()!='.docx': raise HTTPException(415,detail='Поддерживается только DOCX')
 if mime and mime.lower() not in DOCX_MIMES: raise HTTPException(415,detail='Некорректный MIME-тип DOCX')
 if not raw: raise HTTPException(422,detail='Файл пустой')
 if len(raw)>settings.max_upload: raise HTTPException(413,detail='Файл превышает допустимый размер')
 try:
  with zipfile.ZipFile(BytesIO(raw)) as z:
   infos=z.infolist(); names={x.filename for x in infos}
   if len(infos)>5000 or sum(x.file_size for x in infos)>200*1024*1024: raise HTTPException(422,detail='DOCX содержит слишком много данных')
   if any(Path(x.filename).is_absolute() or '..' in Path(x.filename).parts for x in infos): raise HTTPException(422,detail='DOCX содержит небезопасные пути')
   if '[Content_Types].xml' not in names or 'word/document.xml' not in names or z.testzip() is not None: raise HTTPException(422,detail='Файл не имеет корректной структуры DOCX')
   ET.fromstring(z.read('word/document.xml'))
 except HTTPException: raise
 except (zipfile.BadZipFile,KeyError,ET.ParseError): raise HTTPException(422,detail='Файл не имеет корректной структуры DOCX')

class DocumentEditorAdapter(ABC):
 @abstractmethod
 def preview(self,path:Path)->dict[str,Any]: ...
 @abstractmethod
 def select_range(self,path:Path,locator:str,start:int,end:int,text:str)->dict[str,Any]: ...
 @abstractmethod
 def get_structural_locator(self,path:Path,selection:dict[str,Any])->dict[str,Any]: ...
class DocxXmlAdapter(DocumentEditorAdapter):
 def _parts(self,z): return [(x,ET.fromstring(z.read(x))) for x in ['word/document.xml']+sorted(n for n in z.namelist() if re.fullmatch(r'word/(?:header|footer)\d+\.xml',n))]
 def _runs(self,p): return [''.join(x.text or '' for x in r.findall('.//w:t',NS)) for r in p.findall('./w:r',NS)]
 def _node(self,part,locator,kind,text,runs,meta):
  result=[]; pos=0
  for i,value in enumerate(runs,1): result.append({'run':i,'start':pos,'end':pos+len(value)}); pos+=len(value)
  return {'part':part,'locator':locator,'kind':kind,'text':text,'runs':result,'metadata':meta}
 def preview(self,path):
  nodes=[]
  with zipfile.ZipFile(path) as z:
   for part,root in self._parts(z):
    body=root.find('w:body',NS) if part=='word/document.xml' else root
    if body is None: continue
    pno=tno=0
    for child in list(body):
     if child.tag==f'{{{WORD_NS}}}p':
      pno+=1; runs=self._runs(child); text=''.join(runs)
      if text.strip(): nodes.append(self._node(part,f'{part}#/p[{pno}]','paragraph',text,runs,{}))
     elif child.tag==f'{{{WORD_NS}}}tbl':
      tno+=1
      for rno,row in enumerate(child.findall('./w:tr',NS),1):
       for cno,cell in enumerate(row.findall('./w:tc',NS),1):
        props=cell.find('./w:tcPr',NS); grid=props.find('./w:gridSpan',NS) if props is not None else None; merge=props.find('./w:vMerge',NS) if props is not None else None
        meta={'table':tno,'row':rno,'cell':cno,'grid_span':int(grid.get(f'{{{WORD_NS}}}val','1')) if grid is not None else 1,'vertical_merge':merge.get(f'{{{WORD_NS}}}val','continue') if merge is not None else None}
        for cpno,p in enumerate(cell.findall('./w:p',NS),1):
         runs=self._runs(p); text=''.join(runs)
         if text.strip(): nodes.append(self._node(part,f'{part}#/tbl[{tno}]/tr[{rno}]/tc[{cno}]/p[{cpno}]','table_cell',text,runs,meta))
  fp=hashlib.sha256('\n'.join(x['locator']+'\0'+x['text'] for x in nodes).encode()).hexdigest()
  return {'adapter':'DOCX_XML_READ_ONLY','locator_version':1,'structure_fingerprint':fp,'nodes':nodes,'limitations':['Разметка страницы отображается приблизительно.','Выделение поддерживается только внутри одного абзаца или ячейки.']}
 def select_range(self,path,locator,start,end,text):
  preview=self.preview(path); node=next((x for x in preview['nodes'] if x['locator']==locator),None)
  if not node: raise ValueError('Структурный фрагмент не найден в исходном DOCX.')
  if start<0 or end<=start or end>len(node['text']) or node['text'][start:end]!=text: raise ValueError('Выделение не соответствует исходному DOCX.')
  return {'preview':preview,'node':node,'start':start,'end':end}
 def get_structural_locator(self,path,sel):
  preview,node,start,end=sel['preview'],sel['node'],sel['start'],sel['end']; touched=[x for x in node['runs'] if x['end']>start and x['start']<end]
  return {'adapter':preview['adapter'],'locator_version':1,'structure_fingerprint':preview['structure_fingerprint'],'part':node['part'],'node':node['locator'],'text_start':start,'text_end':end,'start_run':touched[0]['run'],'start_run_offset':start-touched[0]['start'],'end_run':touched[-1]['run'],'end_run_offset':end-touched[-1]['start']}
adapter=DocxXmlAdapter()

def template_out(x,s): return {'id':x.id,'code':x.code,'name':x.name,'category':x.category,'description':x.description,'status':x.status,'owner_id':x.owner_id,'current_version_id':x.current_version_id,'version_count':s.query(TemplateVersion).filter_by(template_id=x.id).count()}
def version_out(x): return {'id':x.id,'template_id':x.template_id,'version_number':x.version_number,'status':x.status,'original_filename':x.original_filename,'source_sha256':x.source_sha256,'structure_fingerprint':x.structure_fingerprint,'preview_metadata':x.preview_metadata,'created_at':x.created_at,'published_at':x.published_at}
def field_out(x): return {'id':x.id,'schema_id':x.schema_id,'field_key':x.field_key,'label':x.label,'field_type':x.field_type,'required':x.required,'position':x.position,'config':x.config}
def binding_out(x): return {'id':x.id,'field_id':x.field_id,'binding_key':x.binding_key,'occurrence_index':x.occurrence_index,'selected_text':x.selected_text,'locator':x.locator,'status':x.status}
class CreateTemplate(BaseModel):
 code:str=Field(min_length=2,max_length=80,pattern=r'^[A-Za-z0-9_-]+$'); name:str=Field(min_length=2,max_length=240); category:str=Field(default='Другое',min_length=2,max_length=120); description:str=Field(default='',max_length=2000)
class FieldPayload(BaseModel):
 field_key:str=Field(min_length=2,max_length=120,pattern=r'^[A-Za-z][A-Za-z0-9_.-]*$'); label:str=Field(min_length=2,max_length=300); field_type:str; required:bool=False; position:int=Field(ge=1); description:str=Field(default='',max_length=1000); group:str=Field(default='Основные сведения',max_length=160); placeholder:str=Field(default='',max_length=300); validation:dict[str,Any]=Field(default_factory=dict); options:list[str]=Field(default_factory=list,max_length=100)
class BindingPayload(BaseModel): field_id:str|None=None; binding_key:str|None=None; locator:str; start:int=Field(ge=0); end:int=Field(gt=0); selected_text:str=Field(min_length=1,max_length=10000)
class AnswersPayload(BaseModel): answers:dict[str,Any]

def validate_field_payload(p):
 if p.field_type not in FIELD_TYPES: raise HTTPException(422,detail='Неподдерживаемый тип поля')
 if set(p.validation)-{'min_length','max_length','min','max','regex'}: raise HTTPException(422,detail='Параметры проверки содержат неподдерживаемые правила')
 if 'regex' in p.validation:
  pattern=str(p.validation['regex'])
  if len(pattern)>200 or '(?' in pattern or re.search(r'\\[1-9]',pattern): raise HTTPException(422,detail='Регулярное выражение слишком сложное')
  try: re.compile(pattern)
  except re.error: raise HTTPException(422,detail='Некорректное регулярное выражение')
 if p.field_type=='SINGLE_SELECT' and (not p.options or any(not str(x).strip() for x in p.options)): raise HTTPException(422,detail='Добавьте варианты выбора')
def validate_answer(field,value):
 if value in (None,''):
  return 'Обязательное поле' if field.required else None
 cfg=field.config or {}; rules=cfg.get('validation') or {}; kind=field.field_type
 try:
  if kind in {'TEXT','MULTILINE_TEXT'}:
   text=str(value)
   if rules.get('min_length') is not None and len(text)<int(rules['min_length']): return f'Минимум {rules["min_length"]} символов'
   if rules.get('max_length') is not None and len(text)>int(rules['max_length']): return f'Максимум {rules["max_length"]} символов'
   if rules.get('regex') and not re.fullmatch(str(rules['regex']),text): return 'Значение не соответствует требуемому формату'
  elif kind=='INTEGER': number=Decimal(int(value))
  elif kind in {'DECIMAL','MONEY'}: number=Decimal(str(value).replace(',','.'))
  elif kind=='DATE': date.fromisoformat(str(value))
  elif kind=='BOOLEAN' and not isinstance(value,bool): return 'Выберите да или нет'
  elif kind=='SINGLE_SELECT' and value not in cfg.get('options',[]): return 'Выберите значение из списка'
  if kind in {'INTEGER','DECIMAL','MONEY'}:
   if rules.get('min') is not None and number<Decimal(str(rules['min'])): return f'Значение не меньше {rules["min"]}'
   if rules.get('max') is not None and number>Decimal(str(rules['max'])): return f'Значение не больше {rules["max"]}'
 except (ValueError,TypeError,InvalidOperation): return 'Некорректный формат значения'
 return None
def render_value(field,value):
 if value in (None,''): return ''
 if field.field_type=='BOOLEAN': return 'Да' if value else 'Нет'
 return str(value)
def schema_for(version_id,s,create=False,u=None):
 x=s.query(QuestionnaireSchema).filter_by(template_version_id=version_id).order_by(QuestionnaireSchema.schema_version.desc()).first()
 if not x and create: x=QuestionnaireSchema(template_version_id=version_id,created_by_id=u.id); s.add(x); s.flush()
 return x
def schema_out(x,s): return {'id':x.id,'title':x.title,'status':x.status,'fields':[field_out(f) for f in s.query(QuestionnaireField).filter_by(schema_id=x.id).order_by(QuestionnaireField.position).all()]}
def validate_bindings(v,s):
 preview=adapter.preview(safe_source(v))
 if preview['structure_fingerprint']!=v.structure_fingerprint: raise HTTPException(409,detail='DOCX изменился после создания версии')
 nodes={x['locator']:x for x in preview['nodes']}; occupied={}; bindings=s.query(DocumentBinding).filter_by(template_version_id=v.id,status='ACTIVE').all()
 for b in bindings:
  loc=b.locator or {}; node=nodes.get(loc.get('node')); start,end=loc.get('text_start'),loc.get('text_end')
  if not node or loc.get('part')!=node['part'] or loc.get('structure_fingerprint')!=v.structure_fingerprint: raise HTTPException(422,detail=f'Привязка «{b.binding_key}» устарела')
  if not isinstance(start,int) or not isinstance(end,int) or start<0 or end>len(node['text']) or node['text'][start:end]!=b.selected_text: raise HTTPException(422,detail=f'Диапазон привязки «{b.binding_key}» повреждён')
  ranges=occupied.setdefault(node['locator'],[])
  if any(start<e and end>s0 for s0,e in ranges): raise HTTPException(422,detail='Диапазоны привязок пересекаются')
  ranges.append((start,end))
 return bindings
def paragraph_for(root,locator):
 path=locator.split('#/',1)[1]; body=root.find('w:body',NS) if root.tag.endswith('document') else root
 m=re.fullmatch(r'p\[(\d+)\]',path)
 if m: return body.findall('./w:p',NS)[int(m.group(1))-1]
 m=re.fullmatch(r'tbl\[(\d+)\]/tr\[(\d+)\]/tc\[(\d+)\]/p\[(\d+)\]',path)
 if not m: raise ValueError('Неподдерживаемый структурный locator')
 t,r,c,p=map(int,m.groups()); return body.findall('./w:tbl',NS)[t-1].findall('./w:tr',NS)[r-1].findall('./w:tc',NS)[c-1].findall('./w:p',NS)[p-1]
def replace_range(p,start,end,value):
 if p.find('.//w:fldChar',NS) is not None or p.find('.//w:instrText',NS) is not None: raise ValueError('Привязка внутри поля Word не поддерживается')
 spans=[]; pos=0
 for node in p.findall('.//w:t',NS): text=node.text or ''; spans.append((node,pos,pos+len(text),text)); pos+=len(text)
 touched=[x for x in spans if x[2]>start and x[1]<end]
 if end>pos or not touched: raise ValueError('Диапазон привязки выходит за границы текста')
 first,last=touched[0],touched[-1]
 for node,s,e,text in touched:
  prefix=text[:max(0,start-s)] if node is first[0] else ''; suffix=text[max(0,end-s):] if node is last[0] else ''; node.text=(prefix+str(value)+suffix) if node is first[0] else suffix
  if node.text.startswith(' ') or node.text.endswith(' '): node.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
def render_docx(v,bindings,values,target):
 grouped={}
 for b in bindings: grouped.setdefault(b.locator['part'],[]).append(b)
 with zipfile.ZipFile(safe_source(v),'r') as src,zipfile.ZipFile(target,'w') as dst:
  for info in src.infolist():
   raw=src.read(info.filename)
   if info.filename in grouped:
    root=ET.fromstring(raw); by_node={}
    for b in grouped[info.filename]: by_node.setdefault(b.locator['node'],[]).append(b)
    for locator,items in by_node.items():
     p=paragraph_for(root,locator)
     for b in sorted(items,key=lambda x:x.locator['text_start'],reverse=True): replace_range(p,b.locator['text_start'],b.locator['text_end'],values[b.binding_key])
    raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
   dst.writestr(info,raw)
 validate_docx(target.name,DOCX_MIME,target.read_bytes())

def build_contract_platform_router(current_dependency:Callable)->APIRouter:
 r=APIRouter(tags=['contract-platform']); prefix='/api/v1/document-templates'
 @r.get('/api/v1/contract-catalog')
 def catalog(q:str='',u=Depends(current_dependency),s:DBS=Depends(db)):
  query=s.query(DocumentTemplate).filter_by(status='ACTIVE').filter(DocumentTemplate.current_version_id.is_not(None))
  if q: query=query.filter(DocumentTemplate.name.ilike(f'%{q}%'))
  return [template_out(x,s) for x in query.order_by(DocumentTemplate.name).all()]
 @r.post('/api/v1/contract-drafts',status_code=201)
 def create_draft(payload:dict,u=Depends(current_dependency),s:DBS=Depends(db)):
  t=s.get(DocumentTemplate,payload.get('template_id'))
  if not t or t.status!='ACTIVE' or not t.current_version_id: raise HTTPException(404,detail='Опубликованный шаблон не найден')
  v=s.get(TemplateVersion,t.current_version_id); schema=schema_for(v.id,s)
  if not schema or schema.status!='PUBLISHED': raise HTTPException(409,detail='Анкета шаблона не опубликована')
  d=DocumentDraft(owner_id=u.id,template_version_id=v.id,questionnaire_schema_id=schema.id); s.add(d); s.commit(); return {'id':d.id,'template':template_out(t,s),'status':d.status,'answers':d.answers,'schema':schema_out(schema,s)}
 @r.get('/api/v1/contract-drafts')
 def drafts(u=Depends(current_dependency),s:DBS=Depends(db)):
  out=[]
  for d in s.query(DocumentDraft).filter_by(owner_id=u.id).order_by(DocumentDraft.updated_at.desc()).all():
   v=s.get(TemplateVersion,d.template_version_id); t=s.get(DocumentTemplate,v.template_id); g=s.query(GeneratedDocument).filter_by(draft_id=d.id).order_by(GeneratedDocument.generation_number.desc()).first(); out.append({'id':d.id,'template_name':t.name,'status':d.status,'updated_at':d.updated_at,'generated':g.id if g else None,'generated_stale':bool(g and g.created_at<d.updated_at)})
  return out
 @r.get('/api/v1/contract-drafts/{id}')
 def draft(id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  d=own_draft(id,u,s); v=s.get(TemplateVersion,d.template_version_id); t=s.get(DocumentTemplate,v.template_id); schema=s.get(QuestionnaireSchema,d.questionnaire_schema_id); return {'id':d.id,'status':d.status,'answers':d.answers,'template':template_out(t,s),'schema':schema_out(schema,s)}
 @r.patch('/api/v1/contract-drafts/{id}')
 def save(id:str,payload:AnswersPayload,u=Depends(current_dependency),s:DBS=Depends(db)):
  d=own_draft(id,u,s); fields=s.query(QuestionnaireField).filter_by(schema_id=d.questionnaire_schema_id).all(); known={x.field_key:x for x in fields}
  if set(payload.answers)-set(known): raise HTTPException(422,detail='Анкета содержит неизвестные поля')
  errors={k:e for k,v in payload.answers.items() if (e:=validate_answer(known[k],v))}
  if errors: raise HTTPException(422,detail={'message':'Исправьте ответы','fields':errors})
  d.answers={**(d.answers or {}),**payload.answers}; d.status='DRAFT'; d.updated_at=now(); s.commit(); return {'id':d.id,'status':d.status,'answers':d.answers}
 @r.post('/api/v1/contract-drafts/{id}/generate',status_code=201)
 def generate(id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  d=own_draft(id,u,s); v=s.get(TemplateVersion,d.template_version_id); fields=s.query(QuestionnaireField).filter_by(schema_id=d.questionnaire_schema_id).all(); answers=d.answers or {}; errors={x.field_key:e for x in fields if (e:=validate_answer(x,answers.get(x.field_key)))}
  if errors: raise HTTPException(422,detail={'message':'Заполните обязательные поля','fields':errors})
  bindings=validate_bindings(v,s); values={x.field_key:render_value(x,answers.get(x.field_key,'')) for x in fields}; number=s.query(GeneratedDocument).filter_by(draft_id=d.id).count()+1; root=(Path(settings.storage)/'generated_contracts'/d.id).resolve(); root.mkdir(parents=True,exist_ok=True); target=root/f'{number}.docx'
  try: render_docx(v,bindings,values,target)
  except (ValueError,IndexError,KeyError) as exc: raise HTTPException(422,detail=f'Не удалось безопасно сформировать DOCX: {exc}')
  raw=target.read_bytes(); g=GeneratedDocument(draft_id=d.id,template_version_id=v.id,generation_number=number,path=str(target),sha256=hashlib.sha256(raw).hexdigest(),mime_type=DOCX_MIME,size=len(raw),created_by_id=u.id); s.add(g); d.status='GENERATED'; s.commit(); return {'id':g.id,'generation_number':number,'filename':f'Договор_{number}.docx','download_url':f'/api/v1/generated-documents/{g.id}/download'}
 @r.get('/api/v1/generated-documents/{id}/download')
 def generated(id:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  g=s.get(GeneratedDocument,id)
  if not g: raise HTTPException(404,detail='Документ не найден')
  d=own_draft(g.draft_id,u,s); t=s.get(DocumentTemplate,s.get(TemplateVersion,d.template_version_id).template_id); return FileResponse(safe_file(g.path,'generated_contracts',g.sha256),filename=f'{t.name}.docx',media_type=DOCX_MIME)
 @r.get(prefix)
 def templates(u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); query=s.query(DocumentTemplate)
  if 'administrator' not in roles(u): query=query.filter_by(owner_id=u.id)
  return [template_out(x,s) for x in query.order_by(DocumentTemplate.updated_at.desc()).all()]
 @r.post(prefix,status_code=201)
 def create_template(payload:CreateTemplate,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); code=payload.code.upper()
  if s.query(DocumentTemplate).filter_by(owner_id=u.id,code=code).first(): raise HTTPException(409,detail='Шаблон с таким кодом уже существует')
  x=DocumentTemplate(owner_id=u.id,code=code,name=payload.name.strip(),category=payload.category.strip(),description=payload.description.strip()); s.add(x); s.flush(); s.add(TemplateAuditEvent(template_id=x.id,actor_id=u.id,event_type='TEMPLATE_CREATED')); s.commit(); return template_out(x,s)
 @r.get(prefix+'/{tid}')
 def get_template(tid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); return template_out(owned_template(tid,u,s),s)
 @r.get(prefix+'/{tid}/versions')
 def versions(tid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); owned_template(tid,u,s); return [version_out(x) for x in s.query(TemplateVersion).filter_by(template_id=tid).order_by(TemplateVersion.version_number.desc()).all()]
 @r.post(prefix+'/{tid}/versions',status_code=201)
 async def upload(tid:str,file:UploadFile=File(...),u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); t=owned_template(tid,u,s); raw=await file.read(); filename=Path(file.filename or '').name; validate_docx(filename,file.content_type or '',raw); last=s.query(TemplateVersion).filter_by(template_id=t.id).order_by(TemplateVersion.version_number.desc()).first(); v=TemplateVersion(template_id=t.id,version_number=last.version_number+1 if last else 1,original_filename=filename,source_path='',source_sha256=hashlib.sha256(raw).hexdigest(),source_size=len(raw),mime_type=DOCX_MIME,structure_fingerprint='',created_by_id=u.id); s.add(v); s.flush(); root=(Path(settings.storage)/'template_sources'/t.id/v.id).resolve(); root.mkdir(parents=True); path=root/'source.docx'; path.write_bytes(raw); path.chmod(0o444); preview=adapter.preview(path); v.source_path=str(path); v.structure_fingerprint=preview['structure_fingerprint']; v.preview_metadata={'adapter':preview['adapter'],'node_count':len(preview['nodes']),'limitations':preview['limitations']}; schema_for(v.id,s,True,u); s.add(TemplateAuditEvent(template_id=t.id,template_version_id=v.id,actor_id=u.id,event_type='VERSION_UPLOADED')); s.commit(); return version_out(v)
 @r.get(prefix+'/{tid}/versions/{vid}/preview')
 def preview(tid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s)
  if t.id!=tid: raise HTTPException(404,detail='Версия не найдена')
  result=adapter.preview(safe_source(v))
  if result['structure_fingerprint']!=v.structure_fingerprint: raise HTTPException(409,detail='Структура исходного файла изменилась')
  return result
 @r.get(prefix+'/{tid}/versions/{vid}/source')
 def source(tid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s)
  if t.id!=tid: raise HTTPException(404,detail='Версия не найдена')
  return FileResponse(safe_source(v),filename=v.original_filename,media_type=DOCX_MIME)
 @r.get(prefix+'/{tid}/versions/{vid}/questionnaire')
 def questionnaire(tid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s)
  if t.id!=tid: raise HTTPException(404,detail='Версия не найдена')
  return schema_out(schema_for(v.id,s,True,u),s)
 @r.post(prefix+'/{tid}/versions/{vid}/fields',status_code=201)
 def create_field(tid:str,vid:str,p:FieldPayload,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); require_draft(v); validate_field_payload(p); schema=schema_for(v.id,s,True,u)
  if s.query(QuestionnaireField).filter_by(schema_id=schema.id,field_key=p.field_key).first(): raise HTTPException(409,detail='Поле с таким ключом уже существует')
  if s.query(QuestionnaireField).filter_by(schema_id=schema.id,position=p.position).first(): raise HTTPException(409,detail='Позиция уже занята')
  x=QuestionnaireField(schema_id=schema.id,field_key=p.field_key,label=p.label,field_type=p.field_type,required=p.required,position=p.position,config={'description':p.description,'group':p.group,'placeholder':p.placeholder,'validation':p.validation,'options':p.options}); s.add(x); s.commit(); return field_out(x)
 @r.patch(prefix+'/{tid}/versions/{vid}/fields/{fid}')
 def update_field(tid:str,vid:str,fid:str,p:FieldPayload,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); require_draft(v); validate_field_payload(p); schema=schema_for(v.id,s); x=s.get(QuestionnaireField,fid)
  if not x or not schema or x.schema_id!=schema.id: raise HTTPException(404,detail='Поле не найдено')
  duplicate=s.query(QuestionnaireField).filter(QuestionnaireField.schema_id==schema.id,QuestionnaireField.field_key==p.field_key,QuestionnaireField.id!=x.id).first()
  occupied=s.query(QuestionnaireField).filter(QuestionnaireField.schema_id==schema.id,QuestionnaireField.position==p.position,QuestionnaireField.id!=x.id).first()
  if duplicate: raise HTTPException(409,detail='Поле с таким ключом уже существует')
  if occupied: raise HTTPException(409,detail='Позиция уже занята')
  if x.field_key!=p.field_key:
   for binding in s.query(DocumentBinding).filter_by(field_id=x.id): binding.binding_key=p.field_key
  x.field_key=p.field_key; x.label=p.label; x.field_type=p.field_type; x.required=p.required; x.position=p.position; x.config={'description':p.description,'group':p.group,'placeholder':p.placeholder,'validation':p.validation,'options':p.options}; s.commit(); return field_out(x)
 @r.delete(prefix+'/{tid}/versions/{vid}/fields/{fid}',status_code=204)
 def delete_field(tid:str,vid:str,fid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); require_draft(v); schema=schema_for(v.id,s); x=s.get(QuestionnaireField,fid)
  if not x or not schema or x.schema_id!=schema.id: raise HTTPException(404,detail='Поле не найдено')
  if s.query(DocumentBinding).filter_by(field_id=x.id).first(): raise HTTPException(409,detail='Сначала удалите привязки поля')
  s.delete(x); s.commit()
 @r.get(prefix+'/{tid}/versions/{vid}/bindings')
 def bindings(tid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); return [binding_out(x) for x in s.query(DocumentBinding).filter_by(template_version_id=v.id).all()]
 @r.post(prefix+'/{tid}/versions/{vid}/bindings',status_code=201)
 def bind(tid:str,vid:str,p:BindingPayload,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); require_draft(v); schema=schema_for(v.id,s); field=s.get(QuestionnaireField,p.field_id) if p.field_id else None
  if p.field_id and (not field or not schema or field.schema_id!=schema.id): raise HTTPException(404,detail='Поле анкеты не найдено')
  key=field.field_key if field else p.binding_key
  if not key: raise HTTPException(422,detail='Выберите поле анкеты')
  try: path=safe_source(v); loc=adapter.get_structural_locator(path,adapter.select_range(path,p.locator,p.start,p.end,p.selected_text))
  except ValueError as exc: raise HTTPException(422,detail=str(exc))
  for old in s.query(DocumentBinding).filter_by(template_version_id=v.id,status='ACTIVE'):
   o=old.locator
   if o.get('node')==loc['node'] and loc['text_start']<o['text_end'] and loc['text_end']>o['text_start']: raise HTTPException(409,detail='Выделенный диапазон пересекается с существующей привязкой')
  n=s.query(DocumentBinding).filter_by(template_version_id=v.id,binding_key=key).count()+1; x=DocumentBinding(template_version_id=v.id,field_id=field.id if field else None,binding_key=key,occurrence_index=n,locator=loc,selected_text=p.selected_text,created_by_id=u.id); s.add(x); s.flush(); s.add(TemplateAuditEvent(template_id=t.id,template_version_id=v.id,actor_id=u.id,event_type='BINDING_CREATED',metadata_json={'binding_id':x.id})); s.commit(); return binding_out(x)
 @r.delete(prefix+'/{tid}/versions/{vid}/bindings/{bid}',status_code=204)
 def delete_binding(tid:str,vid:str,bid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); v,t=owned_version(vid,u,s); require_draft(v); x=s.get(DocumentBinding,bid)
  if not x or x.template_version_id!=v.id: raise HTTPException(404,detail='Привязка не найдена')
  s.delete(x); s.commit()
 @r.post(prefix+'/{tid}/versions/{vid}/publish')
 def publish(tid:str,vid:str,u=Depends(current_dependency),s:DBS=Depends(db)):
  require_manager(u); require_publisher(u); v,t=owned_version(vid,u,s); require_draft(v); schema=schema_for(v.id,s)
  if not schema: raise HTTPException(422,detail='Создайте анкету')
  fields=s.query(QuestionnaireField).filter_by(schema_id=schema.id).all(); bindings=validate_bindings(v,s)
  if not fields: raise HTTPException(422,detail='Добавьте хотя бы одно поле анкеты')
  bound={x.field_id for x in bindings}
  if any(x.required and x.id not in bound for x in fields): raise HTTPException(422,detail='Все обязательные поля должны иметь привязку в DOCX')
  if any(not x.field_id for x in bindings): raise HTTPException(422,detail='Найдены привязки без поля анкеты')
  probe={x.field_key:('Да' if x.field_type=='BOOLEAN' else '2026-01-01' if x.field_type=='DATE' else '1') for x in fields}; temp=Path(v.source_path).parent/'publish-check.docx'
  try: render_docx(v,bindings,probe,temp); temp.unlink(missing_ok=True)
  except (ValueError,IndexError,KeyError) as exc: raise HTTPException(422,detail=f'Проверка генерации не пройдена: {exc}')
  for old in s.query(TemplateVersion).filter(TemplateVersion.template_id==t.id,TemplateVersion.status=='PUBLISHED'): old.status='SUPERSEDED'
  v.status='PUBLISHED'; v.published_by_id=u.id; v.published_at=now(); schema.status='PUBLISHED'; t.status='ACTIVE'; t.current_version_id=v.id; s.add(TemplateAuditEvent(template_id=t.id,template_version_id=v.id,actor_id=u.id,event_type='VERSION_PUBLISHED')); s.commit(); return version_out(v)
 return r
