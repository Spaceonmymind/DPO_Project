"""Run only against a disposable PostgreSQL database migrated through Alembic."""
import os
import uuid
from datetime import timedelta

import pytest

if os.getenv('DPO_EPHEMERAL_PG_TEST') != 'true' or not os.getenv('DATABASE_URL', '').startswith('postgresql'):
    pytest.skip('Requires an explicitly configured disposable PostgreSQL database', allow_module_level=True)

from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, event, text
from app.db import (ContractStage, DocumentDraft, DocumentTemplate, DraftStageEvent,
                    QuestionnaireField, QuestionnaireSchema, Session, SessionLocal,
                    TemplateVersion, User, engine, now)
from app.main import app


def test_legacy_stage_sequence_and_unlock_audit_transaction_on_postgres():
    model_constraint = next(item for item in DraftStageEvent.__table__.constraints if isinstance(item, CheckConstraint) and item.name == 'ck_draft_stage_event_type')
    assert all(value in str(model_constraint.sqltext) for value in ('COMPLETED', 'UNLOCKED', 'AUTHORIZED'))
    with engine.connect() as connection:
        definition = connection.execute(text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_draft_stage_event_type'")).scalar_one()
    assert all(value in definition for value in ('COMPLETED', 'UNLOCKED', 'AUTHORIZED'))

    key = uuid.uuid4().hex
    with SessionLocal() as db:
        manager = User(external_id=f'{key}-manager', full_name='Специалист', email=f'{key}-manager@example.test', department='ДПО', roles=['dpo_specialist'], password='unused', is_active=True)
        employee = User(external_id=f'{key}-employee', full_name='Сотрудник', email=f'{key}-employee@example.test', department='ДПО', roles=['employee'], password='unused', is_active=True)
        db.add_all([manager, employee]); db.flush()
        template = DocumentTemplate(owner_id=manager.id, code=key, name='Проверка этапов', category='Тест', status='ACTIVE')
        db.add(template); db.flush()
        version = TemplateVersion(template_id=template.id, version_number=1, status='PUBLISHED', original_filename='fixture.docx', source_path='unused', source_sha256='0'*64, source_size=1, mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document', structure_fingerprint='0'*64, created_by_id=manager.id)
        db.add(version); db.flush()
        template.current_version_id = version.id
        schema = QuestionnaireSchema(template_version_id=version.id, status='PUBLISHED', created_by_id=manager.id)
        db.add(schema); db.flush()
        first = ContractStage(template_version_id=version.id, name='Первый', position=1, status='ACTIVE', created_by_id=manager.id)
        second = ContractStage(template_version_id=version.id, name='Второй', position=2, status='ACTIVE', created_by_id=manager.id)
        third = ContractStage(template_version_id=version.id, name='Третий', position=3, status='ACTIVE', created_by_id=manager.id)
        db.add_all([first, second, third]); db.flush()
        db.add_all([
            QuestionnaireField(schema_id=schema.id, field_key='first', label='Первый ответ', field_type='TEXT', required=True, position=1, config={'stage_ids':[first.id]}),
            QuestionnaireField(schema_id=schema.id, field_key='second', label='Второй ответ', field_type='TEXT', required=True, position=2, config={'stage_ids':[second.id]}),
        ])
        draft = DocumentDraft(owner_id=employee.id, template_version_id=version.id, questionnaire_schema_id=schema.id, status='GENERATED', answers={'first':'Сохранено'}, selected_stage_ids=[first.id], completed_stage_ids=[first.id])
        db.add(draft); db.flush()
        db.add(DraftStageEvent(draft_id=draft.id, stage_id=first.id, actor_id=employee.id, event_type='COMPLETED'))
        token = uuid.uuid4().hex; csrf = uuid.uuid4().hex
        db.add(Session(id=token, user_id=manager.id, expires_at=now()+timedelta(hours=1), csrf_token=csrf))
        db.commit(); draft_id=draft.id; first_id=first.id; second_id=second.id; third_id=third.id

    client = TestClient(app, raise_server_exceptions=False)
    client.cookies.set('dpo_session', token)
    path = f'/api/v1/contract-drafts/{draft_id}/stages/allow-next'
    retired = client.post(path, headers={'x-csrf-token':csrf}, json={'count':2})
    assert retired.status_code == 410, retired.text
    detail = client.get(f'/api/v1/admin/contracts/{draft_id}')
    assert detail.status_code == 200, detail.text
    assert [stage['state'] for stage in detail.json()['stages']] == ['COMPLETED','AVAILABLE','NOT_STARTED']
    assert client.get('/api/v1/admin/contracts?progress=IN_PROGRESS').status_code == 200
    assert client.get('/api/v1/admin/users').status_code == 200
    path = f'/api/v1/contract-drafts/{draft_id}/stages/{first_id}/unlock'
    def force_invalid(_mapper, _connection, target):
        if target.draft_id == draft_id and target.event_type == 'UNLOCKED':
            target.event_type = 'INVALID'
    event.listen(DraftStageEvent, 'before_insert', force_invalid)
    try:
        failed = client.post(path, headers={'x-csrf-token':csrf}, json={'reason':'Исправление данных'})
        assert failed.status_code == 500
    finally:
        event.remove(DraftStageEvent, 'before_insert', force_invalid)
    with SessionLocal() as db:
        stored = db.get(DocumentDraft, draft_id)
        assert stored.selected_stage_ids == [first_id]
        assert stored.completed_stage_ids == [first_id]
        assert stored.answers == {'first':'Сохранено'}
        assert stored.status == 'GENERATED'
        assert [item.event_type for item in db.query(DraftStageEvent).filter_by(draft_id=draft_id).all()] == ['COMPLETED']
    unlocked = client.post(path, headers={'x-csrf-token':csrf}, json={'reason':'Исправление данных'})
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()['completed_stage_ids'] == []
    with SessionLocal() as db:
        stored = db.get(DocumentDraft, draft_id)
        assert stored.answers == {'first':'Сохранено'} and stored.selected_stage_ids == [first_id]
        assert [item.event_type for item in db.query(DraftStageEvent).filter_by(draft_id=draft_id).order_by(DraftStageEvent.created_at).all()] == ['COMPLETED','UNLOCKED']
