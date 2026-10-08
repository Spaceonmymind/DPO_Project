from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class LLMSettings(BaseSettings):
    model_config=SettingsConfigDict(env_file='.env',extra='ignore')
    provider:str='mock'; model:str='qwen'; base_url:str=''; api_key:str=''
    timeout_seconds:float=120; connect_timeout_seconds:float=10; max_retries:int=2
    max_concurrent_requests:int=5; temperature:float=.2; max_output_tokens:int=4096
    structured_output_mode:str='prompt'; context_max_tokens:int=16000; history_max_messages:int=30
    log_content:bool=False; external_data_transfer:bool=False; provider_is_internal:bool=False
    mock_latency_ms:int=0; mock_error:str=''
    @classmethod
    def from_env(cls):
        import os
        return cls(**{k.lower().removeprefix('llm_'):v for k,v in os.environ.items() if k.startswith('LLM_')})
    def validate_provider(self):
        if self.provider not in {'mock','openai_compatible','corporate_ais'}: return False,'Неизвестный LLM provider'
        if self.provider=='openai_compatible' and (not self.base_url or not self.model): return False,'Не заданы LLM_BASE_URL или LLM_MODEL'
        return True,None

@lru_cache
def get_llm_settings(): return LLMSettings.from_env()
