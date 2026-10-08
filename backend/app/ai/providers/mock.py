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
        marker='CURRENT_SPECIFICATION_JSON:'
        if marker in text:
            try: current=json.loads(text.split(marker,1)[1].split('\n',1)[0])
            except Exception: current={}
        user_text=text.rsplit('USER_MESSAGE:',1)[-1].strip() if 'USER_MESSAGE:' in text else text
        t=user_text.lower()
        unrelated=any(x in t for x in ['личный юридический','погода','рецепт'])
        intent='unrelated_request' if unrelated else 'confirm_specification' if any(x in t for x in ['подтверждаю','всё верно','все верно']) else 'update_specification' if any(x in t for x in ['измени','добавь','убери','удали']) else 'create_specification'
        category='supply' if any(x in t for x in ['ноутбук','велосипед','постав','оборудов']) else 'works' if any(x in t for x in ['сайт','лендинг','разработ']) else 'services'
        subject='Поставка ноутбуков' if 'ноутбук' in t else 'Закупка велосипедов' if 'велосипед' in t else 'Разработка корпоративного сайта' if 'сайт' in t else 'Разработка корпоративного лендинга' if 'лендинг' in t else ('Закупка услуг' if not current else '')
        result=RequirementsExtractionResult(intent=intent,category=category,subject=subject)
        if unrelated: return result.model_dump()
        count=re.search(r'\b(\d+)\s+(?:ноутбук|велосипед)',t)
        if count: result.scope=f'{count.group(1)} шт.'
        if any(x in t for x in ['для сотрудник','оснащен']): result.purpose='Оснащение сотрудников'
        date=re.search(r'(?:до|срок[^—-]*[—-]?)\s*(\d{1,2}\s+[а-я]+\s+\d{4}(?:\s+года)?)',t)
        if date: result.deadline=date.group(1)
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
        if current and intent=='create_specification':
            missing=next((f for f in ['purpose','scope','deadline','acceptance_criteria'] if not current.get(f)),None)
            extracted=any([result.purpose,result.scope,result.deadline,result.acceptance_criteria,result.other_conditions])
            if missing and not getattr(result,missing) and (not extracted or (missing=='scope' and bool(result.functional_requirements))): setattr(result,missing,user_text)
        return result.model_dump()
