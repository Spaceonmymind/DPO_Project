import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("empty draft: add question, fill form, save, and select it", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto };
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const style = dom.window.document.createElement("style");
  style.textContent = readFileSync(new URL("../src/enhancements.css", import.meta.url), "utf8") + readFileSync(new URL("../src/template-workspace.css", import.meta.url), "utf8");
  dom.window.document.head.append(style);
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { TemplateAdmin } = await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: { getRandomValues: dom.window.crypto.getRandomValues.bind(dom.window.crypto) } });
  const version = { id: "version-1", template_id: "template-1", status: "DRAFT", version_number: 1, original_filename: "sample.docx" };
  const fields = [];
  const writes = [];
  const api = async (path, options = {}) => {
    if (path === "/document-templates") return [{ id: "template-1", name: "Тестовый договор", category: "Договоры", version_count: 1 }];
    if (path.endsWith("/versions")) return [version];
    if (path.endsWith("/preview")) return { nodes: [{ locator: "word/document.xml#/p[1]", kind: "paragraph", text: "Оплата по договору" }] };
    if (path.endsWith("/questionnaire")) return { fields: [...fields] };
    if (/\/(bindings|conditional-regions|repeating-groups|binding-candidates)$/.test(path)) return [];
    if ((path.endsWith("/fields") && options.method === "POST") || (path.endsWith("/fields/field-1") && options.method === "PATCH")) {
      const payload = JSON.parse(options.body);
      writes.push(payload);
      const created = { ...payload, id: "field-1", config: { group: payload.group, placeholder: payload.placeholder, options: payload.options || [] } };
      if (options.method === "PATCH") fields[0] = created;
      else fields.push(created);
      return created;
    }
    throw new Error(`Unexpected API request: ${options.method || "GET"} ${path}`);
  };
  const click = async (button) => { assert.ok(button, "button exists"); await act(async () => button.click()); };
  const buttonWithText = (text) => [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent.includes(text));
  try {
    await act(async () => root.render(React.createElement(TemplateAdmin, { api })));
    await click(buttonWithText("Тестовый договор"));
    await click(buttonWithText("Версия 1"));
    assert.equal(dom.window.document.querySelectorAll(".workspace-question-list button").length, 0);
    await click(dom.window.document.querySelector(".workspace-add"));
    let form = dom.window.document.querySelector(".questionnaire-builder .field-editor");
    assert.ok(form, "the form appears after clicking the left Add button");
    assert.notEqual(dom.window.getComputedStyle(form).display, "none", "the form is not hidden by CSS");
    assert.match(dom.window.document.querySelector(".workspace-inspector-header").textContent, /Новый вопрос/);
    const question = [...form.querySelectorAll("label")].find((label) => label.textContent.includes("Вопрос"))?.querySelector("input");
    assert.ok(question);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
      setter.call(question, "Порядок оплаты");
      question.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].label, "Порядок оплаты");
    assert.match(dom.window.document.querySelector(".workspace-question-list").textContent, /Порядок оплаты/);
    form = dom.window.document.querySelector(".questionnaire-builder .field-editor");
    assert.ok(form, "the saved question remains selected for editing");
    assert.match(dom.window.document.querySelector(".workspace-inspector-header").textContent, /Редактирование вопроса/);
    await click(form.querySelector("button.secondary"));
    assert.equal(dom.window.document.querySelector(".questionnaire-builder .field-editor"), null, "cancel closes the editor");
    await click(dom.window.document.querySelector(".workspace-inspector-empty button"));
    assert.ok(dom.window.document.querySelector(".questionnaire-builder .field-editor"), "the right Add button opens the same editor");
    await click(buttonWithText("Привязки к Word"));
    assert.notEqual(dom.window.getComputedStyle(dom.window.document.querySelector(".questionnaire-builder .field-editor")).display, "none", "form remains visible on the binding stage");
    await click(buttonWithText("Условия и таблицы"));
    assert.notEqual(dom.window.getComputedStyle(dom.window.document.querySelector(".questionnaire-builder .field-editor")).display, "none", "form remains visible on the conditions stage");
    await click(dom.window.document.querySelector(".field-editor button.secondary"));
    const paragraph = dom.window.document.querySelector(".docx-page [data-locator]");
    const range = dom.window.document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 6);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    await act(async () => paragraph.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true })));
    assert.match(dom.window.document.querySelector(".workspace-inspector-header").textContent, /Привязка фрагмента/);
    await click(dom.window.document.querySelector(".workspace-add"));
    assert.ok(dom.window.document.querySelector(".questionnaire-builder .field-editor"), "Add opens the form even with a selected Word fragment");
    assert.notEqual(dom.window.getComputedStyle(dom.window.document.querySelector(".questionnaire-builder .field-editor")).display, "none");
    await click(dom.window.document.querySelector(".field-editor button.secondary"));
    assert.match(dom.window.document.querySelector(".workspace-inspector-header").textContent, /Привязка фрагмента/, "cancel restores the selected fragment");
    await click(dom.window.document.querySelector(".workspace-question-list button"));
    const typeSelect = [...dom.window.document.querySelectorAll(".field-editor label")].find((label) => label.textContent.includes("Тип"))?.querySelector("select");
    assert.ok(typeSelect);
    await act(async () => { typeSelect.value = "SINGLE_SELECT"; typeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
    const optionsInput = [...dom.window.document.querySelectorAll(".field-editor label")].find((label) => label.textContent.includes("Варианты через запятую"))?.querySelector("input");
    assert.ok(optionsInput);
    const rawOptions = "100% постоплата, 50% предоплата, Оплата в течение 10 рабочих дней";
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
    for (const character of rawOptions) {
      await act(async () => { setter.call(optionsInput, optionsInput.value + character); optionsInput.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
      assert.ok(optionsInput.value.endsWith(character), "typing is not normalized mid-input");
    }
    assert.equal(optionsInput.value, rawOptions);
    await act(async () => dom.window.document.querySelector(".field-editor").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(writes.at(-1).options, ["100% постоплата", "50% предоплата", "Оплата в течение 10 рабочих дней"]);
    await click(dom.window.document.querySelector(".workspace-question-list button"));
    const reopenedOptions = [...dom.window.document.querySelectorAll(".field-editor label")].find((label) => label.textContent.includes("Варианты через запятую"))?.querySelector("input");
    assert.equal(reopenedOptions?.value, rawOptions, "saved options reopen with spaces intact");
    await act(async () => { setter.call(reopenedOptions, `${rawOptions}, , `); reopenedOptions.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    assert.equal(reopenedOptions.value, `${rawOptions}, , `, "empty trailing options remain editable until save");
    await act(async () => dom.window.document.querySelector(".field-editor").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(writes.at(-1).options, ["100% постоплата", "50% предоплата", "Оплата в течение 10 рабочих дней"]);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
