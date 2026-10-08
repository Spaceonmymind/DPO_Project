from .config import get_llm_settings
from .errors import LLMConfigurationError
from .providers import MockLLMProvider,OpenAICompatibleProvider,CorporateAISProvider
def create_provider(settings=None,transport=None):
    settings=settings or get_llm_settings(); valid,error=settings.validate_provider()
    if not valid: raise LLMConfigurationError(error)
    if settings.provider=='mock': return MockLLMProvider(settings)
    if settings.provider=='openai_compatible': return OpenAICompatibleProvider(settings,transport)
    if settings.provider=='corporate_ais': return CorporateAISProvider(settings)
    raise LLMConfigurationError('Неизвестный LLM provider')
