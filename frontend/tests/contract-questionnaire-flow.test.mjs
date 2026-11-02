import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { readFileSync } from "node:fs";

test("sections block incomplete answers, preserve answers on back, and reveal hints", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/contracts" });
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("../src/enhancements.css", import.meta.url), "utf8") + readFileSync(new URL("../src/contract-questionnaire-steps.css", import.meta.url), "utf8");
  dom.window.document.head.append(style);
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto, location: dom.window.location, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window) };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { ContractCatalog } = await server.ssrLoadModule("/src/ContractCatalog.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const fields = [
    { id: "f1", field_key: "name", label: "Полное наименование стороны договора с указанием всех необходимых сведений", field_type: "TEXT", required: true, config: { group: "Стороны", description: "Укажите полное имя", validation: { min_length: 3 } } },
    { id: "f2", field_key: "payment", label: "Оплата", field_type: "SINGLE_SELECT", required: true, config: { group: "Оплата", options: ["После оказания", "Предоплата"] } },
    { id: "f3", field_key: "percent", label: "Процент", field_type: "INTEGER", required: true, config: { group: "Оплата", visible_when: { operator: "EQUALS", field_key: "payment", value: "Предоплата" }, validation: { min: 1, max: 100 } } },
  ];
  const draft = { id: "d1", title: "Тестовый договор", template: { id: "t1", name: "Договор", category: "Тест" }, schema: { fields, repeating_groups: [] }, answers: {} };
  const api = async (path, options = {}) => {
    if (path === "/contract-catalog") return [{ id: "t1", name: "Договор", category: "Тест", description: "" }];
    if (path === "/contract-drafts" && !options.method) return [];
    if (path === "/contract-product-catalog" || path === "/contract-product-drafts") return [];
    if (path === "/contract-drafts" && options.method === "POST") return draft;
    if (path === "/contract-drafts/d1/autosave") return { id: "d1" };
    throw new Error(`Unexpected ${path}`);
  };
  const button = (label) => [...dom.window.document.querySelectorAll("button")].find((item) => item.textContent.includes(label));
  const click = async (target) => { assert.ok(target); await act(async () => target.click()); };
  const type = async (input, value) => { await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(ContractCatalog, { api })));
    await click(button("Заполнить договор"));
    assert.match(dom.window.document.querySelector(".questionnaire-progress").textContent, /Стороны/);
    await click(button("Далее"));
    assert.match(dom.window.document.querySelector(".questionnaire-progress").textContent, /Стороны/);
    assert.match(dom.window.document.body.textContent, /Обязательное поле/);
    const hint = dom.window.document.querySelector(".question-hint-trigger");
    assert.ok(hint);
    const questionTitle = dom.window.document.querySelector("#field-f1").previousElementSibling;
    assert.match(questionTitle.textContent, /Полное наименование стороны договора/);
    assert.equal(questionTitle.querySelector(".question-hint")?.previousSibling?.nodeType, dom.window.Node.TEXT_NODE, "hint follows the question text directly");
    assert.equal(dom.window.getComputedStyle(questionTitle).display, "block", "long titles wrap as inline text, not spaced flex columns");
    assert.equal(dom.window.getComputedStyle(questionTitle.querySelector(".question-hint")).display, "inline-flex");
    assert.equal(dom.window.document.querySelector(".dynamic-form i"), null, "required badge is not rendered");
    await act(async () => hint.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })));
    assert.match(dom.window.document.querySelector("[role=tooltip]")?.textContent || "", /полное имя/);
    await act(async () => hint.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })));
    await act(async () => hint.focus());
    assert.match(dom.window.document.querySelector("[role=tooltip]")?.textContent || "", /полное имя/);
    await act(async () => hint.blur());
    await click(hint);
    assert.match(dom.window.document.querySelector("[role=tooltip]").textContent, /полное имя/);
    await act(async () => hint.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(dom.window.document.querySelector("[role=tooltip]"), null);
    await type(dom.window.document.querySelector("#field-f1"), "Иван");
    await click(button("Далее"));
    assert.match(dom.window.document.querySelector(".questionnaire-progress").textContent, /Оплата/);
    assert.equal(dom.window.document.querySelector("#field-f3"), null);
    await click(button("Назад"));
    assert.equal(dom.window.document.querySelector("#field-f1").value, "Иван");
    await click(button("Далее"));
    await click(button("Предоплата"));
    assert.ok(dom.window.document.querySelector("#field-f3"));
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});

test("document history duplicates a filled document and opens its independent draft", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/documents" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { MyDocuments } = await server.ssrLoadModule("/src/MyDocuments.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const requests = [], paths = [];
  const api = async (path, options = {}) => {
    requests.push([path, options.method]);
    if (path === "/contract-drafts" && !options.method) return [{ id: "original", title: "Первый договор", template_name: "Шаблон", created_at: "2026-11-01", updated_at: "2026-11-01", generated: "file1", status: "GENERATED" }];
    if (path === "/contract-product-drafts") return [];
    if (path === "/contract-drafts/original/duplicate" && options.method === "POST") return { id: "copy" };
    throw new Error(`Unexpected ${path}`);
  };
  try {
    await act(async () => root.render(React.createElement(MyDocuments, { api, go: (path) => paths.push(path) })));
    assert.equal(dom.window.document.body.textContent.includes("версия шаблона"), false);
    const duplicate = [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent.includes("Дублировать"));
    await act(async () => duplicate.click());
    assert.ok(dom.window.document.querySelector("[role=dialog]"));
    await act(async () => dom.window.document.querySelector(".document-dialog button.primary").click());
    assert.ok(requests.some(([path, method]) => path === "/contract-drafts/original/duplicate" && method === "POST"));
    assert.deepEqual(paths, ["/contracts?draft=copy"]);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});

test("section validation uses field types, conditions and repeating minimum", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { questionnaireSteps, validateStep } = await server.ssrLoadModule("/src/questionnaireSteps.ts");
    const fields = [
      { field_key: "mode", field_type: "SINGLE_SELECT", required: true, config: { group: "Оплата", options: ["После", "Аванс"] } },
      { field_key: "percent", field_type: "INTEGER", required: true, config: { group: "Оплата", visible_when: { operator: "EQUALS", field_key: "mode", value: "Аванс" }, validation: { min: 1, max: 100 } } },
      { field_key: "date", field_type: "DATE", required: true, config: { group: "Сроки" } },
    ];
    const groups = [{ group_key: "sessions", name: "График", min_items: 2, max_items: 4, required: true, config: { group: "Сроки" }, fields: [{ field_key: "place", label: "Место", field_type: "TEXT", required: true, config: {} }] }];
    const steps = questionnaireSteps(fields, groups);
    assert.deepEqual(steps.map((step) => step.name), ["Оплата", "Сроки"]);
    assert.deepEqual(validateStep(steps[0], { mode: "После" }, fields), {});
    assert.ok(validateStep(steps[0], { mode: "Аванс", percent: 101 }, fields).percent);
    assert.ok(validateStep(steps[1], { date: "2026-02-30", sessions: [{ _id: "1", place: "Зал" }] }, fields).date);
    assert.ok(validateStep(steps[1], { date: "2026-12-01", sessions: [{ _id: "1", place: "Зал" }] }, fields).sessions);
    assert.deepEqual(validateStep(steps[1], { date: "2026-12-01", sessions: [{ _id: "1", place: "Зал" }, { _id: "2", place: "Зал 2" }] }, fields), {});
  } finally { await server.close(); }
});
