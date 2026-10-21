# Архитектура платформы договоров

## Назначение этапа 1

Этап создаёт независимый от ИИ фундамент конструктора договоров: версионируемые исходники DOCX, анкеты, структурные привязки, черновики и результаты генерации. Он не заменяет действующие сценарии закупок и не объявляет read-only preview полноценным редактором Word.

## Что есть сейчас

- React/TypeScript/Vite обслуживает единый application shell, обращения, чат и панели ТЗ.
- FastAPI содержит auth, cases, загрузку вложений, legacy `TechnicalSpecification`, выбор договоров и AI orchestration в одном модуле `main.py`.
- SQLAlchemy-модели сосредоточены в `db.py`; схема развивается последовательными Alembic migrations.
- Файлы хранятся вне БД в `DOCUMENT_STORAGE_PATH`; наружу выдаются только через авторизованные endpoints.
- `ContractTemplate` и `ContractRule` — legacy registry утверждённых файлов для автоматического выбора договора. Его нельзя смешивать с редактируемым конструктором.
- Тренировочные договоры читаются из immutable `contract_templates/training` и остаются regression/acceptance fixtures.
- Генераторы ТЗ работают через `python-docx`; это не универсальный движок договорных bindings.

## Границы модулей

```text
contract_platform
├── template catalog       DocumentTemplate, TemplateVersion
├── questionnaire          QuestionnaireSchema, QuestionnaireField
├── binding                DocumentBinding + structural locator
├── drafting               DocumentDraft (version pinned)
├── rendering              GeneratedDocument (version pinned)
├── editor adapter         preview/selection/locator contract
└── audit                  TemplateAuditEvent

legacy (временно сохраняется)
├── cases / messages / attachments
├── TechnicalSpecification / SpecVersion
├── ContractTemplate / ContractRule / ContractRouter
├── AI orchestration
└── training contract renderer
```

Frontend и backend зависят от интерфейса `DocumentEditorAdapter`, а Questionnaire, Bindings и будущий Rendering не зависят от конкретного просмотрщика или ONLYOFFICE.

## Модель данных и lifecycle

### DocumentTemplate

- Владелец: `owner_id → users.id`.
- Уникальность: `(owner_id, code)`.
- Статусы: `DRAFT → ACTIVE → ARCHIVED`.
- `current_version_id` указывает на опубликованную версию. Публикация требует отдельного разрешения.

### TemplateVersion

- FK `template_id → document_templates.id`, `created_by_id/published_by_id → users.id`.
- Уникальность: `(template_id, version_number)`.
- Статусы: `DRAFT → PUBLISHED → SUPERSEDED`.
- Хранит immutable source path, SHA-256, размер, MIME, fingerprint структуры и metadata preview.
- Новая загрузка всегда создаёт новую версию; исходник существующей версии не перезаписывается.

### QuestionnaireSchema / QuestionnaireField

- Schema закреплена за конкретной `TemplateVersion`; уникальна по `(template_version_id, schema_version)`.
- Field принадлежит schema; `field_key` и `position` уникальны внутри неё.
- Поле хранит тип, обязательность и нейтральный `config`, без договорно-специфичного кода.

### DocumentBinding

- Закреплён за `TemplateVersion` и опционально за `QuestionnaireField`.
- Locator содержит part, структурный путь узла, текстовые offsets, run boundaries, версию locator и fingerprint структуры.
- Статусы: `ACTIVE`, `STALE`, `INVALID`.
- Binding версии не переносится автоматически на новый DOCX: требуется проверка/rebase.

### DocumentDraft / GeneratedDocument

- Draft принадлежит пользователю, опционально связан с case и всегда pinned к `template_version_id`.
- Ответы хранятся отдельно от шаблона. Статусы: `DRAFT`, `READY`, `GENERATED`, `ARCHIVED`.
- GeneratedDocument pinned к той же версии и номеру генерации; хранит checksum и закрытый путь.
- Публикация новой версии не меняет уже созданные drafts и generated documents.

### TemplateAuditEvent

Append-only журнал операций шаблона и версии: создание, upload, binding, публикация. Содержит actor FK и безопасные metadata без содержимого договора.

## Ownership и RBAC

