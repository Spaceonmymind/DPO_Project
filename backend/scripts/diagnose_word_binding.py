"""Read-only inspection of one stored DOCX binding and nearby Word field markers.

Run from backend: python scripts/diagnose_word_binding.py BINDING_KEY
"""
from __future__ import annotations

import argparse
import copy
from sqlalchemy import text

from app.contract_platform import (
    _part_root, _safe_text_range_around_word_fields, paragraph_for,
    replace_range, safe_source, WORD_NS,
)
from app.db import DocumentBinding, DocumentTemplate, QuestionnaireField, SessionLocal, TemplateVersion


def inspect(binding_key: str) -> None:
    with SessionLocal() as session:
        if session.bind.dialect.name == "postgresql":
            session.execute(text("SET TRANSACTION READ ONLY"))
        bindings = session.query(DocumentBinding).filter_by(binding_key=binding_key).all()
        print(f"Совпадений: {len(bindings)}")
        for binding in bindings:
            version = session.get(TemplateVersion, binding.template_version_id)
            template = session.get(DocumentTemplate, version.template_id)
            field = session.get(QuestionnaireField, binding.field_id) if binding.field_id else None
            locator = binding.locator or {}
            print(f"\nШаблон {template.id}, версия {version.id} ({version.status}), привязка {binding.id}")
            print(f"Вопрос: {field.label if field else binding.binding_key}; locator: {locator}")
            print(f"Диапазон: {locator.get('text_start')}..{locator.get('text_end')}; выделение: {binding.selected_text!r}")
            try:
                paragraph = paragraph_for(_part_root(safe_source(version), locator['part']), locator['node'])
                start, end = locator['text_start'], locator['text_end']
                position = 0
                for element in paragraph.iter():
                    kind = element.tag.rsplit('}', 1)[-1]
                    if kind == 't':
                        content = element.text or ''
                        print(f"  w:t {position}..{position + len(content)}: {content[:100]!r}")
                        position += len(content)
                    elif kind in {'fldChar', 'instrText', 'bookmarkStart', 'bookmarkEnd', 'drawing', 'pict', 'object'}:
                        subtype = element.get(f'{{{WORD_NS}}}fldCharType') if kind == 'fldChar' else None
                        print(f"  w:{kind} at {position}" + (f" ({subtype})" if subtype else ''))
                print(f"Проверка безопасного диапазона: {_safe_text_range_around_word_fields(paragraph, start, end)}")
                try:
                    replace_range(copy.deepcopy(paragraph), start, end, 'ПРОВЕРКА')
                    print('Пробная замена на копии: допустима')
                except (ValueError, IndexError, KeyError) as exc:
                    print(f'Пробная замена на копии: {exc}')
            except (ValueError, IndexError, KeyError) as exc:
                print(f'Структурный locator недоступен: {exc}')
        session.rollback()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('binding_key')
    inspect(parser.parse_args().binding_key)
