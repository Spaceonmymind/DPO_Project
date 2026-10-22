# Stage 3: roadmap универсального договорного продукта

Цель — детерминированно перенести договор «Проведение тренировок» с вариантами ФЛ/ИП, не ломая Stage 2, legacy data и immutable published versions. Каждый релиз deployable отдельно; до выполнения его критериев новый capability не разрешается для публикации.

## Общие архитектурные правила

- Никаких LLM, свободного кода сотрудников или `eval`.
- Все expressions используют versioned declarative AST/DSL с allowlist operators, schema validation, cycle detection и limits.
- Draft pin-ит product, ruleset, questionnaire schema и окончательно выбранную TemplateVersion.
- Published configurations immutable; изменения создают новую версию.
- Любая неоднозначность, unsupported locator или failed postcondition блокирует generation.
- Renderer остаётся общим: операции определяются binding type/config, а не именем договора/варианта.
- Миграции только additive Alembic; существующие templates/drafts/generated documents продолжают работать.

## R3.1 — conditional fields/questions

**Backend:** versioned condition AST (`all/any/not`, typed comparisons, membership, presence); `visible_if`, `required_if`, `enabled_if`; dependency graph; server-side evaluation и field-level errors. Decision trace без чувствительных значений.

**Frontend:** динамическое появление вопросов, очистка/сохранение скрытых значений по явной policy, пояснение причины обязательности, пересчёт без мерцания.

**Данные/миграции:** добавить versioned questionnaire configuration или `condition` JSON с schema version; не переиспользовать строковые выражения матрицы напрямую.

**Тесты:** truth tables; неизвестные/null; циклы; hidden required; VAT/NO_VAT, payment model, extra option, ФЛ/ИП questions; ownership/version pinning regression.

**Готовность:** UI и API дают одинаковый результат; скрытое обязательное поле не блокирует, применимое незаполненное блокирует; произвольный operator/code отклоняется.

**Зависимости/риск:** фундамент для всех следующих релизов. Главный риск — расхождение client/server evaluator; authoritative evaluator только backend.

## R3.2 — conditional sections

**Backend:** locator v2 `PARAGRAPH_BLOCK`; operations `INCLUDE`, `EXCLUDE`, `SELECT_ONE`; expected hashes, non-overlap, numbering/bookmark/reference safeguards; preview показывает границы блока и unsupported selection.

**Frontend:** выбор нескольких соседних абзацев, визуальная рамка блока, операция и условие, предупреждение о Word fields.

**Миграции:** `document_bindings.locator_version`, `locator_kind`, `operation`, `condition`, `expected_structure` (либо versioned binding config JSON с индексами).

**Тесты:** RF007–RF016; первый/последний абзац; split runs; numbered paragraphs; bookmarks; overlapping/nested blocks; package diff; openability DOCX.

**Готовность:** ровно один payment block остаётся; неприменимые НПД-блоки удалены; юридический текст вне блоков и package parts неизменны.

**Зависимости/риск:** R3.1. Риск — повреждение нумерации/ссылок при удалении OOXML nodes.

## R3.3 — repeating tables

**Статус:** реализовано в R3.3 (migration `011_repeating_groups`).

**Backend:** typed collection/object fields; locator v3 строки-образца и диапазонов/пустых ячеек; clone/delete row с сохранением OOXML; проверка `gridSpan`/блокировка `vMerge`; декларативные cell bindings. Вычисления строк и агрегатов отложены до R3.4.

**Frontend:** редактор массива строк графика; add/remove/reorder; table mapping UI; preview of row prototype and optional place column.

**Миграции:** collection field schema, repeat binding definition, row key policy; additive tables are preferable to opaque JSON for published definitions/audit.

**Тесты:** 0/1/max rows; both table 1 and table 6; 1–12 months; merged cells; optional column; extra-option row; long values/page breaks; duplicate dates; package reopen.

**Готовность:** универсальный механизм детерминированно клонирует выбранную строку; проверен на пустой строке графика реального договора физлица. Конфигурация каждого места использования независима; повторное использование одной группы в нескольких местах и агрегаты пока не поддержаны.

**Зависимости/риск:** R3.1, частично R3.2. Наивысший OOXML-риск этапа.

## R3.4 — computed fields and formatting

**Backend:** declarative formulas with typed operands; dependency DAG; Decimal precision/rounding; date and money formatters; Russian number-to-words with currency forms; derived weekday, row totals, tax and duration; formatter version pinning.

**Frontend:** computed read-only values, source explanation, validation summaries; никаких редактируемых производных значений без explicit override policy.

**Миграции:** computed field definitions, formatter/version metadata and possibly calculation snapshot on draft/generated document for audit.

**Тесты:** boundary dates; leap year; >1 year; 0/22% VAT and NDFL rates configured by product; kopecks; large sums; rounding; words; MIXED=100; mismatch must block.

**Готовность:** одинаковые facts дают байт-семантически одинаковые clauses; все денежные представления согласованы; calculation trace сохранён.

