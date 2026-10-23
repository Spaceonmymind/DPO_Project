# R3.6.3 final coverage

- PHYSICAL_PERSON: 69 кандидатов, 2 materialized bindings, контрольная генерация заблокирована.
- INDIVIDUAL_ENTREPRENEUR: 71 кандидат, 2 materialized bindings, контрольная генерация заблокирована.
- Всего: 140 / 4 / 0 generated-and-verified.
- Discovery после повторного анализа: 38 `CANDIDATE_FOUND` (после materialization), 94 `REVIEW_REQUIRED`, 4 `CONFIGURED`, 4 `BLOCKED`.
- Все RF001–RF025 остаются `BLOCKED` на уровне end-to-end acceptance: ни один RF не проверен генерацией во всех применимых вхождениях.
- Графики 1/4/10 строк не запускались, поскольку `RepeatingGroup` для реальных draft-версий ещё не настроены.
- Оба исходных файла остаются immutable; контрольные DOCX не добавлялись в Git.
