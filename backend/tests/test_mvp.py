import io
import os
import tempfile
import hashlib
import shutil
import zipfile
import uuid
from unittest.mock import patch
import pytest
from urllib.parse import quote
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['STORAGE_LOCAL_PATH'] = tempfile.mkdtemp()
os.environ['SEED_DEMO_USERS'] = 'true'
template_directory = Path(tempfile.mkdtemp())
os.environ['CONTRACT_TEMPLATES_PATH'] = str(template_directory)
specification_template_directory = Path(tempfile.mkdtemp())
os.environ['SPECIFICATION_TEMPLATES_PATH'] = str(specification_template_directory)
os.environ['CONTRACT_TEMPLATE_ALLOW_DYNAMIC_CHECKSUMS'] = 'true'
for filename in ('Договор_подряда.docx','договор возмездного оказания услуг (образец).docx','Shablon-agentskogo-dogovora.docx'):
    fixture=Document(); fixture.add_paragraph(filename); fixture.save(template_directory/filename)
(template_directory/'договор поставки.rtf').write_bytes(b'{\\rtf1\\ansi approved supply fixture}')
training_fixture_root=Path('/app/contract_templates/training') if Path('/app/contract_templates/training').is_dir() else Path(__file__).resolve().parents[2]/'contract_templates'/'training'
shutil.copytree(training_fixture_root,template_directory/'training')
supply_specification_source=Path(__file__).resolve().parents[2]/'specification_templates'/'supply'
shutil.copytree(supply_specification_source,specification_template_directory/'supply')

from fastapi.testclient import TestClient
from fastapi import HTTPException
import fitz
import openpyxl
import xlwt
from app.db import Base, engine, SessionLocal, User, QuestionnaireField, QuestionnaireSchema, TemplateVersion, DocumentBinding, DocumentDraft, DocumentTemplate, GeneratedDocument, ContractProduct, ContractProductVersion, ContractProductDraft, ContractProductVariant, settings
from app.security import hash_password
from app.calculations import ValueFormatter, CalculationError
from app import choices
from app.documents.service import SpreadsheetSpecificationParser
from app.ai.dialogue import clarification

Base.metadata.create_all(engine)
from app.seed import seed
seed()
from app.main import app


def auth(client: TestClient, name: str = 'ivanov') -> dict[str, str]:
    response = client.post('/api/v1/auth/login', json={'external_id': name, 'password': name.capitalize()})
    assert response.status_code == 200
    return {'x-csrf-token': response.json()['csrf_token']}


def test_onboarding_progress_is_private_and_csrf_protected():
    ivan, petrov = TestClient(app), TestClient(app)
    ivan_headers = auth(ivan)
    petrov_headers = auth(petrov, 'petrova')
    path = '/api/v1/auth/me/onboarding/T1'
    assert ivan.get('/api/v1/auth/me/onboarding').json().get('T1') is None
    assert ivan.put(path, json={'version': 1, 'status': 'COMPLETED'}).status_code == 403
    response = ivan.put(path, headers=ivan_headers, json={'version': 1, 'status': 'COMPLETED'})
    assert response.status_code == 200
    assert ivan.get('/api/v1/auth/me/onboarding').json()['T1']['status'] == 'COMPLETED'
    assert 'T1' not in petrov.get('/api/v1/auth/me/onboarding').json()
    assert petrov.put('/api/v1/auth/me/onboarding/T4', headers=petrov_headers, json={'version': 1, 'status': 'COMPLETED'}).status_code == 403
    assert ivan.put(path, headers=ivan_headers, json={'version': 2, 'status': 'COMPLETED'}).status_code == 422
    assert ivan.put(path, headers=ivan_headers, json={'version': 1, 'status': 'SKIPPED'}).json()['status'] == 'SKIPPED'


