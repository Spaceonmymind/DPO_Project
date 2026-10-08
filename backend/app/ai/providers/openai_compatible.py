import json,time,httpx
from uuid import uuid4
from ..schemas import LLMResponse,LLMUsage
from ..errors import *

class OpenAICompatibleProvider:
    name='openai_compatible'
    def __init__(self,settings,transport=None): self.settings=settings; self.model=settings.model; self.transport=transport
    async def generate(self,messages,response_schema=None,options=None):
        payload={'model':self.model,'messages':[m.model_dump() for m in messages],'temperature':(options.temperature if options and options.temperature is not None else self.settings.temperature),'max_tokens':(options.max_tokens if options and options.max_tokens else self.settings.max_output_tokens)}
        mode=self.settings.structured_output_mode
        if response_schema and mode=='json_schema': payload['response_format']={'type':'json_schema','json_schema':{'name':response_schema.__name__,'schema':response_schema.model_json_schema()}}
        elif response_schema and mode=='json': payload['response_format']={'type':'json_object'}
        headers={'Content-Type':'application/json'}
        if self.settings.api_key: headers['Authorization']='Bearer '+self.settings.api_key
        started=time.monotonic(); timeout=httpx.Timeout(self.settings.timeout_seconds,connect=self.settings.connect_timeout_seconds)
        try:
            async with httpx.AsyncClient(base_url=self.settings.base_url.rstrip('/'),headers=headers,timeout=timeout,transport=self.transport) as client: response=await client.post('/chat/completions',json=payload)
        except httpx.TimeoutException as e: raise LLMTimeoutError('Превышено время ожидания модели') from e
        except httpx.HTTPError as e: raise LLMUnavailableError('Модель недоступна') from e
        if response.status_code in (401,403): raise LLMAuthenticationError('Ошибка аутентификации LLM')
        if response.status_code==429: raise LLMRateLimitError('Превышен лимит LLM')
        if response.status_code in (500,502,503,504): raise LLMUnavailableError('LLM временно недоступна')
        if response.status_code==400 and 'context' in response.text.lower(): raise LLMContextLimitError('Превышен контекст модели')
        if response.is_error: raise LLMInvalidResponseError(f'Некорректный ответ LLM: HTTP {response.status_code}')
        try:
            body=response.json(); choice=body['choices'][0]; content=choice['message']['content']; usage=body.get('usage') or {}
        except (ValueError,KeyError,IndexError,TypeError) as e: raise LLMInvalidResponseError('Некорректная структура ответа LLM') from e
        return LLMResponse(content=content,provider=self.name,model=body.get('model',self.model),finish_reason=choice.get('finish_reason'),usage=LLMUsage(prompt_tokens=usage.get('prompt_tokens'),completion_tokens=usage.get('completion_tokens'),total_tokens=usage.get('total_tokens')),latency_ms=int((time.monotonic()-started)*1000),request_id=response.headers.get('x-request-id') or body.get('id') or str(uuid4()))