- `employee`: не управляет каталогом шаблонов; в будущем создаёт собственные drafts из опубликованных версий.
- `dpo_specialist`: создаёт и изменяет собственные templates/versions/bindings.
- `administrator`: управляет любым шаблоном.
- `template_publisher` или `administrator`: отдельное разрешение на публикацию. Роль специалиста ДПО сама по себе публикацию не разрешает.
- Чужой ресурс скрывается как `404`; отсутствие функциональной роли возвращает `403`.

## Хранение и безопасность DOCX

Исходник сохраняется как `storage/template_sources/<template_id>/<version_id>/source.docx`. Пользовательское имя хранится только как metadata. Проверяются расширение, allowlist MIME, лимит upload, ZIP-структура OOXML, обязательные entries, CRC, число entries, суммарный распакованный размер и traversal-пути. При каждом скачивании checksum сверяется с БД. Каталог не публикуется nginx.

Корпоративные DOCX и generated files исключены из Git. Миграция не удаляет legacy tables, cases, volumes или файлы.

## Feasibility spike: способы просмотра DOCX

| Способ | Плюсы | Ограничения | Решение |
|---|---|---|---|
| DOCX → HTML (`mammoth`/LibreOffice) | Быстрый read-only preview, обычное DOM-выделение | HTML теряет часть Word layout; обратное сопоставление с OOXML нестабильно | Не выбран как источник locator |
| Прямой разбор WordprocessingML | Стабильные part/node/run locators для immutable версии; таблицы и headers доступны | Нет точной пагинации, floating objects и Word layout | Выбран для этапа 1 |
| ONLYOFFICE/Collabora | Высокая визуальная точность, полноценное редактирование и callbacks | Отдельный сервис, лицензирование, WOPI/JWT и сложная эксплуатация | Кандидат варианта А на следующий этап |

### Реализованный adapter

`DocxXmlPreviewAdapter` читает `document.xml`, headers и footers, возвращает абзацы и ячейки таблиц с locator. UI показывает read-only fragments. Выделение внутри одного fragment преобразуется в offsets и границы исходных runs; backend повторно проверяет текст по неизменному DOCX перед сохранением binding.

### Доказанные свойства и ограничения

- Split runs: выделение может пересекать несколько runs; locator хранит start/end run и offsets.
- Merged cells: фиксируются `gridSpan` и `vMerge`, но визуальная сетка Word воспроизводится приблизительно.
- Headers/footers: имеют отдельный part и потому не конфликтуют с body.
- Tables: locator содержит table/row/cell/paragraph indexes.
- Повторяющийся текст: различается структурным путём, а не самим текстом.
- Стабильность: гарантируется только внутри immutable version и проверяется `structure_fingerprint`.
- Не поддержано: выделение через несколько структурных узлов, точные координаты/страницы, text boxes, shapes, revisions, content controls и сложные поля Word.

Поэтому этап доказывает структурную привязку диапазона внутри узла, но не полноценную визуальную разметку с fidelity Microsoft Word.

## План миграции

1. Этап 1: versioned templates, secure upload/download, XML preview, node-range binding POC, RBAC и audit.
2. Этап 2: CRUD анкет и полей, UI bindings, renderer по bindings, draft lifecycle, rebase/validation bindings, regression fixtures на двух тренировочных договорах. Реализован для простых полей и диапазонов внутри одного структурного узла.
3. Этап 3: подключение ONLYOFFICE/Collabora через новый adapter; callback security, WOPI/JWT, совместное редактирование и сравнение fidelity.
4. Этап 4: миграция пользовательских маршрутов на новую платформу, импорт legacy registry, read-only compatibility layer и постепенный вывод AI/TechnicalSpecification/ContractRouter из основного UI.

Удаление legacy кода возможно только после миграции данных, проверки generated artifacts и отдельного rollback-плана.

## Реализация этапа 2

