import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("question search ranks labels, tolerates typos and finds the last of 120 questions", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { searchQuestions } = await server.ssrLoadModule("/src/questionSearch.ts");
    const fields = ["Порядок: оплата", "Оплта", "Предоплата", "Оплата договора", "Оплата"].map((label, index) => ({ id: String(index), label, field_key: `key_${index}` }));
    assert.deepEqual(searchQuestions(fields, "ОПЛАТА").map(field => field.label), ["Оплата", "Порядок: оплата", "Оплата договора", "Предоплата", "Оплта"]);
    assert.deepEqual(searchQuestions(fields, "ПОРЯДОК").map(field => field.label), ["Порядок: оплата"]);
    assert.ok(searchQuestions(fields, "оплта").some(field => field.label === "Оплата"));
    assert.deepEqual(searchQuestions([{ id: "x", label: "Имя", field_key: "secret_term" }], "secret_term"), []);
    const many = Array.from({ length: 120 }, (_, index) => ({ id: String(index), label: `Вопрос номер ${index}` }));
    assert.equal(searchQuestions(many, "вопрос номер 119")[0].id, "119");
    assert.equal(searchQuestions(many, "").length, 12);
  } finally { await server.close(); }
});

test("combobox supports keyboard, mouse, empty state, escape and free text without auto-creation", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { QuestionCombobox } = await server.ssrLoadModule("/src/QuestionCombobox.tsx");
  const React = await import("react"); const { act } = React; const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const fields = [{ id: "a", label: "Порядок оплаты", field_type: "SINGLE_SELECT" }, { id: "b", label: "Срок договора", field_type: "DATE" }];
  let selected = "", created = "";
  const render = async list => act(async () => root.render(React.createElement(QuestionCombobox, { fields: list, selectedId: selected, onSelect: id => { selected = id; root.render(React.createElement(QuestionCombobox, { fields: list, selectedId: selected, onSelect: () => {}, onCreate: () => {} })); }, onCreate: label => { created = label; } })));
  const key = async (input, name) => act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));
  try {
    await render(fields);
    const input = dom.window.document.querySelector('[role="combobox"]');
    await act(async () => input.click());
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(dom.window.document.querySelectorAll('[role="listbox"] [role="option"]').length, 2);
    await key(input, "ArrowUp");
    assert.match(dom.window.document.querySelector('[role="option"][aria-selected="true"]').textContent, /Срок договора/);
    await key(input, "ArrowDown"); await key(input, "ArrowDown"); await key(input, "Enter");
    assert.equal(selected, "b");
    assert.equal(input.value, "Срок договора");
    await key(input, "Escape");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(created, "");
    await render([]);
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, ""); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await act(async () => input.click());
    assert.match(dom.window.document.querySelector(".question-combobox-empty").textContent, /Вопросов пока нет/);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [name, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
});

