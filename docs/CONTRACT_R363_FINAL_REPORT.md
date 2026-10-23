# R3.6.3 FINALIZATION — итоговый отчёт

## Статус

Этап **не завершён по критерию сквозной готовности**. Реализован и проверен настоящий контур materialization и draft test-drive, но юридическая конфигурация обоих договоров требует работы специалиста: 4 из 140 физических вхождений материализованы, 0 подтверждены генерацией, 132 требуют настройки/решения и 4 доказанно заблокированы текущим структурным поиском.

## Реализовано

- `BindingMaterializationService` создаёт реальные `DocumentBinding`, а не metadata-маркеры. Он проверяет DRAFT, SHA через защищённый source path, fingerprint, locator/range, поле анкеты, пересечения с bindings, conditional regions и repeating groups.
- Автоматическая материализация разрешена только для точного и семантически простого `REPLACE`. `DERIVED`, `SELECT_BLOCK`, `INCLUDE_EXCLUDE`, `REPEAT` и другие операции не преобразуются в обычный текстовый binding.
- Ручное подтверждение, материализация выбранных кандидатов и rollback доступны только специалисту/администратору и аудитируются.
- Повторный анализ прежних `NOT_FOUND` использует прямой matrix locator и нормализованный точный поиск по document/header/footer nodes. Результат: 16 переведены в `REVIEW_REQUIRED`, 4 получили `BLOCKED` с диагностической причиной; безымянных `NOT_FOUND` больше нет.
- В обе draft-схемы идемпотентно добавлены RF-поля: 18 для физлица и 20 для ИП. Исходные документы и опубликованные версии не менялись.
- Добавлен specialist-only draft test-drive. Он применяет обычные server validators и универсальный renderer, не создаёт `GeneratedDocument`, хранит файл отдельно и маркирует его в header и core properties как `ТЕСТОВЫЙ ДОКУМЕНТ`. Переименование файла метку не снимает.
- Test-drive fail-closed: пока есть нематериализованные кандидаты, генерация возвращает конфликт и список незавершённых мест.

## Фактическое покрытие

| Показатель | Значение |
| --- | ---: |
| Физические вхождения | 140 |
| Материализовано | 4 |
| Подтверждено генерацией | 0 |
| Требует ручной настройки/решения | 132 |
| BLOCKED после повторной диагностики | 4 |
| Контрольный DOCX физлица | Не сформирован |
| Контрольный DOCX ИП | Не сформирован |
| 120 сценариев product resolver | 0 PASS / 120 BLOCKED |

120 natural-language fixtures нельзя честно считать прогнанными через универсальный `ContractProduct`: draft product пока не имеет вариантов и декларативных resolver rules. Старый training-specific parser не использован как подмена универсального resolver; его диагностический запуск также обнаружил необработанное входное значение и потому не считается acceptance.

## P0, которые остаются

1. Настроить через универсальные модели 132 вхождения: derived expressions, conditional legal regions, payment select block, two repeating schedules, conditional place columns и composite/list output.
2. Специалисту принять решения по 94 неоднозначным местам; для 38 точных, но не простых `REPLACE`, настроить правильный тип операции.
3. Разрешить 4 `BLOCKED` вручную по структуре OOXML либо доказать неприменимость.
4. Создать draft variants/rules продукта без публикации и выполнить 120 resolver fixtures.
5. После полной конфигурации сформировать оба DOCX, выполнить OOXML assertions и ручной просмотр Microsoft Word.

## Проверки

- Backend: 171 tests passed.
- Frontend: 24 tests passed.
- TypeScript и production Vite build: успешно.
- SHA-256 матрицы и обоих исходных DOCX совпадают с утверждённым inventory.
- Docker Compose build backend/frontend: успешно; PostgreSQL, backend и frontend healthy.
- Alembic: `014_table_column_regions (head)`; новая таблица не потребовалась, materialization использует существующие модели.
- `/health`: `{"status":"ok"}`.

Commit указан в истории Git и delivery summary.
