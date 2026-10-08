from ..errors import LLMConfigurationError
class CorporateAISProvider:
    name='corporate_ais'
    def __init__(self,settings): self.settings=settings; self.model=settings.model
    async def generate(self,*args,**kwargs):
        raise LLMConfigurationError('Протокол Corporate AIS ещё не предоставлен. Если AIS совместим с OpenAI API, выберите openai_compatible.')
