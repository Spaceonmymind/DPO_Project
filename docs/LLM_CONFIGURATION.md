# Конфигурация LLM

Основные переменные: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_API_KEY`, таймауты, `LLM_MAX_RETRIES`, `LLM_MAX_CONCURRENT_REQUESTS`, лимиты контекста и истории. Полный перечень находится в `.env.example`.

Локально используется `LLM_PROVIDER=mock`. Для совместимой Qwen: `LLM_PROVIDER=openai_compatible`, endpoint `/v1` в `LLM_BASE_URL`, модель и ключ. `LLM_STRUCTURED_OUTPUT_MODE` принимает `prompt`, `json` или `json_schema` согласно документированным возможностям сервера. Скрытого fallback на mock нет. Секреты задаются только окружением и не выводятся endpoint диагностики.
