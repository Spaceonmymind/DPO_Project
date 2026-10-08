import asyncio,random,time
from .config import get_llm_settings
from .factory import create_provider
from .policy import DataTransferPolicy
from .validation import validate_output
from .schemas import LLMOptions
from .errors import LLMError,LLMInvalidResponseError
from .observability import digest,structured_log,utcnow

class LLMGateway:
    def __init__(self,settings=None,provider=None):
        self.settings=settings or get_llm_settings(); self.provider=provider or create_provider(self.settings); self.semaphore=asyncio.Semaphore(self.settings.max_concurrent_requests); self.policy=DataTransferPolicy(self.settings)
    async def generate(self,messages,response_schema=None,options=None,db=None,case_id=None,user_id=None,operation='generate',full_document=False):
        self.policy.enforce('document' if full_document else 'message',full_document)
        options=options or LLMOptions(); options.metadata={**options.metadata,'operation':operation}; started=utcnow(); retries=0; result=None; error=None
        for attempt in range(self.settings.max_retries+1):
            try:
                async with self.semaphore: result=await self.provider.generate(messages,response_schema,options)
                if response_schema: parsed=validate_output(result.content,response_schema)
                else: parsed=None
                error=None
                break
            except LLMError as exc:
                error=exc; retries=attempt
                if not exc.retryable or attempt>=self.settings.max_retries: break
                await asyncio.sleep((.15*(2**attempt))+random.uniform(0,.05))
        finished=utcnow(); latency=int((finished-started).total_seconds()*1000)
        if db is not None:
            from app.db import AIRun,SessionLocal
            usage=result.usage if result else None
            logdb=SessionLocal()
            try:
                logdb.add(AIRun(case_id=case_id,user_id=user_id,operation=operation,provider=self.provider.name,model=self.provider.model,status='success' if result else 'error',started_at=started,finished_at=finished,latency_ms=latency,prompt_tokens=usage.prompt_tokens if usage else None,completion_tokens=usage.completion_tokens if usage else None,total_tokens=usage.total_tokens if usage else None,retry_count=retries,error_code=getattr(error,'code',None),error_message=str(error)[:500] if error else None,request_id=result.request_id if result else None,input_hash=digest(messages),output_hash=(__import__('hashlib').sha256(result.content.encode()).hexdigest() if result else None),metadata_json=options.metadata)); logdb.commit()
            finally: logdb.close()
        structured_log(operation=operation,case_id=case_id,provider=self.provider.name,model=self.provider.model,duration=latency,status='success' if result else 'error',error_code=getattr(error,'code',None),retry_count=retries,request_id=result.request_id if result else None)
        if error: raise error
        if not result: raise LLMInvalidResponseError('Пустой ответ модели')
        result.latency_ms=latency; return result,parsed
