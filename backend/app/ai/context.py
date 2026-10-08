import json
from .schemas import LLMMessage
def build_context(case,messages,spec,limit):
    history=[LLMMessage(role=m.role if m.role in {'user','assistant'} else 'user',content=m.content) for m in messages[-limit:]]
    current=(spec.data if spec else {})
    return history,current,json.dumps(current,ensure_ascii=False,separators=(',',':'))
