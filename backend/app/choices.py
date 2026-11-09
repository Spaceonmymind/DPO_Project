"""Stable choice identifiers and structured questionnaire answers."""
from __future__ import annotations

import re

OTHER = '__other__'


def validate_options(items, allow_other=False):
    if not isinstance(items, list) or not items or len(items) > 100:
        return False
    keys = []
    for item in items:
        if not isinstance(item, dict) or not {'key', 'label'} <= set(item) or set(item) - {'key', 'label', 'genitive'}:
            return False
        key, label = item['key'], item['label']
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,79}', key) or key == OTHER:
            return False
        if not isinstance(label, str) or not label.strip() or len(label) > 200:
            return False
        if 'genitive' in item and (not isinstance(item['genitive'], str) or len(item['genitive']) > 200):
            return False
        keys.append(key)
    return len(keys) == len(set(keys))


def selected(value):
    if not isinstance(value, dict) or not isinstance(value.get('selected'), list):
        return []
    return value['selected']


def has_option(value, key):
    return key in selected(value)


def other_values(value):
    if not isinstance(value, dict):
        return []
    if 'other_texts' in value:
        return value['other_texts'] if isinstance(value['other_texts'], list) else []
    return [value.get('other_text', '')]


def validate_answer(value, config, multiple, required=False):
    if not isinstance(value, dict) or not {'selected', 'other_text'} <= set(value) or set(value)-{'selected', 'other_text', 'other_texts'} or not isinstance(value.get('selected'), list):
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
    if 'other_texts' in value:
        texts=value['other_texts']
        if not multiple or not isinstance(texts,list) or len(texts)>20 or any(not isinstance(text,str) or len(text)>1000 for text in texts) or sum(len(text) for text in texts)>3000:
            return 'Проверьте собственные варианты'
        normalized=[text.strip().casefold() for text in texts if text.strip()]
        if OTHER in keys and len(normalized)!=len(set(normalized)):
            return 'Собственные варианты не должны повторяться'
    if OTHER in keys and config.get('other_required') and not any(text.strip() for text in other_values(value)):
        return 'Заполните вариант «Иное»'
    return None


def render(value, config, genitive=False):
    keys = selected(value)
    labels = {item['key']: (item.get('genitive') or item['label']) if genitive else item['label'] for item in config.get('option_items', [])}
    parts=[]
    for key in keys:
        if key==OTHER: parts.extend(text.strip() for text in other_values(value) if isinstance(text,str) and text.strip())
        else: parts.append(labels.get(key,''))
    return ', '.join(part for part in parts if part)