**Зависимости/риск:** R3.1; для table totals — R3.3. Риск — юридически неверное округление/словоформы, требующие business sign-off.

## R3.5 — template variant selection/applicability

**Статус:** универсальный product/version/variant runtime, визуальная конфигурация, resolver, mapping, product drafts и единая анкета реализованы. Полный импорт всех строк корпоративной матрицы и юридическая приёмка остаются R3.6.

**Backend:** `ContractProduct`, `ContractProductVersion`, `ProductVariant`, `ApplicabilityRuleSet/Rule`, `ApplicabilityDecision`; ordered rules with stable reason codes; outcomes `NEEDS_INPUT/BLOCKED/SELECTED`; pinning chosen version; ambiguity and no-match fail closed.

**Frontend:** один catalog card «Договор на проведение тренировок»; сначала общие вопросы, затем вариантные; понятное blocking/clarifying state и decision reason; вариант не выбирается пользователем в обход правил.

**Миграции:** новые additive tables/FKs; nullable `product_version_id`, `decision_snapshot`, `selected_variant_id` на draft; legacy single-template draft остаётся валидным.

**Тесты:** перенести 120 `PROMPT_TESTS` в детерминированные fixtures после нормализации в structured facts; D001–D014/D020/D021/D030/D031/D099; NPD priority; conflicting/unknown data; immutable rule publication.

**Готовность:** все fixtures проходят без LLM; ровно один variant выбран либо generation запрещена с reason code; выбранный TemplateVersion зафиксирован в draft.

**Зависимости/риск:** R3.1; может разрабатываться параллельно R3.2–R3.4. Риск — строки `condition_expression` нельзя исполнять; нужен безопасный импорт в AST и ручная сверка.

## R3.6 — полный перенос тренировочных договоров

**Backend/data:** импорт обоих DOCX как отдельных immutable TemplateVersion одного product; создать schema/rules/bindings; reconcile 74 matrix occurrences с фактическими locator каждого файла; coverage manifest; generation post-validation (нет marker text, все operations выполнены, DOCX valid).

**Frontend:** законченная анкета общих/вариантных вопросов, два графика по утверждённой семантике, readiness checklist, generation/download и audit-visible version info.

**Миграции:** только если выявлены недостающие audit/coverage columns; сами corporate DOCX загружаются в закрытое runtime storage, не Git.

**Тесты:** acceptance fixtures ФЛ/ИП; все применимые RF; each branch payment/VAT/place/extra option/>1 year; 74-occurrence manifest; OOXML structural diff; reopen via LibreOffice/MS Word in release QA; Stage 2/legacy regression.

**Готовность:** юридический владелец принимает generated artifacts для полного decision matrix; никаких красных инструкций/placeholders; неавтоматизированные поля явно блокируют или направляются на manual review; originals checksum unchanged.

**Зависимости/риск:** R3.1–R3.5. Главный риск — неполная исходная карта: реальные DOCX содержат placeholders вне RF001–RF025.

## Рекомендуемая последовательность

```text
R3.1 conditional questions
   ├── R3.2 conditional sections (implemented) ──┐
   ├── R3.4 computations (implemented) ─┼── R3.6 product migration
   └── R3.5 variant/applicability ─┤
       R3.3 repeating tables ──────┘
```

Порядок релизов сохраняется R3.1 → R3.2 → R3.3 → R3.4 → R3.5 → R3.6, но R3.5 можно проектировать после стабилизации condition AST, а R3.4 — частично параллельно R3.3. Нельзя откладывать R3.5 до ручного создания двух независимых catalog products: это закрепит неверную продуктовую модель.

## Data migration и совместимость

1. Добавлять новые таблицы/nullable FK; не менять смысл существующего `DocumentTemplate.current_version_id`.
2. Stage 2 templates считаются implicit single-variant products только на уровне compatibility service, без массового backfill на первом релизе.
3. Locator v1 остаётся читаемым; новые операции создаются только как v2. Published v1 bindings не переписываются.
4. Existing drafts сохраняют pinned TemplateVersion и старый render path. Новый product flow включается feature flag/configuration status.
5. Rules, schemas, bindings, formatters и coverage manifest публикуются атомарным product release или ссылаются на immutable версии.
6. Rollback отключает новый product version, но не удаляет drafts, generated documents или storage.

## Обязательный pre-R3.6 checklist

- Юристы утвердили автоматизируемые поля и поведение каждого conditional block.
- Для каждого из 74 occurrence rows найден конкретный locator в каждом применимом DOCX либо зафиксировано `NOT_APPLICABLE`.
- Решена судьба placeholders вне RF-карты.
- Утверждены rounding, VAT/NDFL, amount-in-words и date formats.
- Уточнено, являются ли два графика одной коллекцией.
- Подтверждены maximum rows/months и page-layout acceptance.
- Negative generation tests доказали fail-closed для stale/unsupported/conflicting bindings.
