import re
from dataclasses import dataclass, field
from typing import Any


NULL_LIKE = {'', '-', '—', 'нет данных', 'не указано', 'не знаю', 'не уверен', 'затрудняюсь', 'null', 'none', 'n/a'}
TEST_PLACEHOLDERS = {'тест', 'test', 'тестовое значение', 'placeholder'}
CONFIRMATIONS = {'да', 'верно', 'всё верно', 'все верно', 'подтверждаю', 'согласен', 'согласна'}


def normalized_phrase(value: str) -> str:
    return re.sub(r'[.!?,;:]+$', '', re.sub(r'\s+', ' ', value.strip().lower()))


def is_confirmation(text: str) -> bool:
    return normalized_phrase(text) in CONFIRMATIONS


def clean_text(value: Any, *, allow_short: bool = False) -> str:
    if not isinstance(value, str): return ''
    cleaned = re.sub(r'\s+', ' ', value).strip()
    lowered = cleaned.lower()
    if lowered in NULL_LIKE or lowered in TEST_PLACEHOLDERS: return ''
    if not allow_short and len(cleaned) < 2: return ''
    return cleaned


def clean_list(values: Any) -> list:
    if not isinstance(values, list): return []
    result = []
    for value in values:
        if isinstance(value, str):
            cleaned = clean_text(value)
            if cleaned: result.append(cleaned)
        elif isinstance(value, dict):
            cleaned = {key: item for key, item in value.items() if not isinstance(item, str) or clean_text(item, allow_short=key in {'unit'})}
            if any(item not in (None, '', []) for item in cleaned.values()): result.append(cleaned)
    return result


DATE_PATTERNS = (
    r'\b(?:до\s+)?\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b',
    r'\b(?:до\s+)?\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4}(?:\s+года)?)?\b',
    r'\b(?:январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)\s+\d{1,2}\b',
    r'\bк\s+концу\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b',
    r'\bв\s+течение\s+\d+\s+(?:дн(?:я|ей)|месяц(?:а|ев)?|недел(?:и|ь))\b',
)


@dataclass
class NormalizedPatch:
    context: dict[str, Any] = field(default_factory=dict)
    specification: dict[str, Any] = field(default_factory=dict)
    resolved_fields: list[str] = field(default_factory=list)


