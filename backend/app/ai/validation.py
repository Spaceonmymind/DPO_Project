import json
from pydantic import ValidationError
from .errors import LLMInvalidResponseError
def validate_output(content,schema):
    try:
        raw=json.loads(content); return schema.model_validate(raw)
    except (ValueError,TypeError,ValidationError) as e: raise LLMInvalidResponseError('Ответ модели не соответствует ожидаемой схеме') from e
