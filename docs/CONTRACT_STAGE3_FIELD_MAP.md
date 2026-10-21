# Stage 3: карта фактов, полей и вхождений

Карта построена по `Матрица_применимости_LLM_v2.xlsx` и сверена со структурой двух утверждённых DOCX. Обозначения вариантов: **ФЛ** — физическое лицо, **ИП** — индивидуальный предприниматель, **оба** — оба DOCX. `S2` означает поддержку текущим Stage 2 без изменения архитектуры.

## 1. Входные и производные факты (40)

| # | Путь | Класс | Тип / обязательность | Вариант | Правило и зависимость | S2 / расширение |
|---:|---|---|---|---|---|---|
| 1 | `subject.type` | TEMPLATE_SELECTION_FACT | enum, critical | оба | TRAINING_SERVICE; иной предмет блокирует | Нет: applicability rules |
| 2 | `subject.paid` | TEMPLATE_SELECTION_FACT | boolean, critical | оба | `true`; false блокирует | Нет: rules |
| 3 | `customer.type` | TEMPLATE_SELECTION_FACT | enum, critical | оба | только CORPORATE_AO | Нет: rules |
| 4 | `contractor.status` | TEMPLATE_SELECTION_FACT | enum, critical | оба | ФЛ/ИП выбирает вариант; NPD/legal/unknown блокирует или уточняет | Нет: variant selector |
| 5 | `contractor.citizenship` | MANUAL_REVIEW_TRIGGER | enum, critical для ФЛ | ФЛ | только RU | Нет: rules/outcome |
| 6 | `contractor.age_18_plus` | MANUAL_REVIEW_TRIGGER | boolean, critical для ФЛ | ФЛ | false блокирует | Нет: rules/outcome |
| 7 | `performance.personal` | TEMPLATE_SELECTION_FACT | boolean, critical | оба | только true | Нет: rules |
| 8 | `performance.third_parties` | MANUAL_REVIEW_TRIGGER | boolean, critical | оба | true блокирует | Нет: rules/outcome |
| 9 | `labor.salary_or_position` | MANUAL_REVIEW_TRIGGER | boolean, stop | оба | любой трудовой признак блокирует | Нет: rules/outcome |
| 10 | `labor.internal_rules` | MANUAL_REVIEW_TRIGGER | boolean, stop | оба | то же | Нет: rules/outcome |
| 11 | `labor.fixed_workday` | MANUAL_REVIEW_TRIGGER | boolean, stop | оба | то же | Нет: rules/outcome |
| 12 | `labor.leave_benefits` | MANUAL_REVIEW_TRIGGER | boolean, stop | оба | то же | Нет: rules/outcome |
| 13 | `service.name` | SIMPLE_FIELD | string, required | оба | RF005; предмет договора | Да: TEXT |
| 14 | `contract.form_label` | CONDITIONAL_FIELD | enum, required | оба | RF001: typical/custom label | Частично: select, но нет derived label |
| 15 | `appendices.other` | MULTI_OCCURRENCE | array<string>, optional, default `[]` | оба | RF002; replace/delete | Нет: array + delete |
| 16 | `price.total` | COMPUTED_FIELD | decimal > 0, required | оба | участвует в RF006/RF018, цифрами и прописью | Частично MONEY; нет formatter/dependencies |
| 17 | `tax.ndfl_rate` | CONDITIONAL_FIELD | decimal 0..100, ФЛ required | ФЛ | RF006/RF009/RF018/RF019 | Нет: conditional required |
| 18 | `tax.ndfl_amount` | COMPUTED_FIELD | decimal >=0, ФЛ required | ФЛ | зависит от price/rate или вводится; повторяется | Нет: formula + multi-output |
| 19 | `tax.vat_status` | CONDITIONAL_FIELD | enum, ИП required | ИП | выбирает VAT/NO_VAT текст RF006/RF010/RF014/RF018 | Нет: conditions/blocks |
| 20 | `tax.vat_rate` | CONDITIONAL_FIELD | decimal, if VAT_PAYER | ИП | RF006/RF018 | Нет: conditional required |
| 21 | `tax.vat_amount` | COMPUTED_FIELD | decimal, if VAT_PAYER | ИП | price/rate; RF006/RF018 | Нет: formula |
| 22 | `tax.no_vat_basis` | CONDITIONAL_FIELD | string, if NO_VAT | ИП | альтернатива VAT clause | Нет: conditional branch |
| 23 | `payment.model` | CONDITIONAL_SECTION | enum, required | оба | RF007; ровно PREPAY/MIXED/POSTPAY | Нет: select block |
| 24 | `payment.advance_percent` | CONDITIONAL_FIELD | decimal, PREPAY/MIXED | оба | для MIXED + postpay = 100 | Нет: conditional/cross-field validation |
| 25 | `payment.advance_days` | CONDITIONAL_FIELD | integer >0, PREPAY/MIXED | оба | срок аванса | Нет: conditional required |
| 26 | `payment.postpay_percent` | CONDITIONAL_FIELD | decimal, MIXED; 100 POSTPAY | оба | cross-field total | Нет: conditional/computed default |
| 27 | `payment.postpay_days` | CONDITIONAL_FIELD | integer >0, MIXED/POSTPAY | оба | срок постоплаты | Нет: conditional required |
| 28 | `payment.bank_guarantee` | CONDITIONAL_SECTION | boolean, required | оба | RF008 только для PREPAY/MIXED | Нет: include/exclude block |
| 29 | `term.start` | SIMPLE_FIELD | date, required | оба | начало услуг; участвует в длительности | Частично DATE; нужен formatter |
| 30 | `term.end` | SIMPLE_FIELD | date, required, >= start | оба | конец; dependency | Частично DATE; нет cross-field rule/formatter |
| 31 | `schedule.months` | REPEATING_ROW | array<YYYY-MM>, required | оба | RF021: 36 маркеров в двух графиках | Нет: collection/row operations |
| 32 | `schedule.entries` | REPEATING_TABLE | array<object>, required | оба | date, weekday, time, count, unit_price, place | Нет: table renderer |
| 33 | `places.multiple_or_not_in_contract` | CONDITIONAL_SECTION | boolean, required | оба | RF020: условная колонка двух таблиц | Нет: column operation |
| 34 | `extra_option.enabled` | CONDITIONAL_SECTION | boolean, required | оба | RF022: строка в двух таблицах | Нет: include/exclude rows |
| 35 | `extra_option.limit` | CONDITIONAL_FIELD | integer >0 if enabled | оба | RF023, 8 вхождений | Нет: conditional + multi occurrence block |
| 36 | `physical.passport` | CONDITIONAL_FIELD | string, ФЛ required | ФЛ | часть RF024 | Частично TEXT; нет composite output |
| 37 | `physical.snils` | CONDITIONAL_FIELD | string, ФЛ required | ФЛ | часть RF024 | Частично TEXT; нет composite output |
| 38 | `ip.ogrnip` | CONDITIONAL_FIELD | 15 digits, ИП required | ИП | RF025 | Частично TEXT+regex; нет variant condition |
| 39 | `term.more_than_one_year` | COMPUTED_FIELD | boolean, ИП required | ИП | выводится из dates или подтверждается | Нет: formula/dependency |
| 40 | `ip.long_term_resources_clause` | CONDITIONAL_SECTION | boolean if >1 year | ИП | RF016 include/delete | Нет: conditional block |

