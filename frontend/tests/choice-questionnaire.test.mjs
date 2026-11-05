import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("multiple choice, Other, conditions, draft and old select", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/contracts" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto, location: dom.window.location, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window) };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { ContractCatalog } = await server.ssrLoadModule("/src/ContractCatalog.tsx");
  const { ConditionEditor } = await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const { evaluateCondition } = await server.ssrLoadModule("/src/conditions.ts");
  const { validateStep } = await server.ssrLoadModule("/src/questionnaireSteps.ts");
  const { choiceText } = await server.ssrLoadModule("/src/choices.ts");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const field = { id: "f1", field_key: "services", label: "Услуги", field_type: "MULTI_SELECT", required: true, config: { group: "Услуги", option_items: [{ key: "catering", label: "Кейтеринг" }, { key: "entertainment", label: "Развлечения" }], allow_other: true, other_required: true } };
  const draft = { id: "d1", title: "Договор", template: { id: "t1", name: "Договор", category: "Тест" }, schema: { fields: [field], repeating_groups: [] }, answers: {} };
  const api = async (path, options = {}) => {
    if (path === "/contract-catalog") return [{ id: "t1", name: "Договор", category: "Тест", description: "" }];
    if (path === "/contract-drafts" && !options.method) return [];
    if (path === "/contract-product-catalog" || path === "/contract-product-drafts") return [];
    if (path === "/contract-drafts" && options.method === "POST") return draft;
    if (path === "/contract-drafts/d1/autosave") { Object.assign(draft.answers, JSON.parse(options.body).answers); return { id: "d1" }; }
    throw new Error(`Unexpected ${path}`);
  };
  const button = text => [...dom.window.document.querySelectorAll("button")].find(x => x.textContent.includes(text));
  const click = async x => { assert.ok(x); await act(async () => x.click()); };
  try {
    await act(async () => root.render(React.createElement(ContractCatalog, { api })));
    await click(button("Заполнить договор"));
    const boxes = [...dom.window.document.querySelectorAll("input[type=checkbox]")];
    assert.equal(boxes.length, 3);
    await click(boxes[0]); await click(boxes[1]); await click(boxes[2]);
    assert.equal(boxes[0].checked, true);
    assert.equal(boxes[1].checked, true);
    assert.equal(boxes[2].checked, true);
    assert.ok(dom.window.document.querySelector('input[aria-label="Укажите свой вариант"]'));
    const own = dom.window.document.querySelector('input[aria-label="Укажите свой вариант"]');
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(own, "Прокат санок"); own.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    const withOther = { selected: ["catering", "entertainment", "__other__"], other_text: "Прокат санок" };
    assert.equal(validateStep({ name: "Услуги", fields: [field], groups: [] }, { services: withOther }, [field]).services, undefined);
    assert.equal(choiceText(field, withOther), "Кейтеринг, Развлечения, Прокат санок");
    assert.ok(evaluateCondition({ operator: "CONTAINS_OPTION", field_key: "services", value: "catering" }, { services: withOther }));
    assert.ok(evaluateCondition({ operator: "NOT_CONTAINS_OPTION", field_key: "services", value: "missing" }, { services: withOther }));
    assert.equal(validateStep({ name: "Услуги", fields: [field], groups: [] }, { services: { selected: ["__other__"], other_text: "" } }, [field]).services, "Заполните вариант «Иное»");
    await click(boxes[2]);
    assert.equal(dom.window.document.querySelector('input[aria-label="Укажите свой вариант"]'), null);
    await click(button("Завершить заполнение"));
    assert.match(dom.window.document.querySelector(".answers-review")?.textContent || "", /Кейтеринг, Развлечения/);
    const stale = { selected: ["catering"], other_text: "Прокат санок" };
    assert.equal(choiceText(field, stale), "Кейтеринг");
    assert.equal(evaluateCondition({ operator: "OTHER_SELECTED", field_key: "services" }, { services: stale }), false);
    const old = { ...field, field_type: "SINGLE_SELECT", config: { options: ["Старый ответ"] } };
    assert.equal(validateStep({ name: "Услуги", fields: [old], groups: [] }, { services: "Старый ответ" }, [old]).services, undefined);
    let rule = null;
    const changed = next => { rule = next; root.render(React.createElement(ConditionEditor, { title: "Условие", value: rule, fields: [field], change: changed })); };
    await act(async () => root.render(React.createElement(ConditionEditor, { title: "Условие", value: rule, fields: [field], change: changed })));
    await click(dom.window.document.querySelector(".condition-add"));
    assert.equal(rule.operator, "CONTAINS_OPTION");
    assert.equal(rule.value, "catering");
    assert.match(dom.window.document.querySelector(".condition-row").textContent, /содержит выбранный вариант/);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