def test_document_soft_delete_and_template_archive_preserve_existing_history():
    manager, employee = TestClient(app), TestClient(app)
    mh, eh = auth(manager), auth(employee, 'petrova')
    template = create_platform_template(manager, mh, 'ARCHIVE_HISTORY_TEST')
    raw = contract_docx_bytes()
    upload = manager.post(f"/api/v1/document-templates/{template['id']}/versions", headers=mh,
        files={'file': ('archive.docx', raw, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert upload.status_code == 201, upload.text
    version = upload.json()
    with SessionLocal() as session:
        t = session.get(DocumentTemplate, template['id']); v = session.get(TemplateVersion, version['id'])
        t.status = 'ACTIVE'; t.current_version_id = v.id; v.status = 'PUBLISHED'
        session.query(QuestionnaireSchema).filter_by(template_version_id=v.id).first().status = 'PUBLISHED'
        session.commit()
    created = employee.post('/api/v1/contract-drafts', headers=eh, json={'template_id': template['id']})
    assert created.status_code == 201, created.text
    draft_id = created.json()['id']
    with SessionLocal() as session:
        target = Path(settings.storage)/'generated_contracts'/f'{draft_id}.docx'
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
        generated = GeneratedDocument(draft_id=draft_id, template_version_id=version['id'], generation_number=1,
            path=str(target), sha256=hashlib.sha256(raw).hexdigest(), mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size=len(raw), created_by_id=session.query(User).filter_by(external_id='petrova').first().id)
        session.add(generated); session.commit(); generated_id = generated.id
    assert employee.get(f'/api/v1/generated-documents/{generated_id}/download').status_code == 200
    assert employee.post(f"/api/v1/document-templates/{template['id']}/archive", headers=eh).status_code == 403
    archived = manager.post(f"/api/v1/document-templates/{template['id']}/archive", headers=mh)
    assert archived.status_code == 200, archived.text
    assert template['id'] not in [item['id'] for item in employee.get('/api/v1/contract-catalog').json()]
    assert employee.get(f'/api/v1/contract-drafts/{draft_id}').status_code == 200
    assert employee.get(f'/api/v1/generated-documents/{generated_id}/download').status_code == 200
    assert employee.post(f'/api/v1/contract-drafts/{draft_id}/duplicate', headers=eh).status_code == 201
    assert manager.delete(f'/api/v1/contract-drafts/{draft_id}', headers=mh).status_code == 404
    assert employee.delete(f'/api/v1/contract-drafts/{draft_id}', headers=eh).status_code == 200
    assert employee.get(f'/api/v1/contract-drafts/{draft_id}').status_code == 404
    assert draft_id not in [item['id'] for item in employee.get('/api/v1/contract-drafts').json()]
    assert employee.post(f'/api/v1/contract-drafts/{draft_id}/duplicate', headers=eh).status_code == 404
    assert employee.get(f'/api/v1/generated-documents/{generated_id}/download').status_code == 404
    assert manager.delete(f"/api/v1/document-templates/{template['id']}", headers=mh).status_code == 409
    assert manager.post(f"/api/v1/document-templates/{template['id']}/restore", headers=mh).status_code == 200
    assert template['id'] in [item['id'] for item in employee.get('/api/v1/contract-catalog').json()]


def test_unused_draft_template_and_product_can_be_soft_deleted():
    manager = TestClient(app); headers = auth(manager)
    template = create_platform_template(manager, headers, 'UNUSED_DELETE_TEST')
    assert manager.delete(f"/api/v1/document-templates/{template['id']}", headers=headers).status_code == 200
    assert manager.get(f"/api/v1/document-templates/{template['id']}").status_code == 404
    product = manager.post('/api/v1/contract-products', headers=headers, json={'code':'UNUSED_PRODUCT_DELETE','name':'Ненужный продукт'}).json()
    assert manager.delete(f"/api/v1/contract-products/{product['id']}", headers=headers).status_code == 200
    assert product['id'] not in [item['id'] for item in manager.get('/api/v1/contract-products').json()]


def test_docx_catalog_includes_published_template_used_by_legacy_product():
    manager, employee = TestClient(app), TestClient(app)
    mh = auth(manager); auth(employee, 'petrova')
    template = create_platform_template(manager, mh, 'DOCX_FROM_PRODUCT_TEST')
    uploaded = manager.post(f"/api/v1/document-templates/{template['id']}/versions", headers=mh,
        files={'file': ('source.docx', contract_docx_bytes(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert uploaded.status_code == 201, uploaded.text
    product = manager.post('/api/v1/contract-products', headers=mh, json={'code':'LEGACY_PRODUCT_CATALOG_TEST','name':'Старый продукт'}).json()
    with SessionLocal() as session:
        t = session.get(DocumentTemplate, template['id']); v = session.get(TemplateVersion, uploaded.json()['id'])
        t.status = 'ACTIVE'; t.current_version_id = v.id; v.status = 'PUBLISHED'
        p = session.get(ContractProduct, product['id']); pv = session.get(ContractProductVersion, product['version']['id'])
        p.status = 'ACTIVE'; p.current_version_id = pv.id; pv.status = 'PUBLISHED'
        session.add(ContractProductVariant(product_version_id=pv.id, code='LEGACY', name='Вариант', template_version_id=v.id, selection_condition={}, position=1))
        session.commit()
    catalog = employee.get('/api/v1/contract-catalog')
    assert catalog.status_code == 200
    assert template['id'] in [item['id'] for item in catalog.json()]
    assert product['id'] not in [item['id'] for item in catalog.json()]


def test_product_archive_restore_and_product_draft_soft_delete():
    manager, employee = TestClient(app), TestClient(app)
    mh, eh = auth(manager), auth(employee, 'petrova')
    response = manager.post('/api/v1/contract-products', headers=mh, json={'code':'PRODUCT_ARCHIVE_TEST','name':'Продукт для архива'})
    assert response.status_code == 201, response.text
    product = response.json()
    with SessionLocal() as session:
        p = session.get(ContractProduct, product['id']); v = session.get(ContractProductVersion, product['version']['id'])
        p.status = 'ACTIVE'; p.current_version_id = v.id; v.status = 'PUBLISHED'; session.commit()
    created = employee.post('/api/v1/contract-product-drafts', headers=eh, json={'product_id':product['id']})
    assert created.status_code == 201, created.text
    draft_id = created.json()['id']
    template = create_platform_template(manager, mh, 'PRODUCT_ARCHIVE_SOURCE')
    raw = contract_docx_bytes()
    uploaded = manager.post(f"/api/v1/document-templates/{template['id']}/versions", headers=mh,
        files={'file': ('product-source.docx', raw, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    with SessionLocal() as session:
        owner = session.query(User).filter_by(external_id='petrova').first()
        child = DocumentDraft(owner_id=owner.id, template_version_id=uploaded['id'])
        session.add(child); session.flush()
        target = Path(settings.storage)/'generated_contracts'/f'{draft_id}-product.docx'
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
        generated = GeneratedDocument(draft_id=child.id, template_version_id=uploaded['id'], product_draft_id=draft_id,
            product_version_id=product['version']['id'], generation_number=1, path=str(target),
            sha256=hashlib.sha256(raw).hexdigest(), mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size=len(raw), created_by_id=owner.id)
        session.add(generated); session.commit(); generated_id = generated.id; child_id = child.id
    assert employee.get(f'/api/v1/generated-documents/{generated_id}/download').status_code == 200
    assert child_id not in [item['id'] for item in employee.get('/api/v1/contract-drafts').json()]
    assert employee.delete(f'/api/v1/contract-drafts/{child_id}', headers=eh).status_code == 409
    assert employee.post(f"/api/v1/contract-products/{product['id']}/archive", headers=eh).status_code == 403
    assert manager.post(f"/api/v1/contract-products/{product['id']}/archive", headers=mh).status_code == 200
    assert product['id'] not in [item['id'] for item in employee.get('/api/v1/contract-product-catalog').json()]
    assert employee.get(f'/api/v1/contract-product-drafts/{draft_id}').status_code == 200
    assert employee.post(f'/api/v1/contract-product-drafts/{draft_id}/duplicate', headers=eh).status_code == 201
    assert manager.delete(f'/api/v1/contract-product-drafts/{draft_id}', headers=mh).status_code == 404
    assert employee.delete(f'/api/v1/contract-product-drafts/{draft_id}', headers=eh).status_code == 200
    assert employee.get(f'/api/v1/contract-product-drafts/{draft_id}').status_code == 404
    assert draft_id not in [item['id'] for item in employee.get('/api/v1/contract-product-drafts').json()]
    assert employee.post(f'/api/v1/contract-product-drafts/{draft_id}/duplicate', headers=eh).status_code == 404
    assert employee.get(f'/api/v1/generated-documents/{generated_id}/download').status_code == 404
    assert manager.post(f"/api/v1/contract-products/{product['id']}/restore", headers=mh).status_code == 200
    assert product['id'] in [item['id'] for item in employee.get('/api/v1/contract-product-catalog').json()]


def contract_docx_bytes() -> bytes:
    document=Document(); paragraph=document.add_paragraph(); paragraph.add_run('Заказчик: '); paragraph.add_run('АО '); paragraph.add_run('«НСПК»')
    table=document.add_table(rows=2,cols=2); table.cell(0,0).merge(table.cell(0,1)).text='Условия договора'; table.cell(1,0).text='Срок'; table.cell(1,1).text='30 дней'
    document.sections[0].header.paragraphs[0].text='Корпоративный договор'; document.sections[0].footer.paragraphs[0].text='Конфиденциально'
    payload=io.BytesIO(); document.save(payload); return payload.getvalue()


def create_platform_template(client,headers,code='TRAINING_POC'):
    response=client.post('/api/v1/document-templates',headers=headers,json={'code':code,'name':'Договор для проверки'})
    assert response.status_code==201,response.text
    return response.json()


def test_requisite_snapshots_and_binding_formats_end_to_end():
    assert choices.render({'selected':['ip'],'other_text':''},{'option_items':[{'key':'ip','label':'Индивидуальный предприниматель','genitive':'Индивидуального предпринимателя'}]},genitive=True)=='Индивидуального предпринимателя'
    assert choices.render({'selected':['ip'],'other_text':''},{'option_items':[{'key':'ip','label':'Индивидуальный предприниматель'}]},genitive=True)=='Индивидуальный предприниматель'
    assert ValueFormatter.format('2000-01-10','DATE_MONTH_SHORT')=='10 января 2000 г.'
    assert ValueFormatter.format('2024-02-29','DATE_MONTH_SHORT')=='29 февраля 2024 г.'
    for month, name in [(3,'марта'),(5,'мая'),(12,'декабря')]:
        assert name in ValueFormatter.format(f'2025-{month:02d}-01','DATE_MONTH_SHORT')
    with pytest.raises(CalculationError):ValueFormatter.format('2025-02-29','DATE_MONTH_SHORT')
    external_id='admin_'+uuid.uuid4().hex[:12]
    with SessionLocal() as session:
        session.add(User(external_id=external_id,full_name='Администратор теста',email=external_id+'@example.test',department='ДПО',roles=['administrator'],password=hash_password('Testpassword'),is_active=True));session.commit()
    admin=TestClient(app);login=admin.post('/api/v1/auth/login',json={'external_id':external_id,'password':'Testpassword'});assert login.status_code==200,login.text
    headers={'x-csrf-token':login.json()['csrf_token']}
    employee=TestClient(app);employee_headers=auth(employee,'petrova')
    assert employee.get('/api/v1/requisite-sets').status_code==403
    assert employee.post('/api/v1/requisite-sets',headers=employee_headers,json={'name':'Чужой набор','entries':[]}).status_code==403
    directory=admin.post('/api/v1/requisite-sets',headers=headers,json={'name':'Реквизиты для теста','entries':[{'key':'legal_address','label':'Юридический адрес','value':'Адрес 1'}]})
    assert directory.status_code==201,directory.text
    set_id=directory.json()['id'];assert admin.get('/api/v1/requisite-sets').json()[0]['id']==set_id
    specialist=TestClient(app);specialist_headers=auth(specialist)
    assert specialist.get('/api/v1/requisite-sets').status_code==200
    assert specialist.post('/api/v1/requisite-sets',headers=specialist_headers,json={'name':'Набор специалиста '+uuid.uuid4().hex[:6],'entries':[]}).status_code==201
    stale=admin.put(f'/api/v1/requisite-sets/{set_id}',headers=headers,json={'name':'Реквизиты для теста','entries':[],'revision':100})
    assert stale.status_code==409
    doc=Document()
    for text in ('NAME','GENITIVE','ADDRESS','DATE'):doc.add_paragraph(text)
    raw=io.BytesIO();doc.save(raw)
    template=create_platform_template(admin,headers,'R910_'+uuid.uuid4().hex[:8])
    version=admin.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('requisites.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    specs=[
        {'field_key':'party_type','label':'Сторона','field_type':'SINGLE_SELECT','option_items':[{'key':'ip','label':'Индивидуальный предприниматель','genitive':'Индивидуального предпринимателя'}]},
        {'field_key':'address','label':'Адрес','field_type':'TEXT','default_source':{'set_id':set_id,'field_key':'legal_address','fallback':'NONE'}},
        {'field_key':'signed','label':'Дата подписания','field_type':'DATE','default_value':'2000-01-10'},
        {'field_key':'reserve_address','label':'Резервный адрес','field_type':'TEXT','default_value':'Запасной адрес','default_source':{'set_id':set_id,'field_key':'legal_address','fallback':'FIXED'}},
    ]
    fields=[]
    for position,payload in enumerate(specs,1):
        response=admin.post(base+'/fields',headers=headers,json={**payload,'position':position});assert response.status_code==201,response.text;fields.append(response.json())
    invalid_reference=admin.patch(base+f"/fields/{fields[1]['id']}",headers=headers,json={**specs[1],'position':2,'default_source':{'set_id':set_id,'field_key':'unknown','fallback':'NONE'}})
    assert invalid_reference.status_code==422
    preview=admin.get(base+'/preview',headers=headers).json()['nodes']
    bindings_by_text={}
    for text,field,format_name in [('NAME',fields[0],'RAW'),('GENITIVE',fields[0],'GENITIVE'),('ADDRESS',fields[1],'RAW'),('DATE',fields[2],'DATE_MONTH_SHORT')]:
        node=next(node for node in preview if node['text']==text)
        response=admin.post(base+'/bindings',headers=headers,json={'field_id':field['id'],'locator':node['locator'],'start':0,'end':len(text),'selected_text':text,'output_format':format_name});assert response.status_code==201,response.text
        binding=response.json();bindings_by_text[text]=binding
        assert next(item for item in admin.get(base+'/bindings',headers=headers).json() if item['id']==binding['id'])['format_config']['format']==format_name
    invalid_format=admin.patch(base+f"/bindings/{bindings_by_text['ADDRESS']['id']}/format",headers=headers,json={'output_format':'DATE_MONTH_SHORT'})
    assert invalid_format.status_code==422
    assert admin.post(base+'/publish',headers=headers).status_code==200
    assert admin.patch(base+f"/bindings/{bindings_by_text['NAME']['id']}/format",headers=headers,json={'output_format':'GENITIVE'}).status_code==409
    created=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']});assert created.status_code==201,created.text
    draft_path=f"/api/v1/contract-drafts/{created.json()['id']}";assert created.json()['answers']['address']=='Адрес 1'
    assert employee.patch(draft_path+'/autosave',headers=employee_headers,json={'answers':{'party_type':{'selected':['ip'],'other_text':''}}}).status_code==200
    generated=employee.post(draft_path+'/generate',headers=employee_headers);assert generated.status_code==201,generated.text
    rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
    assert [p.text for p in rendered.paragraphs]==['Индивидуальный предприниматель','Индивидуального предпринимателя','Адрес 1','10 января 2000 г.']
    changed=admin.put(f'/api/v1/requisite-sets/{set_id}',headers=headers,json={'name':'Реквизиты для теста','entries':[{'key':'legal_address','label':'Юридический адрес','value':'Адрес 2'}],'revision':1});assert changed.status_code==200,changed.text
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['address']=='Адрес 1'
    preserved=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
    assert preserved.paragraphs[2].text=='Адрес 1'
    new_draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']});assert new_draft.json()['answers']['address']=='Адрес 2'
    assert employee.patch(draft_path+'/autosave',headers=employee_headers,json={'answers':{'address':''}}).status_code==200
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['address']==''
    assert admin.post(f'/api/v1/requisite-sets/{set_id}/archive',headers=headers,json={'revision':2}).status_code==200
    archived=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']});assert 'address' not in archived.json()['answers']
    assert archived.json()['answers']['reserve_address']=='Запасной адрес'


def test_mixed_paragraph_table_row_conditional_range_renders_without_damaging_word():
    document=Document();document.add_paragraph('BEFORE')
    first=document.add_table(rows=3,cols=1)
    for row,text in zip(first.rows,['R1','R2','R3']):row.cells[0].text=text
    document.add_paragraph('AFTER')
    second=document.add_table(rows=2,cols=1)
    for row,text in zip(second.rows,['S1','S2']):row.cells[0].text=text
    document.add_paragraph('END')
    raw=io.BytesIO();document.save(raw);original=raw.getvalue()
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'MIXED_BLOCK_'+uuid.uuid4().hex[:8])
    uploaded=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('mixed.docx',original,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')});assert uploaded.status_code==201,uploaded.text
    version=uploaded.json();base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    flag=manager.post(base+'/fields',headers=headers,json={'field_key':'show_block','label':'Показать блок','field_type':'BOOLEAN','position':1});assert flag.status_code==201,flag.text
    token=manager.post(base+'/fields',headers=headers,json={'field_key':'token','label':'Конец','field_type':'TEXT','position':2});assert token.status_code==201,token.text
    preview=manager.get(base+'/preview',headers=headers).json()['nodes'];locator={node['text']:node['locator'] for node in preview}
    end=locator['END'];binding=manager.post(base+'/bindings',headers=headers,json={'field_id':token.json()['id'],'locator':end,'start':0,'end':3,'selected_text':'END'});assert binding.status_code==201,binding.text
    def region(start,stop,key,rule):
        result=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':key,'region_type':'CONDITIONAL_PARAGRAPH_GROUP','start_locator':locator[start],'end_locator':locator[stop],'include_when':rule})
        assert result.status_code==201,result.text
        return result.json()
    def result(show):
        generated=manager.post(base+'/test-drive',headers=headers,json={'answers':{'show_block':show,'token':'DONE'}});assert generated.status_code==201,generated.text
        data=manager.get(generated.json()['download_url'],headers=headers).content
        with zipfile.ZipFile(io.BytesIO(data)) as archive:assert archive.testzip() is None
        rendered=Document(io.BytesIO(data))
        return [p.text for p in rendered.paragraphs],[ [row.cells[0].text for row in table.rows] for table in rendered.tables ]
    conditional={'operator':'EQUALS','field_key':'show_block','value':True}
    parent=region('BEFORE','R2','mixed_partial',conditional)
    assert result(False)==(['AFTER','DONE'],[['R3'],['S1','S2']])
    assert result(True)==(['BEFORE','AFTER','DONE'],[['R1','R2','R3'],['S1','S2']])
    child=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'nested_row','region_type':'CONDITIONAL_TABLE_ROW','start_locator':locator['R1'],'include_when':{'operator':'NEVER'}});assert child.status_code==201,child.text
    assert result(True)==(['BEFORE','AFTER','DONE'],[['R2','R3'],['S1','S2']])
    assert result(False)==(['AFTER','DONE'],[['R3'],['S1','S2']])
    overlap=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'crossing','region_type':'CONDITIONAL_PARAGRAPH_GROUP','start_locator':locator['R2'],'end_locator':locator['R3'],'include_when':conditional})
    assert overlap.status_code==422
    assert manager.delete(base+f"/conditional-regions/{child.json()['id']}",headers=headers).status_code==204
    assert manager.delete(base+f"/conditional-regions/{parent['id']}",headers=headers).status_code==204
    for index,(start,stop,expected) in enumerate([
        ('BEFORE','R3',(['AFTER','DONE'],[['S1','S2']])),
        ('BEFORE','AFTER',(['DONE'],[['S1','S2']])),
        ('R1','R2',(['BEFORE','AFTER','DONE'],[['R3'],['S1','S2']])),
        ('BEFORE','S2',(['DONE'],[])),
    ]):
        current=region(start,stop,f'case_{index}',conditional)
        assert result(False)==expected
        assert manager.delete(base+f"/conditional-regions/{current['id']}",headers=headers).status_code==204
    source=manager.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/source",headers=headers)
    assert source.content==original


def test_text_answer_limits_preserve_leading_zeros_and_reject_invalid_api_answers():
    doc=Document();doc.add_paragraph('SERIES');raw=io.BytesIO();doc.save(raw)
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'TEXT_LIMITS_'+uuid.uuid4().hex[:8])
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('limits.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    field={'field_key':'passport_series','label':'Серия паспорта','field_type':'TEXT','position':1,'validation':{'min_length':4,'max_length':4,'character_set':'DIGITS'},'default_value':'0012'}
    for invalid in ({'validation':{'min_length':5,'max_length':4}},{'default_value':'ABCD'},{'validation':{'character_set':'UNKNOWN'}},{'field_type':'DATE','validation':{'character_set':'DIGITS'}}):
        response=manager.post(base+'/fields',headers=headers,json={**field,**invalid});assert response.status_code==422,response.text
    created=manager.post(base+'/fields',headers=headers,json=field);assert created.status_code==201,created.text
    plain=manager.post(base+'/fields',headers=headers,json={'field_key':'note','label':'Примечание','field_type':'TEXT','position':2});assert plain.status_code==201
    node=next(item for item in manager.get(base+'/preview',headers=headers).json()['nodes'] if item['text']=='SERIES')
    assert manager.post(base+'/bindings',headers=headers,json={'field_id':created.json()['id'],'locator':node['locator'],'start':0,'end':6,'selected_text':'SERIES'}).status_code==201
    assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app);employee_headers=auth(employee,'petrova')
    draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']});assert draft.status_code==201
    path=f"/api/v1/contract-drafts/{draft.json()['id']}";assert draft.json()['answers']['passport_series']=='0012'
    for invalid in ('12345','12A4','123'):
        response=employee.patch(path+'/autosave',headers=employee_headers,json={'answers':{'passport_series':invalid}})
        assert response.status_code==422 and 'passport_series' in response.text
    assert employee.patch(path+'/autosave',headers=employee_headers,json={'answers':{'passport_series':''}}).status_code==200
    assert employee.get(path,headers=employee_headers).json()['answers']['passport_series']==''
    assert employee.patch(path+'/autosave',headers=employee_headers,json={'answers':{'passport_series':'0012'}}).status_code==200
    generated=employee.post(path+'/generate',headers=employee_headers);assert generated.status_code==201,generated.text
    result=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
    assert result.paragraphs[0].text=='0012'


def test_question_deletion_lists_dependencies_and_preserves_other_versions():
    doc=Document();doc.add_paragraph('VALUE');raw=io.BytesIO();doc.save(raw)
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'DELETE_QUESTION_'+uuid.uuid4().hex[:8])
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('delete.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    a=manager.post(base+'/fields',headers=headers,json={'field_key':'source','label':'Источник','field_type':'TEXT','position':1});assert a.status_code==201
    condition={'operator':'NOT','condition':{'operator':'EQUALS','field_key':'source','value':'нет'}}
    b=manager.post(base+'/fields',headers=headers,json={'field_key':'dependent','label':'Зависимый','field_type':'TEXT','position':2,'visible_when':condition});assert b.status_code==201,b.text
    source_path=base+f"/fields/{a.json()['id']}"
    dependencies=manager.get(source_path+'/dependencies',headers=headers);assert dependencies.status_code==200
    assert any(item['kind']=='question' for item in dependencies.json()['dependencies'])
    blocked=manager.delete(source_path,headers=headers);assert blocked.status_code==409 and 'Зависимый' in blocked.text
    outsider=TestClient(app);outsider_headers=auth(outsider,'petrova')
    assert outsider.delete(source_path,headers=outsider_headers).status_code==403
    assert manager.delete(base+f"/fields/{b.json()['id']}",headers=headers).status_code==204
    region=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'conditional_value','region_type':'CONDITIONAL_PARAGRAPH','start_locator':next(item['locator'] for item in manager.get(base+'/preview',headers=headers).json()['nodes'] if item['text']=='VALUE'),'include_when':{'operator':'EQUALS','field_key':'source','value':'да'}});assert region.status_code==201,region.text
    assert any(item['kind']=='region' for item in manager.get(source_path+'/dependencies',headers=headers).json()['dependencies'])
    assert manager.delete(base+f"/conditional-regions/{region.json()['id']}",headers=headers).status_code==204
    node=next(item for item in manager.get(base+'/preview',headers=headers).json()['nodes'] if item['text']=='VALUE')
    binding=manager.post(base+'/bindings',headers=headers,json={'field_id':a.json()['id'],'locator':node['locator'],'start':0,'end':5,'selected_text':'VALUE'})
    assert binding.status_code==201,binding.text
    assert any(item['kind']=='binding' for item in manager.get(source_path+'/dependencies',headers=headers).json()['dependencies'])
    assert manager.delete(source_path,headers=headers).status_code==409
    assert manager.delete(base+f"/bindings/{binding.json()['id']}",headers=headers).status_code==204
    assert manager.delete(source_path,headers=headers).status_code==204
    assert manager.get(base+'/questionnaire',headers=headers).json()['fields']==[]
    survivor=manager.post(base+'/fields',headers=headers,json={'field_key':'survivor','label':'Оставшийся вопрос','field_type':'TEXT','position':1})
    assert survivor.status_code==201,survivor.text
    assert manager.post(base+'/bindings',headers=headers,json={'field_id':survivor.json()['id'],'locator':node['locator'],'start':0,'end':5,'selected_text':'VALUE'}).status_code==201
    assert manager.post(base+'/publish',headers=headers).status_code==200
    assert manager.delete(base+f"/fields/{survivor.json()['id']}",headers=headers).status_code==409


def deletion_test_template(label):
    doc=Document();doc.add_paragraph('VALUE');doc.add_paragraph('BOUND');raw=io.BytesIO();doc.save(raw)
    client=TestClient(app);headers=auth(client);template=create_platform_template(client,headers,label+'_'+uuid.uuid4().hex[:8])
    uploaded=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('delete.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert uploaded.status_code==201,uploaded.text
    base=f"/api/v1/document-templates/{template['id']}/versions/{uploaded.json()['id']}"
    return client,headers,base,raw.getvalue()


def confirmed_question_delete(client,headers,path,acknowledge=True):
    response=client.get(path+'/dependencies',headers=headers)
    assert response.status_code==200,response.text
    dependencies=response.json()['dependencies']
    deleted=client.request('DELETE',path,headers=headers,json={'confirmed_dependencies':[f"{item['kind']}:{item['id']}" for item in dependencies],'acknowledge_logic_change':acknowledge})
    return deleted,dependencies


def test_question_delete_without_dependencies_needs_no_cleanup():
    client,headers,base,_=deletion_test_template('DELETE_SIMPLE')
    field=client.post(base+'/fields',headers=headers,json={'field_key':'simple','label':'Простой вопрос','field_type':'TEXT','position':1}).json()
    path=base+f"/fields/{field['id']}"
    assert client.get(path+'/dependencies',headers=headers).json()['dependencies']==[]
    assert client.delete(path,headers=headers).status_code==204
    assert client.get(base+'/questionnaire',headers=headers).json()['fields']==[]


def test_question_delete_cleans_word_binding_and_keeps_source_unchanged():
    client,headers,base,original=deletion_test_template('DELETE_BINDING')
    field=client.post(base+'/fields',headers=headers,json={'field_key':'bound','label':'Привязанный вопрос','field_type':'TEXT','position':1}).json()
    locator=next(node['locator'] for node in client.get(base+'/preview',headers=headers).json()['nodes'] if node['text']=='VALUE')
    binding=client.post(base+'/bindings',headers=headers,json={'field_id':field['id'],'locator':locator,'start':0,'end':5,'selected_text':'VALUE'})
    assert binding.status_code==201,binding.text
    path=base+f"/fields/{field['id']}"
    assert client.delete(path,headers=headers).status_code==409
    deleted,dependencies=confirmed_question_delete(client,headers,path)
    assert deleted.status_code==204,deleted.text
    assert [item['kind'] for item in dependencies]==['binding']
    assert client.get(base+'/bindings',headers=headers).json()==[]
    assert client.get(base+'/source',headers=headers).content==original


def test_question_delete_keeps_conditional_region_and_always_includes_it():
    client,headers,base,original=deletion_test_template('DELETE_REGION')
    flag=client.post(base+'/fields',headers=headers,json={'field_key':'flag','label':'Показать текст','field_type':'BOOLEAN','position':1}).json()
    locator=next(node['locator'] for node in client.get(base+'/preview',headers=headers).json()['nodes'] if node['text']=='VALUE')
    created=client.post(base+'/conditional-regions',headers=headers,json={'region_key':'area','region_type':'CONDITIONAL_PARAGRAPH','start_locator':locator,'include_when':{'operator':'EQUALS','field_key':'flag','value':True}})
    assert created.status_code==201,created.text
    path=base+f"/fields/{flag['id']}"
    deleted,dependencies=confirmed_question_delete(client,headers,path)
    assert deleted.status_code==204,deleted.text
    assert [item['kind'] for item in dependencies]==['region']
    regions=client.get(base+'/conditional-regions',headers=headers).json()
    assert len(regions)==1 and regions[0]['include_when']=={'operator':'ALWAYS'}
    assert client.get(base+'/source',headers=headers).content==original
    keep=client.post(base+'/fields',headers=headers,json={'field_key':'keep','label':'Оставить текст','field_type':'TEXT','position':1})
    assert keep.status_code==201,keep.text
    other=next(node['locator'] for node in client.get(base+'/preview',headers=headers).json()['nodes'] if node['text']=='BOUND')
    assert client.post(base+'/bindings',headers=headers,json={'field_id':keep.json()['id'],'locator':other,'start':0,'end':5,'selected_text':'BOUND'}).status_code==201
    generated=client.post(base+'/test-drive',headers=headers,json={'answers':{'keep':'HELLO'}})
    assert generated.status_code==201,generated.text
    rendered=Document(io.BytesIO(client.get(generated.json()['download_url'],headers=headers).content))
    assert [paragraph.text for paragraph in rendered.paragraphs]==['VALUE','HELLO']


def test_question_delete_prunes_nested_conditions_without_empty_groups():
    client,headers,base,_=deletion_test_template('DELETE_NESTED')
    fields={}
    for position,key in enumerate(('aa','bb','cc'),1):
        response=client.post(base+'/fields',headers=headers,json={'field_key':key,'label':'Поле '+key,'field_type':'BOOLEAN','position':position})
        assert response.status_code==201,response.text
        fields[key]=response.json()
    rule={'operator':'AND','conditions':[{'operator':'OR','conditions':[{'operator':'EQUALS','field_key':'aa','value':True},{'operator':'EQUALS','field_key':'bb','value':True}]},{'operator':'NOT','condition':{'operator':'EQUALS','field_key':'cc','value':True}}]}
    dependent=client.post(base+'/fields',headers=headers,json={'field_key':'target','label':'Зависимый вопрос','field_type':'TEXT','position':4,'visible_when':rule,'required_when':{'operator':'NOT','condition':{'operator':'EQUALS','field_key':'bb','value':True}}})
    assert dependent.status_code==201,dependent.text
    path=base+f"/fields/{fields['bb']['id']}"
    dependencies=client.get(path+'/dependencies',headers=headers).json()['dependencies']
    assert len(dependencies)==2 and all(item['complex'] for item in dependencies)
    payload={'confirmed_dependencies':[f"{item['kind']}:{item['id']}" for item in dependencies]}
    assert client.request('DELETE',path,headers=headers,json=payload).status_code==409
    assert client.request('DELETE',path,headers=headers,json={**payload,'acknowledge_logic_change':True,'confirmed_dependencies':[]}).status_code==409
    deleted,_=confirmed_question_delete(client,headers,path)
    assert deleted.status_code==204,deleted.text
    target=next(item for item in client.get(base+'/questionnaire',headers=headers).json()['fields'] if item['field_key']=='target')
    assert target['config']['visible_when']=={'operator':'AND','conditions':[{'operator':'EQUALS','field_key':'aa','value':True},{'operator':'NOT','condition':{'operator':'EQUALS','field_key':'cc','value':True}}]}
    assert target['config']['required_when'] is None
    for key in ('cc','aa'):
        deleted,_=confirmed_question_delete(client,headers,base+f"/fields/{fields[key]['id']}")
        assert deleted.status_code==204,deleted.text
    target=next(item for item in client.get(base+'/questionnaire',headers=headers).json()['fields'] if item['field_key']=='target')
    assert target['config']['visible_when'] is None


def test_question_delete_resets_dependent_calculation_to_manual_field():
    client,headers,base,_=deletion_test_template('DELETE_CALCULATION')
    source=client.post(base+'/fields',headers=headers,json={'field_key':'amount','label':'Сумма','field_type':'INTEGER','position':1})
    assert source.status_code==201,source.text
    calculated=client.post(base+'/fields',headers=headers,json={'field_key':'total','label':'Итого','field_type':'INTEGER','position':2,'calculated':True,'expression':{'source':'FIELD','field_key':'amount'}})
    assert calculated.status_code==201,calculated.text
    deleted,dependencies=confirmed_question_delete(client,headers,base+f"/fields/{source.json()['id']}")
    assert deleted.status_code==204,deleted.text
    assert [item['kind'] for item in dependencies]==['calculation']
    remaining=client.get(base+'/questionnaire',headers=headers).json()['fields']
    assert len(remaining)==1 and remaining[0]['field_key']=='total'
    assert remaining[0]['config']['calculated'] is False and remaining[0]['config']['expression'] is None


def test_question_delete_rolls_back_all_cleanup_when_validation_fails():
    client,headers,base,_=deletion_test_template('DELETE_ROLLBACK')
    field=client.post(base+'/fields',headers=headers,json={'field_key':'source','label':'Источник','field_type':'TEXT','position':1}).json()
    locator=next(node['locator'] for node in client.get(base+'/preview',headers=headers).json()['nodes'] if node['text']=='VALUE')
    binding=client.post(base+'/bindings',headers=headers,json={'field_id':field['id'],'locator':locator,'start':0,'end':5,'selected_text':'VALUE'})
    assert binding.status_code==201,binding.text
    region=client.post(base+'/conditional-regions',headers=headers,json={'region_key':'visible','region_type':'CONDITIONAL_PARAGRAPH','start_locator':locator,'include_when':{'operator':'IS_NOT_EMPTY','field_key':'source'}})
    assert region.status_code==201,region.text
    path=base+f"/fields/{field['id']}"
    with patch('app.contract_platform.validate_calculations',side_effect=HTTPException(422,detail='Проверка прервана')):
        deleted,_=confirmed_question_delete(client,headers,path)
    assert deleted.status_code==422
    assert client.get(base+'/questionnaire',headers=headers).json()['fields'][0]['id']==field['id']
    assert client.get(base+'/bindings',headers=headers).json()[0]['id']==binding.json()['id']
    assert client.get(base+'/conditional-regions',headers=headers).json()[0]['include_when']=={'operator':'IS_NOT_EMPTY','field_key':'source'}


def configure_platform_field(client,headers,template,version,field_key='customer_name',label='Наименование заказчика',occurrences=1):
    field=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/fields",headers=headers,json={'field_key':field_key,'label':label,'field_type':'TEXT','required':True,'position':1,'group':'Стороны'}).json()
    preview=client.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/preview",headers=headers).json()
    matches=[]
    for node in preview['nodes']:
        start=0
        while (index:=node['text'].find('АО «НСПК»',start))>=0:
            matches.append((node,index)); start=index+1
    assert len(matches)>=occurrences
    for node,index in matches[:occurrences]:
        response=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/bindings",headers=headers,json={'field_id':field['id'],'locator':node['locator'],'start':index,'end':index+len('АО «НСПК»'),'selected_text':'АО «НСПК»'})
        assert response.status_code==201,response.text
    return field


def repeating_contract_docx_bytes(vertical_merge=False) -> bytes:
    document=Document(); document.add_paragraph('Заказчик: CUSTOMER')
    table=document.add_table(rows=3,cols=2); table.style='Table Grid'
    table.rows[0].cells[0].text='Дата'; table.rows[0].cells[1].text='Место'
    date_cell=table.rows[1].cells[0]; date_cell.text=''; p=date_cell.paragraphs[0]; p.add_run('DA'); p.add_run('TE'); date_cell.add_paragraph('Дополнительная строка')
    table.rows[1].cells[1].text='PLACE'
    table.rows[2].cells[0].merge(table.rows[2].cells[1]).text='ИТОГО'
    if vertical_merge:
        properties=table.rows[1].cells[0]._tc.get_or_add_tcPr(); marker=OxmlElement('w:vMerge'); marker.set(qn('w:val'),'restart'); properties.append(marker)
    payload=io.BytesIO(); document.save(payload); return payload.getvalue()


def multirow_contract_docx_bytes(block_size=2, source_repetitions=2, vertical_merge=False) -> bytes:
    document=Document(); document.add_paragraph('Служебное поле')
    table=document.add_table(rows=1+block_size*source_repetitions+1,cols=2); table.style='Table Grid'
    table.rows[0].cells[0].text='График';table.rows[0].cells[1].text='Данные'
    for repetition in range(source_repetitions):
        start=1+repetition*block_size
        if vertical_merge:table.rows[start].cells[0].text='MONTH';table.rows[start].cells[1].text='META'
        else:table.rows[start].cells[0].merge(table.rows[start].cells[1]).text='MONTH'
        table.rows[start+1].cells[0].text='DATE';table.rows[start+1].cells[1].text='PLACE'
        for offset in range(2,block_size):table.rows[start+offset].cells[0].merge(table.rows[start+offset].cells[1]).text=f'NOTE{offset}'
    table.rows[-1].cells[0].merge(table.rows[-1].cells[1]).text='ИТОГО'
    if vertical_merge:
        table.rows[1].cells[0].merge(table.rows[2].cells[0])
    payload=io.BytesIO();document.save(payload);return payload.getvalue()


def configure_repeating_platform(client,headers,code,vertical_merge=False,min_items=0,max_items=10,visible_when=None):
    template=create_platform_template(client,headers,code)
    raw=repeating_contract_docx_bytes(vertical_merge)
    version=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('repeat.docx',raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    preview=client.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/preview",headers=headers).json()
    node=lambda text: next(x for x in preview['nodes'] if text in x['text'])
    customer=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/fields",headers=headers,json={'field_key':'customer_name','label':'Заказчик','field_type':'TEXT','required':True,'position':1}).json(); customer_node=node('CUSTOMER'); customer_start=customer_node['text'].index('CUSTOMER')
    linked=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/bindings",headers=headers,json={'field_id':customer['id'],'locator':customer_node['locator'],'start':customer_start,'end':customer_start+8,'selected_text':'CUSTOMER'}); assert linked.status_code==201,linked.text
    date_node=node('DATE')
    response=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/repeating-groups",headers=headers,json={'group_key':'schedule','name':'График тренировок','description':'Добавьте тренировки','min_items':min_items,'max_items':max_items,'required':False,'position':1,'row_locator':date_node['locator'],'visible_when':visible_when})
    if vertical_merge: return template,version,raw,response,None
    assert response.status_code==201,response.text
    group=response.json(); fields=[]
    for position,(key,label,kind,needle) in enumerate((('date','Дата','DATE','DATE'),('place','Место','TEXT','PLACE')),1):
        field=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':key,'label':label,'field_type':kind,'required':True,'position':position}).json(); target=node(needle); start=target['text'].index(needle)
        bound=client.put(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/repeating-groups/{group['id']}/fields/{field['id']}/binding",headers=headers,json={'locator':target['locator'],'start':start,'end':start+len(needle),'selected_text':needle})
        assert bound.status_code==200,bound.text; fields.append(bound.json())
    return template,version,raw,response,group


def test_structural_candidate_materialization_is_reviewed_idempotent_and_draft_only():
    with TestClient(app) as client:
        headers=auth(client); template=create_platform_template(client,headers,'MATERIALIZATION_POC')
        raw=contract_docx_bytes(); version=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('candidate.docx',raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
        field=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/fields",headers=headers,json={'field_key':'customer_name','label':'Заказчик','field_type':'TEXT','required':True,'position':1}).json()
        preview=client.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/preview",headers=headers).json();node=next(x for x in preview['nodes'] if 'АО «НСПК»' in x['text']);start=node['text'].index('АО «НСПК»')
        candidate={'candidate_id':'O001:TEST','occurrence_id':'O001','rf_id':'RF001','field_path':'customer_name','variant':'TEST','matrix_location':'P0','locator':node['locator'],'part':node['part'],'structure_fingerprint':preview['structure_fingerprint'],'start':start,'end':start+len('АО «НСПК»'),'selected_text':'АО «НСПК»','context':node['text'],'operation':'REPLACE','status':'CANDIDATE_FOUND'}
        session=SessionLocal();stored=session.get(TemplateVersion,version['id']);stored.preview_metadata={**(stored.preview_metadata or {}),'binding_candidates':[candidate]};session.commit();session.close()
        response=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/binding-candidates/auto-materialize",headers=headers);assert response.status_code==200,response.text
        assert response.json()['materialized']==['O001:TEST']
        session=SessionLocal();assert session.query(DocumentBinding).filter_by(template_version_id=version['id']).count()==1;session.close()
        repeated=client.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/binding-candidates/auto-materialize",headers=headers);assert repeated.status_code==200
        session=SessionLocal();assert session.query(DocumentBinding).filter_by(template_version_id=version['id']).count()==1;session.close()
        rolled=client.delete(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/binding-candidates/O001:TEST/materialization",headers=headers);assert rolled.status_code==200,rolled.text
        session=SessionLocal();assert session.query(DocumentBinding).filter_by(template_version_id=version['id']).count()==0;session.close()


def test_derived_candidate_requires_calculated_field_and_exact_reviewed_range():
    from app.binding_materialization import candidate_is_resolved
    with TestClient(app) as client:
        headers=auth(client);template=create_platform_template(client,headers,'DERIVED_MATERIALIZATION')
        version=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('derived.docx',contract_docx_bytes(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
        base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
        assert client.post(base+'/fields',headers=headers,json={'field_key':'vat','label':'НДС','field_type':'SINGLE_SELECT','required':True,'position':1,'options':['YES','NO']}).status_code==201
        assert client.post(base+'/fields',headers=headers,json={'field_key':'clause','label':'Пункт','field_type':'TEXT','required':False,'position':2,'calculated':True,'text_expression':{'operation':'IF','condition':{'operator':'EQUALS','field_key':'vat','value':'YES'},'then':{'literal':'Есть НДС'},'else':{'literal':'Нет НДС'}}}).status_code==201
        preview=client.get(base+'/preview',headers=headers).json();node=next(x for x in preview['nodes'] if 'Заказчик:' in x['text'])
        candidate={'candidate_id':'O013:TEST','occurrence_id':'O013','rf_id':'RF010','field_path':'clause','variant':'TEST','matrix_location':'P0','locator':node['locator'],'part':node['part'],'structure_fingerprint':preview['structure_fingerprint'],'start':0,'end':len(node['text']),'selected_text':node['text'],'context':node['text'],'operation':'DERIVED','status':'REVIEW_REQUIRED','review_decision':'CONFIRMED'}
        alias={**candidate,'candidate_id':'O014:TEST','occurrence_id':'O014','status':'STRUCTURAL_ALIAS','alias_of_candidate_id':'O013:TEST','materialized_id':None}
        session=SessionLocal();stored=session.get(TemplateVersion,version['id']);stored.preview_metadata={**(stored.preview_metadata or {}),'binding_candidates':[candidate,alias]};session.commit();session.close()
        auto=client.post(base+'/binding-candidates/auto-materialize',headers=headers);assert auto.status_code==200 and auto.json()['materialized']==[]
        made=client.post(base+'/binding-candidates/O013:TEST/materialize',headers=headers);assert made.status_code==200,made.text
        session=SessionLocal();stored=session.get(TemplateVersion,version['id']);items=stored.preview_metadata['binding_candidates'];assert candidate_is_resolved(session,stored,items[1],items);session.close()
        rolled=client.delete(base+'/binding-candidates/O013:TEST/materialization',headers=headers);assert rolled.status_code==200,rolled.text
        session=SessionLocal();stored=session.get(TemplateVersion,version['id']);items=stored.preview_metadata['binding_candidates'];assert not candidate_is_resolved(session,stored,items[1],items);session.close()


def test_conditional_run_beside_word_field_keeps_field_and_allows_nested_payment_clause():
    from types import SimpleNamespace
    from app.contract_platform import _regions_overlap, _safe_text_range_around_word_fields, replace_range
    paragraph=Document().add_paragraph();paragraph.add_run('Оплата ')
    field_run=paragraph.add_run();begin=OxmlElement('w:fldChar');begin.set(qn('w:fldCharType'),'begin');field_run._r.append(begin)
    paragraph.add_run('[срок]')
    field_run=paragraph.add_run();end=OxmlElement('w:fldChar');end.set(qn('w:fldCharType'),'end');field_run._r.append(end)
    paragraph.add_run(' и предоставления банковской гарантии.')
    source=paragraph.text;start=source.index(' и предоставления');finish=source.index('.',start)
    assert _safe_text_range_around_word_fields(paragraph._p,start,finish)
    assert not _safe_text_range_around_word_fields(paragraph._p,source.index('[срок]'),source.index('[срок]')+len('[срок]'))
    part='word/document.xml';node=f'{part}#/p[1]'
    parent=SimpleNamespace(region_type='CONDITIONAL_PARAGRAPH_GROUP',locator={'part':part,'nodes':[node]})
    child=SimpleNamespace(region_type='CONDITIONAL_RUN',locator={'part':part,'node':node,'text_start':start,'text_end':finish})
    assert not _regions_overlap(parent,child)
    replace_range(paragraph._p,start,finish,'')
    assert paragraph.text=='Оплата [срок].'
    assert len(paragraph._p.findall('.//'+qn('w:fldChar')))==2


def test_conditional_row_alias_becomes_unresolved_after_anchor_rollback():
    from app.binding_materialization import candidate_is_resolved
    with TestClient(app) as client:
        headers=auth(client);template=create_platform_template(client,headers,'ROW_ALIAS_ROLLBACK')
        version=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('rows.docx',contract_docx_bytes(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
        base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
        assert client.post(base+'/fields',headers=headers,json={'field_key':'extra_option.enabled','label':'Дополнительная опция','field_type':'BOOLEAN','position':1}).status_code==201
        preview=client.get(base+'/preview',headers=headers).json();start=next(item for item in preview['nodes'] if item['text']=='Срок');alias_node=next(item for item in preview['nodes'] if item['text']=='30 дней')
        created=client.post(base+'/conditional-regions',headers=headers,json={'region_key':'extra_row','region_type':'CONDITIONAL_TABLE_ROW','start_locator':start['locator'],'include_when':{'operator':'EQUALS','field_key':'extra_option.enabled','value':True}})
        assert created.status_code==201,created.text
        anchor={'candidate_id':'O048:TEST','rf_id':'RF022','field_path':'extra_option.enabled','structure_fingerprint':preview['structure_fingerprint'],'status':'CONFIGURED','materialized_type':'CONDITIONAL_DOCUMENT_REGION','materialized_id':created.json()['id']}
        alias={'candidate_id':'O049:TEST','rf_id':'RF022','field_path':'extra_option.enabled','structure_fingerprint':preview['structure_fingerprint'],'status':'STRUCTURAL_ALIAS','alias_of_candidate_id':'O048:TEST','locator':alias_node['locator']}
        session=SessionLocal();stored=session.get(TemplateVersion,version['id'])
        assert candidate_is_resolved(session,stored,alias,[anchor,alias])
        assert not candidate_is_resolved(session,stored,alias,[{**anchor,'status':'REVIEW_REQUIRED'},alias])
        assert not candidate_is_resolved(session,stored,{**alias,'locator':start['locator'].replace('/tr[2]','/tr[1]')},[anchor,alias])
        session.close()


def test_clarification_asks_only_one_atomic_field():
    question, fields, _ = clarification(['purpose', 'deadline'], [], 0)
    assert fields == ['purpose']
    assert 'цель' in question.lower() and 'срок' not in question.lower()


def test_clarification_never_exposes_internal_field_name():
    question, _, _ = clarification(['subject'], [], 0)
    assert question == 'Укажите предмет закупки.' and 'subject' not in question.lower()
    fallback, _, _ = clarification(['internal_unknown'], [], 0)
    assert fallback == 'Уточните, пожалуйста, сведения о закупке.' and 'internal_unknown' not in fallback


def test_full_flow_and_versions():
    client = TestClient(app); headers = auth(client)
    case_id = client.post('/api/v1/cases', headers=headers, json={'title': 'Лендинг'}).json()['id']
    response = client.post(f'/api/v1/cases/{case_id}/messages', headers=headers, json={'content': 'Нужно заказать разработку лендинга для мероприятия'})
    assert response.json()['state'] == 'COLLECTING_SPEC_DATA'
    for answer in ['Продвижение мероприятия', 'Создать адаптивный лендинг', '30 ноября 2026 года', 'Соответствие требованиям']:
        response = client.post(f'/api/v1/cases/{case_id}/messages', headers=headers, json={'content': answer})
    assert response.json()['state'] == 'SPEC_REVIEW'
    spec = client.patch(f'/api/v1/cases/{case_id}/technical-specification', headers=headers, json={'changes': [{'field': 'deadline', 'value': '2026-11-30'}]})
    assert spec.json()['version'] == 3 and spec.json()['data']['purpose'] == 'Продвижение мероприятия'
    recommendation = client.post(f'/api/v1/cases/{case_id}/technical-specification/confirm', headers=headers)
    assert recommendation.json()['status'] == 'matched'
    assert client.get(f'/api/v1/cases/{case_id}/technical-specification/download').status_code == 200


def test_permissions_and_escalation():
    ivan = TestClient(app); ivan_headers = auth(ivan)
    case_id = ivan.post('/api/v1/cases', headers=ivan_headers, json={}).json()['id']
    anna = TestClient(app); auth(anna, 'petrova')
    assert anna.get(f'/api/v1/cases/{case_id}').status_code == 404
    response = ivan.post(f'/api/v1/cases/{case_id}/messages', headers=ivan_headers, json={'content': 'Мне нужен личный юридический совет'})
    assert response.json()['state'] == 'ESCALATED_TO_DPO'


def test_upload_docx_analysis_and_contract_download():
    document = Document(); document.add_paragraph('Техническое задание: разработка корпоративного лендинга. Срок 30 ноября 2026 года.')
    buffer = io.BytesIO(); document.save(buffer)
    client = TestClient(app); headers = auth(client)
    case_id = client.post('/api/v1/cases', headers=headers, json={'title': 'Готовое ТЗ'}).json()['id']
    response = client.post(f'/api/v1/cases/{case_id}/attachments', headers=headers, files={'file': ('tz.docx', buffer.getvalue(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert response.status_code == 200 and response.json()['analysis_ready']
    recommendation = client.post(f'/api/v1/cases/{case_id}/technical-specification/confirm', headers=headers)
    assert recommendation.json()['status'] == 'matched'
    assert client.get(f'/api/v1/cases/{case_id}/contract-template').status_code == 200


def test_sessions_csrf_ownership_and_switching():
    ivan = TestClient(app); ivan_headers = auth(ivan)
    assert ivan.get('/api/v1/auth/me').json()['user']['email'] == 'ivanov@nspk.local'
    case_id = ivan.post('/api/v1/cases', headers=ivan_headers, json={}).json()['id']
    assert ivan.post('/api/v1/cases', json={}).status_code == 403
    ivan.post(f'/api/v1/cases/{case_id}/messages', headers=ivan_headers, json={'content': 'Нам нужно купить велосипеды'})
    assert ivan.get(f'/api/v1/cases/{case_id}').json()['title'] == 'Закупка велосипедов'

    anna = TestClient(app); anna_headers = auth(anna, 'petrova')
    assert case_id not in [item['id'] for item in anna.get('/api/v1/cases').json()]
    attempts = [
        anna.get(f'/api/v1/cases/{case_id}'),
        anna.patch(f'/api/v1/cases/{case_id}', headers=anna_headers, json={'title': 'чужое'}),
        anna.post(f'/api/v1/cases/{case_id}/messages', headers=anna_headers, json={'content': 'чужое'}),
        anna.post(f'/api/v1/cases/{case_id}/attachments', headers=anna_headers, files={'file': ('x.docx', b'x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}),
        anna.get(f'/api/v1/cases/{case_id}/technical-specification/download'),
    ]
    assert all(response.status_code == 404 for response in attempts)
    anna_case = anna.post('/api/v1/cases', headers=anna_headers, json={'title': 'Обучение сотрудников'}).json()['id']
    assert anna.post('/api/v1/auth/logout', headers=anna_headers).status_code == 200
    assert anna.get('/api/v1/auth/me').status_code == 401
    assert case_id in [item['id'] for item in ivan.get('/api/v1/cases').json()]
    assert anna_case not in [item['id'] for item in ivan.get('/api/v1/cases').json()]


def test_login_cookie_and_rate_limit():
    client = TestClient(app)
    response = client.post('/api/v1/auth/login', json={'external_id': 'Ivanov', 'password': 'Ivanov'})
    assert response.status_code == 200 and 'session_id' not in response.json()
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie
    for _ in range(5):
        assert client.post('/api/v1/auth/login', json={'external_id': 'rate-limit-probe', 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'external_id': 'rate-limit-probe', 'password': 'wrong-password'}).status_code == 429


def spreadsheet_bytes() -> bytes:
    workbook = openpyxl.Workbook(); sheet = workbook.active; sheet.title = 'Спецификация'
    sheet['B1'] = 'Спецификация'
    for column,value in enumerate(['Наименование','Характеристики','Кол-во','Стоимость (руб., c учетом НДС)','Срок поставки (рабочих дней)','Гарантия','Ссылки на ресурс, при наличии','Адрес поставки'],2): sheet.cell(2,column,value)
    first=['Ноутбук Альфа','RAM 16 ГБ; SSD 512 ГБ',3,300000,20,'24 месяца','https://example.test/notebook-a\nhttps://example.test/notebook-b','Москва']
    second=['Ноутбук Бета','RAM 32 ГБ; SSD 1 ТБ',2,250000,20,'36 месяцев','','Москва']
    for row_index,values in enumerate((first,second),3):
        sheet.cell(row_index,1,row_index-2)
        for column,value in enumerate(values,2): sheet.cell(row_index,column,value)
    sheet['H3'].hyperlink = 'https://example.test/notebook-a'
    sheet['C5']='Блокирующие требования:\n- Не допускается восстановленное оборудование\n- Без замены на аналоги'
    requirements = workbook.create_sheet('Требования')
    requirements.append(['Общие требования','Только поставка, без установки'])
    requirements.append(['Срок поставки','20 рабочих дней'])
    buffer = io.BytesIO(); workbook.save(buffer); return buffer.getvalue()


def test_contract_only_without_specification_and_download():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    response=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Хотим купить 5 ноутбуков у юридического лица, только поставка.'})
    body=response.json(); assert body['technical_specification'] is None
    assert body['procurement_context']['intent']=='GET_CONTRACT' and body['procurement_context']['installation_required'] is False
    assert body['recommendation']['status']=='MATCHED'
    assert client.get(f'/api/v1/cases/{case_id}/contract-template').status_code==200


def test_contract_ambiguity_then_clarification_and_legal_review():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    first=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Хотим купить 5 ноутбуков у юридического лица.'}).json()
    assert first['technical_specification'] is None and first['recommendation']['template_code']=='SUPPLY'
    second=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Только поставка, без установки.'}).json()
    assert second['recommendation']['status']=='MATCHED'
    review_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    review=client.post(f'/api/v1/cases/{review_id}/messages',headers=headers,json={'content':'Нужен договор, требуется юридическая экспертиза.'}).json()
    assert review['state']=='ESCALATED_TO_DPO'


def test_spreadsheet_parser_xlsx_and_xls():
    with tempfile.TemporaryDirectory() as directory:
        xlsx=Path(directory)/'sample.xlsx'; xlsx.write_bytes(spreadsheet_bytes())
        parsed=SpreadsheetSpecificationParser().parse(xlsx,'.xlsx')
        assert len(parsed['items'])==2 and parsed['items'][0]['quantity']==3
        assert '16 ГБ' in parsed['items'][0]['characteristics']
        assert len(parsed['items'][0]['references'].splitlines())==2
        assert any('восстановленное' in item for item in parsed['blocking_requirements'])
        assert parsed['delivery_terms']=='20 рабочих дней'
        book=xlwt.Workbook(); sheet=book.add_sheet('Спецификация')
        for column,value in enumerate(['Наименование','Количество','Единица измерения','Характеристики']): sheet.write(0,column,value)
        for column,value in enumerate(['Ноутбук',4,'шт.','RAM 16 ГБ']): sheet.write(1,column,value)
        xls=Path(directory)/'sample.xls'; book.save(str(xls))
        assert SpreadsheetSpecificationParser().parse(xls,'.xls')['items'][0]['quantity']==4


def test_xlsx_upload_one_file_and_corruption():
    client=TestClient(app); headers=auth(client)
    bad_id=client.post('/api/v1/cases',headers=headers,json={}).json()['id']
    bad=client.post(f'/api/v1/cases/{bad_id}/attachments',headers=headers,files={'file':('broken.xlsx',b'not-a-workbook','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert bad.status_code==422
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    upload=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert upload.status_code==200
    spec=upload.json()['case']['technical_specification']['data']; assert len(spec['items'])==2
    second=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('second.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert second.status_code==409


def test_xlsx_context_selects_same_approved_supply_template():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    upload=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    assert upload.status_code==200
    body=upload.json()['case']
    assert body['technical_specification']['data']['kind']=='SUPPLY'
    assert body['procurement_context']['specification_template']=='SUPPLY'


def test_consistent_docx_pdf_xlsx_exports():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    # Supply output is intentionally limited to the approved DOCX and cannot
    # be generated before the imported data has passed validation.
    assert client.get(f'/api/v1/cases/{case_id}/technical-specification/download?format=docx').status_code==409


def test_search_delete_and_ownership():
    ivan=TestClient(app); ih=auth(ivan); anna=TestClient(app); ah=auth(anna,'petrova')
    own_case=ivan.post('/api/v1/cases',headers=ih,json={'title':'Секретные велосипеды'}).json()['id']
    foreign=anna.post('/api/v1/cases',headers=ah,json={'title':'Секретные ноутбуки'}).json()['id']
    results=ivan.get('/api/v1/cases?q=Секретные').json()
    assert own_case in [item['id'] for item in results] and foreign not in [item['id'] for item in results]
    assert ivan.delete(f'/api/v1/cases/{foreign}',headers=ih).status_code==404
    assert ivan.delete(f'/api/v1/cases/{own_case}',headers=ih).status_code==204
    assert ivan.get(f'/api/v1/cases/{own_case}').status_code==404


def test_four_approved_contracts_and_original_download_bytes():
    scenarios={
        'SUPPLY':('Нужен договор: купить 10 ноутбуков, только поставка без установки','договор поставки.rtf','application/rtf'),
        'SERVICES':('Нужен договор: заказать консультационные услуги','договор возмездного оказания услуг (образец).docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        'WORKS':('Нужен договор: выполнить ремонт помещения','Договор_подряда.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        'AGENCY':('Нужен договор: агент должен по поручению закупить материалы у третьих лиц, доставить их и предоставить отчёт агента за вознаграждение','Shablon-agentskogo-dogovora.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    }
    client=TestClient(app); headers=auth(client)
    for code,(message,filename,mime) in scenarios.items():
        case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':message}).json()
        assert body['recommendation']['status']=='MATCHED'
        assert body['recommendation']['template_code']==code
        response=client.get(f'/api/v1/cases/{case_id}/contract-template')
        assert response.status_code==200 and response.headers['content-type'].startswith(mime)
        assert quote(filename) in response.headers['content-disposition']
        assert hashlib.sha256(response.content).hexdigest()==hashlib.sha256((template_directory/filename).read_bytes()).hexdigest()


def test_rules_fallbacks_are_deterministic():
    from app.contracts import select_contract
    from app.db import SessionLocal
    db=SessionLocal()
    base={'subject':'Закупка'}
    assert select_contract(db,{**base,'requires_transfer_of_goods':True,'requires_tangible_work_result':True}).status=='AMBIGUOUS'
    assert select_contract(db,{}).status=='AMBIGUOUS'
    assert select_contract(db,{**base,'category':'software_license','licensing_required':True}).status=='NO_MATCH'
    assert select_contract(db,{**base,'exceptions':['Нестандартные условия']}).status=='LEGAL_REVIEW_REQUIRED'
    db.close()


def test_training_dialogue_persists_facts_and_selects_physical_template():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    first=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужен тренер для проведения платных тренировок, лично, без третьих лиц.'}).json()
    assert first['state']=='TRAINING_APPLICABILITY' and first['procurement_context']['training_facts']['subject']['type']=='TRAINING_SERVICE'
    assert first['procurement_context']['contract_domain']=='training'
    second=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Обычное физлицо без ИП, гражданин РФ, совершеннолетний.'}).json()
    assert second['state']=='TRAINING_TEMPLATE_SELECTED' and second['recommendation']['template_code']=='PHYSICAL_PERSON'
    assert second['procurement_context']['training_decision']['matched_rule_id']=='D020'


def test_contract_router_keeps_supply_and_services_in_generic_engine():
    client=TestClient(app); headers=auth(client)
    supply_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    supply=client.post(f'/api/v1/cases/{supply_id}/messages',headers=headers,json={'content':'Нужно купить ноутбуки, только поставка без установки.'}).json()
    assert supply['recommendation']['template_code']=='SUPPLY' and supply['procurement_context'].get('contract_domain')!='training'
    service_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    service=client.post(f'/api/v1/cases/{service_id}/messages',headers=headers,json={'content':'Нужно заказать консультационные услуги.'}).json()
    assert service['recommendation']['template_code']=='SERVICES' and service['procurement_context'].get('contract_domain')!='training'


def test_contract_router_training_ip_npd_and_clarification():
    client=TestClient(app); headers=auth(client)
    for phrase,template,status in [
        ('Нужен тренер. ИП без НПД, лично, без третьих лиц.','INDIVIDUAL_ENTREPRENEUR','NEEDS_INPUT'),
        ('Нужен тренер. Исполнитель самозанятый плательщик НПД.','', 'BLOCKED'),
    ]:
        case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':phrase}).json()
        assert body['procurement_context']['contract_domain']=='training'
        assert body['recommendation']['template_code']==template and body['recommendation']['status']==status
    unclear_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    unclear=client.post(f'/api/v1/cases/{unclear_id}/messages',headers=headers,json={'content':'Нужно организовать занятия сотрудникам.'}).json()
    assert unclear['procurement_context']['pending_contract_domain']=='training'
    confirmed=client.post(f'/api/v1/cases/{unclear_id}/messages',headers=headers,json={'content':'Да'}).json()
    assert confirmed['procurement_context']['contract_domain']=='training'


def test_training_composite_yes_and_explicit_answers_via_api():
    client=TestClient(app); headers=auth(client)
    for answer in ('Да','ЛИЧНО БЕЗ ПРИВЛЕЧЕНИЯ ДРУГИХ ЛИЦ'):
        case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
        first=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужен тренер для проведения тренировок, исполнитель физлицо без ИП и НПД'}).json()
        pending=first['procurement_context']['pending_clarification']
        assert pending['question_id']=='TRAINING_PERFORMANCE_COMPOSITE'
        assert first['procurement_context']['training_facts']['contractor']['status']=='PHYSICAL_NO_IP_NO_NPD'
        previous_question=first['messages'][-1]['content']
        second=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':answer}).json()
        persisted=client.get(f'/api/v1/cases/{case_id}').json()
        performance=persisted['procurement_context']['training_facts']['performance']
        assert persisted['procurement_context']['training_facts']['contractor']['status']=='PHYSICAL_NO_IP_NO_NPD'
        assert performance['personal'] is True and performance['third_parties'] is False
        assert persisted['messages'][-1]['content']!=previous_question
        assert not {'performance.personal','performance.third_parties'} & set(persisted['procurement_context']['pending_clarification']['target_fields'])
        assert persisted['recommendation']['contract_status_text']=='Подходит шаблон для физического лица',persisted['procurement_context']['training_decision']


def test_training_composite_no_requests_disambiguation_without_inference():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужен тренер для тренировок, исполнитель физлицо без ИП и НПД'})
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нет'}).json()
    assert body['procurement_context']['training_facts']['performance']=={'personal':None,'third_parties':None}
    assert body['procurement_context']['pending_clarification']['question_id']=='TRAINING_PERFORMANCE_DISAMBIGUATION'
    assert 'Уточните' in body['messages'][-1]['content']


def run_training_dialogue(client,headers,initial,vat='NO_VAT',schedule_answer='2026-11-10, вторник, 10:00, 1, 120000, Москва'):
    answers={
      'service.name':'Проведение тренировок по плаванию','term.start':'2026-11-01','term.end':'2027-01-31',
      'price.total':'120 000 рублей','tax.ndfl_rate':'13%','tax.ndfl_amount':'15 600 рублей',
      'tax.vat_status':'Без НДС' if vat=='NO_VAT' else 'С НДС','tax.no_vat_basis':'Применение УСН',
      'tax.vat_rate':'20%','tax.vat_amount':'20 000 рублей','payment.model':'Постоплата',
      'payment.postpay_percent':'100%','payment.postpay_days':'10 дней','places.multiple_or_not_in_contract':'Нет',
      'schedule.months':'2026-10','schedule.entries':schedule_answer,
      'extra_option.enabled':'Нет','physical.passport':'45 01 123456, выдан 01.01.2020',
      'physical.snils':'123-456-789 00','ip.ogrnip':'123456789012345','ip.long_term_resources_clause':'Нет',
    }
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':initial}).json()
    seen=[]; turns=1
    while body['state']!='TRAINING_READY':
        assert body['state']!='TRAINING_BLOCKED',body['messages'][-1]['content']
        pending=body['procurement_context']['pending_clarification']; question_id=pending['question_id']
        assert question_id not in seen,(question_id,body['messages'][-1]['content'])
        seen.append(question_id)
        path=pending['target_paths'][0]
        assert path in answers,(path,pending)
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':answers[path]}).json(); turns+=1
        assert turns<30
    assert body['procurement_context']['training_decision']['render_status']=='READY'
    assert not body['procurement_context']['missing_fields']
    download=client.get(f'/api/v1/cases/{case_id}/contract-template')
    assert download.status_code==200 and download.content[:2]==b'PK'
    return body,turns


def test_sequential_full_physical_flow_reaches_ready_and_generates_docx():
    client=TestClient(app); headers=auth(client)
    body,turns=run_training_dialogue(client,headers,'Нужен тренер, обычное физлицо без ИП и НПД, гражданин РФ, совершеннолетний, проводит лично без привлечения других лиц')
    assert body['recommendation']['template_code']=='PHYSICAL_PERSON' and turns==15


def test_sequential_full_ip_no_vat_and_vat_flows_reach_ready():
    client=TestClient(app); headers=auth(client)
    base='Нужен тренер ИП без НПД, проводит лично без привлечения других лиц'
    no_vat,no_vat_turns=run_training_dialogue(client,headers,base,'NO_VAT')
    vat,vat_turns=run_training_dialogue(client,headers,base,'VAT_PAYER')
    assert no_vat['recommendation']['template_code']=='INDIVIDUAL_ENTREPRENEUR' and no_vat_turns==14
    assert vat['recommendation']['template_code']=='INDIVIDUAL_ENTREPRENEUR' and vat_turns==15


def test_training_negative_flows_stop_before_red_fields():
    client=TestClient(app); headers=auth(client)
    for phrase in ('Нужен тренер самозанятый НПД','Нужен тренер юридическое лицо ООО Ромашка','Нужен иностранный тренер','Нужен несовершеннолетний тренер','Нужен тренер, будут ещё другие тренеры','Нужен тренер в штат на оклад'):
        case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':phrase}).json()
        assert body['state']=='TRAINING_BLOCKED',phrase
        assert body['procurement_context']['pending_clarification'] is None


def test_full_api_schedule_with_three_rows_and_address_commas_progresses():
    client=TestClient(app); headers=auth(client)
    schedule='20.10.2026, вторник, 19:00, 1, 5000 руб., Москва, ул. Большая Татарская, 11; 22.10.2026, четверг, 19:00, 1, 5000 руб., Москва, ул. Большая Татарская, 11; 27.10.2026, вторник, 19:00, 1, 5000 руб., Москва, ул. Большая Татарская, 11'
    body,_=run_training_dialogue(client,headers,'Нужен тренер, обычное физлицо без ИП и НПД, гражданин РФ, совершеннолетний, проводит лично без привлечения других лиц',schedule_answer=schedule)
    entries=body['procurement_context']['training_facts']['schedule']['entries']
    assert len(entries)==3 and [entry['date'] for entry in entries]==['20.10.2026','22.10.2026','27.10.2026']
    assert all(entry['place']=='Москва, ул. Большая Татарская, 11' for entry in entries)
    assert body['procurement_context']['pending_clarification'] is None


def test_mixed_contract_flow_returns_clarification():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужен договор: купить оборудование и выполнить большой комплекс монтажа'}).json()
    assert body['recommendation']['status']=='AMBIGUOUS'
    assert 'основным предметом' in body['recommendation']['reason']
    assert client.get(f'/api/v1/cases/{case_id}/contract-template').status_code==404


def contract_conversation(client,headers,messages):
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    states=[]
    for message in messages:
        states.append(client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':message}).json())
    return case_id,states


def test_equivalent_service_answers_resolve_goods_services_question():
    client=TestClient(app); headers=auth(client)
    for answer in ('Оказание услуги','Самостоятельное оказание услуги','Услуга'):
        _,states=contract_conversation(client,headers,['Нужен договор: передача товара или оказание услуг',answer])
        final=states[-1]
        assert final['procurement_context']['procurement_object_type']=='services'
        assert final['recommendation']['template_code']=='SERVICES'
        assert 'передача товара или самостоятельное оказание услуг' not in final['messages'][-1]['content']


def test_full_supply_specification_api_dialogue_reaches_ready_and_downloads_docx():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    body=client.get(f'/api/v1/cases/{case_id}',headers=headers).json(); seen=[]
    answers={
      'equipment_category':'компьютерное оборудование','subject':'Поставка ноутбуков','item_count':'1','items[0].description':'Ноутбук Lenovo ThinkPad',
      'items[0].part_number':'21ABC','items[0].manufacturer':'Lenovo','items[0].warranty_term':'3 года',
      'items[0].unit_price':'100 тыс. руб.','items[0].quantity':'10 шт.','delivery_address':'Москва, ул. Большая Татарская, 11',
      'currency':'рубли','vat_mode':'С НДС','vat_rate':'20%','delivery_term':'10 рабочих дней',
      'support_required':'Нет','warranty_service_description':'ремонт и замена неисправных компонентов',
      'warranty_terms_url':'https://example.test/warranty',
    }
    while pending:=body['procurement_context'].get('pending_specification_question'):
        seen.append(pending['question_id'])
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':answers[pending['target']]}).json()
    assert len(seen)==len(set(seen)) and body['state']=='SPEC_REVIEW'
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Подтверждаю'}).json()
    assert body['state']=='SPEC_READY' and body['technical_specification']['status']=='READY'
    response=client.get(f'/api/v1/cases/{case_id}/technical-specification/download?format=docx',headers=headers)
    assert response.status_code==200 and response.content.startswith(b'PK')


def test_text_confirmation_uses_same_transition_as_button_after_xlsx():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    uploaded=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()['case']
    assert uploaded['procurement_context']['procurement_object_type']=='goods'
    assert uploaded['procurement_context']['requires_tangible_work_result'] is False
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Всё верно'}).json()
    assert body['technical_specification']['data']['kind']=='SUPPLY'
    assert body['technical_specification']['status']=='EDITING'
    assert body['procurement_context']['pending_specification_question'] is not None


def test_vague_water_procurement_clarifies_then_selects_supply():
    client=TestClient(app); headers=auth(client)
    _,states=contract_conversation(client,headers,['Нужно купить много воды','Да'])
    first,second=states
    assert first['state']=='COLLECTING_CONTRACT_DATA' and first['recommendation']['status']=='AMBIGUOUS'
    assert 'обычная поставка' in first['messages'][-1]['content'] and first['state']!='ESCALATED_TO_DPO'
    assert second['recommendation']['template_code']=='SUPPLY' and second['state']=='COMPLETED'


def test_full_technical_support_description_selects_services():
    client=TestClient(app); headers=auth(client)
    message='Нужен договор на оказание услуг по технической поддержке информационной системы в течение 12 месяцев. Исполнитель консультирует пользователей, устраняет ошибки и обеспечивает сопровождение. Передача товаров и создание нового программного продукта не предусмотрены.'
    _,states=contract_conversation(client,headers,[message])
    body=states[0]
    assert body['procurement_context']['requires_transfer_of_goods'] is False
    assert body['procurement_context']['procurement_object_type']=='services'
    assert body['procurement_context']['new_software_development'] is False
    assert body['recommendation']['template_code']=='SERVICES'


def test_context_contradiction_replaces_domain_not_marks_missing():
    client=TestClient(app); headers=auth(client)
    _,states=contract_conversation(client,headers,['Нужен договор: только поставка оборудования','Нет, всё-таки это услуга'])
    body=states[-1]
    assert body['procurement_context']['requires_transfer_of_goods'] is False
    assert body['procurement_context']['requires_service_activity'] is True
    assert body['recommendation']['template_code']=='SERVICES'


def test_invalid_short_and_test_placeholders_are_not_saved_or_returned():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужно разработать лендинг'})
    for value in ('М','ТЕст'):
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':value}).json()
    assert 'М' not in body['technical_specification']['data'].values()
    assert 'ТЕст' not in body['technical_specification']['data'].values()


def test_supply_dialogue_does_not_repeat_question_after_valid_answer():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'компьютерное оборудование'}).json()
    first=body['procurement_context']['pending_specification_question']['question_id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Поставка компьютерного оборудования'}).json()
    second=body['procurement_context']['pending_specification_question']['question_id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'2'}).json()
    third=body['procurement_context']['pending_specification_question']['question_id']
    assert first=='SUPPLY_SUBJECT' and second=='SUPPLY_ITEM_COUNT' and third=='SUPPLY_ITEM_1_DESCRIPTION'
    assert len({first,second,third})==3


def complete_supply_case(client,headers,confirm=True):
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    body=client.get(f'/api/v1/cases/{case_id}',headers=headers).json()
    answers={'equipment_category':'компьютерное оборудование','subject':'Поставка ноутбуков','item_count':'1','items[0].description':'Ноутбук Lenovo ThinkPad',
      'items[0].manufacturer':'Lenovo','items[0].warranty_term':'3 года','items[0].unit_price':'100 тыс. руб.',
      'items[0].quantity':'5 шт.','delivery_address':'Москва, ул. Большая Татарская, 11','currency':'рубли',
      'vat_mode':'С НДС','vat_rate':'22%','delivery_term':'10 рабочих дней','support_required':'Нет',
      'warranty_service_description':'ремонт и замена','warranty_terms_url':'https://example.test/warranty'}
    while pending:=body['procurement_context'].get('pending_specification_question'):
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':answers[pending['target']]}).json()
    if confirm: body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Подтверждаю'}).json()
    return case_id,body


def test_general_new_case_enters_canonical_supply_flow():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={}).json()['id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужно купить ноутбуки.'}).json()
    assert body['technical_specification']['data']['kind']=='SUPPLY'
    assert body['supply_specification']['data']['kind']=='SUPPLY'
    assert body['procurement_context']['procurement_type']=='SUPPLY'
    assert body['procurement_context']['workflow_type']=='SUPPLY_SPECIFICATION'
    assert body['procurement_context']['specification_template']=='SUPPLY'
    assert body['procurement_context']['pending_specification_question']['question_id'].startswith('SUPPLY_')


def test_supply_reject_confirmation_enters_editing_without_repeating_summary():
    client=TestClient(app); headers=auth(client); case_id,body=complete_supply_case(client,headers,confirm=False)
    previous=body['messages'][-1]['content']; assert 'Всё верно?' in previous
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'нет'}).json()
    assert body['technical_specification']['status']=='EDITING'
    assert body['messages'][-1]['content']=='Хорошо. Что нужно изменить в ТЗ?'
    assert body['messages'][-1]['content']!=previous


def test_supply_reject_then_select_vat_field_asks_specific_question():
    client=TestClient(app); headers=auth(client); case_id,body=complete_supply_case(client,headers,confirm=False)
    client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'нет'})
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'НДС'}).json()
    assert body['messages'][-1]['content']=='Укажите новую ставку НДС, например 22%.'
    assert 'Проверьте ТЗ' not in body['messages'][-1]['content']
    assert body['procurement_context']['pending_specification_question']['target']=='vat_rate'
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'18%'}).json()
    assert body['technical_specification']['data']['vat_rate']==18


def test_supply_reject_confirmation_with_sparse_patch():
    client=TestClient(app); headers=auth(client); case_id,body=complete_supply_case(client,headers,confirm=False)
    subject=body['technical_specification']['data']['subject']; items=len(body['technical_specification']['data']['items'])
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нет, срок поставки должен быть 30 дней.'}).json()
    assert body['technical_specification']['status']=='EDITING'
    assert body['technical_specification']['data']['delivery_term']=='30 дней'
    assert body['technical_specification']['data']['subject']==subject and len(body['technical_specification']['data']['items'])==items
    assert 'Всё верно?' not in body['messages'][-1]['content']


def test_supply_chat_does_not_leak_internal_enum_names():
    client=TestClient(app); headers=auth(client); _,body=complete_supply_case(client,headers,confirm=False)
    visible='\n'.join(message['content'] for message in body['messages'] if message['role']=='assistant')
    for internal in ('SUBJECT','SUPPLY','READY','EDITING','COMPLETED','NEEDS_INPUT','MANUAL_REVIEW','question_id'):
        assert internal not in visible


def test_supply_owner_can_patch_draft_and_foreign_user_cannot():
    owner=TestClient(app); owner_headers=auth(owner); case_id=owner.post('/api/v1/cases',headers=owner_headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    response=owner.patch(f'/api/v1/cases/{case_id}/technical-specification',headers=owner_headers,json={'changes':[{'field':'delivery_term','value':'30 дней'}]})
    assert response.status_code==200 and response.json()['data']['delivery_term']=='30 дней'
    foreign=TestClient(app); foreign_headers=auth(foreign,'petrova')
    response=foreign.patch(f'/api/v1/cases/{case_id}/technical-specification',headers=foreign_headers,json={'changes':[{'field':'delivery_term','value':'1 день'}]})
    assert response.status_code==404


def test_supply_ready_reopens_then_right_panel_patch_persists():
    client=TestClient(app); headers=auth(client); case_id,_=complete_supply_case(client,headers)
    reopened=client.post(f'/api/v1/cases/{case_id}/technical-specification/reopen',headers=headers)
    assert reopened.status_code==200 and reopened.json()['status']=='EDITING'
    patched=client.patch(f'/api/v1/cases/{case_id}/technical-specification',headers=headers,json={'changes':[{'field':'items[0].quantity','value':'10'}]})
    assert patched.status_code==200 and patched.json()['data']['items'][0]['quantity']==10
    persisted=client.get(f'/api/v1/cases/{case_id}',headers=headers).json()
    assert persisted['technical_specification']['data']['items'][0]['quantity']==10


def test_supply_chat_sparse_edits_subject_lock_and_undo():
    client=TestClient(app); headers=auth(client); case_id,body=complete_supply_case(client,headers)
    subject=body['technical_specification']['data']['subject']; original_address=body['technical_specification']['data']['delivery_address']
    edits=('Поменяй количество первой позиции на 10','Исправь срок поставки на 30 дней','Добавь критерий приёмки: оборудование должно быть новым','Добавь критерий приёмки: упаковка не повреждена','Поменяй гарантию на 36 месяцев')
    for message in edits:
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':message}).json()
        assert body['technical_specification']['data']['subject']==subject
    data=body['technical_specification']['data']
    assert data['items'][0]['quantity']==10 and data['delivery_term']=='30 дней'
    assert 'оборудование должно быть новым' in data['acceptance_criteria'] and data['items'][0]['warranty_term']=='36 месяцев'
    assert data['delivery_address']==original_address
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Отмени последнее изменение'}).json()
    assert body['technical_specification']['data']['items'][0]['warranty_term']=='3 года'


def test_supply_without_part_number_ready_download_completed_and_contract_handoff():
    client=TestClient(app); headers=auth(client); case_id,body=complete_supply_case(client,headers)
    assert body['technical_specification']['status']=='READY' and body['technical_specification']['data']['items'][0].get('part_number','')==''
    assert body['recommendation']['template_code']=='SUPPLY' and body['procurement_context']['contract_status']=='READY'
    response=client.get(f'/api/v1/cases/{case_id}/technical-specification/download?format=docx',headers=headers)
    assert response.status_code==200
    document=Document(io.BytesIO(response.content)); assert document.tables[0].rows[1].cells[1].text==''
    body=client.get(f'/api/v1/cases/{case_id}',headers=headers).json()
    assert body['technical_specification']['status']=='COMPLETED' and body['state']=='COMPLETED'


def test_uploaded_tz_extracts_delivery_term():
    client=TestClient(app); headers=auth(client); case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    source=Document(); source.add_paragraph('Предмет закупки: поставка ноутбуков'); source.add_paragraph('Срок поставки — 22 календарных дня'); payload=io.BytesIO(); source.save(payload)
    body=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('existing.docx',payload.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()['case']
    assert body['technical_specification']['data']['delivery_term']=='22 календарных дня'
    assert body['supply_specification']['data']['kind']=='SUPPLY'
    assert body['procurement_context']['workflow_type']=='SUPPLY_SPECIFICATION'


def test_uploaded_supply_tz_keeps_vat_and_delivery_term_separate():
    client=TestClient(app); headers=auth(client); case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    source=Document(); source.add_paragraph('Предмет закупки: поставка ноутбуков'); source.add_paragraph('НДС: 22%.'); source.add_paragraph('Срок поставки: 10 дней.'); payload=io.BytesIO(); source.save(payload)
    body=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('supply.docx',payload.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()['case']
    data=body['supply_specification']['data']
    assert data['vat_rate']==22 and data['delivery_term']=='10 дней'
    assert data['delivery_term'] not in {'22','22.0'}


def test_contract_platform_rbac_ownership_versions_and_immutable_source():
    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    assert employee.get('/api/v1/document-templates',headers=employee_headers).status_code==403
    assert employee.post('/api/v1/document-templates',headers=employee_headers,json={'code':'NO','name':'Нельзя'}).status_code==403

    manager=TestClient(app); manager_headers=auth(manager); template=create_platform_template(manager,manager_headers,'POC_VERSIONS')
    source=contract_docx_bytes(); digest=hashlib.sha256(source).hexdigest()
    first=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('contract.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    second=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('contract-v2.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert first.status_code==201 and second.status_code==201
    assert first.json()['version_number']==1 and second.json()['version_number']==2
    assert first.json()['source_sha256']==digest
    downloaded=manager.get(f"/api/v1/document-templates/{template['id']}/versions/{first.json()['id']}/source",headers=manager_headers)
    assert downloaded.status_code==200 and downloaded.content==source and hashlib.sha256(downloaded.content).hexdigest()==digest
    assert len(manager.get(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers).json())==2
    configure_platform_field(manager,manager_headers,template,second.json())
    published=manager.post(f"/api/v1/document-templates/{template['id']}/versions/{second.json()['id']}/publish",headers=manager_headers)
    assert published.status_code==200 and published.json()['status']=='PUBLISHED'
    metadata=manager.get(f"/api/v1/document-templates/{template['id']}",headers=manager_headers).json()
    assert metadata['current_version_id']==second.json()['id'] and metadata['status']=='ACTIVE'

    database=SessionLocal(); petrova=database.query(User).filter_by(external_id='petrova').one(); petrova.roles=['employee','dpo_specialist']; database.commit(); database.close()
    employee_headers=auth(employee,'petrova')
    assert employee.get(f"/api/v1/document-templates/{template['id']}",headers=employee_headers).status_code==404


def test_contract_platform_rejects_invalid_uploads_and_separates_publish_permission():
    client=TestClient(app); headers=auth(client,'petrova'); template=create_platform_template(client,headers,'POC_SECURITY')
    text=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('contract.txt',b'plain text','text/plain')})
    fake=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('contract.docx',b'not a zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert text.status_code==415 and fake.status_code==422
    uploaded=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('contract.docx',contract_docx_bytes(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    denied=client.post(f"/api/v1/document-templates/{template['id']}/versions/{uploaded['id']}/publish",headers=headers)
    assert denied.status_code==403


def test_docx_preview_and_binding_use_stable_structural_locator():
    client=TestClient(app); headers=auth(client); template=create_platform_template(client,headers,'POC_LOCATORS')
    uploaded=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('contract.docx',contract_docx_bytes(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    preview=client.get(f"/api/v1/document-templates/{template['id']}/versions/{uploaded['id']}/preview",headers=headers).json()
    assert preview['adapter']=='DOCX_XML_READ_ONLY' and preview['structure_fingerprint']==uploaded['structure_fingerprint']
    assert any(node['part'].startswith('word/header') for node in preview['nodes'])
    assert any(node['part'].startswith('word/footer') for node in preview['nodes'])
    merged=next(node for node in preview['nodes'] if node['text']=='Условия договора')
    assert merged['kind']=='table_cell' and merged['metadata']['grid_span']==2
    node=next(node for node in preview['nodes'] if 'АО «НСПК»' in node['text']); start=node['text'].index('АО «НСПК»'); end=start+len('АО «НСПК»')
    binding=client.post(f"/api/v1/document-templates/{template['id']}/versions/{uploaded['id']}/bindings",headers=headers,json={'binding_key':'contract.customer','locator':node['locator'],'start':start,'end':end,'selected_text':'АО «НСПК»'})
    assert binding.status_code==201
    locator=binding.json()['locator']; assert locator['start_run']!=locator['end_run'] and locator['structure_fingerprint']==preview['structure_fingerprint']
    invalid=client.post(f"/api/v1/document-templates/{template['id']}/versions/{uploaded['id']}/bindings",headers=headers,json={'binding_key':'contract.invalid','locator':node['locator'],'start':start,'end':end,'selected_text':'другой текст'})
    assert invalid.status_code==422


def test_contract_platform_end_to_end_multiple_occurrences_generation_and_ownership():
    document=Document()
    for prefix in ('Заказчик: ','Подпись заказчика: '):
        paragraph=document.add_paragraph(); paragraph.add_run(prefix); paragraph.add_run('АО '); paragraph.add_run('«НСПК»'); paragraph.add_run(', действует на основании устава.')
    source_buffer=io.BytesIO(); document.save(source_buffer); source=source_buffer.getvalue(); original_hash=hashlib.sha256(source).hexdigest()

    manager=TestClient(app); manager_headers=auth(manager); template=create_platform_template(manager,manager_headers,'E2E_CONTRACT')
    uploaded=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('e2e.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert uploaded.status_code==201,uploaded.text
    version=uploaded.json()
    field=configure_platform_field(manager,manager_headers,template,version,occurrences=2)
    bindings=manager.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/bindings",headers=manager_headers).json()
    assert [item['occurrence_index'] for item in bindings]==[1,2]
    assert manager.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/publish",headers=manager_headers).status_code==200
    assert manager.patch(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/fields/{field['id']}",headers=manager_headers,json={'field_key':'customer_name','label':'Изменить нельзя','field_type':'TEXT','required':True,'position':1}).status_code==409

    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    catalog=employee.get('/api/v1/contract-catalog',headers=employee_headers).json(); assert any(item['id']==template['id'] for item in catalog)
    draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']})
    assert draft.status_code==201,draft.text
    draft_id=draft.json()['id']
    history=employee.get('/api/v1/contract-drafts',headers=employee_headers).json()
    history_item=next(item for item in history if item['id']==draft_id)
    assert history_item['created_at'] and history_item['template_version']==version['version_number']
    assert employee.post(f'/api/v1/contract-drafts/{draft_id}/generate',headers=employee_headers).status_code==422
    assert employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'unknown':'x'}}).status_code==422
    saved=employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'customer_name':'ООО «Ромашка»'}})
    assert saved.status_code==200
    generated=employee.post(f'/api/v1/contract-drafts/{draft_id}/generate',headers=employee_headers)
    assert generated.status_code==201,generated.text
    download=employee.get(generated.json()['download_url'],headers=employee_headers)
    assert download.status_code==200 and 'attachment' in download.headers['content-disposition'].lower()
    rendered=Document(io.BytesIO(download.content)); text='\n'.join(p.text for p in rendered.paragraphs)
    assert text.count('ООО «Ромашка»')==2 and 'действует на основании устава' in text and 'АО «НСПК»' not in text
    original=manager.get(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/source",headers=manager_headers)
    assert hashlib.sha256(original.content).hexdigest()==original_hash
    outsider=TestClient(app); outsider_headers=auth(outsider)
    assert outsider.get(f'/api/v1/contract-drafts/{draft_id}',headers=outsider_headers).status_code==404
    assert outsider.get(generated.json()['download_url'],headers=outsider_headers).status_code==404


def test_filled_document_copy_title_and_owner_isolation():
    manager=TestClient(app); headers=auth(manager)
    template=create_platform_template(manager,headers,'COPY_DOCUMENT')
    source=contract_docx_bytes()
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('copy.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    configure_platform_field(manager,headers,template,version)
    assert manager.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/publish",headers=headers).status_code==200
    owner=TestClient(app); owner_headers=auth(owner,'petrova')
    original=owner.post('/api/v1/contract-drafts',headers=owner_headers,json={'template_id':template['id']}).json()
    original_id=original['id']
    assert owner.patch(f'/api/v1/contract-drafts/{original_id}/autosave',headers=owner_headers,json={'answers':{'customer_name':'Исходный заказчик'}}).status_code==200
    assert owner.post(f'/api/v1/contract-drafts/{original_id}/generate',headers=owner_headers).status_code==201
    copy_response=owner.post(f'/api/v1/contract-drafts/{original_id}/duplicate',headers=owner_headers,json={'title':'Копия договора'})
    assert copy_response.status_code==201,copy_response.text
    duplicate=copy_response.json()
    assert duplicate['id']!=original_id and duplicate['status']=='DRAFT' and duplicate['title']=='Копия договора'
    assert duplicate['answers']=={'customer_name':'Исходный заказчик'}
    assert duplicate['schema']['id']==original['schema']['id']
    assert owner.patch(f"/api/v1/contract-drafts/{duplicate['id']}/autosave",headers=owner_headers,json={'answers':{'customer_name':'Новый заказчик'}}).status_code==200
    assert owner.get(f'/api/v1/contract-drafts/{original_id}',headers=owner_headers).json()['answers']['customer_name']=='Исходный заказчик'
    assert owner.patch(f"/api/v1/contract-drafts/{duplicate['id']}/title",headers=owner_headers,json={'title':'  Новое имя  '}).json()['title']=='Новое имя'
    assert owner.patch(f"/api/v1/contract-drafts/{duplicate['id']}/title",headers=owner_headers,json={'title':'  '}).status_code==422
    assert owner.post(f"/api/v1/contract-drafts/{duplicate['id']}/generate",headers=owner_headers).status_code==201
    outsider=TestClient(app); outsider_headers=auth(outsider)
    assert outsider.post(f'/api/v1/contract-drafts/{original_id}/duplicate',headers=outsider_headers).status_code==404
    assert outsider.patch(f'/api/v1/contract-drafts/{original_id}/title',headers=outsider_headers,json={'title':'Чужое'}).status_code==404


def test_copy_preserves_repeating_answers_and_pinned_schema():
    source=Document(); source.add_paragraph('Исходный текст')
    table=source.add_table(rows=2,cols=1); table.cell(0,0).text='Дата'; table.cell(1,0).text='DATE'
    raw=io.BytesIO(); source.save(raw)
    manager=TestClient(app); headers=auth(manager); template=create_platform_template(manager,headers,'COPY_REPEATING')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('rows.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    node=next(x for x in manager.get(base+'/preview',headers=headers).json()['nodes'] if x['text']=='DATE')
    group=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'schedule','name':'График','min_items':0,'max_items':5,'position':1,'row_locator':node['locator']}).json()
    field=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':'date','label':'Дата','field_type':'DATE','required':True,'position':1})
    assert field.status_code==201,field.text
    schema=manager.get(base+'/questionnaire',headers=headers).json()
    db=SessionLocal(); owner=db.query(User).filter_by(external_id='petrova').one(); original=DocumentDraft(owner_id=owner.id,template_version_id=version['id'],questionnaire_schema_id=schema['id']); db.add(original); db.commit(); original_id=original.id; db.close()
    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    rows=[{'_id':'one','date':'2026-12-01'},{'_id':'two','date':'2026-12-02'}]
    assert employee.patch(f'/api/v1/contract-drafts/{original_id}/autosave',headers=employee_headers,json={'answers':{'schedule':rows}}).status_code==200
    copied=employee.post(f'/api/v1/contract-drafts/{original_id}/duplicate',headers=employee_headers).json()
    assert copied['id']!=original_id and copied['schema']['id']==schema['id'] and copied['answers']['schedule']==rows
    revised=[{**rows[0],'date':'2026-12-03'},rows[1]]
    assert employee.patch(f"/api/v1/contract-drafts/{copied['id']}/autosave",headers=employee_headers,json={'answers':{'schedule':revised}}).status_code==200
    assert employee.get(f'/api/v1/contract-drafts/{original_id}',headers=employee_headers).json()['answers']['schedule']==rows


def test_contract_platform_conditional_payment_question_end_to_end():
    document=Document(); document.add_paragraph('Порядок оплаты: PAYMENT'); document.add_paragraph('Процент предоплаты: ADVANCE')
    payload=io.BytesIO(); document.save(payload)
    manager=TestClient(app); manager_headers=auth(manager); template=create_platform_template(manager,manager_headers,'R31_PAYMENT')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('payment.docx',payload.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    payment=manager.post(base+'/fields',headers=manager_headers,json={'field_key':'payment.model','label':'Какой порядок оплаты предусмотрен?','field_type':'SINGLE_SELECT','required':True,'position':1,'options':['После оказания услуг','Полная предоплата','Частичная предоплата']})
    assert payment.status_code==201,payment.text
    condition={'operator':'EQUALS','field_key':'payment.model','value':'Частичная предоплата'}
    percent=manager.post(base+'/fields',headers=manager_headers,json={'field_key':'payment.advance_percent','label':'Какой процент предоплаты предусмотрен?','field_type':'INTEGER','required':False,'position':2,'visible_when':condition,'required_when':condition,'validation':{'min':1,'max':99}})
    assert percent.status_code==201,percent.text
    preview=manager.get(base+'/preview',headers=manager_headers).json()
    for marker,field_id in [('PAYMENT',payment.json()['id']),('ADVANCE',percent.json()['id'])]:
        node=next(x for x in preview['nodes'] if marker in x['text']); start=node['text'].index(marker)
        bound=manager.post(base+'/bindings',headers=manager_headers,json={'field_id':field_id,'locator':node['locator'],'start':start,'end':start+len(marker),'selected_text':marker})
        assert bound.status_code==201,bound.text
    published=manager.post(base+'/publish',headers=manager_headers); assert published.status_code==200,published.text

    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); draft_id=draft['id']
    bypass=employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'payment.model':'Частичная предоплата'}})
    assert bypass.status_code==422 and 'payment.advance_percent' in bypass.text
    first=employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'payment.model':'Частичная предоплата','payment.advance_percent':30}})
    assert first.status_code==200
    hidden=employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'payment.model':'После оказания услуг'}})
    assert hidden.status_code==200 and hidden.json()['answers']['payment.advance_percent']==30
    generated=employee.post(f'/api/v1/contract-drafts/{draft_id}/generate',headers=employee_headers)
    assert generated.status_code==201,generated.text
    rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
    text='\n'.join(x.text for x in rendered.paragraphs)
    assert 'После оказания услуг' in text and 'ADVANCE' in text and '30' not in text
    restored=employee.get(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers).json()
    assert restored['answers']['payment.advance_percent']==30
    again=employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'payment.model':'Частичная предоплата'}})
    assert again.status_code==200 and again.json()['answers']['payment.advance_percent']==30


def test_copy_questions_between_versions_keeps_source_and_checks_dependencies():
    client=TestClient(app);headers=auth(client);template=create_platform_template(client,headers,'COPY_QUESTIONS')
    document=Document();document.add_paragraph('New contract');data=io.BytesIO();document.save(data)
    endpoint=f"/api/v1/document-templates/{template['id']}/versions"
    first=client.post(endpoint,headers=headers,files={'file':('old.docx',data.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    old_base=f"{endpoint}/{first['id']}"
    field_a=client.post(old_base+'/fields',headers=headers,json={'field_key':'payment','label':'Оплата','field_type':'TEXT','position':1,'group':'Финансы'})
    assert field_a.status_code==201,field_a.text
    field_b=client.post(old_base+'/fields',headers=headers,json={'field_key':'advance','label':'Аванс','field_type':'TEXT','position':2,'group':'  финансы  ','visible_when':{'operator':'IS_NOT_EMPTY','field_key':'payment'}})
    assert field_b.status_code==201,field_b.text
    assert field_b.json()['config']['group']=='Финансы'
    second=client.post(endpoint,headers=headers,files={'file':('new.docx',data.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    new_base=f"{endpoint}/{second['id']}"
    copy_url=new_base+'/copy-questions'
    missing=client.post(copy_url,headers=headers,json={'source_version_id':first['id'],'field_ids':[field_b.json()['id']]})
    assert missing.status_code==422 and 'payment' in missing.text
    all_fields=client.post(copy_url,headers=headers,json={'source_version_id':first['id']})
    assert all_fields.status_code==200,all_fields.text
    assert all_fields.json()['count']==2
    assert {x['field_key'] for x in all_fields.json()['fields']}=={'payment','advance'}
    assert {x['id'] for x in all_fields.json()['fields']}.isdisjoint({field_a.json()['id'],field_b.json()['id']})
    assert client.get(old_base+'/questionnaire',headers=headers).json()['fields'][1]['id']==field_b.json()['id']
    repeated=client.post(copy_url,headers=headers,json={'source_version_id':first['id']})
    assert repeated.status_code==409
    third=client.post(endpoint,headers=headers,files={'file':('third.docx',data.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    third_base=f"{endpoint}/{third['id']}"
    single=client.post(third_base+'/copy-questions',headers=headers,json={'source_version_id':first['id'],'field_ids':[field_a.json()['id']]})
    assert single.status_code==200 and single.json()['count']==1
    dependent=client.post(third_base+'/copy-questions',headers=headers,json={'source_version_id':first['id'],'field_ids':[field_b.json()['id']]})
    assert dependent.status_code==200 and dependent.json()['count']==1
    assert client.get(third_base+'/questionnaire',headers=headers).json()['fields'][0]['config']['group']=='Финансы'


def test_question_defaults_are_pinned_to_new_draft_and_used_for_conditions_and_docx():
    document=Document();document.add_paragraph('CITY');document.add_paragraph('HIDDEN')
    raw=io.BytesIO();document.save(raw)
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'QUESTION_DEFAULTS')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('defaults.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    fields=[
      {'field_key':'city','label':'Город','field_type':'TEXT','default_value':'Москва'},
      {'field_key':'amount','label':'Сумма','field_type':'DECIMAL','default_value':12.5},
      {'field_key':'signed','label':'Дата','field_type':'DATE','default_value':'2026-11-06'},
      {'field_key':'mode','label':'Режим','field_type':'SINGLE_SELECT','option_items':[{'key':'base','label':'Основной'}],'default_value':{'selected':['base'],'other_text':''}},
      {'field_key':'services','label':'Услуги','field_type':'MULTI_SELECT','option_items':[{'key':'one','label':'Первый'},{'key':'two','label':'Второй'}],'default_value':{'selected':['one','two'],'other_text':''}},
      {'field_key':'secret','label':'Секрет','field_type':'TEXT','default_value':'Скрытый текст','visible_when':{'operator':'EQUALS','field_key':'city','value':'Казань'}},
    ]
    saved=[]
    for position,payload in enumerate(fields,1):
        response=manager.post(base+'/fields',headers=headers,json={**payload,'position':position})
        assert response.status_code==201,response.text
        saved.append(response.json())
    invalid=manager.patch(base+f"/fields/{saved[1]['id']}",headers=headers,json={**fields[1],'position':2,'default_value':'не число'})
    assert invalid.status_code==422
    invalid_choice=manager.patch(base+f"/fields/{saved[3]['id']}",headers=headers,json={**fields[3],'position':4,'default_value':{'selected':['missing'],'other_text':''}})
    assert invalid_choice.status_code==422
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']
    city_node=next(node for node in nodes if node['text']=='CITY')
    hidden_node=next(node for node in nodes if node['text']=='HIDDEN')
    assert manager.post(base+'/bindings',headers=headers,json={'field_id':saved[0]['id'],'locator':city_node['locator'],'start':0,'end':4,'selected_text':'CITY'}).status_code==201
    assert manager.post(base+'/bindings',headers=headers,json={'field_id':saved[-1]['id'],'locator':hidden_node['locator'],'start':0,'end':6,'selected_text':'HIDDEN'}).status_code==201
    region=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'only_kazan','region_type':'CONDITIONAL_PARAGRAPH','start_locator':hidden_node['locator'],'include_when':{'operator':'EQUALS','field_key':'city','value':'Казань'}})
    assert region.status_code==201,region.text
    assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app);employee_headers=auth(employee,'petrova')
    created=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']})
    assert created.status_code==201,created.text
    answers=created.json()['answers'];draft_path=f"/api/v1/contract-drafts/{created.json()['id']}"
    assert answers['city']=='Москва' and answers['amount']==12.5 and answers['signed']=='2026-11-06'
    assert answers['mode']['selected']==['base'] and answers['services']['selected']==['one','two']
    assert answers['secret']=='Скрытый текст'
    first=employee.post(draft_path+'/generate',headers=employee_headers)
    assert first.status_code==201,first.text
    first_doc=Document(io.BytesIO(employee.get(first.json()['download_url'],headers=employee_headers).content))
    assert [p.text for p in first_doc.paragraphs]==['Москва']
    cleared=employee.patch(draft_path+'/autosave',headers=employee_headers,json={'answers':{'city':''}})
    assert cleared.status_code==200,cleared.text
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['city']==''
    second=employee.post(draft_path+'/generate',headers=employee_headers)
    assert second.status_code==201,second.text
    changed=employee.patch(draft_path+'/autosave',headers=employee_headers,json={'answers':{'city':'Казань'}})
    assert changed.status_code==200
    third=employee.post(draft_path+'/generate',headers=employee_headers)
    assert third.status_code==201,third.text
    third_doc=Document(io.BytesIO(employee.get(third.json()['download_url'],headers=employee_headers).content))
    assert [p.text for p in third_doc.paragraphs]==['Казань','Скрытый текст']
    another=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']})
    assert another.json()['answers']['city']=='Москва'
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['city']=='Казань'


def test_multiple_choice_other_api_draft_conditions_generation_and_ownership():
    document=Document(); document.add_paragraph('Услуги: SERVICES'); document.add_paragraph('Питание: CATERING')
    payload=io.BytesIO(); document.save(payload)
    manager=TestClient(app); manager_headers=auth(manager); template=create_platform_template(manager,manager_headers,'R_CHOICE_OTHER')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('choices.docx',payload.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    options=[{'key':'catering','label':'Кейтеринг'},{'key':'entertainment','label':'Развлечения'}]
    source=manager.post(base+'/fields',headers=manager_headers,json={'field_key':'services','label':'Услуги','field_type':'MULTI_SELECT','required':True,'position':1,'option_items':options,'allow_other':True,'other_required':True})
    assert source.status_code==201,source.text
    rule={'operator':'CONTAINS_OPTION','field_key':'services','value':'catering'}
    dependent=manager.post(base+'/fields',headers=manager_headers,json={'field_key':'people','label':'Сколько человек кормить?','field_type':'INTEGER','required':False,'position':2,'visible_when':rule,'required_when':rule})
    assert dependent.status_code==201,dependent.text
    preview=manager.get(base+'/preview',headers=manager_headers).json()
    node=next(x for x in preview['nodes'] if 'SERVICES' in x['text']); start=node['text'].index('SERVICES')
    binding=manager.post(base+'/bindings',headers=manager_headers,json={'field_id':source.json()['id'],'locator':node['locator'],'start':start,'end':start+8,'selected_text':'SERVICES'})
    assert binding.status_code==201,binding.text
    food_node=next(x for x in preview['nodes'] if 'CATERING' in x['text']); food_start=food_node['text'].index('CATERING')
    assert manager.post(base+'/bindings',headers=manager_headers,json={'field_id':dependent.json()['id'],'locator':food_node['locator'],'start':food_start,'end':food_start+8,'selected_text':'CATERING'}).status_code==201
    published=manager.post(base+'/publish',headers=manager_headers); assert published.status_code==200,published.text
    assert manager.patch(base+f"/fields/{source.json()['id']}",headers=manager_headers,json={'field_key':'services','label':'Изменено','field_type':'MULTI_SELECT','position':1,'option_items':options}).status_code==409
    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    created=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}); assert created.status_code==201,created.text
    draft_id=created.json()['id']; draft_path=f'/api/v1/contract-drafts/{draft_id}'
    answer={'selected':['catering','__other__'],'other_text':'Прокат санок'}
    assert employee.patch(draft_path+'/autosave',headers=employee_headers,json={'answers':{'services':answer}}).status_code==200
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['services']==answer
    assert employee.patch(draft_path,headers=employee_headers,json={'answers':{'people':12}}).status_code==200
    generated=employee.post(draft_path+'/generate',headers=employee_headers); assert generated.status_code==201,generated.text
    rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
    assert 'Кейтеринг, Прокат санок' in rendered.paragraphs[0].text
    multiple={'selected':['catering','__other__'],'other_text':'Аренда помещения','other_texts':['Аренда помещения','Доставка оборудования']}
    assert employee.patch(draft_path,headers=employee_headers,json={'answers':{'services':multiple}}).status_code==200
    assert employee.get(draft_path,headers=employee_headers).json()['answers']['services']==multiple
    generated_multiple=employee.post(draft_path+'/generate',headers=employee_headers)
    assert generated_multiple.status_code==201,generated_multiple.text
    document_multiple=Document(io.BytesIO(employee.get(generated_multiple.json()['download_url'],headers=employee_headers).content))
    assert 'Кейтеринг, Аренда помещения, Доставка оборудования' in document_multiple.paragraphs[0].text
    assert employee.patch(draft_path,headers=employee_headers,json={'answers':{'services':answer}}).status_code==200
    copied=employee.post(draft_path+'/duplicate',headers=employee_headers,json={}); assert copied.status_code==201 and copied.json()['answers']['services']==answer
    assert manager.get(draft_path,headers=manager_headers).status_code==404
    assert employee.patch(draft_path,headers=employee_headers,json={'answers':{'services':{'selected':['__other__'],'other_text':''}}}).status_code==422
    assert employee.patch(draft_path,headers=employee_headers,json={'answers':{'services':{'selected':['entertainment'],'other_text':'stale'}}}).status_code==200


def test_contract_platform_rejects_invalid_condition_configuration():
    client=TestClient(app); headers=auth(client); template=create_platform_template(client,headers,'R31_INVALID')
    uploaded=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('conditions.docx',contract_docx_bytes(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{uploaded['id']}"
    a=client.post(base+'/fields',headers=headers,json={'field_key':'field.a','label':'Поле А','field_type':'TEXT','position':1}).json()
    missing=client.post(base+'/fields',headers=headers,json={'field_key':'field.bad','label':'Ошибка ссылки','field_type':'TEXT','position':2,'visible_when':{'operator':'EQUALS','field_key':'missing','value':'x'}})
    assert missing.status_code==422
    b=client.post(base+'/fields',headers=headers,json={'field_key':'field.b','label':'Поле Б','field_type':'TEXT','position':2,'visible_when':{'operator':'EQUALS','field_key':'field.a','value':'x'}})
    assert b.status_code==201
    cycle=client.patch(base+f"/fields/{a['id']}",headers=headers,json={'field_key':'field.a','label':'Поле А','field_type':'TEXT','position':1,'visible_when':{'operator':'EQUALS','field_key':'field.b','value':'x'}})
    assert cycle.status_code==422 and 'циклическая' in cycle.text
    wrong=client.patch(base+f"/fields/{b.json()['id']}",headers=headers,json={'field_key':'field.b','label':'Поле Б','field_type':'TEXT','position':2,'visible_when':{'operator':'GREATER_THAN','field_key':'field.a','value':'x'}})
    assert wrong.status_code==422 and 'несовместим' in wrong.text
    assert client.delete(base+f"/fields/{a['id']}",headers=headers).status_code==422
    database=SessionLocal(); broken=database.query(QuestionnaireField).filter_by(id=b.json()['id']).one(); broken.config={**broken.config,'visible_when':{'operator':'EQUALS','field_key':'deleted.field','value':'x'}}; database.commit(); database.close()
    rejected=client.post(base+'/publish',headers=headers)
    assert rejected.status_code==422 and 'не найдено' in rejected.text


def test_r32_conditional_legal_payment_alternatives_generate_only_selected_branch():
    source_doc=Document(); source_doc.add_paragraph('Вариант А: оплата после оказания услуг.'); source_doc.add_paragraph('Вариант Б: полная предоплата.')
    source_buffer=io.BytesIO(); source_doc.save(source_buffer); source=source_buffer.getvalue(); digest=hashlib.sha256(source).hexdigest()
    manager=TestClient(app); manager_headers=auth(manager); template=create_platform_template(manager,manager_headers,'R32_PAYMENT')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=manager_headers,files={'file':('legal-payment.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json(); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    field=manager.post(base+'/fields',headers=manager_headers,json={'field_key':'payment.model','label':'Порядок оплаты','field_type':'SINGLE_SELECT','position':1,'options':['После оказания услуг','Предоплата']})
    assert field.status_code==201,field.text
    nodes=manager.get(base+'/preview',headers=manager_headers).json()['nodes']; after=next(x for x in nodes if 'Вариант А' in x['text']); advance=next(x for x in nodes if 'Вариант Б' in x['text'])
    rules=[('after_services',after,{'operator':'AND','conditions':[{'operator':'EQUALS','field_key':'payment.model','value':'После оказания услуг'},{'operator':'NOT','condition':{'operator':'EQUALS','field_key':'payment.model','value':'Предоплата'}}]}),('prepayment',advance,{'operator':'EQUALS','field_key':'payment.model','value':'Предоплата'})]
    for key,node,condition in rules:
        created=manager.post(base+'/conditional-regions',headers=manager_headers,json={'region_key':key,'region_type':'CONDITIONAL_PARAGRAPH','start_locator':node['locator'],'include_when':condition})
        assert created.status_code==201,created.text
    assert manager.post(base+'/publish',headers=manager_headers).status_code==200
    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    for choice,present,absent in [('После оказания услуг','Вариант А','Вариант Б'),('Предоплата','Вариант Б','Вариант А')]:
        draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); draft_id=draft['id']
        assert employee.patch(f'/api/v1/contract-drafts/{draft_id}',headers=employee_headers,json={'answers':{'payment.model':choice}}).status_code==200
        generated=employee.post(f'/api/v1/contract-drafts/{draft_id}/generate',headers=employee_headers); assert generated.status_code==201,generated.text
        rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content)); text='\n'.join(x.text for x in rendered.paragraphs)
        assert present in text and absent not in text
    original=manager.get(base+'/source',headers=manager_headers)
    assert hashlib.sha256(original.content).hexdigest()==digest


def test_region_visibility_modes_generate_safe_docx_and_preserve_source():
    source_doc=Document()
    for text in ('ALWAYS PARAGRAPH','NEVER PARAGRAPH','GROUP START','GROUP END','CONDITIONAL PARAGRAPH','RESTORED PARAGRAPH','RUN HIDDEN TAIL','NAME_PLACEHOLDER'):
        source_doc.add_paragraph(text)
    rows=source_doc.add_table(rows=3,cols=2)
    for index,(left,right) in enumerate((('ROW HEADER','ROW DETAIL'),('ROW HIDDEN','ROW HIDDEN DETAIL'),('ROW FOOTER','ROW FOOTER DETAIL'))):
        rows.cell(index,0).text=left;rows.cell(index,1).text=right
    columns=source_doc.add_table(rows=2,cols=2)
    columns.cell(0,0).text='KEEP HEADER';columns.cell(0,1).text='HIDE HEADER'
    columns.cell(1,0).text='KEEP VALUE';columns.cell(1,1).text='HIDE VALUE'
    buffer=io.BytesIO();source_doc.save(buffer);source=buffer.getvalue();digest=hashlib.sha256(source).hexdigest()
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'REGION_VISIBILITY_MODES')
    uploaded=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('visibility.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert uploaded.status_code==201,uploaded.text
    version=uploaded.json();base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'flag','label':'Флаг','field_type':'BOOLEAN','position':1}).status_code==201
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']
    node=lambda text: next(item for item in nodes if item['text']==text)
    name=manager.post(base+'/fields',headers=headers,json={'field_key':'name','label':'Имя','field_type':'TEXT','position':2}).json()
    binding=manager.post(base+'/bindings',headers=headers,json={'field_id':name['id'],'locator':node('NAME_PLACEHOLDER')['locator'],'start':0,'end':len('NAME_PLACEHOLDER'),'selected_text':'NAME_PLACEHOLDER'})
    assert binding.status_code==201,binding.text
    always={'operator':'ALWAYS'};never={'operator':'NEVER'}
    conditional={'operator':'NOT','condition':{'operator':'OR','conditions':[{'operator':'EQUALS','field_key':'flag','value':False},{'operator':'IS_EMPTY','field_key':'flag'}]}}
    cases=[('always','CONDITIONAL_PARAGRAPH','ALWAYS PARAGRAPH',always,{}),('never','CONDITIONAL_PARAGRAPH','NEVER PARAGRAPH',never,{}),('group','CONDITIONAL_PARAGRAPH_GROUP','GROUP START',never,{'end_locator':node('GROUP END')['locator']}),('row','CONDITIONAL_TABLE_ROW','ROW HIDDEN',never,{}),('column','CONDITIONAL_TABLE_COLUMN','HIDE HEADER',never,{}),('conditional','CONDITIONAL_PARAGRAPH','CONDITIONAL PARAGRAPH',conditional,{})]
    created={}
    for key,kind,text,condition,extra in cases:
        response=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':key,'region_type':kind,'start_locator':node(text)['locator'],'include_when':condition,**extra})
        assert response.status_code==201,(key,response.text)
        created[key]=response.json()
    run=node('RUN HIDDEN TAIL');start=run['text'].index('HIDDEN')
    response=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'run','region_type':'CONDITIONAL_RUN','start_locator':run['locator'],'start':start,'end':start+len('HIDDEN'),'selected_text':'HIDDEN','include_when':never})
    assert response.status_code==201,response.text
    restored=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'restored','region_type':'CONDITIONAL_PARAGRAPH','start_locator':node('RESTORED PARAGRAPH')['locator'],'include_when':never})
    assert restored.status_code==201,restored.text
    assert manager.delete(base+f"/conditional-regions/{restored.json()['id']}",headers=headers).status_code==204
    assert manager.patch(base+f"/conditional-regions/{created['never']['id']}",headers=headers,json={'region_key':'never','include_when':always}).json()['include_when']==always
    assert manager.patch(base+f"/conditional-regions/{created['never']['id']}",headers=headers,json={'region_key':'never','include_when':conditional}).json()['include_when']==conditional
    saved_never={'operator':'NEVER','previous_condition':conditional}
    assert manager.patch(base+f"/conditional-regions/{created['never']['id']}",headers=headers,json={'region_key':'never','include_when':saved_never}).json()['include_when']==saved_never
    assert {item['region_key']:item['include_when'] for item in manager.get(base+'/conditional-regions',headers=headers).json()}['conditional']==conditional
    invalid=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'invalid','region_type':'CONDITIONAL_PARAGRAPH','start_locator':node('RESTORED PARAGRAPH')['locator'],'include_when':{'operator':'NEVER','field_key':'flag'}})
    assert invalid.status_code==422
    published=manager.post(base+'/publish',headers=headers); assert published.status_code==200,published.text
    assert manager.patch(base+f"/conditional-regions/{created['never']['id']}",headers=headers,json={'region_key':'never','include_when':always}).status_code in (403,409)
    employee=TestClient(app);employee_headers=auth(employee,'petrova')
    for flag in (True,False):
        draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json()
        assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'flag':flag,'name':'Имя'}}).status_code==200
        generated=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers)
        assert generated.status_code==201,generated.text
        rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
        text='\n'.join(paragraph.text for paragraph in rendered.paragraphs)
        assert 'ALWAYS PARAGRAPH' in text and 'RESTORED PARAGRAPH' in text and 'RUN  TAIL' in text
        assert all(value not in text for value in ('NEVER PARAGRAPH','GROUP START','GROUP END','HIDDEN'))
        assert ('CONDITIONAL PARAGRAPH' in text)==flag
        assert len(rendered.tables)==2 and len(rendered.tables[0].rows)==2
        assert all('ROW HIDDEN' not in cell.text for row in rendered.tables[0].rows for cell in row.cells)
        assert len(rendered.tables[1].columns)==1
        assert [row.cells[0].text for row in rendered.tables[1].rows]==['KEEP HEADER','KEEP VALUE']
    assert hashlib.sha256(manager.get(base+'/source',headers=headers).content).hexdigest()==digest


