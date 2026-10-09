# Архитектура LLM

FastAPI передаёт сообщения и извлечённый текст документов в `AIOrchestrator`. Оркестратор собирает ограниченный контекст обращения, загружает версионированные промпты и вызывает только `LLMGateway`. Gateway применяет Data Transfer Policy, локальный `asyncio.Semaphore`, retry с exponential backoff и jitter, Pydantic-валидацию и журналирование в `ai_runs`.

Провайдеры реализуют единый async-контракт `generate(messages, response_schema, options)`. Модель извлекает intent и признаки, но не выбирает договор. `ProcurementContextRecord` хранится отдельно от опционального `TechnicalSpecification`; `app/contracts.py` принимает решение только по формализованному контексту и возвращает `MATCHED`, `AMBIGUOUS`, `NO_MATCH` или `LEGAL_REVIEW_REQUIRED`.

Источники объединяются без передачи бинарных файлов в LLM: диалог, сохранённый ProcurementContext, структурированный результат spreadsheet parser и ТЗ (если оно существует). Данные из явного сообщения или структурной ячейки имеют приоритет над интерпретацией. Локальный semaphore действует только в одном процессе; для глобального лимита нескольких workers впоследствии нужен распределённый limiter.
