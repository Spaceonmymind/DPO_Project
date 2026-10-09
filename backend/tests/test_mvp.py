import io
import os
import tempfile
import hashlib
from urllib.parse import quote
from pathlib import Path
from docx import Document

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['STORAGE_LOCAL_PATH'] = tempfile.mkdtemp()
os.environ['SEED_DEMO_USERS'] = 'true'
template_directory = Path(tempfile.mkdtemp())
os.environ['CONTRACT_TEMPLATES_PATH'] = str(template_directory)
os.environ['CONTRACT_TEMPLATE_ALLOW_DYNAMIC_CHECKSUMS'] = 'true'
for filename in ('Договор_подряда.docx','договор возмездного оказания услуг (образец).docx','Shablon-agentskogo-dogovora.docx'):
    fixture=Document(); fixture.add_paragraph(filename); fixture.save(template_directory/filename)
(template_directory/'договор поставки.rtf').write_bytes(b'{\\rtf1\\ansi approved supply fixture}')

from fastapi.testclient import TestClient
import fitz
import openpyxl
import xlwt
from app.db import Base, engine
from app.documents.service import SpreadsheetSpecificationParser

Base.metadata.create_all(engine)
from app.seed import seed
seed()
from app.main import app


def auth(client: TestClient, name: str = 'ivanov') -> dict[str, str]:
    response = client.post('/api/v1/auth/login', json={'external_id': name, 'password': name.capitalize()})
    assert response.status_code == 200
    return {'x-csrf-token': response.json()['csrf_token']}


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
    recommendation=client.post(f'/api/v1/cases/{case_id}/technical-specification/confirm',headers=headers).json()
    assert recommendation['status']=='matched' and recommendation['template_code']=='SUPPLY'
    assert client.get(f'/api/v1/cases/{case_id}/contract-template').content==(template_directory/'договор поставки.rtf').read_bytes()


def test_consistent_docx_pdf_xlsx_exports():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    for fmt in ('docx','pdf','xlsx'):
        response=client.get(f'/api/v1/cases/{case_id}/technical-specification/download?format={fmt}')
        assert response.status_code==200 and len(response.content)>500
        if fmt=='docx': assert 'Ноутбук Альфа' in '\n'.join(p.text for p in Document(io.BytesIO(response.content)).paragraphs)
        if fmt=='pdf': assert 'Ноутбук Альфа' in ''.join(page.get_text() for page in fitz.open(stream=response.content,filetype='pdf'))
        if fmt=='xlsx': assert 'Ноутбук' in openpyxl.load_workbook(io.BytesIO(response.content)).active['B3'].value


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


def test_mixed_contract_flow_returns_clarification():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужен договор: купить оборудование и выполнить большой комплекс монтажа'}).json()
    assert body['recommendation']['status']=='AMBIGUOUS'
    assert 'основным предметом' in body['recommendation']['reason']
    assert client.get(f'/api/v1/cases/{case_id}/contract-template').status_code==404