@pytest.mark.parametrize('fixture_name',['Шаблон_тренировки_физлицо.docx','Шаблон_тренировки_ИП.docx'])
def test_never_region_on_real_training_docx_draft_test_drive(fixture_name):
    source=(template_directory/'training'/fixture_name).read_bytes();digest=hashlib.sha256(source).hexdigest()
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'NEVER_REAL_'+('IP' if 'ИП' in fixture_name else 'PERSON'))
    uploaded=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('real-training.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')})
    assert uploaded.status_code==201,uploaded.text
    version=uploaded.json();base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']
    paragraphs=[item for item in nodes if item['kind']=='paragraph' and item['locator'].startswith('word/document.xml#/p[') and 10<=len(item['text'].strip())<=200]
    assert len(paragraphs)>=2
    hidden=next(item for item in paragraphs if sum(other['text']==item['text'] for other in nodes)==1)
    bound=next(item for item in paragraphs if item['locator']!=hidden['locator'])
    field=manager.post(base+'/fields',headers=headers,json={'field_key':'probe','label':'Проверочное поле','field_type':'TEXT','position':1}).json()
    binding=manager.post(base+'/bindings',headers=headers,json={'field_id':field['id'],'locator':bound['locator'],'start':0,'end':1,'selected_text':bound['text'][0]})
    assert binding.status_code==201,binding.text
    region=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'technical_hidden','region_type':'CONDITIONAL_PARAGRAPH','start_locator':hidden['locator'],'include_when':{'operator':'NEVER'}})
    assert region.status_code==201,region.text
    tested=manager.post(base+'/test-drive',headers=headers,json={'answers':{'probe':'П'}})
    assert tested.status_code==201,tested.text
    rendered=Document(io.BytesIO(manager.get(tested.json()['download_url'],headers=headers).content))
    assert hidden['text'] not in [paragraph.text for paragraph in rendered.paragraphs]
    assert hashlib.sha256(manager.get(base+'/source',headers=headers).content).hexdigest()==digest


