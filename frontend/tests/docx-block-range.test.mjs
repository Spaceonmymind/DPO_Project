import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("block range follows paragraph and table-row order and rejects invalid boundaries", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { resolveBlockRange } = await server.ssrLoadModule("/src/docxBlockRange.ts");
    const part = "word/document.xml";
    const locators = new Set(Array.from({ length: 1000 }, (_, index) => `${part}#/p[${index + 1}]`));
    locators.add(`${part}#/tbl[1]/tr[1]/tc[1]/p[1]`);
    const range = resolveBlockRange(`${part}#/p[100]`, `${part}#/p[800]`, locators);
    assert.equal(range.locators.size, 701);
    assert.equal(range.locators.has(`${part}#/tbl[1]/tr[1]/tc[1]/p[1]`), false);
    assert.match(resolveBlockRange(`${part}#/p[8]`, `${part}#/p[3]`, locators).error, /после начала/);
    assert.deepEqual([...resolveBlockRange(`${part}#/p[8]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, locators).locators].slice(0,2),[`${part}#/p[8]`,`${part}#/p[9]`]);
    assert.match(resolveBlockRange(`${part}#/p[8]`, "word/header1.xml#/p[1]", locators).error, /одной части/);
    const sparse = [`${part}#/p[1]`, `${part}#/p[3]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[7]`];
    assert.deepEqual([...resolveBlockRange(`${part}#/p[1]`, `${part}#/p[7]`, sparse).locators], sparse, "table rows between boundaries are included");
    assert.match(resolveBlockRange(`${part}#/p[1]`, `${part}#/p[7]`, [...sparse].reverse()).error, /после начала/);
  } finally { await server.close(); }
});

test("DOCX builder previews, changes, saves, selects and cancels block highlighting", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { TemplateAdmin } = await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const part = "word/document.xml";
  const nodes = [1, 2, 3, 4].map(number => ({ locator: `${part}#/p[${number}]`, kind: "paragraph", text: `Абзац ${number}` }));
  nodes.splice(2, 0, { locator: `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, kind: "table_cell", text: "Ячейка" });
  const version = { id: "version-1", template_id: "template-1", status: "DRAFT", version_number: 1, original_filename: "sample.docx" };
  const regions = [];
  const writes = [];
  const api = async (path, options = {}) => {
    if (path === "/document-templates") return [{ id: "template-1", name: "Тестовый договор", category: "Договоры", version_count: 1 }];
    if (path.endsWith("/versions")) return [version];
    if (path.endsWith("/preview")) return { nodes };
    if (path.endsWith("/questionnaire")) return { fields: [] };
    if (path.endsWith("/conditional-regions") && !options.method) return [...regions];
    if (/\/(bindings|repeating-groups|binding-candidates)$/.test(path)) return [];
    if (path.endsWith("/conditional-regions") && options.method === "POST") {
      const payload = JSON.parse(options.body); writes.push(payload);
      const start = nodes.findIndex(node => node.locator === payload.start_locator);
      const end = nodes.findIndex(node => node.locator === payload.end_locator);
      const locators = nodes.slice(start,end+1).map(node => node.locator.replace(/\/tc\[\d+\]\/p\[\d+\]$/, ""));
      const region = { ...payload, id: "region-1", locator: { nodes: locators, part } }; regions.push(region); return region;
    }
    throw new Error(`Unexpected API request: ${options.method || "GET"} ${path}`);
  };
  const click = async button => { assert.ok(button); await act(async () => button.click()); };
  const preview = locator => dom.window.document.querySelector(`.preview-node:has([data-locator='${locator}'])`);
  const action = (locator, label) => [...preview(locator).querySelectorAll(".region-actions button")].find(button => button.textContent === label);
  const hover = async locator => { await act(async () => preview(locator).dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }))); };
  const current = () => [...dom.window.document.querySelectorAll(".preview-node.block-range-active [data-locator]")].map(node => node.dataset.locator);
  try {
    await act(async () => root.render(React.createElement(TemplateAdmin, { api })));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Тестовый договор")));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Версия 1")));
    await click(action(`${part}#/p[2]`, "Начало блока"));
    assert.deepEqual(current(), [`${part}#/p[2]`]);
    assert.match(preview(`${part}#/p[2]`).textContent, /Начало блока/);
    await hover(`${part}#/p[4]`);
    assert.deepEqual(current(), [`${part}#/p[2]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[3]`, `${part}#/p[4]`]);
    assert.equal(preview(`${part}#/tbl[1]/tr[1]/tc[1]/p[1]`).classList.contains("block-range-active"), true);
    await click(action(`${part}#/p[1]`, "Конец блока"));
    assert.match(dom.window.document.querySelector(".block-selection-error").textContent, /после начала/);
    assert.equal(dom.window.document.querySelector(".region-editor"), null);
    await click(action(`${part}#/p[4]`, "Конец блока"));
    assert.deepEqual(current(), [`${part}#/p[2]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[3]`, `${part}#/p[4]`]);
    assert.ok(dom.window.document.querySelector(".region-editor"));
    await click(action(`${part}#/p[1]`, "Начало блока"));
    assert.deepEqual(current(), [`${part}#/p[1]`]);
    await hover(`${part}#/p[3]`);
    assert.deepEqual(current(), [`${part}#/p[1]`, `${part}#/p[2]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[3]`]);
    await click(action(`${part}#/p[3]`, "Конец блока"));
    assert.deepEqual(current(), [`${part}#/p[1]`, `${part}#/p[2]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[3]`]);
    const mode = dom.window.document.querySelector(".region-editor select[aria-label='Отображение в готовом документе']");
    await act(async () => { mode.value = "NEVER"; mode.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    const key = dom.window.document.querySelector(".region-editor input[required]");
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(key, "block_one"); key.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent.includes("Сохранить область")));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].start_locator, `${part}#/p[1]`);
    assert.equal(writes[0].end_locator, `${part}#/p[3]`);
    assert.deepEqual(current(), []);
    assert.ok(preview(`${part}#/p[1]`).classList.contains("block-boundary-saved"));
    assert.ok(preview(`${part}#/p[3]`).classList.contains("block-boundary-saved"));
    await click(dom.window.document.querySelector(".region-list button[aria-label='Изменить условную область']"));
    assert.deepEqual(current(), [`${part}#/p[1]`, `${part}#/p[2]`, `${part}#/tbl[1]/tr[1]/tc[1]/p[1]`, `${part}#/p[3]`]);
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent === "Отмена"));
    assert.deepEqual(current(), []);
    await click(action(`${part}#/p[2]`, "Начало блока"));
    await click([...dom.window.document.querySelectorAll(".block-selection-status button")][0]);
    assert.deepEqual(current(), []);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
