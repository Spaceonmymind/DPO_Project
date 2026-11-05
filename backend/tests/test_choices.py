from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

import pytest
from docx import Document

from app import choices
from app.conditions import ConditionEngine, ConditionConfigurationError


CONFIG = {'option_items': [{'key': 'catering', 'label': 'Кейтеринг'}, {'key': 'entertainment', 'label': 'Развлекательные активности'}], 'allow_other': True, 'other_required': True}


def field(key='services', kind='MULTI_SELECT', required=True, **config):
    return SimpleNamespace(id=key, field_key=key, field_type=kind, required=required, config={**CONFIG, **config})


def test_choices_validation_and_legacy():
    from app.contract_platform import FieldPayload, validate_field_payload, field_config, validate_active_answers, render_value
    payload = FieldPayload(field_key='services', label='Услуги', field_type='MULTI_SELECT', position=1, option_items=CONFIG['option_items'], allow_other=True, other_required=True)
    validate_field_payload(payload)
    assert field_config(payload)['option_items'] == CONFIG['option_items']
    target = field()
    assert validate_active_answers([target], {'services': {'selected': ['catering', choices.OTHER], 'other_text': 'Прокат санок'}}) == {}
    assert validate_active_answers([target], {'services': {'selected': [choices.OTHER], 'other_text': ''}})['services'] == 'Заполните вариант «Иное»'
    assert validate_active_answers([target], {'services': {'selected': [], 'other_text': ''}})['services'] == 'Обязательное поле'
    assert validate_active_answers([target], {'services': {'selected': ['unknown'], 'other_text': ''}})
    assert render_value(target, {'selected': ['catering', 'entertainment', choices.OTHER], 'other_text': 'Прокат санок'}) == 'Кейтеринг, Развлекательные активности, Прокат санок'
    assert render_value(target, {'selected': ['catering'], 'other_text': 'Старый текст'}) == 'Кейтеринг'
    old = field(kind='SINGLE_SELECT', **{'option_items': [], 'options': ['Старый вариант']})
    assert validate_active_answers([old], {'services': 'Старый вариант'}) == {}


def test_choice_conditions_nested_and_schema():
    source = field()
    leaf = {'operator': 'CONTAINS_OPTION', 'field_key': 'services', 'value': 'catering'}
    rule = {'operator': 'AND', 'conditions': [{'operator': 'OR', 'conditions': [leaf, {'operator': 'OTHER_SELECTED', 'field_key': 'services'}]}, {'operator': 'NOT', 'condition': {'operator': 'NOT_CONTAINS_OPTION', 'field_key': 'services', 'value': 'entertainment'}}]}
    ConditionEngine.validate_condition(rule, [source])
    assert ConditionEngine.evaluate(rule, {'services': {'selected': ['catering', 'entertainment'], 'other_text': ''}})
    assert not ConditionEngine.evaluate(rule, {'services': {'selected': ['catering'], 'other_text': ''}})
    assert not ConditionEngine.evaluate({'operator': 'OTHER_SELECTED', 'field_key': 'services'}, {'services': {'selected': ['catering'], 'other_text': 'Старый текст'}})
    with pytest.raises(ConditionConfigurationError):
        ConditionEngine.validate_condition({'operator': 'CONTAINS_OPTION', 'field_key': 'services', 'value': 'missing'}, [source])


def test_real_docx_choice_binding(tmp_path: Path):
    from app.contract_platform import formatted_bindings, render_docx
    source = tmp_path / 'source.docx'
    target = tmp_path / 'result.docx'
    doc = Document(); doc.add_paragraph('Услуги: PLACEHOLDER'); doc.save(source)
    original = source.read_bytes()
    binding = SimpleNamespace(id='binding', field_id='services', binding_key='services', locator={'part': 'word/document.xml', 'node': 'word/document.xml#/p[1]', 'text_start': 8, 'text_end': 19}, format_config={'format': 'RAW'})
    answer = {'selected': ['catering', choices.OTHER], 'other_text': 'Прокат санок'}
    values = formatted_bindings([binding], {'services': answer}, [field()])
    with patch('app.contract_platform.safe_source', return_value=source):
        render_docx(SimpleNamespace(), [binding], values, target)
    assert 'Кейтеринг, Прокат санок' in Document(target).paragraphs[0].text
    assert source.read_bytes() == original
