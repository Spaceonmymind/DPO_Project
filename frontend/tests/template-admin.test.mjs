import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const component=readFileSync(new URL('../src/TemplateAdmin.tsx',import.meta.url),'utf8');
const catalog=readFileSync(new URL('../src/ContractCatalog.tsx',import.meta.url),'utf8');
const conditions=readFileSync(new URL('../src/conditions.ts',import.meta.url),'utf8');
const calculations=readFileSync(new URL('../src/calculations.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const productAdmin=readFileSync(new URL('../src/ProductAdmin.tsx',import.meta.url),'utf8');
const productFlow=readFileSync(new URL('../src/ProductQuestionnaire.tsx',import.meta.url),'utf8');

test('template manager exposes catalog creation and version upload',()=>{
  assert.match(component,/Новый шаблон/);
  assert.match(component,/Загрузить DOCX/);
  assert.match(component,/document-templates/);
  assert.match(component,/accept="\.docx/);
});

test('preview selection persists a structural locator instead of coordinates',()=>{
  assert.match(component,/data-locator/);
  assert.match(component,/selected_text/);
  assert.match(component,/bindings/);
  assert.doesNotMatch(component,/getBoundingClientRect|pageX|pageY/);
});

test('template page is role-gated in the application shell',()=>{
  assert.match(app,/dpo_specialist/);
  assert.match(app,/administrator/);
  assert.match(app,/route\s*===\s*["']\/templates["']/);
});

test('questionnaire builder supports field actions and multiple bindings',()=>{
  assert.match(component,/fields/);
  assert.match(component,/Изменить вопрос/);
  assert.match(component,/Удалить привязку/);
  assert.match(component,/occurrence_index/);
  assert.match(component,/Проверить и опубликовать/);
});

test('employee questionnaire is schema driven and restores drafts',()=>{
  assert.match(catalog,/schema\.fields/);
  assert.match(catalog,/contract-drafts/);
  assert.match(catalog,/Продолжить заполнение/);
  assert.match(catalog,/Сформировать DOCX/);
  assert.match(catalog,/Обязательное поле/);
});

test('condition editor is visual, localized and supports boolean groups',()=>{
  assert.match(component,/Показывать вопрос, когда/);
  assert.match(component,/Делать обязательным, когда/);
  assert.match(component,/Все условия \(И\)/);
  assert.match(component,/Любое условие \(ИЛИ\)/);
  assert.match(component,/Отрицание \(НЕ\)/);
  assert.doesNotMatch(component,/JSON\.stringify\(field\.visible_when/);
});

test('employee questionnaire reacts to conditions without dropping answers',()=>{
  assert.match(catalog,/fieldState\(f,\s*answers\)\.visible/);
  assert.match(catalog,/setAnswers\(\{\s*\.\.\.answers/);
  assert.match(conditions,/EQUALS/);
  assert.match(conditions,/GREATER_OR_EQUAL/);
  assert.match(conditions,/op==='NOT'/);
});

test('calculation editor is visual and employee totals recalculate dynamically',()=>{
  assert.match(component,/FormulaEditor/);
  assert.match(component,/Вычисляемое поле/);
  assert.match(component,/Сумма по строкам/);
  assert.match(component,/Сумма прописью/);
  assert.doesNotMatch(component,/введите JSON/i);
  assert.match(catalog,/calculateAnswers/);
  assert.match(catalog,/Рассчитывается автоматически/);
  assert.match(component,/Проверить на своих значениях/);
  assert.match(component,/Формат вывода/);
  assert.match(component,/bindings\/\$\{binding\.id\}\/format/);
  assert.match(calculations,/Расчёт недоступен/);
});

test('conditional DOCX areas use visual structural selection and the shared condition editor',()=>{
  assert.match(component,/conditional-regions/);
  assert.match(component,/CONDITIONAL_RUN/);
  assert.match(component,/CONDITIONAL_PARAGRAPH_GROUP/);
  assert.match(component,/CONDITIONAL_TABLE_ROW/);
  assert.match(component,/CONDITIONAL_TABLE/);
  assert.match(component,/Начало блока/);
  assert.match(component,/Конец блока/);
  assert.match(component,/Включать область, когда/);
  assert.doesNotMatch(component,/OOXML-путь|JSON вручную/);
});

test('specialist can configure a repeating DOCX row without technical locators',()=>{
  assert.match(component,/Сделать строку повторяемой/);
  assert.match(component,/repeating-groups/);
  assert.match(component,/Повторяемые строки/);
  assert.match(component,/Связать с полем строки/);
  assert.match(component,/Показывать группу, когда/);
  assert.doesNotMatch(component,/OOXML path|XPath/);
});

test('employee repeating group supports stable records, ordering and autosave',()=>{
  assert.match(catalog,/randomUUID/);
  assert.match(catalog,/Добавить запись/);
  assert.match(catalog,/Удалить запись/);
  assert.match(catalog,/Переместить запись выше/);
  assert.match(catalog,/\/autosave/);
  assert.match(catalog,/evaluateCondition/);
  assert.match(catalog,/schedule|repeating_groups/);
});

test('contract products expose visual rules, mappings and scenario preview',()=>{
  assert.match(productAdmin,/Договорные продукты/);
  assert.match(productAdmin,/Когда выбирать этот вариант/);
  assert.match(productAdmin,/Сопоставление общих данных/);
  assert.match(productAdmin,/Проверить сценарий/);
  assert.match(productAdmin,/manual_review_rules/);
  assert.doesNotMatch(productAdmin,/eval\s*\(/);
  assert.doesNotMatch(productAdmin,/Тестовые ответы JSON|введите JSON/i);
});

test('employee uses one product questionnaire without choosing a technical DOCX',()=>{
  assert.match(catalog,/contract-product-catalog/);
  assert.match(productFlow,/Система сама выберет утверждённый вариант DOCX/);
  assert.match(productFlow,/contract-product-drafts/);
  assert.match(productFlow,/MANUAL_REVIEW_REQUIRED/);
  assert.doesNotMatch(productFlow,/template_version_id.*select/);
});

test('R3.6.2 mechanisms are configured without JSON',()=>{
  assert.match(component,/Повторяемый список/);
  assert.match(component,/Составное значение/);
  assert.match(component,/TextExpressionEditor/);
  assert.match(component,/CONDITIONAL_TABLE_COLUMN/);
  assert.match(catalog,/field\.field_type==="LIST"/);
  assert.match(catalog,/field\.field_type==="COMPOSITE"/);
});

test('R3.6.3 structural candidates require explicit specialist review',()=>{
  assert.match(component,/binding-candidates/);
  assert.match(component,/Кандидаты разметки/);
  assert.match(component,/Подтвердить/);
  assert.match(component,/Отклонить/);
  assert.match(component,/Подтверждение не создаёт привязку само по себе/);
});
