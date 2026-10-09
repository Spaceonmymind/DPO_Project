import asyncio,json,re
from uuid import uuid4
from ..schemas import LLMResponse,LLMUsage,RequirementsExtractionResult
from ..errors import LLMTimeoutError,LLMUnavailableError

class MockLLMProvider:
    name='mock'
    def __init__(self,settings): self.settings=settings; self.model=settings.model
    async def generate(self,messages,response_schema=None,options=None):
        if self.settings.mock_latency_ms: await asyncio.sleep(self.settings.mock_latency_ms/1000)
        if self.settings.mock_error=='timeout': raise LLMTimeoutError('Симулирован timeout')
        if self.settings.mock_error: raise LLMUnavailableError('Симулирован отказ провайдера')
        text=messages[-1].content; operation=(options.metadata if options else {}).get('operation','extract_requirements')
        payload=self._extract(text,operation)
        content=json.dumps(payload,ensure_ascii=False)
        return LLMResponse(content=content,provider=self.name,model=self.model,finish_reason='stop',usage=LLMUsage(),request_id=str(uuid4()),metadata={'simulated':True})
    def _extract(self,text,operation):
        current={}
        current_context={}
        marker='CURRENT_SPECIFICATION_JSON:'
        if marker in text:
            try: current=json.loads(text.split(marker,1)[1].split('\n',1)[0])
            except Exception: current={}
        context_marker='CURRENT_PROCUREMENT_CONTEXT_JSON:'
        if context_marker in text:
            try: current_context=json.loads(text.split(context_marker,1)[1].split('\n',1)[0])
            except Exception: current_context={}
        user_text=text.rsplit('USER_MESSAGE:',1)[-1].strip() if 'USER_MESSAGE:' in text else text
        t=user_text.lower()
        unrelated=any(x in t for x in ['личный юридический','погода','рецепт'])
        contract_only=any(x in t for x in ['только договор','нужен договор','шаблон договора','подобрать договор','тз делать не надо'])
        create_both=any(x in t for x in ['тз и договор','техническое задание и договор'])
        intent='unrelated' if unrelated else 'confirm_specification' if any(x == re.sub(r'[.!?]+$','',t.strip()) for x in ['да','верно','всё верно','все верно','подтверждаю','согласен','согласна']) else 'update_specification' if any(x in t for x in ['измени','поменяй','добавь','убери','удали']) else 'create_spec_and_get_contract' if create_both else 'get_contract' if contract_only else 'create_specification'
        agency=any(x in t for x in ['агент ', 'агент должен', 'по поручению', 'агентское вознаграждение', 'отчёт агента', 'отчет агента'])
        principal=agency and any(x in t for x in ['по поручению', 'в интересах', 'у третьих лиц', 'вознагражден', 'отчёт', 'отчет'])
        goods=any(x in t for x in ['ноутбук','велосипед','сервер','мебел','оборудов','товар','материал','кондиционер','постав'])
        works=any(x in t for x in ['ремонт','монтаж','изготов','строитель','конструкц']) or (any(x in t for x in ['сайт','лендинг','разработ']) and not any(x in t for x in ['сопровожден','поддержк']))
        services=any(x in t for x in ['услуг','консультац','обучен','сопровожден','эксперт','поддержк'])
        category='software_license' if any(x in t for x in ['лицензи','право использования по']) else 'agency' if agency else 'supply' if goods and not works and not services else 'works' if works and not goods else 'services' if services and not goods and not works else ''
        subject='Поставка ноутбуков' if 'ноутбук' in t else 'Поставка питьевой воды' if 'вод' in t else 'Закупка велосипедов' if 'велосипед' in t else 'Ремонт помещения' if 'ремонт' in t else 'Монтаж оборудования' if 'монтаж' in t else 'Консультационные услуги' if 'консультац' in t else 'Обучение сотрудников' if 'обучен' in t else 'Оказание услуг' if services and not goods and not works else 'Агентское поручение' if agency else 'Разработка корпоративного сайта' if 'сайт' in t else 'Разработка корпоративного лендинга' if 'лендинг' in t else ''
        result=RequirementsExtractionResult(intent=intent,is_procurement=not unrelated,category=category,subject=subject,counterparty_type='legal_entity' if any(x in t for x in ['юрлиц','юридическ']) else '')
        result.procurement_object_type='agency' if agency else 'goods' if goods and not works and not services else 'works' if works and not goods else 'services' if services and not goods else 'mixed' if sum((goods,works,services))>1 else ''
        result.requires_transfer_of_goods=True if goods else None; result.requires_tangible_work_result=True if works else None; result.requires_service_activity=True if services else None
        result.requires_agent_actions=True if agency else None; result.agent_acts_in_principal_interest=True if principal else None
        result.materials_purchase_required=True if agency and any(x in t for x in ['закуп','материал']) else None
        result.acceptance_result_type='товар' if goods and not works else 'результат работ' if works and not goods else 'акт оказанных услуг' if services and not goods and not works else ''
        if unrelated: return result.model_dump(exclude_unset=True)
        count=re.search(r'\b(\d+)\s+(?:ноутбук|велосипед)',t)
        if count: result.scope=f'{count.group(1)} шт.'
        if any(x in t for x in ['только поставка','без установки','без настройки']): result.installation_required=False
        elif any(x in t for x in ['установка','настройка','монтаж']): result.installation_required=True
        if 'персональн' in t and 'данн' in t: result.personal_data_related=True
        if any(x in t for x in ['обратитесь в дпо','юридическая экспертиза']): result.exceptions=['Требуется правовая экспертиза']
        warranty=re.search(r'гаранти[яию][^\d]*(\d+)\s*(месяц|год)',t)
        if warranty: result.other_conditions=f'Гарантия не менее {warranty.group(1)} {warranty.group(2)}'
        if any(x in t for x in ['для сотрудник','оснащен']): result.purpose='Оснащение сотрудников'
        months='января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря'
        month_names='январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь'
        date=re.search(rf'(?:до\s+)?(\d{{1,2}}\s+(?:{months})(?:\s+\d{{4}}(?:\s+года)?)?|(?:{month_names})\s+\d{{1,2}}|\d{{1,2}}[./]\d{{1,2}}(?:[./]\d{{2,4}})?|к\s+концу\s+(?:{months})|в\s+течение\s+\d+\s+(?:дней|месяцев|недель))',t)
        if date: result.deadline=date.group(0)
        req=[]
        if '16 гб' in t: req.append('Оперативная память не менее 16 ГБ')
        if '512 гб' in t: req.append('SSD не менее 512 ГБ')
        if 'личн' in t and 'кабинет' in t: req.append('Личный кабинет')
        if 'адаптив' in t: req.append('Адаптивная версия')
        if 'административ' in t: req.append('Административная панель')
        if req: result.functional_requirements='; '.join(req)
        if 'lenovo' in t: result.other_conditions='Предпочтительный производитель Lenovo'
        if 'убери' in t or 'удали' in t:
            if 'личн' in t: result.remove_phrases=['Личный кабинет']
            if 'производител' in t: result.remove_phrases=['Предпочтительный производитель Lenovo']
            if 'блокирующ' in t: result.remove_blocking_requirements=['Блокирующее требование']
        quantity_change=re.search(r'(?:количество[^\d]*|поменяй[^\d]*)(\d+)',t)
        if quantity_change: result.item_updates=[{'index':0,'quantity':float(quantity_change.group(1))}]
        if ('добавь' in t or 'добавить' in t) and 'блокирующ' in t:
            result.blocking_requirements=['Блокирующее требование']
        if current and intent=='create_specification':
            missing=next((f for f in ['purpose','scope','deadline','acceptance_criteria'] if not current.get(f)),None)
            extracted=any([result.purpose,result.scope,result.deadline,result.acceptance_criteria,result.other_conditions])
            meaningful=len(user_text.strip())>1 and user_text.strip().lower() not in {'тест','test','null','none'}
            if meaningful and missing and not getattr(result,missing) and (not extracted or (missing=='scope' and bool(result.functional_requirements))): setattr(result,missing,user_text)
        result.resolved_fields=[field for field in ['subject','purpose','scope','deadline','acceptance_criteria','procurement_object_type'] if getattr(result,field,None)]
        return result.model_dump(exclude_unset=True)
