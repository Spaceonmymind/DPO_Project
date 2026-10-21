import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const component=readFileSync(new URL('../src/TemplateAdmin.tsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');

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
  assert.match(app,/route==='\/templates'/);
});
