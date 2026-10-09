from .config import get_llm_settings
from .gateway import LLMGateway
from .prompts import PromptManager
from .context import build_context
from .schemas import LLMMessage, LLMOptions, RequirementsExtractionResult, ProcurementContext, SpecificationAnalysisResult
from .dialogue import clean_list, clean_text, clarification, is_confirmation, normalize_user_message

SPEC_FIELDS = ['subject','purpose','scope','functional_requirements','nonfunctional_requirements','deadline','acceptance_criteria','other_conditions']
CONTEXT_FIELDS = ['subject','category','counterparty_type','amount','currency','procurement_object_type','requires_transfer_of_goods','requires_service_activity','requires_tangible_work_result','requires_agent_actions','agent_acts_in_principal_interest','materials_purchase_required','acceptance_result_type','delivery_required','delivery_location','installation_required','support_required','licensing_required','new_software_development','intellectual_property_related','personal_data_related','advance_payment','term','restrictions','exceptions']
SPEC_INTENTS = {'CREATE_SPECIFICATION','CREATE_SPEC_AND_GET_CONTRACT','UPDATE_SPECIFICATION','CONFIRM_SPECIFICATION','ANALYZE_SPECIFICATION'}
CONTRACT_INTENTS = {'GET_CONTRACT','CREATE_SPEC_AND_GET_CONTRACT'}
LABELS = {'purpose':'цель закупки','scope':'объём поставки или работ','deadline':'срок выполнения','acceptance_criteria':'критерии приёмки'}


