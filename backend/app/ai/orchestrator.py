from .config import get_llm_settings
from .gateway import LLMGateway
from .prompts import PromptManager
from .context import build_context
from .schemas import LLMMessage,LLMOptions,RequirementsExtractionResult,ProcurementContext,SpecificationAnalysisResult

FIELDS=['subject','purpose','scope','functional_requirements','nonfunctional_requirements','deadline','acceptance_criteria','other_conditions']
LABELS={'purpose':'цель закупки','scope':'объём поставки или работ','functional_requirements':'основные функциональные требования','deadline':'срок выполнения','acceptance_criteria':'критерии приёмки'}

class AIOrchestrator:
    def __init__(self,gateway=None): self.settings=get_llm_settings(); self.gateway=gateway or LLMGateway(self.settings); self.prompts=PromptManager()
    async def process_message(self,case,user,text,messages,spec,db):
        system,version=self.prompts.load('system'); task,_=self.prompts.load('extract_requirements'); history,current,current_json=build_context(case,messages,spec,self.settings.history_max_messages)
        prompt=f'{task}\nCURRENT_SPECIFICATION_JSON:{current_json}\nUSER_MESSAGE:{text}'
        llm_messages=[LLMMessage(role='system',content=system),*history,LLMMessage(role='user',content=prompt)]
        _,result=await self.gateway.generate(llm_messages,RequirementsExtractionResult,LLMOptions(metadata={'prompt_version':version}),db,case.id,user.id,'extract_requirements')
        if result.intent=='unrelated_request': return {'answer':'Я могу помочь с подготовкой закупочной документации. Для этого запроса требуется участие специалиста ДПО.','context':ProcurementContext(intent=result.intent,is_procurement=False,category='other').model_dump(),'data':current,'ready':False,'changed':False}
        data=dict(current) if current else {f:'' for f in FIELDS}; changed=False
        for field in FIELDS:
            value=getattr(result,field,'')
            if value:
                if field in {'functional_requirements','other_conditions'} and data.get(field) and value not in data[field]: data[field]=data[field].rstrip('; ')+ '; '+value
                else: data[field]=value
                changed=True
        for phrase in result.remove_phrases:
            for field in ('functional_requirements','other_conditions'):
                if phrase.lower() in data.get(field,'').lower():
                    parts=[x.strip() for x in data[field].split(';') if phrase.lower() not in x.lower()]; data[field]='; '.join(parts); changed=True
        missing=[f for f in ('purpose','scope','deadline','acceptance_criteria') if not data.get(f)]
        ctx=ProcurementContext(intent=result.intent,is_procurement=True,subject=data.get('subject') or 'Закупка услуг',category=result.category,has_technical_specification=True,missing_fields=missing)
        if result.intent=='confirm_specification': answer='Техническое задание готово к подтверждению. Проверьте карточку и нажмите «Подтвердить ТЗ».'
        elif result.intent=='update_specification' and changed: answer='Изменения внесены в черновик технического задания.'
        elif missing:
            ask=' и '.join(LABELS[f] for f in missing[:2]); answer=f'Уточните, пожалуйста: {ask}?'
        else: answer='Черновик технического задания готов. Проверьте его в карточке и при необходимости внесите изменения.'
        return {'answer':answer,'context':ctx.model_dump(),'data':data,'ready':not missing,'changed':changed}
    async def analyse_document(self,case,user,text,db):
        system,version=self.prompts.load('system'); task,_=self.prompts.load('analyse_specification')
        safe=text[:max(1000,self.settings.context_max_tokens*4)]
        messages=[LLMMessage(role='system',content=system),LLMMessage(role='user',content=f'{task}\n<UNTRUSTED_DOCUMENT>\n{safe}\n</UNTRUSTED_DOCUMENT>')]
        _,extracted=await self.gateway.generate(messages,RequirementsExtractionResult,LLMOptions(metadata={'prompt_version':version,'untrusted_document':True}),db,case.id,user.id,'analyse_specification',full_document=True)
        data={f:getattr(extracted,f,'') for f in FIELDS}; ctx=ProcurementContext(subject=data['subject'] or 'Закупка услуг',category=extracted.category,has_technical_specification=True,missing_fields=[f for f in FIELDS if not data[f]])
        return SpecificationAnalysisResult(context=ctx,specification=extracted,summary='Я изучил техническое задание. Ниже — сведения, которые удалось определить.')
