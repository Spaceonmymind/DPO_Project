from pydantic import BaseModel
class ProcurementContext(BaseModel):
 intent:str='procurement'; is_procurement:bool=True; subject:str='Закупка услуг'; category:str='services'; counterparty_type:str='legal_entity'; amount:int|None=None; has_technical_specification:bool=False; missing_fields:list[str]=[]
class LLMProvider:
 def extract(self,text:str)->ProcurementContext: raise NotImplementedError
 def analyse_specification(self,text:str)->dict: raise NotImplementedError
class MockLLMProvider(LLMProvider):
 def extract(self,text):
  t=text.lower()
  if any(x in t for x in ['личн','непонят','юридическ']): return ProcurementContext(intent='unsupported',is_procurement=False,category='other')
  category='works' if any(x in t for x in ['разработк','лендинг','сайт','строител']) else 'supply' if any(x in t for x in ['велосипед','постав','оборудов','товар']) else 'software_license' if 'лиценз' in t else 'services'
  subject='Закупка велосипедов' if 'велосипед' in t else 'Разработка корпоративного лендинга' if any(x in t for x in ['лендинг','сайт']) else 'Закупка услуг'
  return ProcurementContext(subject=subject,category=category,has_technical_specification=('тз' in t or 'техническ' in t),missing_fields=['purpose','scope','deadline','acceptance_criteria'])
 def analyse_specification(self,text):
  t=text.lower(); ctx=self.extract(t); ctx.has_technical_specification=True
  data={'subject':'Разработка корпоративного лендинга','purpose':'Информирование участников мероприятия и продвижение события','scope':'Разработка адаптивной веб-страницы и административной панели','functional_requirements':'Адаптивная веб-версия, форма регистрации, административная панель','nonfunctional_requirements':'Корректная работа в современных браузерах','deadline':'30 ноября 2026 года','acceptance_criteria':'Соответствие функциональным требованиям и успешное тестирование','other_conditions':''}
  if 'велосипед' in t: data.update({'subject':'Закупка велосипедов','purpose':'Оснащение сотрудников','scope':'3 велосипеда','deadline':'25 октября 2026 года','acceptance_criteria':'Соответствие характеристикам и количеству'}); ctx.category='supply'
  return {'context':ctx.model_dump(),'specification':data,'summary':'Я изучил техническое задание. Ниже — сведения, которые удалось определить.'}
class CorporateQwenProvider(LLMProvider):
 def extract(self,text): raise RuntimeError('Corporate Qwen requires configuration')
def provider(): return MockLLMProvider()
