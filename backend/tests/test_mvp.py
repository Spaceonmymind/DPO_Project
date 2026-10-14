import io
import os
import tempfile
import hashlib
import shutil
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
training_fixture_root=Path('/app/contract_templates/training') if Path('/app/contract_templates/training').is_dir() else Path(__file__).resolve().parents[2]/'contract_templates'/'training'
shutil.copytree(training_fixture_root,template_directory/'training')

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
        if fmt=='xlsx': assert 'Ноутбук' in openpyxl.load_workbook(io.BytesIO(response.content)).active['B11'].value


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


def run_training_dialogue(client,headers,initial,vat='NO_VAT'):
    answers={
      'service.name':'Проведение тренировок по плаванию','term.start':'2026-11-01','term.end':'2027-01-31',
      'price.total':'120 000 рублей','tax.ndfl_rate':'13%','tax.ndfl_amount':'15 600 рублей',
      'tax.vat_status':'Без НДС' if vat=='NO_VAT' else 'С НДС','tax.no_vat_basis':'Применение УСН',
      'tax.vat_rate':'20%','tax.vat_amount':'20 000 рублей','payment.model':'Постоплата',
      'payment.postpay_percent':'100%','payment.postpay_days':'10 дней','places.multiple_or_not_in_contract':'Нет',
      'schedule.months':'2026-11','schedule.entries':'2026-11-10, вторник, 10:00, 1, 120000, Москва',
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


def test_partial_date_answer_only_asks_acceptance_criteria():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    for text in ('Нужно разработать лендинг','Продвижение мероприятия','Адаптивный лендинг'):
        client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':text})
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'25 октября'}).json()
    assert body['technical_specification']['data']['deadline']=='25 октября'
    assert body['procurement_context']['missing_fields']==['acceptance_criteria']
    assert 'критерии приёмки' in body['messages'][-1]['content'] and 'срок' not in body['messages'][-1]['content'].lower()


def test_natural_date_october_25_is_saved():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Нужно разработать лендинг'})
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'октябрь 25'}).json()
    assert body['technical_specification']['data']['deadline']=='октябрь 25'


def test_text_confirmation_uses_same_transition_as_button_after_xlsx():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'ANALYZE_SPECIFICATION'}).json()['id']
    uploaded=client.post(f'/api/v1/cases/{case_id}/attachments',headers=headers,files={'file':('sample.xlsx',spreadsheet_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()['case']
    assert uploaded['procurement_context']['procurement_object_type']=='goods'
    assert uploaded['procurement_context']['requires_tangible_work_result'] is False
    body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':'Всё верно'}).json()
    assert body['technical_specification']['status']=='CONFIRMED'
    assert body['recommendation']['template_code']=='SUPPLY' and body['state']=='COMPLETED'
    assert not any(field in body['procurement_context']['missing_fields'] for field in ('subject','scope'))


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


def test_loop_detector_never_repeats_identical_question_three_times():
    client=TestClient(app); headers=auth(client)
    case_id=client.post('/api/v1/cases',headers=headers,json={'initial_intent':'CREATE_SPECIFICATION'}).json()['id']
    questions=[]
    for text in ('Нужно разработать лендинг','не знаю','не уверен','затрудняюсь'):
        body=client.post(f'/api/v1/cases/{case_id}/messages',headers=headers,json={'content':text}).json(); questions.append(body['messages'][-1]['content'])
    assert len(set(questions[-3:]))==3
