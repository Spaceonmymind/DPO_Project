import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const panel=readFileSync(new URL('../src/SupplySpec.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');

test('supply panel exposes one approved DOCX action',()=>{
  assert.match(panel,/technical-specification\/download\?format=docx/);
  assert.doesNotMatch(panel,/format=(?:pdf|xlsx)/i);
  assert.match(panel,/SupplySpecificationPanel/);
});

test('case list cannot exceed its content container',()=>{
  assert.match(styles,/\.content,\.page\{min-width:0;width:100%\}/);
  assert.match(styles,/\.table\{width:100%;max-width:100%;overflow:visible\}/);
  assert.match(styles,/grid-template-columns:minmax\(0,1fr\) 150px 84px/);
  assert.match(styles,/text-overflow:ellipsis/);
});
