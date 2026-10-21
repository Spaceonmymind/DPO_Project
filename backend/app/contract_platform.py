"""Versioned, non-AI contract-template platform and DOCX preview spike."""
from __future__ import annotations

import hashlib
import re
import zipfile
from abc import ABC, abstractmethod
from io import BytesIO
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree as ET

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBS

from app.db import DocumentBinding, DocumentTemplate, SessionLocal, TemplateAuditEvent, TemplateVersion, now, settings

DOCX_MIMES={'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream','application/zip'}
WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w':WORD_NS}
MAX_ZIP_ENTRIES=5000
MAX_UNCOMPRESSED_BYTES=200*1024*1024


def db():
    session=SessionLocal()
    try: yield session
    finally: session.close()


def roles(user) -> set[str]: return set(user.roles or [])
def require_manager(user):
    if not roles(user).intersection({'dpo_specialist','administrator'}): raise HTTPException(403,detail='Управление шаблонами доступно специалистам ДПО')
def require_publisher(user):
    if not roles(user).intersection({'template_publisher','administrator'}): raise HTTPException(403,detail='Нет разрешения на публикацию шаблонов')


def template_for_user(template_id:str,user,session:DBS) -> DocumentTemplate:
    template=session.get(DocumentTemplate,template_id)
    if not template: raise HTTPException(404,detail='Шаблон не найден')
    if template.owner_id!=user.id and 'administrator' not in roles(user): raise HTTPException(404,detail='Шаблон не найден')
    return template


def version_for_user(version_id:str,user,session:DBS) -> tuple[TemplateVersion,DocumentTemplate]:
    version=session.get(TemplateVersion,version_id)
    if not version: raise HTTPException(404,detail='Версия не найдена')
    return version,template_for_user(version.template_id,user,session)


def safe_source(version:TemplateVersion) -> Path:
    root=(Path(settings.storage)/'template_sources').resolve(); path=Path(version.source_path).resolve()
    if not path.is_relative_to(root) or not path.is_file(): raise HTTPException(404,detail='Исходный файл недоступен')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=version.source_sha256: raise HTTPException(409,detail='Нарушена целостность исходного файла')
    return path


def validate_docx(filename:str,mime_type:str,raw:bytes) -> None:
    if Path(filename).suffix.lower()!='.docx': raise HTTPException(415,detail='Поддерживается только DOCX')
    if mime_type and mime_type.lower() not in DOCX_MIMES: raise HTTPException(415,detail='Некорректный MIME-тип DOCX')
    if not raw: raise HTTPException(422,detail='Файл пустой')
    if len(raw)>settings.max_upload: raise HTTPException(413,detail='Файл превышает допустимый размер')
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            infos=archive.infolist()
            names={item.filename for item in infos}
            if len(infos)>MAX_ZIP_ENTRIES or sum(item.file_size for item in infos)>MAX_UNCOMPRESSED_BYTES: raise HTTPException(422,detail='DOCX содержит слишком много данных')
            if any(Path(item.filename).is_absolute() or '..' in Path(item.filename).parts for item in infos): raise HTTPException(422,detail='DOCX содержит небезопасные пути')
            if '[Content_Types].xml' not in names or 'word/document.xml' not in names: raise HTTPException(422,detail='Файл не имеет корректной структуры DOCX')
            if archive.testzip() is not None: raise HTTPException(422,detail='DOCX повреждён')
            ET.fromstring(archive.read('word/document.xml'))
    except HTTPException: raise
    except (zipfile.BadZipFile,KeyError,ET.ParseError): raise HTTPException(422,detail='Файл не имеет корректной структуры DOCX')


class DocumentEditorAdapter(ABC):
    """Editor-neutral boundary. Locators identify source nodes, never rendered coordinates."""
    @abstractmethod
    def load(self,path:Path) -> dict[str,Any]: ...
    @abstractmethod
    def preview(self,path:Path) -> dict[str,Any]: ...
    @abstractmethod
    def select_range(self,path:Path,locator:str,start:int,end:int,selected_text:str) -> dict[str,Any]: ...
    @abstractmethod
    def get_structural_locator(self,path:Path,selection:dict[str,Any]) -> dict[str,Any]: ...