- Поля анкеты остаются частью `QuestionnaireSchema` конкретной версии. Группа, подсказка, placeholder, правила и варианты выбора хранятся в `config`; пользовательский код и вычисляемые выражения не исполняются.
- Один `field_key` может иметь несколько `DocumentBinding`. Каждое вхождение имеет `occurrence_index`, OOXML locator и fingerprint исходной версии.
- Публикация проверяет обязательные поля, orphan/conflicting/stale bindings и выполняет пробный deterministic render. После публикации версия, поля и bindings неизменяемы.
- `DocumentDraft` создаётся только из текущей опубликованной версии и сохраняет version pinning. Ответы проверяются на клиенте и сервере; изменение ответов делает предыдущую генерацию устаревшей по времени обновления draft.
- Renderer копирует исходный ZIP package и изменяет только связанные `w:t` в `document.xml`, header/footer parts. Split runs заменяются от конца диапазонов; окружающий текст и свойства runs/paragraphs/tables остаются в package.
- Generated DOCX хранится в закрытом `storage/generated_contracts/<draft_id>/`, выдаётся только владельцу и проверяется по SHA-256.

Ограничения этапа 2: нет cross-node selection, повторяемых строк таблиц, условных секций, формул, text boxes/shapes, complex Word fields и редактирования юридического текста. Для этих структур renderer возвращает контролируемую ошибку.

## R3.1: условные вопросы

`QuestionnaireField.config` поддерживает `visible_when` и `required_when` в формате versioned declarative AST. Версия формата фиксируется полем `QuestionnaireSchema.condition_schema_version=1`. Листовые выражения имеют `field_key`, allowlisted `operator` и, кроме empty-операторов, typed `value`; группы представлены `AND`/`OR` с `conditions` и `NOT` с `condition`.

`ConditionEngine` является серверным источником истины. При изменении поля и публикации он проверяет ссылки, типы значений/операторов, циклы и limits дерева. При сохранении и генерации сервер заново определяет видимые и обязательные поля. Ответ скрытого поля сохраняется в pinned `DocumentDraft`, но его binding не передаётся renderer. Frontend повторяет вычисление только для немедленной реакции интерфейса и не заменяет серверную проверку.

R3.1 не добавляет операции над условными DOCX-блоками: скрытие вопроса исключает его простую текстовую привязку из render pass, но не удаляет абзац, строку или раздел. Такие операции относятся к R3.2/R3.3.

## R3.2: условные области DOCX

`ConditionalDocumentRegion` принадлежит immutable `TemplateVersion` и хранит стабильный `region_key`, один из пяти типов (`RUN`, `PARAGRAPH`, `PARAGRAPH_GROUP`, `TABLE_ROW`, `TABLE`), locator v2, fingerprint исходной структуры, `include_when` и неизменную исходную юридическую формулировку. Условия валидируются и вычисляются тем же `ConditionEngine`, что и R3.1.

Locator содержит OOXML part, структурные границы и SHA-256 выбранных XML-элементов. Для текстового диапазона дополнительно сохраняются offsets; для группы — полный упорядоченный список соседних абзацев; для строки и таблицы — структурные индексы. Любое изменение исходной структуры делает locator stale и блокирует публикацию/генерацию.

Renderer работает только с копией исходного ZIP package. Сначала вычисляются видимые поля и набор включённых областей, затем обычные подстановки и удаления применяются от конца текстовых диапазонов; исключённые OOXML-узлы удаляются через их родителя. Подстановка внутри условной области разрешена: при включении она выполняется, при исключении пропускается. Частичные пересечения диапазонов, пересечения/вложенность условных областей и вертикально объединённые строки запрещены.

Поля Word, bookmarks/cross-references, drawings, shapes и embedded objects внутри удаляемой области блокируются, потому что их безопасное автоматическое восстановление не доказано. Удаление целого нумерованного абзаца сохраняет `numbering.xml` и свойства оставшихся пунктов; области с bookmark/field cross-reference не публикуются. Preflight проверяет SHA исходника, условия, locators, fingerprints, конфликты и формирует две ветви: все области включены и все исключены.

Значения скрытых полей продолжают храниться в `DocumentDraft`, но исключаются из набора ответов для решений по юридическим областям. Таким образом старое скрытое значение не может неожиданно включить блок; `IS_EMPTY` для неактивного поля при этом имеет явную семантику «ответ отсутствует».

Ограничения R3.2: нет вложенных областей, повторяемых таблиц, пересчётов, вариантов шаблона, редактирования Word layout, удаления строк с `vMerge` и автоматического ремонта полей/перекрёстных ссылок.
