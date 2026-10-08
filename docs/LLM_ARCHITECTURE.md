# Архитектура LLM

FastAPI передаёт сообщения и извлечённый текст документов в `AIOrchestrator`. Оркестратор собирает ограниченный контекст обращения, загружает версионированные промпты и вызывает только `LLMGateway`. Gateway применяет Data Transfer Policy, локальный `asyncio.Semaphore`, retry с exponential backoff и jitter, Pydantic-валидацию и журналирование в `ai_runs`.

Провайдеры реализуют единый async-контракт `generate(messages, response_schema, options)`. Rules Engine остаётся единственным компонентом, выбирающим договор. Локальный semaphore действует только в одном процессе; для глобального лимита нескольких workers впоследствии нужен распределённый limiter.