class AIOrchestrator:
    def __init__(self, gateway=None):
        self.settings = get_llm_settings()
        self.gateway = gateway or LLMGateway(self.settings)
        self.prompts = PromptManager()

    async def process_message(self, case, user, text, messages, spec, db, procurement=None):
        system, version = self.prompts.load('system')
        task, _ = self.prompts.load('extract_requirements')
        history, current_spec, current_json = build_context(case, messages, spec, self.settings.history_max_messages)
        existing_context = dict(procurement.data if procurement else (case.context or {}))
        prompt = f'{task}\nWORKFLOW_STATE:{case.state}\nSPECIFICATION_STATUS:{spec.status if spec else "NONE"}\nCURRENT_INTENT:{existing_context.get("intent", "")}\nANSWERED_FIELDS:{[key for key,value in {**existing_context,**current_spec}.items() if value not in (None,"",[])]}\nMISSING_FIELDS:{existing_context.get("missing_fields",[])}\nCURRENT_PROCUREMENT_CONTEXT_JSON:{existing_context}\nCURRENT_SPECIFICATION_JSON:{current_json}\nUSER_MESSAGE:{text}'
        llm_messages = [LLMMessage(role='system',content=system), *history, LLMMessage(role='user',content=prompt)]
        _, result = await self.gateway.generate(llm_messages, RequirementsExtractionResult, LLMOptions(metadata={'prompt_version':version}), db, case.id, user.id, 'extract_requirements')

        intent = result.intent.upper()
        aliases = {'CREATE_SPEC':'CREATE_SPECIFICATION','CONTRACT_ONLY':'GET_CONTRACT','UNRELATED_REQUEST':'UNRELATED','UPDATE_SPEC':'UPDATE_SPECIFICATION','CONFIRM_SPEC':'CONFIRM_SPECIFICATION'}
        intent = aliases.get(intent, intent)
        previous_intent = (procurement.intent if procurement else existing_context.get('intent','')).upper()
        if previous_intent in CONTRACT_INTENTS and not spec and is_confirmation(text): intent = previous_intent
        if previous_intent in CONTRACT_INTENTS and intent == 'CREATE_SPECIFICATION': intent = previous_intent
        if intent == 'UNRELATED' or not result.is_procurement:
            context = ProcurementContext(intent='ESCALATE', is_procurement=False, subject=result.subject, category=result.category or 'other_demo', exceptions=['Запрос не относится к закупке'])
            return {'answer':'Запрос требует участия специалиста ДПО.','context':context.model_dump(),'spec_data':None,'create_spec':False,'run_contract':True,'changed':False}

        context_data = existing_context
        context_data['intent'] = intent
        context_data['is_procurement'] = True
        extracted_fields = result.model_fields_set
        for field in CONTEXT_FIELDS:
            value = getattr(result, field, None)
            if field in extracted_fields and value not in (None, '', []): context_data[field] = value
        normalized = normalize_user_message(text, existing_context, current_spec)
        context_data.update(normalized.context)
        valid_llm_resolved=[field for field in result.resolved_fields if (not isinstance(getattr(result,field,None),str) and getattr(result,field,None) is not None) or clean_text(getattr(result,field,''))]
        context_data['resolved_fields'] = list(dict.fromkeys([*valid_llm_resolved, *normalized.resolved_fields]))
        context_data['suggested_options'] = []
        if context_data['resolved_fields']:
            context_data['last_clarification_fields'] = []
            context_data['last_clarification_question'] = ''
            context_data['clarification_repeat_count'] = 0
        context_data['source_confidence'] = result.confidence
        context_data['has_technical_specification'] = bool(spec) or intent in SPEC_INTENTS

        create_spec = intent in SPEC_INTENTS and not (spec and spec.status == 'CONFIRMED' and intent != 'UPDATE_SPECIFICATION')
        data = dict(current_spec) if current_spec else {field:'' for field in SPEC_FIELDS}
        changed = False
        if create_spec:
            for field in SPEC_FIELDS:
                value = clean_text(getattr(result, field, ''))
                if field in extracted_fields and value:
                    if field in {'functional_requirements','other_conditions'} and data.get(field) and value not in data[field]: data[field] = data[field].rstrip('; ') + '; ' + value
                    else: data[field] = value
                    changed = True
            for field in ('items','common_requirements','blocking_requirements','additional_conditions'):
                value = clean_list(getattr(result, field, []))
                if value: data[field] = value; changed = True
            for field,value in normalized.specification.items():
                if clean_text(value): data[field]=value; changed=True
            for update in result.item_updates:
                items=data.get('items',[]); index=update.get('index')
                if isinstance(index,int) and 0 <= index < len(items):
                    items[index]={**items[index],**{key:value for key,value in update.items() if key!='index'}}; data['items']=items; changed=True
            if result.remove_blocking_requirements:
                data['blocking_requirements']=[item for item in data.get('blocking_requirements',[]) if not any(phrase.lower() in str(item).lower() for phrase in result.remove_blocking_requirements)]; changed=True
            for phrase in result.remove_phrases:
                for field in ('functional_requirements','other_conditions'):
                    if phrase.lower() in str(data.get(field,'')).lower():
                        data[field] = '; '.join(part.strip() for part in str(data[field]).split(';') if phrase.lower() not in part.lower()); changed = True
                data['blocking_requirements'] = [item for item in data.get('blocking_requirements',[]) if phrase.lower() not in str(item).lower()]
            missing = [field for field in ('purpose','scope','deadline','acceptance_criteria') if not clean_text(data.get(field,''))]
            context_data['missing_fields'] = missing
            if intent == 'CONFIRM_SPECIFICATION': answer = 'Техническое задание готово к подтверждению. Проверьте карточку и нажмите «Подтвердить».'
            elif intent == 'UPDATE_SPECIFICATION' and changed: answer = 'Изменения внесены только в указанные поля технического задания.'
            elif missing:
                answer,fields,repeats=clarification(missing[:2],existing_context.get('last_clarification_fields',[]),existing_context.get('clarification_repeat_count',0))
                context_data.update(last_clarification_fields=fields,last_clarification_question=answer,clarification_repeat_count=repeats)
            else: answer = 'Черновик технического задания готов. Проверьте данные и подтвердите их.'
        else:
            data = None
            missing = []
            if not context_data.get('subject'): missing.append('subject')
            context_data['missing_fields'] = missing
            if missing:
                answer,fields,repeats=clarification(missing,existing_context.get('last_clarification_fields',[]),existing_context.get('clarification_repeat_count',0))
                context_data.update(last_clarification_fields=fields,last_clarification_question=answer,clarification_repeat_count=repeats)
            else: answer = 'Данных достаточно для подбора договорного шаблона.'

        context = ProcurementContext.model_validate(context_data)
        return {'answer':answer,'context':context.model_dump(),'spec_data':data,'create_spec':create_spec,'run_contract':intent in CONTRACT_INTENTS and (not context.missing_fields or bool(context.exceptions)),'changed':changed,'resolved_fields':context.resolved_fields}

    async def analyse_document(self, case, user, text, db, structured=None):
        system, version = self.prompts.load('system'); task, _ = self.prompts.load('analyse_specification')
        safe = text[:max(1000,self.settings.context_max_tokens*4)]
        messages = [LLMMessage(role='system',content=system),LLMMessage(role='user',content=f'{task}\n<UNTRUSTED_DOCUMENT>\n{safe}\n</UNTRUSTED_DOCUMENT>')]
        _, extracted = await self.gateway.generate(messages,RequirementsExtractionResult,LLMOptions(metadata={'prompt_version':version,'untrusted_document':True}),db,case.id,user.id,'analyse_specification',full_document=True)
        data = {field:getattr(extracted,field,'') for field in SPEC_FIELDS}
        if structured:
            for key, value in structured.items():
                if value not in (None,'',[]): data[key] = value
            if structured.get('items'):
                # A tabular item specification is authoritative evidence of a
                # goods transfer; prose/URLs inside cells must not turn it into
                # a mixed works scenario.
                extracted.procurement_object_type='goods'
                extracted.requires_transfer_of_goods=True
                extracted.requires_service_activity=False
                extracted.requires_tangible_work_result=False
                extracted.requires_agent_actions=False
                extracted.agent_acts_in_principal_interest=False
                extracted.category='supply'
                if not structured.get('deadline') and not structured.get('delivery_terms'):
                    data['deadline']=''
        structured_category=structured.get('procurement_category','') if structured else ''
        context_values={field:getattr(extracted,field,None) for field in CONTEXT_FIELDS}
        context_values.update(subject=data.get('subject') or extracted.subject,category=extracted.category or structured_category,has_technical_specification=True,intent='ANALYZE_SPECIFICATION',missing_fields=[field for field in SPEC_FIELDS if not data.get(field)],source_confidence=extracted.confidence)
        context = ProcurementContext(**context_values)
        return SpecificationAnalysisResult(context=context,specification=RequirementsExtractionResult(**{**extracted.model_dump(),**{key:value for key,value in data.items() if key in RequirementsExtractionResult.model_fields}}),summary='Я проанализировал техническое задание. Проверьте извлечённые сведения и позиции.') , data
