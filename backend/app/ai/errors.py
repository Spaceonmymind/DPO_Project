class LLMError(Exception): code='llm_error'; retryable=False
class LLMConfigurationError(LLMError): code='configuration_error'
class LLMTimeoutError(LLMError): code='timeout'; retryable=True
class LLMAuthenticationError(LLMError): code='authentication_error'
class LLMRateLimitError(LLMError): code='rate_limit'; retryable=True
class LLMInvalidResponseError(LLMError): code='invalid_response'
class LLMUnavailableError(LLMError): code='unavailable'; retryable=True
class LLMContextLimitError(LLMError): code='context_limit'
class LLMDataPolicyError(LLMError): code='data_policy'
