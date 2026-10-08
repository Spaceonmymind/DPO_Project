# Подключение провайдера

OpenAI-compatible адаптер вызывает относительный `/chat/completions` от настроенного `LLM_BASE_URL`, передаёт историю, temperature и max_tokens, читает usage/finish reason/request id. Любой structured JSON повторно валидируется локально Pydantic.

`corporate_ais` зарегистрирован отдельно, но намеренно возвращает configuration error, пока корпоративная команда не предоставит endpoint, аутентификацию и схемы. Если AIS совместим с OpenAI API, применяется готовый `openai_compatible`. Для собственного протокола реализуется `LLMProvider`, после чего он регистрируется в factory без изменений бизнес-логики.