class DocxXmlPreviewAdapter(DocumentEditorAdapter):
    def load(self,path:Path) -> dict[str,Any]:
        return self.preview(path)

    def _parts(self,archive:zipfile.ZipFile):
        names=['word/document.xml']+sorted(name for name in archive.namelist() if re.fullmatch(r'word/(?:header|footer)\d+\.xml',name))
        return [(name,ET.fromstring(archive.read(name))) for name in names]

    @staticmethod
    def _runs(paragraph) -> list[str]:
        return [''.join(node.text or '' for node in run.findall('.//w:t',NS)) for run in paragraph.findall('./w:r',NS)]

    def preview(self,path:Path) -> dict[str,Any]:
        nodes=[]
        with zipfile.ZipFile(path) as archive:
            for part,root in self._parts(archive):
                body=root.find('w:body',NS) if part=='word/document.xml' else root
                if body is None: continue
                paragraph_index=0; table_index=0
                for child in list(body):
                    if child.tag==f'{{{WORD_NS}}}p':
                        paragraph_index+=1; runs=self._runs(child); text=''.join(runs)
                        if text.strip(): nodes.append(self._node(part,f'{part}#/p[{paragraph_index}]','paragraph',text,runs,{}))
                    elif child.tag==f'{{{WORD_NS}}}tbl':
                        table_index+=1
                        for row_index,row in enumerate(child.findall('./w:tr',NS),1):
                            for cell_index,cell in enumerate(row.findall('./w:tc',NS),1):
                                props=cell.find('./w:tcPr',NS); grid=props.find('./w:gridSpan',NS) if props is not None else None; merge=props.find('./w:vMerge',NS) if props is not None else None
                                cell_meta={'table':table_index,'row':row_index,'cell':cell_index,'grid_span':int(grid.get(f'{{{WORD_NS}}}val','1')) if grid is not None else 1,'vertical_merge':merge.get(f'{{{WORD_NS}}}val','continue') if merge is not None else None}
                                for cell_paragraph_index,paragraph in enumerate(cell.findall('./w:p',NS),1):
                                    runs=self._runs(paragraph); text=''.join(runs)
                                    if text.strip(): nodes.append(self._node(part,f'{part}#/tbl[{table_index}]/tr[{row_index}]/tc[{cell_index}]/p[{cell_paragraph_index}]','table_cell',text,runs,cell_meta))
        fingerprint=hashlib.sha256('\n'.join(node['locator']+'\0'+node['text'] for node in nodes).encode()).hexdigest()
        return {'adapter':'DOCX_XML_READ_ONLY','locator_version':1,'structure_fingerprint':fingerprint,'nodes':nodes,'limitations':['Предпросмотр не воспроизводит пагинацию и точную геометрию Microsoft Word.','Выделение поддерживается внутри одного абзаца или одной ячейки.']}

    @staticmethod
    def _node(part,locator,kind,text,runs,meta):
        offsets=[]; cursor=0
        for index,value in enumerate(runs,1): offsets.append({'run':index,'start':cursor,'end':cursor+len(value)}); cursor+=len(value)
        return {'part':part,'locator':locator,'kind':kind,'text':text,'runs':offsets,'metadata':meta}

    def select_range(self,path:Path,locator:str,start:int,end:int,selected_text:str) -> dict[str,Any]:
        preview=self.preview(path); node=next((item for item in preview['nodes'] if item['locator']==locator),None)
        if not node or start<0 or end<=start or end>len(node['text']) or node['text'][start:end]!=selected_text: raise ValueError('Выделение не соответствует исходному DOCX')
        return {'preview':preview,'node':node,'start':start,'end':end,'selected_text':selected_text}

    def get_structural_locator(self,path:Path,selection:dict[str,Any]) -> dict[str,Any]:
        preview=selection['preview']; node=selection['node']; start=selection['start']; end=selection['end']
        touched=[run for run in node['runs'] if run['end']>start and run['start']<end]
        return {'adapter':preview['adapter'],'locator_version':1,'structure_fingerprint':preview['structure_fingerprint'],'part':node['part'],'node':node['locator'],'text_start':start,'text_end':end,'start_run':touched[0]['run'],'start_run_offset':start-touched[0]['start'],'end_run':touched[-1]['run'],'end_run_offset':end-touched[-1]['start']}