def test_r32_supports_all_region_types_and_rejects_overlap_and_stale_locator():
    document=Document(); document.add_paragraph('Префикс: условный фрагмент.'); document.add_paragraph('Отдельный пункт.'); document.add_paragraph('Начало группы.'); document.add_paragraph('Конец группы.')
    first=document.add_table(rows=2,cols=2); first.cell(0,0).merge(first.cell(0,1)).text='Объединённый заголовок'; first.cell(1,0).text='Удаляемая'; first.cell(1,1).text='строка'
    second=document.add_table(rows=1,cols=1); second.cell(0,0).text='Удаляемая таблица'
    payload=io.BytesIO(); document.save(payload)
    client=TestClient(app); headers=auth(client); template=create_platform_template(client,headers,'R32_TYPES')
    version=client.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('regions.docx',payload.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json(); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    assert client.post(base+'/fields',headers=headers,json={'field_key':'enabled','label':'Включить условия','field_type':'BOOLEAN','position':1}).status_code==201
    nodes=client.get(base+'/preview',headers=headers).json()['nodes']; condition={'operator':'EQUALS','field_key':'enabled','value':True}
    run=next(x for x in nodes if 'условный фрагмент' in x['text']); start=run['text'].index('условный фрагмент')
    requests=[{'region_key':'run','region_type':'CONDITIONAL_RUN','start_locator':run['locator'],'start':start,'end':start+len('условный фрагмент'),'selected_text':'условный фрагмент'}, {'region_key':'paragraph','region_type':'CONDITIONAL_PARAGRAPH','start_locator':next(x for x in nodes if x['text']=='Отдельный пункт.')['locator']}, {'region_key':'group','region_type':'CONDITIONAL_PARAGRAPH_GROUP','start_locator':next(x for x in nodes if x['text']=='Начало группы.')['locator'],'end_locator':next(x for x in nodes if x['text']=='Конец группы.')['locator']}, {'region_key':'row','region_type':'CONDITIONAL_TABLE_ROW','start_locator':next(x for x in nodes if x['text']=='Удаляемая')['locator']}, {'region_key':'table','region_type':'CONDITIONAL_TABLE','start_locator':next(x for x in nodes if x['text']=='Удаляемая таблица')['locator']}]
    for body in requests:
        response=client.post(base+'/conditional-regions',headers=headers,json={**body,'include_when':condition}); assert response.status_code==201,response.text
        assert response.json()['locator']['structure_fingerprint']==version['structure_fingerprint']
    nested=client.post(base+'/conditional-regions',headers=headers,json={'region_key':'nested','region_type':'CONDITIONAL_PARAGRAPH','start_locator':run['locator'],'include_when':condition})
    assert nested.status_code==201,nested.text
    listed=client.get(base+'/conditional-regions',headers=headers).json(); assert {x['region_type'] for x in listed}=={'CONDITIONAL_RUN','CONDITIONAL_PARAGRAPH','CONDITIONAL_PARAGRAPH_GROUP','CONDITIONAL_TABLE_ROW','CONDITIONAL_TABLE'}
    database=SessionLocal(); from app.db import ConditionalDocumentRegion
    stale=database.query(ConditionalDocumentRegion).filter_by(region_key='table',template_version_id=version['id']).one(); stale.locator={**stale.locator,'structure_fingerprint':'0'*64}; database.commit(); database.close()
    rejected=client.post(base+'/publish',headers=headers); assert rejected.status_code==422 and 'устарел' in rejected.text


def test_nested_conditional_regions_generate_for_each_parent_child_state():
    document=Document()
    for text in ('OUTER START','INNER CLAUSE','NAME'):document.add_paragraph(text)
    raw=io.BytesIO();document.save(raw)
    manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'R_NESTED_REGIONS')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('nested.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    for position,key in enumerate(('show_outer','show_inner','name'),1):
        response=manager.post(base+'/fields',headers=headers,json={'field_key':key,'label':key,'field_type':'BOOLEAN' if key!='name' else 'TEXT','position':position,'required':True})
        assert response.status_code==201,response.text
        if key=='name':name_id=response.json()['id']
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']
    first=next(node for node in nodes if node['text']=='OUTER START')
    inner=next(node for node in nodes if node['text']=='INNER CLAUSE')
    marker=next(node for node in nodes if node['text']=='NAME')
    binding=manager.post(base+'/bindings',headers=headers,json={'field_id':name_id,'locator':marker['locator'],'start':0,'end':4,'selected_text':'NAME'})
    assert binding.status_code==201,binding.text
    parent=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'outer','region_type':'CONDITIONAL_PARAGRAPH_GROUP','start_locator':first['locator'],'end_locator':inner['locator'],'include_when':{'operator':'EQUALS','field_key':'show_outer','value':True}})
    child=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'inner','region_type':'CONDITIONAL_PARAGRAPH','start_locator':inner['locator'],'include_when':{'operator':'EQUALS','field_key':'show_inner','value':True}})
    assert parent.status_code==201 and child.status_code==201,(parent.text,child.text)
    assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app);employee_headers=auth(employee,'petrova')
    for show_outer,show_inner,expected in ((False,True,[]),(True,False,['OUTER START']),(True,True,['OUTER START','INNER CLAUSE']),(False,False,[])):
        draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json()
        draft_path=f"/api/v1/contract-drafts/{draft['id']}"
        answers={'show_outer':show_outer,'show_inner':show_inner,'name':'Иванов'}
        assert employee.patch(draft_path,headers=employee_headers,json={'answers':answers}).status_code==200
        generated=employee.post(draft_path+'/generate',headers=employee_headers)
        assert generated.status_code==201,generated.text
        output=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content))
        assert [paragraph.text for paragraph in output.paragraphs]==expected+['Иванов']


