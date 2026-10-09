from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.db import ContractTemplate


@dataclass
class ContractDecision:
    status: str
    reason: str
    template: ContractTemplate | None = None
    missing_fields: list[str] = field(default_factory=list)
    rules_triggered: list[str] = field(default_factory=list)


def _matched(db: Session, code: str, reason: str, rules: list[str]) -> ContractDecision:
    template = db.query(ContractTemplate).filter_by(code=code, active=True).one_or_none()
    if not template:
        return ContractDecision('NO_MATCH', 'Утверждённый активный шаблон не найден. Обратитесь в ДПО.', rules_triggered=rules + ['ACTIVE_TEMPLATE_MISSING'])
    return ContractDecision('MATCHED', reason, template, rules_triggered=rules)


def select_contract(db: Session, context: dict) -> ContractDecision:
    """Deterministic selection from structured facts; an LLM never chooses the file."""
    if not context.get('is_procurement', True):
        return ContractDecision('NO_MATCH', 'Запрос не относится к закупке. Обратитесь в ДПО.', rules_triggered=['NOT_PROCUREMENT'])
    if context.get('legal_review_required') or context.get('exceptions'):
        return ContractDecision('LEGAL_REVIEW_REQUIRED', 'Условия требуют юридической оценки. Обратитесь в ДПО.', rules_triggered=['LEGAL_EXCEPTION'])
    if not context.get('subject'):
        return ContractDecision('AMBIGUOUS', 'Недостаточно сведений о предмете закупки.', missing_fields=['subject'], rules_triggered=['SUBJECT_REQUIRED'])

    goods = context.get('requires_transfer_of_goods') is True
    services = context.get('requires_service_activity') is True
    works = context.get('requires_tangible_work_result') is True
    agent = context.get('requires_agent_actions') is True
    principal = context.get('agent_acts_in_principal_interest') is True
    if agent != principal:
        return ContractDecision('AMBIGUOUS', 'Уточните, действует ли контрагент по поручению и в интересах заказчика как агент, отчитываясь за действия.', missing_fields=['agency_relationship'], rules_triggered=['INCOMPLETE_AGENCY_SIGNS'])
    if agent and principal:
        return _matched(db, 'AGENCY', 'Контрагент действует по поручению и в интересах заказчика, организует действия с третьими лицами и отчитывается как агент.', ['AGENT_ACTIONS', 'PRINCIPAL_INTEREST'])
    if goods and works:
        return ContractDecision('AMBIGUOUS', 'Уточните, что является основным предметом: поставка оборудования с сопутствующим монтажом или самостоятельный результат монтажных работ.', missing_fields=['dominant_procurement_element'], rules_triggered=['GOODS_TRANSFER', 'TANGIBLE_WORK_RESULT', 'MIXED_SCENARIO'])
    if goods and services:
        return ContractDecision('AMBIGUOUS', 'Уточните, что является основным предметом: передача товара или самостоятельное оказание услуг.', missing_fields=['dominant_procurement_element'], rules_triggered=['GOODS_TRANSFER', 'SERVICE_ACTIVITY', 'MIXED_SCENARIO'])
    if works and services:
        return ContractDecision('AMBIGUOUS', 'Уточните, должен ли контрагент передать конкретный материальный результат работ или только осуществлять деятельность.', missing_fields=['acceptance_result_type'], rules_triggered=['TANGIBLE_WORK_RESULT', 'SERVICE_ACTIVITY'])
    if goods:
        return _matched(db, 'SUPPLY', 'Предмет закупки — передача товара без самостоятельного комплекса работ, услуг или агентских действий.', ['GOODS_TRANSFER', 'NO_DOMINANT_WORKS_OR_AGENCY'])
    if works:
        return _matched(db, 'WORKS', 'Предмет закупки — выполнение работ с передачей и приёмкой конкретного результата.', ['TANGIBLE_WORK_RESULT', 'RESULT_ACCEPTANCE'])
    if services:
        return _matched(db, 'SERVICES', 'Предмет закупки — оказание услуг без передачи самостоятельного материального результата работ.', ['SERVICE_ACTIVITY', 'NO_TANGIBLE_WORK_RESULT'])

    category = (context.get('category') or '').lower()
    if category in {'software_license', 'license'} or context.get('licensing_required'):
        return ContractDecision('NO_MATCH', 'Сценарий не покрывается четырьмя утверждёнными шаблонами. Обратитесь в ДПО.', rules_triggered=['UNSUPPORTED_LICENSE'])
    legacy = {'supply': 'SUPPLY', 'works': 'WORKS', 'services': 'SERVICES', 'consulting': 'SERVICES'}.get(category)
    if legacy and all(context.get(key) is None for key in ('requires_transfer_of_goods', 'requires_service_activity', 'requires_tangible_work_result', 'requires_agent_actions')):
        return _matched(db, legacy, 'Шаблон выбран по ранее сохранённой категории обращения; рекомендуется проверить формализованные признаки закупки.', ['LEGACY_CATEGORY'])
    return ContractDecision('NO_MATCH', 'Сценарий не покрывается четырьмя утверждёнными шаблонами. Обратитесь в ДПО.', rules_triggered=['NO_SUPPORTED_RULE'])
