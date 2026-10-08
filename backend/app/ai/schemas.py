from typing import Any,Literal
from pydantic import BaseModel,Field
class LLMMessage(BaseModel): role:Literal['system','user','assistant']; content:str
class LLMUsage(BaseModel): prompt_tokens:int|None=None; completion_tokens:int|None=None; total_tokens:int|None=None
class LLMOptions(BaseModel): temperature:float|None=None; max_tokens:int|None=None; timeout:float|None=None; metadata:dict[str,Any]=Field(default_factory=dict)
class LLMResponse(BaseModel):
    content:str; provider:str; model:str; finish_reason:str|None=None; usage:LLMUsage=Field(default_factory=LLMUsage); latency_ms:int=0; request_id:str|None=None; metadata:dict[str,Any]=Field(default_factory=dict)
class ProcurementContext(BaseModel):
    intent:str='create_specification'; is_procurement:bool=True; subject:str=''; category:str='services'; counterparty_type:str='legal_entity'; amount:int|None=None; has_technical_specification:bool=False; missing_fields:list[str]=Field(default_factory=list)
class RequirementsExtractionResult(BaseModel):
    intent:str='create_specification'; category:str='services'; subject:str=''; purpose:str=''; scope:str=''; functional_requirements:str=''; nonfunctional_requirements:str=''; deadline:str=''; acceptance_criteria:str=''; other_conditions:str=''; remove_phrases:list[str]=Field(default_factory=list); confidence:float=1
class SpecificationAnalysisResult(BaseModel):
    context:ProcurementContext; specification:RequirementsExtractionResult; summary:str
class DialogueState(BaseModel):
    case_id:str; intent:str; procurement_category:str; specification_fields:dict[str,Any]; missing_fields:list[str]; clarification_questions:list[str]; confidence:float=1; last_operation:str=''; status:str=''