def test_r33_full_repeating_table_flow_preserves_order_static_rows_and_source():
    manager=TestClient(app); manager_headers=auth(manager); template,version,source,_,_=configure_repeating_platform(manager,manager_headers,'R33_FULL')
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"; assert manager.post(base+'/publish',headers=manager_headers).status_code==200
    assert hashlib.sha256(manager.get(base+'/source',headers=manager_headers).content).hexdigest()==hashlib.sha256(source).hexdigest()
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); did=draft['id']
    rows=[{'_id':f'row-{i}','date':f'2026-11-{i:02d}','place':f'Зал {i}'} for i in range(1,6)]; rows[2]['place']='Изменённый зал'; rows.pop(1); rows=[rows[2],rows[0],rows[1],rows[3]]
    saved=employee.patch(f'/api/v1/contract-drafts/{did}/autosave',headers=employee_headers,json={'answers':{'customer_name':'АО Заказчик','schedule':rows}}); assert saved.status_code==200,saved.text
    restored=employee.get(f'/api/v1/contract-drafts/{did}',headers=employee_headers).json(); assert restored['answers']['schedule']==rows
    duplicate=employee.post(f'/api/v1/contract-drafts/{did}/duplicate',headers=employee_headers).json()
    assert duplicate['id']!=did and duplicate['answers']['schedule']==rows and duplicate['schema']['id']==restored['schema']['id']
    changed_rows=[{**rows[0],'place':'Другой зал'},*rows[1:]]
    assert employee.patch(f"/api/v1/contract-drafts/{duplicate['id']}/autosave",headers=employee_headers,json={'answers':{'schedule':changed_rows}}).status_code==200
    assert employee.get(f'/api/v1/contract-drafts/{did}',headers=employee_headers).json()['answers']['schedule']==rows
    assert employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':restored['answers']}).status_code==200
    generated=employee.post(f'/api/v1/contract-drafts/{did}/generate',headers=employee_headers); assert generated.status_code==201,generated.text
    rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content)); table=rendered.tables[0]
    assert len(table.rows)==6 and table.rows[0].cells[0].text=='Дата' and table.rows[-1].cells[0].text=='ИТОГО'
    assert [row.cells[1].text for row in table.rows[1:-1]]==[x['place'] for x in rows]
    assert all('Дополнительная строка' in row.cells[0].text and len(row.cells[0].paragraphs)==2 for row in table.rows[1:-1])


