from typing import Protocol,Type
from pydantic import BaseModel
from .schemas import LLMMessage,LLMOptions,LLMResponse
class LLMProvider(Protocol):
    name:str; model:str
    async def generate(self,messages:list[LLMMessage],response_schema:Type[BaseModel]|None=None,options:LLMOptions|None=None)->LLMResponse: ...
