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
  for(const label of ['Общие сведения','Исходный документ','Поля и привязки','Анкета','Условия и повторяемые таблицы','Проверка и публикация']) assert.match(builder,new RegExp(label));
  assert.match(builder,/document-outline/);
  assert.match(builder,/data-locator/);
  assert.match(styles,/grid-template-columns:210px minmax\(520px,1fr\) 330px/);
  assert.match(styles,/preview-node:hover>.region-actions/);
});

test('template route stays role gated and publication permission remains server controlled',()=>{
  assert.match(app,/dpo_specialist/);
  assert.match(app,/administrator/);
  assert.match(app,/Раздел недоступен/);
  assert.doesNotMatch(home,/Подобрать договор|У меня уже есть ТЗ|Новое обращение/);
});