def test_r33_zero_one_three_and_ten_rows_and_limits():
    manager=TestClient(app); headers=auth(manager); template,version,_,_,_=configure_repeating_platform(manager,headers,'R33_COUNTS',min_items=0,max_items=10); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"; assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app); employee_headers=auth(employee,'petrova')
    for count in (0,1,3,10):
        draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); rows=[{'_id':f'{count}-{i}','date':'2026-12-01','place':f'Зал {i}'} for i in range(count)]; answers={'customer_name':'Заказчик','schedule':rows}
        assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':answers}).status_code==200
        made=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers); assert made.status_code==201,made.text
        result=Document(io.BytesIO(employee.get(made.json()['download_url'],headers=employee_headers).content)); assert len(result.tables[0].rows)==count+2
    overflow=[{'_id':f'x-{i}','date':'2026-12-01','place':'Зал'} for i in range(11)]; assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'schedule':overflow}}).status_code==422


def test_r33_minimum_and_required_nested_values_are_enforced_server_side():
    manager=TestClient(app); headers=auth(manager); template,version,_,_,_=configure_repeating_platform(manager,headers,'R33_REQUIRED',min_items=2,max_items=4); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"; assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); did=draft['id']
    one=employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'customer_name':'Заказчик','schedule':[{'_id':'one','date':'2026-12-01','place':'Зал'}]}}); assert one.status_code==422 and 'минимум 2' in one.text
    missing=employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'customer_name':'Заказчик','schedule':[{'_id':'one','date':'2026-12-01','place':''},{'_id':'two','date':'2026-12-02','place':'Зал'}]}}); assert missing.status_code==422 and 'заполните поле' in missing.text.lower() and 'Место' in missing.text