adapter=DocxXmlPreviewAdapter()

class CreateTemplate(BaseModel):
    code:str=Field(min_length=2,max_length=80,pattern=r'^[A-Za-z0-9_-]+$'); name:str=Field(min_length=2,max_length=240); description:str=Field(default='',max_length=2000)
class CreateBinding(BaseModel):
    binding_key:str=Field(min_length=2,max_length=120,pattern=r'^[A-Za-z0-9_.-]+$'); locator:str; start:int=Field(ge=0); end:int=Field(gt=0); selected_text:str=Field(min_length=1,max_length=10000); field_id:str|None=None

def template_out(item:DocumentTemplate,session:DBS):
    count=session.query(TemplateVersion).filter_by(template_id=item.id).count()
    return {'id':item.id,'code':item.code,'name':item.name,'description':item.description,'status':item.status,'owner_id':item.owner_id,'current_version_id':item.current_version_id,'version_count':count,'created_at':item.created_at,'updated_at':item.updated_at}
def version_out(item:TemplateVersion):
    return {'id':item.id,'template_id':item.template_id,'version_number':item.version_number,'status':item.status,'original_filename':item.original_filename,'source_sha256':item.source_sha256,'source_size':item.source_size,'mime_type':item.mime_type,'structure_fingerprint':item.structure_fingerprint,'preview_metadata':item.preview_metadata,'created_by_id':item.created_by_id,'created_at':item.created_at,'published_by_id':item.published_by_id,'published_at':item.published_at}


