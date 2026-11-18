import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

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
  assert.match(documents,/Дублировать/);
  assert.match(documents,/Переименовать/);
  assert.doesNotMatch(documents,/версия шаблона/);
  assert.match(documents,/generated-documents/);
  assert.match(app,/route === "\/documents"/);
});

test('catalog has search, empty state and resumable questionnaire',()=>{
  assert.match(catalog,/Найти договор по названию или категории/);
  assert.match(catalog,/Пока нет доступных договоров/);
  assert.match(catalog,/URLSearchParams\(location\.search\)/);
  assert.match(catalog,/Раздел \$\{stepIndex \+ 1\}/);
  assert.match(catalog,/Проверка ответов/);
});

test('builder exposes staged wide structural workspace',()=>{
  for(const label of ['Общие сведения','Исходный документ','Вопросы анкеты','Привязки к Word','Условия и таблицы','Проверка и публикация']) assert.match(builder,new RegExp(label));
  assert.match(builder,/document-outline/);
  assert.match(builder,/data-locator/);
  assert.match(builder,/workspace-context-inspector/);
  assert.match(builder,/workspace-question-list/);
  assert.match(readFileSync(new URL('../src/template-workspace.css',import.meta.url),'utf8'),/grid-template-columns:var\(--questions-pane-width,240px\) 12px minmax\(0,1fr\) 12px var\(--settings-pane-width,340px\)/);
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

test('Word outline searches and opens a distant fragment in a large document', { skip: !existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') }, async()=>{
  const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'silent'});
  await server.listen();
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1450,height:900}});
    await page.goto(`${server.resolvedUrls.local[0]}tests/fixtures/template-workspace.html?large=1`);
    await page.getByRole('button',{name:/Тестовый договор/}).first().click();
    await page.getByRole('button',{name:/Версия 1/}).first().click();
    await page.locator('.workspace-word-outline summary').click();
    const outline=page.getByRole('navigation',{name:'Структура документа'});
    assert.ok(Number(await outline.locator('button').first().getAttribute('aria-setsize'))>=3500);
    await page.getByRole('textbox',{name:'Найти фрагмент'}).fill('Фрагмент договора 2750');
    const result=outline.getByRole('button',{name:/Фрагмент договора 2750/});
    assert.equal(await result.count(),1);
    assert.equal(await outline.evaluate(node=>getComputedStyle(node).overflowY),'auto');
    await result.click();
    await page.locator('.docx-page [data-locator="word/document.xml#/p[2750]"]').waitFor();
  } finally { await browser.close(); await server.close(); }
});

test('template route stays role gated and publication permission remains server controlled',()=>{
  assert.match(app,/dpo_specialist/);
  assert.match(app,/administrator/);
  assert.match(app,/Раздел недоступен/);
  assert.doesNotMatch(home,/Подобрать договор|У меня уже есть ТЗ|Новое обращение/);
});