def test_r33_horizontal_gridspan_and_row_formatting_survive_cloning():
    document=Document(); document.add_paragraph('Служебное поле')
    table=document.add_table(rows=3,cols=2); table.style='Table Grid'; table.rows[0].cells[0].text='Заголовок'; table.rows[0].cells[1].text='Колонка'; merged=table.rows[1].cells[0].merge(table.rows[1].cells[1]); merged.text='VALUE'; merged.paragraphs[0].alignment=1; table.rows[2].cells[0].merge(table.rows[2].cells[1]).text='ИТОГО'
    raw=io.BytesIO(); document.save(raw); manager=TestClient(app); headers=auth(manager); template=create_platform_template(manager,headers,'R33_GRIDSPAN'); version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('gridspan.docx',raw.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json(); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'note','label':'Примечание','field_type':'TEXT','required':False,'position':1}).status_code==201
    node=next(x for x in manager.get(base+'/preview',headers=headers).json()['nodes'] if x['text']=='VALUE'); group=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'lines','name':'Строки','min_items':0,'max_items':3,'position':1,'row_locator':node['locator']}).json(); field=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':'value','label':'Значение','field_type':'TEXT','required':True,'position':1}).json(); assert manager.put(base+f"/repeating-groups/{group['id']}/fields/{field['id']}/binding",headers=headers,json={'locator':node['locator'],'start':0,'end':5,'selected_text':'VALUE'}).status_code==200; assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); rows=[{'_id':str(i),'value':f'Строка {i}'} for i in range(3)]; assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'lines':rows}}).status_code==200; made=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers).json(); rendered=Document(io.BytesIO(employee.get(made['download_url'],headers=employee_headers).content)); result=rendered.tables[0]
    assert len(result.rows)==5 and all(row._tr.find('.//'+qn('w:gridSpan')).get(qn('w:val'))=='2' for row in result.rows[1:4]); assert all(row.cells[0].paragraphs[0].alignment==1 for row in result.rows[1:4]); assert result.rows[-1].cells[0].text=='ИТОГО'


@pytest.mark.parametrize('block_size',[2,3])
def test_r364_multirow_blocks_replace_all_prototypes_and_preserve_order(block_size):
    raw=multirow_contract_docx_bytes(block_size,2);manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,f'R364_MULTI_{block_size}')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('multi.docx',raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json();base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}";nodes=manager.get(base+'/preview',headers=headers).json()['nodes']
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'note','label':'Примечание','field_type':'TEXT','required':False,'position':1}).status_code==201
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'show_place','label':'Показывать место','field_type':'BOOLEAN','required':False,'position':2}).status_code==201
    start=next(x for x in nodes if x['metadata'].get('table')==1 and x['metadata'].get('row')==2 and x['metadata'].get('cell')==1);end=next(x for x in nodes if x['metadata'].get('table')==1 and x['metadata'].get('row')==1+block_size and x['metadata'].get('cell')==1)
    group=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'schedule','name':'График','min_items':0,'max_items':10,'position':1,'row_locator':start['locator'],'end_row_locator':end['locator'],'source_repetitions':2}).json();assert group['locator']['row_count']==block_size and group['locator']['source_row_count']==block_size*2
    for position,(key,text) in enumerate((('month','MONTH'),('date','DATE'),('place','PLACE')),1):
        node=next(x for x in nodes if x['text']==text);field=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':key,'label':key,'field_type':'TEXT','required':True,'position':position}).json();assert manager.put(base+f"/repeating-groups/{group['id']}/fields/{field['id']}/binding",headers=headers,json={'locator':node['locator'],'start':0,'end':len(text),'selected_text':text}).status_code==200
    header=next(x for x in nodes if x['metadata'].get('row')==1 and x['metadata'].get('cell')==2);column=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'place_column','region_type':'CONDITIONAL_TABLE_COLUMN','start_locator':header['locator'],'include_when':{'operator':'EQUALS','field_key':'show_place','value':True}});assert column.status_code==201,column.text
    published=manager.post(base+'/publish',headers=headers);assert published.status_code==200,published.text
    employee=TestClient(app);employee_headers=auth(employee,'petrova');draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json();items=[{'_id':str(i),'month':f'M{i}','date':f'D{i}','place':f'P{i}'} for i in (3,1,2)]
    assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'show_place':False,'schedule':items}}).status_code==200;made=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers).json();rendered=Document(io.BytesIO(employee.get(made['download_url'],headers=employee_headers).content));table=rendered.tables[0]
    assert len(table.rows)==2+block_size*3 and len(table.rows[0].cells)==1 and [table.rows[1+i*block_size].cells[0].text for i in range(3)]==['M3','M1','M2'] and table.rows[-1].cells[0].text=='ИТОГО'


def test_r364_vertical_merge_must_be_contained_inside_block():
    raw=multirow_contract_docx_bytes(2,1,vertical_merge=True);manager=TestClient(app);headers=auth(manager);template=create_platform_template(manager,headers,'R364_VMERGE');version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('merge.docx',raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json();base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}";nodes=manager.get(base+'/preview',headers=headers).json()['nodes'];start=next(x for x in nodes if x['metadata'].get('row')==2 and x['metadata'].get('cell')==1);end=next(x for x in nodes if x['metadata'].get('row')==3 and x['metadata'].get('cell')==1)
    accepted=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'inside','name':'Внутри','position':1,'row_locator':start['locator'],'end_row_locator':end['locator']});assert accepted.status_code==201,accepted.text
    manager.delete(base+f"/repeating-groups/{accepted.json()['id']}",headers=headers)
    rejected=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'crossing','name':'Пересечение','position':1,'row_locator':start['locator']});assert rejected.status_code==422 and 'пересекает конец' in rejected.text


def test_r33_vertical_merge_stale_locator_conflict_and_foreign_draft():
    manager=TestClient(app); headers=auth(manager); _,_,_,response,_=configure_repeating_platform(manager,headers,'R33_VMERGE',vertical_merge=True); assert response.status_code==201,response.text
    template,version,_,_,group=configure_repeating_platform(manager,headers,'R33_SAFETY'); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    database=SessionLocal(); from app.db import RepeatingGroup
    stored=database.query(RepeatingGroup).filter_by(id=group['id']).one(); original=stored.locator; stored.locator={**original,'row_hashes':['0'*64]}; database.commit(); database.close(); stale=manager.post(base+'/publish',headers=headers); assert stale.status_code==422 and 'устарела' in stale.text
    database=SessionLocal(); stored=database.query(RepeatingGroup).filter_by(id=group['id']).one(); stored.locator=original; database.commit(); database.close()
    preview=manager.get(base+'/preview',headers=headers).json(); date_node=next(x for x in preview['nodes'] if 'DATE' in x['text']); conflict=manager.post(base+'/bindings',headers=headers,json={'binding_key':'conflict','locator':date_node['locator'],'start':0,'end':4,'selected_text':'DATE'}); assert conflict.status_code==201
    assert manager.post(base+'/publish',headers=headers).status_code==422
    manager.delete(base+f"/bindings/{conflict.json()['id']}",headers=headers)
    conditional=manager.post(base+'/conditional-regions',headers=headers,json={'region_key':'same_row','region_type':'CONDITIONAL_TABLE_ROW','start_locator':date_node['locator'],'include_when':{'operator':'IS_NOT_EMPTY','field_key':'customer_name'}}); assert conditional.status_code==201,conditional.text
    assert manager.post(base+'/publish',headers=headers).status_code==422
    manager.delete(base+f"/conditional-regions/{conditional.json()['id']}",headers=headers); assert manager.post(base+'/publish',headers=headers).status_code==200
    owner=TestClient(app); owner_headers=auth(owner,'petrova'); draft=owner.post('/api/v1/contract-drafts',headers=owner_headers,json={'template_id':template['id']}).json(); foreign=TestClient(app); foreign_headers=auth(foreign)
    assert foreign.patch(f"/api/v1/contract-drafts/{draft['id']}/autosave",headers=foreign_headers,json={'answers':{}}).status_code==404


def test_r33_inactive_group_keeps_answers_but_does_not_render_or_require_rows():
    manager=TestClient(app); headers=auth(manager); template,version,_,_,group=configure_repeating_platform(manager,headers,'R33_CONDITION',visible_when={'operator':'EQUALS','field_key':'customer_name','value':'Показывать'})
    # The referenced text field is condition-compatible; publishing also proves shared ConditionEngine validation.
    base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"; assert manager.post(base+'/publish',headers=headers).status_code==200
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); hidden=[{'_id':'kept','date':'','place':''}]
    saved=employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'customer_name':'Скрыть','schedule':hidden}}); assert saved.status_code==200,saved.text
    made=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers); assert made.status_code==201,made.text
    result=Document(io.BytesIO(employee.get(made.json()['download_url'],headers=employee_headers).content)); assert len(result.tables[0].rows)==2
    restored=employee.get(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers).json()
    assert restored['answers']['schedule']==hidden


