"""Concurrency check against an isolated, disposable PostgreSQL database."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

if os.getenv('DPO_EPHEMERAL_PG_TEST') != 'true' or not os.getenv('DATABASE_URL', '').startswith('postgresql'):
    pytest.skip('Requires an explicitly configured disposable PostgreSQL database', allow_module_level=True)

from fastapi.testclient import TestClient
from app.db import (Base, DocumentTemplate, QuestionnaireSchema, Session, SessionLocal,
                    TemplateVersion, User, engine, now)
from app.main import app


def test_concurrent_question_creates_and_reorder_preserve_unique_positions():
    Base.metadata.create_all(engine)
    key=uuid.uuid4().hex
    with SessionLocal() as db:
        user=User(external_id=key,full_name='Проверка',email=f'{key}@example.test',department='ДПО',roles=['dpo_specialist'],password='unused',is_active=True)
        db.add(user);db.flush()
        template=DocumentTemplate(owner_id=user.id,code=key,name='Проверка порядка',category='Тест')
        db.add(template);db.flush()
        version=TemplateVersion(template_id=template.id,version_number=1,status='DRAFT',original_filename='fixture.docx',source_path='unused',source_sha256='0'*64,source_size=1,mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',structure_fingerprint='0'*64,created_by_id=user.id)
        db.add(version);db.flush()
        schema=QuestionnaireSchema(template_version_id=version.id,created_by_id=user.id)
        db.add(schema)
        token=uuid.uuid4().hex;csrf=uuid.uuid4().hex
        db.add(Session(id=token,user_id=user.id,expires_at=now()+timedelta(hours=1),csrf_token=csrf))
        db.commit();tid=template.id;vid=version.id
    base=f'/api/v1/document-templates/{tid}/versions/{vid}'
    def client():
        result=TestClient(app)
        result.cookies.set('dpo_session',token)
        return result
    headers={'x-csrf-token':csrf}
    initial=[]
    for position in range(1,4):
        response=client().post(base+'/fields',headers=headers,json={'field_key':f'field_{position}','label':f'Вопрос {position}','field_type':'TEXT','position':position})
        assert response.status_code==201,response.text
        initial.append(response.json()['id'])
    def create(index):
        return client().post(base+'/fields',headers=headers,json={'field_key':f'new_{index}','label':f'Новый {index}','field_type':'TEXT','position':3})
    with ThreadPoolExecutor(max_workers=2) as pool:
        created=list(pool.map(create,(1,2)))
    assert [response.status_code for response in created]==[201,201],[response.text for response in created]
    assert sorted(response.json()['position'] for response in created)==[4,5]
    ids=initial+[response.json()['id'] for response in created]
    def reorder():return client().patch(base+'/fields/order',headers=headers,json={'field_ids':list(reversed(ids))})
    def create_last():return client().post(base+'/fields',headers=headers,json={'field_key':'last','label':'Последний','field_type':'TEXT','position':5})
    with ThreadPoolExecutor(max_workers=2) as pool:
        result=list(pool.map(lambda fn:fn(),(reorder,create_last)))
    assert result[0].status_code in {200,422} and result[1].status_code==201,[response.text for response in result]
    fields=client().get(base+'/questionnaire',headers=headers).json()['fields']
    assert len(fields)==6
    assert sorted(field['position'] for field in fields)==list(range(1,7))
