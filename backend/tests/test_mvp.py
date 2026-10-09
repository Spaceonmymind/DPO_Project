import io
import os
import tempfile
from pathlib import Path

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['STORAGE_LOCAL_PATH'] = tempfile.mkdtemp()
os.environ['SEED_DEMO_USERS'] = 'true'

from fastapi.testclient import TestClient
from docx import Document
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
    assert client.get('/api/v1/templates/' + recommendation.json()['template_id'] + '/download').status_code == 200


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
    sheet.merge_cells('A1:F1'); sheet['A1'] = 'Предмет закупки'; sheet['A2'] = 'Предмет закупки'; sheet['B2'] = 'Поставка ноутбуков'
    sheet.append(['Наименование','Количество','Единица измерения','Характеристики','Гарантия','Адрес поставки','Ссылка'])
    sheet.append(['Ноутбук Альфа',3,'шт.','RAM 16 ГБ; SSD 512 ГБ','24 месяца','Москва','Карточка товара'])
    sheet['G4'].hyperlink = 'https://example.test/notebook-a'
    sheet.append(['Ноутбук Бета',2,'шт.','RAM 32 ГБ; SSD 1 ТБ','36 месяцев','Москва',''])
    requirements = workbook.create_sheet('Требования')
    requirements.append(['Общие требования','Только поставка, без установки'])
    requirements.append(['Блокирующее требование','Не допускается восстановленное оборудование'])
    requirements.append(['Срок поставки','20 рабочих дней'])
    buffer = io.BytesIO(); workbook.save(buffer); return buffer.getvalue()


def test_contract_only_without_specification_and_download():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    response=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Хотим купить 5 ноутбуков у юридического лица, только поставка.'})
    body=response.json(); assert body['technical_specification'] is None
    assert body['procurement_context']['intent']=='GET_CONTRACT' and body['procurement_context']['installation_required'] is False
    assert body['recommendation']['status']=='MATCHED'
    assert client.get('/api/v1/templates/'+body['recommendation']['template_id']+'/download').status_code==200


def test_contract_ambiguity_then_clarification_and_legal_review():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'GET_CONTRACT'}).json()['id']
    first=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Хотим купить 5 ноутбуков у юридического лица.'}).json()
    assert first['technical_specification'] is None and first['recommendation'] is None
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
        assert parsed['items'][0]['references']=='https://example.test/notebook-a'
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


def test_consistent_docx_pdf_xlsx_exports():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})
    for fmt in ('docx','pdf','xlsx'):
        response=client.get(f'/api/v1/cases/{case_id}/technical-specification/download?format={fmt}')
        assert response.status_code==200 and len(response.content)>500
        if fmt=='docx': assert 'Поставка ноутбуков' in '\n'.join(p.text for p in Document(io.BytesIO(response.content)).paragraphs)
        if fmt=='pdf': assert 'Поставка ноутбуков' in ''.join(page.get_text() for page in fitz.open(stream=response.content,filetype='pdf'))
        if fmt=='xlsx': assert openpyxl.load_workbook(io.BytesIO(response.content)).active['B3'].value=='Поставка ноутбуков'


def test_search_delete_and_ownership():
    ivan=TestClient(app); ih=auth(ivan); anna=TestClient(app); ah=auth(anna,'petrova')
    own_case=ivan.post('/api/v1/cases',headers=ih,json={'title':'Секретные велосипеды'}).json()['id']
    foreign=anna.post('/api/v1/cases',headers=ah,json={'title':'Секретные ноутбуки'}).json()['id']
    results=ivan.get('/api/v1/cases?q=Секретные').json()
    assert own_case in [item['id'] for item in results] and foreign not in [item['id'] for item in results]
    assert ivan.delete(f'/api/v1/cases/{foreign}',headers=ih).status_code==404
    assert ivan.delete(f'/api/v1/cases/{own_case}',headers=ih).status_code==204
    assert ivan.get(f'/api/v1/cases/{own_case}').status_code==404