def normalize_user_message(text: str, existing_context: dict, current_spec: dict) -> NormalizedPatch:
    t = normalized_phrase(text); patch = NormalizedPatch()
    services = any(x in t for x in ('услуга', 'услуги', 'оказание услуг', 'консультир', 'техническ поддерж', 'сопровожден'))
    goods = any(x in t for x in ('товар', 'поставка', 'купить', 'приобрести', 'оборудован', 'ноутбук', 'сервер', 'мебел', 'вод'))
    works = any(x in t for x in ('ремонт', 'монтаж', 'изготовлен', 'выполнение работ'))
    agency = any(x in t for x in ('агент', 'по поручению', 'отчёт агента', 'отчет агента'))
    dominant = sum((services, goods, works, agency)) == 1 or any(x in t for x in ('самостоятельное оказание', 'только поставка', 'всё-таки это', 'все-таки это'))
    if services and dominant:
        patch.context.update(procurement_object_type='services', category='services', requires_service_activity=True, requires_transfer_of_goods=False, requires_tangible_work_result=False, requires_agent_actions=False, agent_acts_in_principal_interest=False)
        if not existing_context.get('subject'): patch.context['subject'] = 'Оказание услуг'
        patch.resolved_fields.append('procurement_object_type')
    elif goods and dominant:
        patch.context.update(procurement_object_type='goods', category='supply', requires_transfer_of_goods=True, requires_service_activity=False, requires_tangible_work_result=False, requires_agent_actions=False, agent_acts_in_principal_interest=False)
        patch.resolved_fields.append('procurement_object_type')
        if 'вод' in t:
            patch.context.update(subject='Поставка питьевой воды', ordinary_supply_confirmed=False)
    elif works and dominant:
        patch.context.update(procurement_object_type='works', category='works', requires_tangible_work_result=True, requires_transfer_of_goods=False, requires_service_activity=False, requires_agent_actions=False, agent_acts_in_principal_interest=False)
        patch.resolved_fields.append('procurement_object_type')
    elif agency and dominant:
        patch.context.update(procurement_object_type='agency', category='agency', requires_agent_actions=True, agent_acts_in_principal_interest=True)
        patch.resolved_fields.append('procurement_object_type')

    goods_explicitly_absent=any(x in t for x in ('без передачи товар', 'товары не предусмотрены', 'передача товаров не предусмотрена')) or bool(re.search(r'передача\s+товар.{0,100}не\s+предусмотр',t))
    if goods_explicitly_absent:
        patch.context['requires_transfer_of_goods'] = False
        if services and not works and not agency:
            patch.context.update(procurement_object_type='services',category='services',requires_service_activity=True,requires_tangible_work_result=False,requires_agent_actions=False,agent_acts_in_principal_interest=False)
            if not existing_context.get('subject'): patch.context['subject'] = 'Оказание услуг'
            patch.resolved_fields.append('procurement_object_type')
    if any(x in t for x in ('без установки', 'без монтажа', 'только поставка')):
        patch.context.update(installation_required=False, requires_tangible_work_result=False, requires_service_activity=False)
    if 'без разработки' in t or re.search(r'создание\s+нового\s+программного\s+продукта.{0,40}не\s+предусмотр',t):
        patch.context['new_software_development'] = False
    if 'в течение 12 месяцев' in t: patch.context['term'] = '12 месяцев'

    for pattern in DATE_PATTERNS:
        match = re.search(pattern, t, re.IGNORECASE)
        if match:
            patch.specification['deadline'] = clean_text(match.group(0))
            patch.resolved_fields.append('deadline')
            break
    count = re.search(r'\b(\d+)\s+(?:ноутбук|бутыл|единиц|штук|шт\.?)(?:а|ов|и)?\b', t)
    if count:
        patch.specification['scope'] = f'{count.group(1)} шт.'
        patch.resolved_fields.append('scope')

    if is_confirmation(text) and existing_context.get('last_clarification_fields'):
        fields = existing_context['last_clarification_fields']
        if 'ordinary_supply_confirmation' in fields:
            patch.context.update(requires_transfer_of_goods=True, requires_service_activity=False, requires_tangible_work_result=False, requires_agent_actions=False, agent_acts_in_principal_interest=False, ordinary_supply_confirmed=True, procurement_object_type='goods', category='supply')
            patch.resolved_fields.append('ordinary_supply_confirmation')
    return patch


def clarification(fields: list[str], previous_fields: list[str], repeat_count: int) -> tuple[str, list[str], int]:
    same = fields == previous_fields
    repeats = repeat_count + 1 if same else 0
    labels = {'purpose':'основная цель закупки','scope':'требуемый объём','deadline':'срок выполнения','acceptance_criteria':'критерии приёмки результата'}
    if repeats >= 3:
        question = 'Ответ пока не распознан. Напишите значения отдельными сообщениями или укажите «нужна помощь ДПО»: ' + '; '.join(labels.get(field, field) for field in fields) + '.'
    elif repeats == 2:
        question = 'Не удалось однозначно интерпретировать ответ. Укажите, пожалуйста, отдельно: ' + '; '.join(labels.get(field, field) for field in fields) + '.'
    elif repeats == 1:
        question = 'Осталось уточнить: ' + ' и '.join(labels.get(field, field) for field in fields) + '. Можно ответить свободным текстом.'
    elif len(fields) == 1:
        question = {'deadline':'Какой срок выполнения требуется?','acceptance_criteria':'Какими должны быть критерии приёмки результата?','purpose':'Какова основная цель закупки?','scope':'Какой объём товаров, работ или услуг требуется?'}.get(fields[0], f'Уточните: {labels.get(fields[0], fields[0])}?')
    else:
        question = 'Уточните, пожалуйста: ' + ' и '.join(labels.get(field, field) for field in fields[:2]) + '?'
    return question, fields, repeats
