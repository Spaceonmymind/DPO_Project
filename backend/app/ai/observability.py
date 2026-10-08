import hashlib,json,logging
from datetime import datetime,timezone
log=logging.getLogger('dpo.ai')
def digest(messages): return hashlib.sha256('\n'.join(m.content for m in messages).encode()).hexdigest()
def structured_log(**data): log.info(json.dumps(data,ensure_ascii=False,default=str))
def utcnow(): return datetime.now(timezone.utc)
