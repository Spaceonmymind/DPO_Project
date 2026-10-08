import io
import os
import tempfile

os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
os.environ['STORAGE_LOCAL_PATH'] = tempfile.mkdtemp()
os.environ['SEED_DEMO_USERS'] = 'true'

from fastapi.testclient import TestClient
from docx import Document
from app.db import Base, engine

Base.metadata.create_all(engine)
from app.seed import seed
seed()
from app.main import app


def auth(client: TestClient, name: str = 'ivanov') -> dict[str, str]:
    response = client.post('/api/v1/auth/login', json={'external_id': name, 'password': name})
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
    response = client.post('/api/v1/auth/login', json={'external_id': 'ivanov', 'password': 'ivanov'})
    assert response.status_code == 200 and 'session_id' not in response.json()
    cookie = response.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie
    for _ in range(5):
        assert client.post('/api/v1/auth/login', json={'external_id': 'rate-limit-probe', 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'external_id': 'rate-limit-probe', 'password': 'wrong-password'}).status_code == 429
