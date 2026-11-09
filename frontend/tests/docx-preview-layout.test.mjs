import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { layoutPreviewNodes } = await server.ssrLoadModule("/src/docxPreviewLayout.ts");
test.after(() => server.close());

const paragraph = (part, text) => ({ locator: `${part}#/p[1]`, kind: "paragraph", text });
const cell = (table, row, column, para, text, extra = {}) => ({
  locator: `word/document.xml#/tbl[${table}]/tr[${row}]/tc[${column}]/p[${para}]`,
  kind: "table_cell", text,
  metadata: { table, row, cell: column, grid_span: 1, vertical_merge: null, ...extra },
});

test("ordinary table retains horizontal rows and document order", () => {
  const nodes = [paragraph("word/document.xml", "Before"), cell(1, 1, 1, 1, "A"), cell(1, 1, 2, 1, "B"), cell(1, 2, 1, 1, "C"), cell(1, 2, 2, 1, "D"), paragraph("word/document.xml", "After")];
  const blocks = layoutPreviewNodes(nodes);
  assert.deepEqual(blocks.map(block => block.kind), ["paragraph", "table", "paragraph"]);
  assert.deepEqual(blocks[1].rows.map(row => row.map(item => item.nodes[0].text)), [["A", "B"], ["C", "D"]]);
});

test("gridSpan and vMerge become colSpan and rowSpan", () => {
  const nodes = [cell(1, 1, 1, 1, "Combined", { grid_span: 2, vertical_merge: "restart" }), cell(1, 1, 2, 1, "Right"), cell(1, 2, 1, 1, "", { grid_span: 2, vertical_merge: "continue" }), cell(1, 2, 2, 1, "Below")];
  const table = layoutPreviewNodes(nodes)[0];
  assert.equal(table.rows[0][0].colSpan, 2);
  assert.equal(table.rows[0][0].rowSpan, 2);
  assert.equal(table.rows[1][0].continuation, true);
  assert.equal(table.rows[1][1].nodes[0].text, "Below");
});

test("multiple paragraphs and continuation nodes keep original locators", () => {
  const nodes = [cell(1, 1, 1, 1, "First", { vertical_merge: "restart" }), cell(1, 1, 1, 2, "Second", { vertical_merge: "restart" }), cell(1, 2, 1, 1, "", { vertical_merge: "continue" })];
  const table = layoutPreviewNodes(nodes)[0];
  assert.deepEqual(table.rows[0][0].nodes.map(node => node.locator), nodes.slice(0, 2).map(node => node.locator));
  assert.deepEqual(table.rows[1][0].nodes.map(node => node.locator), [nodes[2].locator]);
  assert.deepEqual(table.rows.flatMap(row => row.flatMap(item => item.nodes.map(node => node.locator))), nodes.map(node => node.locator));
});