def build_contract_platform_router(current_dependency:Callable) -> APIRouter:
    router=APIRouter(prefix='/api/v1/document-templates',tags=['contract-platform'])

    @router.get('')
    def list_templates(user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); query=session.query(DocumentTemplate)
        if 'administrator' not in roles(user): query=query.filter_by(owner_id=user.id)
        return [template_out(item,session) for item in query.order_by(DocumentTemplate.updated_at.desc()).all()]

    @router.post('',status_code=201)
    def create_template(payload:CreateTemplate,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); code=payload.code.upper()
        if session.query(DocumentTemplate).filter_by(owner_id=user.id,code=code).first(): raise HTTPException(409,detail='Шаблон с таким кодом уже существует')
        item=DocumentTemplate(owner_id=user.id,code=code,name=payload.name.strip(),description=payload.description.strip()); session.add(item); session.flush(); session.add(TemplateAuditEvent(template_id=item.id,actor_id=user.id,event_type='TEMPLATE_CREATED')); session.commit(); return template_out(item,session)

    @router.get('/{template_id}')
    def get_template(template_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); return template_out(template_for_user(template_id,user,session),session)

    @router.get('/{template_id}/versions')
    def list_versions(template_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); template_for_user(template_id,user,session); return [version_out(item) for item in session.query(TemplateVersion).filter_by(template_id=template_id).order_by(TemplateVersion.version_number.desc()).all()]

    @router.post('/{template_id}/versions',status_code=201)
    async def upload_version(template_id:str,file:UploadFile=File(...),user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); template=template_for_user(template_id,user,session); raw=await file.read(); filename=Path(file.filename or '').name; validate_docx(filename,file.content_type or '',raw)
        number=(session.query(TemplateVersion).filter_by(template_id=template.id).order_by(TemplateVersion.version_number.desc()).first().version_number+1) if session.query(TemplateVersion).filter_by(template_id=template.id).first() else 1
        version=TemplateVersion(template_id=template.id,version_number=number,original_filename=filename,source_path='',source_sha256=hashlib.sha256(raw).hexdigest(),source_size=len(raw),mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',structure_fingerprint='',created_by_id=user.id); session.add(version); session.flush()
        root=(Path(settings.storage)/'template_sources'/template.id/version.id).resolve(); root.mkdir(parents=True,exist_ok=False); path=root/'source.docx'; path.write_bytes(raw); path.chmod(0o444)
        preview=adapter.load(path); version.source_path=str(path); version.structure_fingerprint=preview['structure_fingerprint']; version.preview_metadata={'adapter':preview['adapter'],'locator_version':preview['locator_version'],'node_count':len(preview['nodes']),'limitations':preview['limitations']}
        session.add(TemplateAuditEvent(template_id=template.id,template_version_id=version.id,actor_id=user.id,event_type='VERSION_UPLOADED',metadata_json={'sha256':version.source_sha256,'size':version.source_size})); session.commit(); return version_out(version)

    @router.get('/{template_id}/versions/{version_id}')
    def get_version(template_id:str,version_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); version,template=version_for_user(version_id,user,session)
        if template.id!=template_id: raise HTTPException(404,detail='Версия не найдена')
        return version_out(version)

    @router.get('/{template_id}/versions/{version_id}/source')
    def download_source(template_id:str,version_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); version,template=version_for_user(version_id,user,session)
        if template.id!=template_id: raise HTTPException(404,detail='Версия не найдена')
        return FileResponse(safe_source(version),filename=version.original_filename,media_type=version.mime_type)

    @router.get('/{template_id}/versions/{version_id}/preview')
    def preview_version(template_id:str,version_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); version,template=version_for_user(version_id,user,session)
        if template.id!=template_id: raise HTTPException(404,detail='Версия не найдена')
        result=adapter.preview(safe_source(version))
        if result['structure_fingerprint']!=version.structure_fingerprint: raise HTTPException(409,detail='Структура исходного файла изменилась')
        return result

    @router.post('/{template_id}/versions/{version_id}/bindings',status_code=201)
    def create_binding(template_id:str,version_id:str,payload:CreateBinding,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); version,template=version_for_user(version_id,user,session)
        if template.id!=template_id: raise HTTPException(404,detail='Версия не найдена')
        try:
            path=safe_source(version); selection=adapter.select_range(path,payload.locator,payload.start,payload.end,payload.selected_text); locator=adapter.get_structural_locator(path,selection)
        except ValueError as exc: raise HTTPException(422,detail=str(exc))
        binding=DocumentBinding(template_version_id=version.id,field_id=payload.field_id,binding_key=payload.binding_key,locator=locator,selected_text=payload.selected_text,created_by_id=user.id); session.add(binding); session.flush(); session.add(TemplateAuditEvent(template_id=template.id,template_version_id=version.id,actor_id=user.id,event_type='BINDING_CREATED',metadata_json={'binding_id':binding.id,'binding_key':binding.binding_key})); session.commit()
        return {'id':binding.id,'binding_key':binding.binding_key,'selected_text':binding.selected_text,'locator':binding.locator,'status':binding.status}

    @router.post('/{template_id}/versions/{version_id}/publish')
    def publish_version(template_id:str,version_id:str,user=Depends(current_dependency),session:DBS=Depends(db)):
        require_manager(user); require_publisher(user); version,template=version_for_user(version_id,user,session)
        if template.id!=template_id: raise HTTPException(404,detail='Версия не найдена')
        for old in session.query(TemplateVersion).filter(TemplateVersion.template_id==template.id,TemplateVersion.status=='PUBLISHED',TemplateVersion.id!=version.id): old.status='SUPERSEDED'
        version.status='PUBLISHED'; version.published_by_id=user.id; version.published_at=now(); template.status='ACTIVE'; template.current_version_id=version.id; session.add(TemplateAuditEvent(template_id=template.id,template_version_id=version.id,actor_id=user.id,event_type='VERSION_PUBLISHED')); session.commit(); return version_out(version)

    return router