`STATIC_LEGAL_TEXT` — весь остальной утверждённый текст двух DOCX. Он не является ответом анкеты, не должен редактироваться пользователем и переносится renderer побайтно на уровне незатронутых ZIP parts/nodes. Любая операция Stage 3 обязана доказывать, что изменены только опубликованные bindings.

## 2. Канонические RF-поля и все 74 вхождения

| RF | Путь / класс | Scope | Вх. | Локаторы матрицы | Источник и обработка | S2 |
|---|---|---|---:|---|---|---|
| RF001 | `contract.form_label` / CONDITIONAL_FIELD | оба | 1 | P15 | enum; заменить label | Частично |
| RF002 | `appendices.other` / MULTI_OCCURRENCE | оба | 1 | P16 | array; заменить либо удалить | Нет |
| RF003 | `contractor.variant_label` / COMPUTED_FIELD | оба | 1 | P41 | из выбранного варианта | Нет |
| RF004 | `party.status_clause` / COMPUTED_FIELD | оба | 1 | P46 | вариант + ФИО; готовая clause | Нет |
| RF005 | `service.name` / SIMPLE_FIELD | оба | 1 | P49 | пользовательская строка | Да |
| RF006 | `price.tax_clause` / COMPUTED_FIELD | оба | 1 | P56 | total цифрами/прописью + НДФЛ/НДС | Нет |
| RF007 | `payment.model` / CONDITIONAL_SECTION | оба | 3 | P57, P59, P62 | оставить ровно один блок оплаты | Нет |
| RF008 | `payment.bank_guarantee_clause` / CONDITIONAL_SECTION | оба | 2 | P58, P60 | include/exclude внутри применимого блока | Нет |
| RF009 | `physical.ndfl_clause` / COMPUTED_FIELD | ФЛ | 1 | P76 | rate + amount | Нет |
| RF010 | `ip.invoice_clause` / CONDITIONAL_SECTION | ИП | 1 | P77 | VAT status -> текст | Нет |
| RF011 | `npd.receipt_clause` / CONDITIONAL_SECTION | ни один | 1 | P78 | всегда удалить | Нет |
| RF012 | `npd.loss_status_clause` / CONDITIONAL_SECTION | ни один | 1 | P104 | всегда удалить | Нет |
| RF013 | `ip.additional_warranties` / CONDITIONAL_SECTION | ИП | 1 | P127 | включить опубликованный блок | Нет |
| RF014 | `ip.vat_penalty` / CONDITIONAL_SECTION | ИП VAT | 1 | P137 | include/delete | Нет |
| RF015 | `dispute.forum` / COMPUTED_FIELD | оба | 1 | P170 | общий суд / арбитраж | Частично, но нужен variant derivation |
| RF016 | `ip.long_term_resources` / CONDITIONAL_SECTION | ИП >1 года | 1 | P207 | include/delete по сроку и ответу | Нет |
| RF017 | `act.party_status_clause` / COMPUTED_FIELD | оба | 1 | P296 | вариантная преамбула акта | Нет |
| RF018 | `act.price_tax_clause` / COMPUTED_FIELD | оба | 1 | P299 | сумма + налоговая clause | Нет |
| RF019 | `act.ndfl_clause` / COMPUTED_FIELD | ФЛ | 1 | P300 | rate + amount | Нет |
| RF020 | `schedule.place_column` / CONDITIONAL_SECTION | оба | 2 | T1R0C6P0; T6R0C6P0 | добавить/удалить целую колонку | Нет |
| RF021 | `schedule.months` / REPEATING_TABLE | оба | 36 | T1: R1/R3/R5/R7/R9/R11 × C0–C3; T6: R1/R3/R5 × C0–C3 | не 36 независимых ответов: график из массива | Нет |
| RF022 | `extra_option.enabled` / CONDITIONAL_SECTION | оба | 4 | T1R14C0/C1; T6R8C0/C1 | включить/удалить строки/merged cells | Нет |
| RF023 | `extra_option.limit` / MULTI_OCCURRENCE | оба | 8 | T1R14C2–C5P1; T6R8C2–C5P1 | одно число в повторяющихся merged cells | Замена возможна, но блок условный — нет |
| RF024 | `physical.passport_snils` / COMPUTED_FIELD | ФЛ | 1 | T2R1C1P5 | composite passport + SNILS | Нет |
| RF025 | `ip.ogrnip` / CONDITIONAL_FIELD | ИП | 1 | T2R1C1P7 | 15 digits | Частично |