@pytest.mark.parametrize('fixture_name',['Шаблон_тренировки_физлицо.docx','Шаблон_тренировки_ИП.docx'])
def test_r34_real_training_contracts_calculate_schedule_cost_without_mutating_source(fixture_name):
    source=(template_directory/'training'/fixture_name).read_bytes(); digest=hashlib.sha256(source).hexdigest()
    manager=TestClient(app); headers=auth(manager); template=create_platform_template(manager,headers,'R34_REAL_'+('IP' if 'ИП' in fixture_name else 'PERSON'))
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('training.docx',source,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json(); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'comment','label':'Комментарий','field_type':'TEXT','required':False,'position':1}).status_code==201
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']; cells=[x for x in nodes if x['kind']=='table_cell' and x['metadata']['table']==2 and x['metadata']['row']==3 and x['metadata']['cell']<=7 and x['locator'].endswith('/p[1]')]
    assert len(cells)==7 and all(x['text']=='' for x in cells)
    created=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'schedule','name':'График тренировок','min_items':0,'max_items':10,'required':False,'position':1,'row_locator':cells[0]['locator']}); assert created.status_code==201,created.text; group=created.json()
    for position,(cell,key,label,kind) in enumerate(zip(cells,['date','weekday','time','quantity','price','total','place'],['Дата','День недели','Время','Количество','Цена','Стоимость','Место'],['DATE','TEXT','TEXT','INTEGER','MONEY','MONEY','TEXT']),1):
        payload={'field_key':key,'label':label,'field_type':kind,'required':False,'position':position}
        if key=='total': payload.update({'calculated':True,'expression':{'operation':'MULTIPLY','operands':[{'source':'ROW_FIELD','field_key':'quantity'},{'source':'ROW_FIELD','field_key':'price'}]},'precision':2,'rounding':'HALF_UP','output_format':'MONEY'})
        field=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json=payload).json()
        bound=manager.put(base+f"/repeating-groups/{group['id']}/fields/{field['id']}/binding",headers=headers,json={'locator':cell['locator'],'start':0,'end':0,'selected_text':''}); assert bound.status_code==200,bound.text
    published=manager.post(base+'/publish',headers=headers); assert published.status_code==200,published.text
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); rows=[{'_id':f'real-{i}','date':f'2026-11-{i:02d}','weekday':'Понедельник','time':'19:00','quantity':i,'price':'5000','place':f'Зал {i}'} for i in range(1,5)]
    assert employee.patch(f"/api/v1/contract-drafts/{draft['id']}",headers=employee_headers,json={'answers':{'schedule':rows}}).status_code==200
    made=employee.post(f"/api/v1/contract-drafts/{draft['id']}/generate",headers=employee_headers); assert made.status_code==201,made.text
    rendered=Document(io.BytesIO(employee.get(made.json()['download_url'],headers=employee_headers).content)); schedule=rendered.tables[1]
    assert len(schedule.rows)==18 and [schedule.rows[i].cells[6].text for i in range(2,6)]==[x['place'] for x in rows]
    assert [schedule.rows[i].cells[5].text for i in range(2,6)]==['5 000,00','10 000,00','15 000,00','20 000,00']
    assert any('Итого за общий период' in row.cells[0].text for row in schedule.rows)
    assert hashlib.sha256(manager.get(base+'/source',headers=headers).content).hexdigest()==digest


def test_r34_calculated_rows_total_words_and_untrusted_values():
    document=Document(); document.add_paragraph('Сумма прописью: WORDS')
    table=document.add_table(rows=3,cols=3); table.style='Table Grid'; table.rows[0].cells[0].text='Количество'; table.rows[0].cells[1].text='Цена'; table.rows[0].cells[2].text='Стоимость'
    for cell,text in zip(table.rows[1].cells,['QTY','PRICE','ROW_TOTAL']): cell.text=text
    table.rows[2].cells[0].merge(table.rows[2].cells[1]).text='ИТОГО'; table.rows[2].cells[2].text='TOTAL'
    payload=io.BytesIO(); document.save(payload); original=payload.getvalue(); manager=TestClient(app); headers=auth(manager); template=create_platform_template(manager,headers,'R34_CALC')
    version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':('calculation.docx',original,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json(); base=f"/api/v1/document-templates/{template['id']}/versions/{version['id']}"
    assert manager.post(base+'/fields',headers=headers,json={'field_key':'comment','label':'Комментарий','field_type':'TEXT','required':False,'position':1}).status_code==201
    nodes=manager.get(base+'/preview',headers=headers).json()['nodes']; qty=next(x for x in nodes if x['text']=='QTY'); group=manager.post(base+'/repeating-groups',headers=headers,json={'group_key':'services','name':'Услуги','min_items':0,'max_items':10,'position':1,'row_locator':qty['locator']}).json()
    row_fields=[]
    for pos,(key,label,kind,text) in enumerate([('quantity','Количество','INTEGER','QTY'),('price','Цена','MONEY','PRICE')],1):
        f=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':key,'label':label,'field_type':kind,'required':True,'position':pos}).json(); node=next(x for x in nodes if x['text']==text); assert manager.put(base+f"/repeating-groups/{group['id']}/fields/{f['id']}/binding",headers=headers,json={'locator':node['locator'],'start':0,'end':len(text),'selected_text':text}).status_code==200; row_fields.append(f)
    row_total=manager.post(base+f"/repeating-groups/{group['id']}/fields",headers=headers,json={'field_key':'row_total','label':'Стоимость','field_type':'MONEY','required':False,'position':3,'calculated':True,'expression':{'operation':'MULTIPLY','operands':[{'source':'ROW_FIELD','field_key':'quantity'},{'source':'ROW_FIELD','field_key':'price'}]},'precision':2,'rounding':'HALF_UP','output_format':'MONEY'}).json(); node=next(x for x in nodes if x['text']=='ROW_TOTAL'); assert manager.put(base+f"/repeating-groups/{group['id']}/fields/{row_total['id']}/binding",headers=headers,json={'locator':node['locator'],'start':0,'end':9,'selected_text':'ROW_TOTAL'}).status_code==200
    grand=manager.post(base+'/fields',headers=headers,json={'field_key':'grand_total','label':'Итого','field_type':'MONEY','required':False,'position':2,'calculated':True,'expression':{'operation':'SUM','group_key':'services','field_key':'row_total'},'precision':2,'rounding':'HALF_UP','output_format':'MONEY'}).json()
    for text,fmt in [('TOTAL','MONEY_WITH_CURRENCY'),('WORDS','MONEY_WORDS_RUB')]:
        node=([x for x in nodes if x['text']==text] or [x for x in nodes if text in x['text']])[0]; response=manager.post(base+'/bindings',headers=headers,json={'field_id':grand['id'],'locator':node['locator'],'start':node['text'].index(text),'end':node['text'].index(text)+len(text),'selected_text':text,'output_format':fmt,'format_options':{'precision':2}}); assert response.status_code==201,response.text
    assert manager.patch(base+f"/bindings/{response.json()['id']}/format",headers=headers,json={'output_format':'MONEY_WORDS_RUB','format_options':{'precision':99}}).status_code==422
    published=manager.post(base+'/publish',headers=headers); assert published.status_code==200,published.text
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); draft=employee.post('/api/v1/contract-drafts',headers=employee_headers,json={'template_id':template['id']}).json(); did=draft['id']; rows=[{'_id':'1','quantity':2,'price':'5000'},{'_id':'2','quantity':3,'price':'5000'},{'_id':'3','quantity':1,'price':'1000'}]
    assert employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'services':rows,'grand_total':'1'}}).status_code==422
    initial=employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'services':rows}}); assert initial.status_code==200,initial.text
    rows[1]['price']='6000'; changed=employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'services':rows}}); assert changed.status_code==200,changed.text
    rows.pop(); saved=employee.patch(f'/api/v1/contract-drafts/{did}',headers=employee_headers,json={'answers':{'services':rows}}); assert saved.status_code==200,saved.text
    restored=employee.get(f'/api/v1/contract-drafts/{did}',headers=employee_headers); assert restored.status_code==200 and restored.json()['answers']['services']==rows
    made=employee.post(f'/api/v1/contract-drafts/{did}/generate',headers=employee_headers); assert made.status_code==201,made.text; rendered=Document(io.BytesIO(employee.get(made.json()['download_url'],headers=employee_headers).content))
    assert [rendered.tables[0].rows[i].cells[2].text for i in (1,2)]==['10 000,00','18 000,00']; assert rendered.tables[0].rows[-1].cells[2].text=='28 000,00 руб.'; assert 'Двадцать восемь тысяч рублей 00 копеек' in rendered.paragraphs[0].text
    assert hashlib.sha256(manager.get(base+'/source',headers=headers).content).hexdigest()==hashlib.sha256(original).hexdigest()


def test_r35_product_resolver_and_unified_document_flow():
    manager=TestClient(app); headers=auth(manager)
    def published(code,marker):
        raw=contract_docx_bytes(); template=create_platform_template(manager,headers,code)
        version=manager.post(f"/api/v1/document-templates/{template['id']}/versions",headers=headers,files={'file':(marker+'.docx',raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')}).json()
        field=configure_platform_field(manager,headers,template,version)
        response=manager.post(f"/api/v1/document-templates/{template['id']}/versions/{version['id']}/publish",headers=headers)
        assert response.status_code==200,response.text
        return template,version,field,raw
    person,pv,pfield,praw=published('R35_PERSON','person'); entrepreneur,iv,ifield,iraw=published('R35_IP','ip')
    created=manager.post('/api/v1/contract-products',headers=headers,json={'code':'TRAINING_PRODUCT','name':'Договор на проведение тренировок','description':'Единый договорный продукт'}); assert created.status_code==201,created.text
    product=created.json(); version=product['version']; base=f"/api/v1/contract-products/{product['id']}/versions/{version['id']}"
    fields=[]
    for pos,payload in enumerate([
        {'field_key':'contractor_status','label':'Статус исполнителя','field_type':'SINGLE_SELECT','required':True,'options':['Физическое лицо','Индивидуальный предприниматель']},
        {'field_key':'contractor_name','label':'ФИО исполнителя','field_type':'TEXT','required':True},
        {'field_key':'labor_signs','label':'Есть признаки трудовых отношений','field_type':'BOOLEAN','required':True},
        {'field_key':'foreign_citizen','label':'Иностранное гражданство','field_type':'BOOLEAN','required':True},
    ],1):
        response=manager.post(base+'/fields',headers=headers,json={**payload,'position':pos}); assert response.status_code==201,response.text; fields.append(response.json())
    status,name,labor,foreign=fields
    variants=[]
    for pos,(code,title,tv,value,target) in enumerate([('PERSON','Физическое лицо',pv,'Физическое лицо',pfield),('IP','Индивидуальный предприниматель',iv,'Индивидуальный предприниматель',ifield)],1):
        response=manager.post(base+'/variants',headers=headers,json={'code':code,'name':title,'template_version_id':tv['id'],'position':pos,'condition':{'operator':'EQUALS','field_key':'contractor_status','value':value}}); assert response.status_code==201,response.text; variant=response.json();variants.append(variant)
        mapped=manager.put(base+f"/variants/{variant['id']}/mappings/{name['id']}",headers=headers,json={'target_field_id':target['id']}); assert mapped.status_code==200,mapped.text
    rules={'blocking_rules':[{'code':'LABOR_RELATIONSHIP','message':'Обнаружены признаки трудовых отношений','condition':{'operator':'EQUALS','field_key':'labor_signs','value':True}}],'manual_review_rules':[{'code':'FOREIGN_CITIZEN','message':'Требуется проверка документов иностранного гражданина','condition':{'operator':'EQUALS','field_key':'foreign_citizen','value':True}}],'test_scenarios':[
        {'name':'ФЛ','answers':{'contractor_status':'Физическое лицо','labor_signs':False,'foreign_citizen':False},'expected_state':'SELECTED'},
        {'name':'ИП','answers':{'contractor_status':'Индивидуальный предприниматель','labor_signs':False,'foreign_citizen':False},'expected_state':'SELECTED'},
        {'name':'Трудовые отношения','answers':{'contractor_status':'Физическое лицо','labor_signs':True,'foreign_citizen':False},'expected_state':'NOT_APPLICABLE'},
        {'name':'Иностранец','answers':{'contractor_status':'Физическое лицо','labor_signs':False,'foreign_citizen':True},'expected_state':'MANUAL_REVIEW_REQUIRED'},
    ]}
    assert manager.patch(base+'/rules',headers=headers,json=rules).status_code==200
    def resolve(answers): return manager.post(base+'/resolve',headers=headers,json={'answers':answers}).json()
    assert resolve({})['state']=='NEED_MORE_INFORMATION'
    assert resolve({'contractor_status':'Физическое лицо','labor_signs':True,'foreign_citizen':False})['state']=='NOT_APPLICABLE'
    assert resolve({'contractor_status':'Физическое лицо','labor_signs':False,'foreign_citizen':True})['state']=='MANUAL_REVIEW_REQUIRED'
    assert resolve({'contractor_status':'Физическое лицо','labor_signs':False,'foreign_citizen':False})['variant_id']==variants[0]['id']
    assert resolve({'contractor_status':'Индивидуальный предприниматель','labor_signs':False,'foreign_citizen':False})['variant_id']==variants[1]['id']
    published_product=manager.post(base+'/publish',headers=headers); assert published_product.status_code==200,published_product.text
    assert manager.patch(base+'/rules',headers=headers,json=rules).status_code==409
    employee=TestClient(app); employee_headers=auth(employee,'petrova'); catalog=employee.get('/api/v1/contract-product-catalog',headers=employee_headers).json(); assert [x['name'] for x in catalog].count('Договор на проведение тренировок')==1
    legacy_catalog=employee.get('/api/v1/contract-catalog',headers=employee_headers).json(); assert person['id'] not in {x['id'] for x in legacy_catalog} and entrepreneur['id'] not in {x['id'] for x in legacy_catalog}
    draft=employee.post('/api/v1/contract-product-drafts',headers=employee_headers,json={'product_id':product['id']}).json(); did=draft['id']; assert draft['decision']['state']=='NEED_MORE_INFORMATION'
    common={'contractor_status':'Физическое лицо','contractor_name':'Иван Иванов','labor_signs':False,'foreign_citizen':False}
    saved=employee.patch(f'/api/v1/contract-product-drafts/{did}',headers=employee_headers,json={'common_answers':common,'selected_variant_id':variants[1]['id'],'variant_answers':{}}); assert saved.status_code==200,saved.text; assert saved.json()['selected_variant']['id']==variants[0]['id']
    generated=employee.post(f'/api/v1/contract-product-drafts/{did}/generate',headers=employee_headers,json={}); assert generated.status_code==201,generated.text; assert generated.json()['variant_name']=='Физическое лицо'; rendered=Document(io.BytesIO(employee.get(generated.json()['download_url'],headers=employee_headers).content)); assert 'Иван Иванов' in rendered.paragraphs[0].text
    duplicated=employee.post(f'/api/v1/contract-product-drafts/{did}/duplicate',headers=employee_headers,json={'title':'Копия тренировочного договора'})
    assert duplicated.status_code==201,duplicated.text
    copied=duplicated.json(); assert copied['id']!=did and copied['title']=='Копия тренировочного договора' and copied['status']=='DRAFT'
    assert copied['product_version']==draft['product_version'] and copied['common_answers']==common and copied['generated_documents']==[]
    assert employee.patch(f"/api/v1/contract-product-drafts/{copied['id']}/title",headers=employee_headers,json={'title':'Копия для проверки'}).json()['title']=='Копия для проверки'
    assert employee.post(f"/api/v1/contract-product-drafts/{copied['id']}/generate",headers=employee_headers,json={}).status_code==201
    assert employee.get(f'/api/v1/contract-product-drafts/{did}',headers=employee_headers).json()['common_answers']==common
    common['contractor_status']='Индивидуальный предприниматель'; switched=employee.patch(f'/api/v1/contract-product-drafts/{did}',headers=employee_headers,json={'common_answers':common,'variant_answers':{}}); assert switched.status_code==200 and switched.json()['selected_variant']['id']==variants[1]['id']; assert switched.json()['common_answers']['contractor_name']=='Иван Иванов'
    generated_ip=employee.post(f'/api/v1/contract-product-drafts/{did}/generate',headers=employee_headers,json={}); assert generated_ip.status_code==201,generated_ip.text; assert generated_ip.json()['variant_name']=='Индивидуальный предприниматель' and generated_ip.json()['generation_number']==2
    restored=employee.get(f'/api/v1/contract-product-drafts/{did}',headers=employee_headers); assert restored.status_code==200 and restored.json()['selected_variant']['id']==variants[1]['id']
    assert len(restored.json()['generated_documents'])==2
    next_version=manager.post(f"/api/v1/contract-products/{product['id']}/versions",headers=headers); assert next_version.status_code==201 and next_version.json()['version_number']==2
    assert employee.get(f'/api/v1/contract-product-drafts/{did}',headers=employee_headers).json()['product_version']==1
    outsider=TestClient(app); outsider_headers=auth(outsider); assert outsider.get(f'/api/v1/contract-product-drafts/{did}',headers=outsider_headers).status_code==404
    assert outsider.post(f'/api/v1/contract-product-drafts/{did}/duplicate',headers=outsider_headers).status_code==404
    assert outsider.patch(f'/api/v1/contract-product-drafts/{did}/title',headers=outsider_headers,json={'title':'Чужой'}).status_code==404
    assert employee.post(f"/api/v1/contract-products/{product['id']}/versions/{next_version.json()['id']}/publish",headers=employee_headers).status_code==403
    assert hashlib.sha256(manager.get(f"/api/v1/document-templates/{person['id']}/versions/{pv['id']}/source",headers=headers).content).hexdigest()==hashlib.sha256(praw).hexdigest()
    assert hashlib.sha256(manager.get(f"/api/v1/document-templates/{entrepreneur['id']}/versions/{iv['id']}/source",headers=headers).content).hexdigest()==hashlib.sha256(iraw).hexdigest()


def test_r35_resolver_reports_ambiguity_and_configuration_error():
    from types import SimpleNamespace
    from app.contract_products import ContractVariantResolver
    field=SimpleNamespace(field_key='kind',field_type='SINGLE_SELECT',required=True,config={'options':['A','B']})
    version=SimpleNamespace(rules={})
    variants=[SimpleNamespace(id='1',name='Первый',template_version_id='t1',status='ACTIVE',selection_condition={'operator':'IN','field_key':'kind','value':['A','B']}),SimpleNamespace(id='2',name='Второй',template_version_id='t2',status='ACTIVE',selection_condition={'operator':'EQUALS','field_key':'kind','value':'A'})]
    assert ContractVariantResolver.resolve(version,[field],variants,{'kind':'A'})['state']=='AMBIGUOUS'
    variants[0].selection_condition={'operator':'UNKNOWN','field_key':'kind','value':'A'}
    assert ContractVariantResolver.resolve(version,[field],variants,{'kind':'A'})['state']=='CONFIGURATION_ERROR'


def test_r35_training_matrix_blocking_facts_are_deterministic():
    from types import SimpleNamespace
    from app.contract_products import ContractVariantResolver
    def f(key,kind='BOOLEAN',options=None): return SimpleNamespace(field_key=key,field_type=kind,required=True,config={'options':options or []})
    fields=[f('status','SINGLE_SELECT',['PHYSICAL_NO_IP_NO_NPD','IP_NO_NPD','NPD_PHYSICAL','IP_NPD']),f('citizenship','SINGLE_SELECT',['RU','NON_RU']),f('adult'),f('personal'),f('third_parties'),f('labor_signs')]
    eq=lambda key,value:{'operator':'EQUALS','field_key':key,'value':value}
    version=SimpleNamespace(rules={'blocking_rules':[
        {'code':'D005','message':'НПД не поддерживается','condition':{'operator':'IN','field_key':'status','value':['NPD_PHYSICAL','IP_NPD']}},
        {'code':'D006','message':'Иностранный исполнитель','condition':eq('citizenship','NON_RU')},
        {'code':'D007','message':'Несовершеннолетний исполнитель','condition':eq('adult',False)},
        {'code':'D008','message':'Нет личного оказания','condition':{'operator':'OR','conditions':[eq('personal',False),eq('third_parties',True)]}},
        {'code':'D009','message':'Признаки трудовой модели','condition':eq('labor_signs',True)},
    ]})
    variants=[SimpleNamespace(id='person',name='Физлицо',template_version_id='p',status='ACTIVE',selection_condition=eq('status','PHYSICAL_NO_IP_NO_NPD')),SimpleNamespace(id='ip',name='ИП',template_version_id='i',status='ACTIVE',selection_condition=eq('status','IP_NO_NPD'))]
    base={'status':'PHYSICAL_NO_IP_NO_NPD','citizenship':'RU','adult':True,'personal':True,'third_parties':False,'labor_signs':False}
    assert ContractVariantResolver.resolve(version,fields,variants,base)['variant_id']=='person'
    for patch,code in [({'status':'IP_NPD'},'D005'),({'citizenship':'NON_RU'},'D006'),({'adult':False},'D007'),({'third_parties':True},'D008'),({'labor_signs':True},'D009')]:
        result=ContractVariantResolver.resolve(version,fields,variants,{**base,**patch}); assert result['state']=='NOT_APPLICABLE' and result['reason_code']==code
