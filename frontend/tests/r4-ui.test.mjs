import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
const home=readFileSync(new URL('../src/ContractHome.tsx',import.meta.url),'utf8');
const documents=readFileSync(new URL('../src/MyDocuments.tsx',import.meta.url),'utf8');
const catalog=readFileSync(new URL('../src/ContractCatalog.tsx',import.meta.url),'utf8');
const builder=readFileSync(new URL('../src/TemplateAdmin.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../src/enhancements.css',import.meta.url),'utf8');

test('contract platform navigation replaces legacy entry points',()=>{
  const sidebar=app.slice(app.indexOf('function Sidebar'),app.indexOf('function Dashboard'));
  assert.match(sidebar,/Главная/);
  assert.match(sidebar,/Каталог договоров/);
  assert.match(sidebar,/Мои документы/);
  assert.match(sidebar,/Создать договор/);
  assert.doesNotMatch(sidebar,/Новое обращение|Мои обращения|Подготовить ТЗ|Единый диалог/);
});

test('home and document history use real contract APIs',()=>{
  assert.match(home,/contract-drafts/);
  assert.match(home,/contract-catalog/);
  assert.match(home,/Последние документы/);
  assert.match(documents,/template_version/);
  assert.match(documents,/generated-documents/);
  assert.match(app,/route === "\/documents"/);
});

test('catalog has search, empty state and resumable questionnaire',()=>{
  assert.match(catalog,/Найти договор по названию или категории/);
  assert.match(catalog,/Пока нет доступных договоров/);
  assert.match(catalog,/URLSearchParams\(location\.search\)/);
  assert.match(catalog,/Шаг 1 из 2 · Анкета/);
  assert.match(catalog,/Шаг 2 из 2 · Проверка/);
});

test('builder exposes staged wide structural workspace',()=>{
  for(const label of ['Общие сведения','Исходный документ','Вопросы анкеты','Привязки к Word','Условия и таблицы','Проверка и публикация']) assert.match(builder,new RegExp(label));
  assert.match(builder,/document-outline/);
  assert.match(builder,/data-locator/);
  assert.match(builder,/workspace-context-inspector/);
  assert.match(builder,/workspace-question-list/);
  assert.match(readFileSync(new URL('../src/template-workspace.css',import.meta.url),'utf8'),/grid-template-columns:minmax\(210px,240px\) minmax\(400px,1fr\) minmax\(300px,340px\)/);
  assert.match(styles,/preview-node:hover>.region-actions/);
});

test('selection stays in contextual inspector and can create a linked question',()=>{
  const workspace=readFileSync(new URL('../src/template-workspace.css',import.meta.url),'utf8');
  assert.match(builder,/createPortal\(children, target\)/);
  assert.match(builder,/setSelection\(\{ \.\.\.selectionDraft, field_id: saved\.id \}\)/);
  assert.match(builder,/Создать новый вопрос/);
  assert.match(workspace,/#workspace-context-inspector>\.selection-card-floating\{position:static/);
  assert.match(workspace,/\.document-outline,\.template-open \.questionnaire-builder\{position:sticky/);
});

test('Word outline keeps full searchable list in independently scrolling rows',()=>{
  const workspace=readFileSync(new URL('../src/template-workspace.css',import.meta.url),'utf8');
  assert.match(builder,/visibleStructureItems\.map/);
  assert.match(builder,/structureItems\.filter/);
  assert.match(builder,/CSS\.escape\(item\.locator\)/);
  assert.doesNotMatch(builder,/visibleStructureItems\.slice\(/);
  assert.match(workspace,/\.workspace-structure-list\{[^}]*grid-auto-rows:max-content/);
  assert.match(workspace,/\.workspace-structure-list button\{[^}]*flex-shrink:0/);
  assert.match(workspace,/\.document-outline nav\{[^}]*overflow-y:auto/);
  assert.match(workspace,/\.workspace-question-list button\{/);
});

test('template route stays role gated and publication permission remains server controlled',()=>{
  assert.match(app,/dpo_specialist/);
  assert.match(app,/administrator/);
  assert.match(app,/Раздел недоступен/);
  assert.doesNotMatch(home,/Подобрать договор|У меня уже есть ТЗ|Новое обращение/);
});
