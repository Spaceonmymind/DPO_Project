"""Stable choice identifiers and structured questionnaire answers."""
from __future__ import annotations

import re

OTHER = '__other__'


def validate_options(items, allow_other=False):
    if not isinstance(items, list) or not items or len(items) > 100:
        return False
    keys = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {'key', 'label'}:
            return False
        key, label = item['key'], item['label']
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}', key) or key == OTHER:
            return False
        if not isinstance(label, str) or not label.strip() or len(label) > 200:
            return False
        keys.append(key)
    return len(keys) == len(set(keys))


def selected(value):
    if not isinstance(value, dict) or not isinstance(value.get('selected'), list):
        return []
    return value['selected']


def has_option(value, key):
    return key in selected(value)


def validate_answer(value, config, multiple, required=False):
    if not isinstance(value, dict) or set(value) != {'selected', 'other_text'} or not isinstance(value.get('selected'), list):
        return 'Выберите значение из списка'
    keys = selected(value)
    allowed = {item['key'] for item in config.get('option_items', [])}
    if config.get('allow_other'):
        allowed.add(OTHER)
    if any(not isinstance(key, str) or key not in allowed for key in keys) or len(keys) != len(set(keys)):
        return 'Выберите значение из списка'
    if not multiple and len(keys) > 1:
        return 'Выберите один вариант'
    if required and not keys:
        return 'Обязательное поле'
    other_text = value.get('other_text')
    if not isinstance(other_text, str) or len(other_text) > 1000:
        return 'Проверьте текст варианта «Иное»'
    if OTHER in keys and config.get('other_required') and not other_text.strip():
        return 'Заполните вариант «Иное»'
    return None


def render(value, config):
    keys = selected(value)
    labels = {item['key']: item['label'] for item in config.get('option_items', [])}
    return ', '.join((value.get('other_text', '').strip() if key == OTHER else labels.get(key, '')) for key in keys if key != OTHER or value.get('other_text', '').strip())
