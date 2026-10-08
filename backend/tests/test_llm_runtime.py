import asyncio,json,httpx,pytest
from app.ai.config import LLMSettings
from app.ai.factory import create_provider
from app.ai.gateway import LLMGateway
from app.ai.schemas import LLMMessage,RequirementsExtractionResult
from app.ai.errors import *

def run(coro): return asyncio.run(coro)
def settings(**kwargs):
 values={'provider':'openai_compatible','base_url':'https://llm.test/v1','model':'qwen','provider_is_internal':True}; values.update(kwargs); return LLMSettings(**values)
def response(status=200,body=None,headers=None):
 return httpx.Response(status,json=body or {'id':'r1','model':'qwen','choices':[{'message':{'content':'{}'},'finish_reason':'stop'}]},headers=headers)

def test_mock_provider_structured_output():
 p=create_provider(LLMSettings(provider='mock')); r=run(p.generate([LLMMessage(role='user',content='Нужно купить 10 ноутбуков до 30 ноября 2026 года, ОЗУ 16 ГБ')],RequirementsExtractionResult)); data=json.loads(r.content); assert data['scope']=='10 шт.' and data['deadline']
def test_factory_unknown_and_missing_config():
 with pytest.raises(LLMConfigurationError): create_provider(LLMSettings(provider='unknown'))
 with pytest.raises(LLMConfigurationError): create_provider(LLMSettings(provider='openai_compatible',base_url=''))
def test_openai_valid_json_and_missing_usage():
 transport=httpx.MockTransport(lambda req:response(body={'choices':[{'message':{'content':json.dumps({'subject':'Ноутбуки'})},'finish_reason':'stop'}]})); p=create_provider(settings(),transport); r=run(p.generate([LLMMessage(role='user',content='x')],RequirementsExtractionResult)); assert r.usage.total_tokens is None
def test_openai_usage_and_request_id():
 body={'model':'qwen','choices':[{'message':{'content':'{}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':2,'completion_tokens':3,'total_tokens':5}}
 r=run(create_provider(settings(),httpx.MockTransport(lambda req:response(body=body,headers={'x-request-id':'abc'}))).generate([LLMMessage(role='user',content='x')])); assert r.usage.total_tokens==5 and r.request_id=='abc'
@pytest.mark.parametrize('status,error',[ (401,LLMAuthenticationError),(429,LLMRateLimitError),(500,LLMUnavailableError)])
def test_http_errors(status,error):
 p=create_provider(settings(),httpx.MockTransport(lambda req:response(status))); 
 with pytest.raises(error): run(p.generate([LLMMessage(role='user',content='x')]))
def test_invalid_response_and_invalid_structured_json():
 p=create_provider(settings(),httpx.MockTransport(lambda req:httpx.Response(200,json={'bad':True})))
 with pytest.raises(LLMInvalidResponseError): run(p.generate([LLMMessage(role='user',content='x')]))
 p=create_provider(settings(),httpx.MockTransport(lambda req:response(body={'choices':[{'message':{'content':'not-json'}}]}))); g=LLMGateway(settings(max_retries=0),p)
 with pytest.raises(LLMInvalidResponseError): run(g.generate([LLMMessage(role='user',content='x')],RequirementsExtractionResult))
def test_timeout_mapping():
 def handler(req): raise httpx.ReadTimeout('late',request=req)
 p=create_provider(settings(),httpx.MockTransport(handler))
 with pytest.raises(LLMTimeoutError): run(p.generate([LLMMessage(role='user',content='x')]))
def test_retry_and_exhaustion():
 calls={'n':0}
 def handler(req): calls['n']+=1; return response(500) if calls['n']<2 else response()
 p=create_provider(settings(),httpx.MockTransport(handler)); run(LLMGateway(settings(max_retries=2),p).generate([LLMMessage(role='user',content='x')])); assert calls['n']==2
 with pytest.raises(LLMUnavailableError): run(LLMGateway(settings(max_retries=1),create_provider(settings(),httpx.MockTransport(lambda req:response(500)))).generate([LLMMessage(role='user',content='x')]))
def test_context_limit_and_data_policy():
 p=create_provider(settings(),httpx.MockTransport(lambda req:httpx.Response(400,text='context length exceeded')))
 with pytest.raises(LLMContextLimitError): run(p.generate([LLMMessage(role='user',content='x')]))
 external=settings(provider_is_internal=False,external_data_transfer=False)
 with pytest.raises(LLMDataPolicyError): run(LLMGateway(external,create_provider(external,httpx.MockTransport(lambda req:response()))).generate([LLMMessage(role='user',content='secret')]))
def test_mock_multi_field_extraction_and_update():
 p=create_provider(LLMSettings(provider='mock'))
 first=json.loads(run(p.generate([LLMMessage(role='user',content='Нужно купить 10 ноутбуков для сотрудников до 30 ноября 2026 года, 16 ГБ, SSD 512 ГБ')])).content)
 assert first['subject']=='Поставка ноутбуков' and first['scope']=='10 шт.' and 'SSD' in first['functional_requirements']
 prompt='CURRENT_SPECIFICATION_JSON:'+json.dumps(first,ensure_ascii=False)+'\nUSER_MESSAGE:Убери требование к производителю'
 changed=json.loads(run(p.generate([LLMMessage(role='user',content=prompt)])).content); assert changed['intent']=='update_specification' and changed['remove_phrases']
def test_corporate_ais_has_explicit_unimplemented_protocol():
 provider=create_provider(LLMSettings(provider='corporate_ais',model='qwen'))
 with pytest.raises(LLMConfigurationError): run(provider.generate([LLMMessage(role='user',content='x')]))
def test_json_schema_capability_is_configuration_driven():
 seen={}
 def handler(req): seen.update(json.loads(req.content)); return response()
 p=create_provider(settings(structured_output_mode='json_schema'),httpx.MockTransport(handler)); run(p.generate([LLMMessage(role='user',content='x')],RequirementsExtractionResult)); assert seen['response_format']['type']=='json_schema'