test("free text opens the existing question form and restores the Word selection before binding", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { TemplateAdmin } = await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const React = await import("react"); const { act } = React; const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: { getRandomValues: dom.window.crypto.getRandomValues.bind(dom.window.crypto) } });
  const version = { id: "version-1", template_id: "template-1", status: "DRAFT", version_number: 1, original_filename: "sample.docx" };
  const fields = Array.from({ length: 105 }, (_, index) => ({ id: `field-${index}`, field_key: `question_${index}`, label: `Вопрос номер ${index}`, field_type: index % 2 ? "TEXT" : "DATE", config: { group: "Основные сведения", options: [] } }));
  fields.push({ id: "payment", field_key: "payment_order", label: "Порядок оплаты", field_type: "SINGLE_SELECT", config: { group: "Оплата", options: ["После услуг"] } });
  const bindings = []; const writes = [];
  const api = async (path, options = {}) => {
    if (path === "/document-templates") return [{ id: "template-1", name: "Тестовый договор", category: "Договоры", version_count: 1 }];
    if (path.endsWith("/versions")) return [version];
    if (path.endsWith("/preview")) return { nodes: [{ locator: "word/document.xml#/p[1]", kind: "paragraph", text: "Оплата по договору" }] };
    if (path.endsWith("/questionnaire")) return { fields: [...fields] };
    if (path.endsWith("/bindings") && !options.method) return [...bindings];
    if (/\/(conditional-regions|repeating-groups|binding-candidates)$/.test(path)) return [];
    if (path.endsWith("/fields") && options.method === "POST") { const payload = JSON.parse(options.body); writes.push({ type: "field", payload }); const field = { ...payload, id: "new-field", config: { group: payload.group, options: payload.options || [] } }; fields.push(field); return field; }
    if (path.endsWith("/bindings") && options.method === "POST") { const payload = JSON.parse(options.body); writes.push({ type: "binding", payload }); const binding = { ...payload, id: "binding-1", locator: { node: payload.locator, text_start: payload.start, text_end: payload.end }, selected_text: payload.selected_text, occurrence_index: 1 }; bindings.push(binding); return binding; }
    throw new Error(`Unexpected API request: ${options.method || "GET"} ${path}`);
  };
  const click = async element => { assert.ok(element); await act(async () => element.click()); };
  const type = async (input, value) => act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  try {
    await act(async () => root.render(React.createElement(TemplateAdmin, { api })));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Тестовый договор")));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Версия 1")));
    const paragraph = dom.window.document.querySelector(".docx-page [data-locator]");
    const range = dom.window.document.createRange(); range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 6);
    dom.window.getSelection().removeAllRanges(); dom.window.getSelection().addRange(range);
    await act(async () => paragraph.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true })));
    const input = dom.window.document.querySelector('[role="combobox"]');
    await type(input, "ВОПРОС НОМЕР 104");
    assert.match(dom.window.document.querySelector('[role="listbox"] [role="option"]').textContent, /Вопрос номер 104/);
    await type(input, "оплта");
    assert.match(dom.window.document.querySelector('[role="listbox"]').textContent, /Порядок оплаты/);
    await click([...dom.window.document.querySelectorAll('[role="option"]')].find(option => option.textContent.includes("Порядок оплаты")));
    assert.equal(input.value, "Порядок оплаты");
    assert.equal(dom.window.document.querySelector(".selection-card .primary").disabled, false);
    const format = [...dom.window.document.querySelectorAll(".selection-card label")].find(label => label.textContent.includes("Формат в документе"))?.querySelector("select");
    await act(async () => { format.value = "MONEY"; format.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    await type(input, "Особый новый вопрос");
    assert.match(dom.window.document.querySelector(".question-combobox-empty").textContent, /Совпадений нет/);
    assert.equal(dom.window.document.querySelector(".selection-card .primary").disabled, true, "free text is not a field ID");
    await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(writes.length, 0, "closing the list does not create a question");
    await act(async () => input.focus());
    await click([...dom.window.document.querySelectorAll('[role="option"]')].find(option => option.textContent.includes("Создать новый вопрос")));
    const form = dom.window.document.querySelector(".field-editor");
    assert.ok(form);
    const labelInput = [...form.querySelectorAll("label")].find(label => label.textContent.includes("Вопрос"))?.querySelector("input");
    assert.equal(labelInput.value, "Особый новый вопрос");
    await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(writes[0].payload.label, "Особый новый вопрос");
    assert.match(dom.window.document.querySelector(".selection-card blockquote").textContent, /Оплата/);
    assert.equal(dom.window.document.querySelector('[role="combobox"]').value, "Особый новый вопрос");
    assert.equal([...dom.window.document.querySelectorAll(".selection-card label")].find(label => label.textContent.includes("Формат в документе"))?.querySelector("select").value, "MONEY");
    await click(dom.window.document.querySelector(".selection-card .primary"));
    assert.equal(writes.at(-1).payload.field_id, "new-field");
    assert.equal(writes.at(-1).payload.selected_text, "Оплата");
    await click(dom.window.document.querySelector(".docx-page mark[role='button']"));
    assert.match(dom.window.document.querySelector(".workspace-active-binding").textContent, /Особый новый вопрос/);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [name, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
  }
});
