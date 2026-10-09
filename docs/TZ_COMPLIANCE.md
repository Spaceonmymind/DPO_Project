# Соответствие исходному ТЗ

| Требование | Статус | Реализация |
|---|---|---|
| Корпоративный SSO | Частично | Локальная защищённая сессия и подготовленные auth endpoints; корпоративный SSO не подключён |
| Русскоязычный диалог, свободный текст | Реализовано | `app/ai/orchestrator.py`, prompt templates, Chat |
| Один файл на обращение | Реализовано | `POST /cases/{id}/attachments`, HTTP 409 |
| Вход DOCX / PDF / XLSX / XLS | Реализовано | `app/documents/service.py` |
| Определение закупочного запроса | Реализовано | intent/is_procurement в AI Orchestrator |
| Формирование и изменение ТЗ | Реализовано | Orchestrator, PATCH technical-specification, item patches |
| Явное подтверждение | Реализовано | `/technical-specification/confirm` |
| Экспорт DOCX / PDF / Excel | Реализовано | `render_specification` |
| Шесть договорных шаблонов | Частично | На текущем тестовом этапе фактически предоставлены и зарегистрированы 4 оригинальных шаблона; исходное ТЗ предусматривает 6 |
| Выбор и скачивание договора | Реализовано | Детерминированный `app/contracts.py`, case-scoped download оригинала с SHA-256 |
| Договор без обязательного ТЗ | Реализовано | ProcurementContext + GET_CONTRACT flow |
| История / продолжение / переименование | Реализовано | cases/messages API и frontend |
| Серверный поиск | Реализовано | `GET /cases?q=` с ownership filter |
| Удаление с подтверждением | Реализовано | DELETE endpoint и DeleteModal |
| Изоляция пользователей | Реализовано | `own()`, ownership во всех новых endpoints |
| Fallback в ДПО | Реализовано | NO_MATCH / LEGAL_REVIEW_REQUIRED / ESCALATED_TO_DPO |
| Корпоративная структура Excel | Реализовано | Parser и XLSX renderer проверены по предоставленному примеру `Спецификация_ноут MAС.xlsx`; публичный fixture обезличен |