Итого: **25 RF-полей, 74 occurrence rows**. Распределение: RF021 — 36, RF023 — 8, RF022 — 4, RF007 — 3, RF008/RF020 — по 2, остальные — по 1. Все строки матрицы имеют `mapping_status=MAPPED`, но это означает согласованность самой матрицы, а не доказанную привязку к locator текущего adapter в каждом из двух DOCX.

## 3. Зависимости и готовность

```text
classification facts
  -> ordered STOP/NEEDS_INPUT rules D001–D014
  -> SELECT D020 or D021
  -> pinned variant + applicable RF set
  -> common answers + variant answers
  -> computed values / formatted clauses
  -> occurrence coverage + structural validation
  -> READY (D030/D031) or fail closed
```

Основные зависимости:

- `contractor.status` выбирает вариант и тем самым применимость RF009/019/024 либо RF010/013/014/016/025.
- `tax.vat_status` выбирает `vat_rate + vat_amount` либо `no_vat_basis`, а также RF010/RF014.
- `payment.model` определяет проценты/сроки и применимость гарантии; для MIXED сумма процентов равна 100.
- `term.start/end` дают `term.more_than_one_year`, который включает возможность RF016.
- `extra_option.enabled` включает `extra_option.limit` и соответствующие строки двух графиков.
- `places.multiple_or_not_in_contract` определяет структуру обеих таблиц графика.
- `schedule.entries` определяет weekday, row total и общий total; это вычисления, а не свободный текст.

Значения по умолчанию из матрицы: `subject.type=UNKNOWN`, `customer.type=UNKNOWN`, критические booleans — `null`, `appendices.other=[]`. Defaults не превращают неизвестные critical values в готовые ответы. Неприменимые RF обязаны присутствовать в decision result со статусом `NOT_APPLICABLE`, но не должны порождать bindings/render operations.

## 4. Несоответствия, требующие решения перед импортом

- `FACT_SCHEMA` содержит цену, сроки и полноценные `schedule.entries`, но `RED_FIELD_SCHEMA` не даёт им самостоятельных RF и полного occurrence map.
- RF006/RF018 описывают налоговую clause, однако исходным данным нужна также общая сумма цифрами и прописью.
- RF024 объединяет два атомарных ответа в один render field; questionnaire должен хранить passport и SNILS раздельно, formatter — собирать clause.
- Матрица использует единые P/T номера. Для каждого варианта должны храниться собственные locator и occurrence coverage.
- Реальные DOCX содержат другие placeholders (`ФИО`, реквизиты, сроки, результаты, контакты и др.), не покрытые RF001–RF025. Их нельзя молча оставлять или автоматически заполнять без решения владельца шаблона.
