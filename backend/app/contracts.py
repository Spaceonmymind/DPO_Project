from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import ContractRule, ContractTemplate


@dataclass
class ContractDecision:
    status: str
    reason: str
    template: ContractTemplate | None = None
    missing_fields: list[str] | None = None


REASONS = {
    'supply': 'Закупка товаров без выполнения работ и дополнительных услуг.',
    'works': 'Предмет закупки относится к выполнению работ с передачей результата.',
    'services': 'Предмет закупки относится к оказанию услуг.',
    'software_license': 'Закупка предусматривает предоставление прав использования программного обеспечения.',
    'consulting': 'Предмет закупки относится к информационно-консультационным услугам.',
    'other_demo': 'Подходит универсальный договорный шаблон.',
}


def select_contract(db: Session, context: dict) -> ContractDecision:
    if not context.get('is_procurement', True):
        return ContractDecision('NO_MATCH', 'Запрос не относится к закупке.')
    if context.get('legal_review_required') or context.get('exceptions'):
        return ContractDecision('LEGAL_REVIEW_REQUIRED', 'Для условий закупки требуется участие специалиста ДПО.')
    category = context.get('category') or ''
    missing = []
    if not context.get('subject'): missing.append('subject')
    if not category: missing.append('category')
    if category == 'supply' and context.get('installation_required') is None: missing.append('installation_required')
    if missing:
        return ContractDecision('AMBIGUOUS', 'Недостаточно данных для однозначного выбора договора.', missing_fields=missing)
    rules = db.query(ContractRule).all()
    matches = [rule for rule in rules if rule.conditions.get('category') == category]
    if len(matches) != 1:
        status = 'AMBIGUOUS' if len(matches) > 1 else 'NO_MATCH'
        return ContractDecision(status, 'Не удалось однозначно определить договорный шаблон.')
    template = db.get(ContractTemplate, matches[0].template_id)
    if not template or not template.active:
        return ContractDecision('NO_MATCH', 'Подходящий активный шаблон не найден.')
    return ContractDecision('MATCHED', REASONS.get(category, 'Шаблон соответствует формализованным признакам закупки.'), template)
