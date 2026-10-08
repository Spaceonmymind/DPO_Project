from .errors import LLMDataPolicyError
class DataTransferPolicy:
    def __init__(self,settings): self.settings=settings
    def enforce(self,data_category='message',full_document=False):
        if self.settings.provider=='mock' or self.settings.provider_is_internal: return
        if not self.settings.external_data_transfer: raise LLMDataPolicyError('Передача данных внешнему LLM-провайдеру запрещена')
        if full_document: raise LLMDataPolicyError('Передача полного документа внешнему провайдеру запрещена')
