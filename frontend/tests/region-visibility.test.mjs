import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("DOCX region modes persist, restore nested rule before save, and can be removed", async () => {
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
  const version = { id: "version-1", template_id: "template-1", status: "DRAFT", version_number: 1, original_filename: "sample.docx" };
  const nested = { operator: "AND", conditions: [{ operator: "OR", conditions: [{ operator: "EQUALS", field_key: "A", value: true }, { operator: "EQUALS", field_key: "B", value: true }] }, { operator: "EQUALS", field_key: "C", value: true }] };
  const regions = [{ id: "region-1", region_key: "existing", region_type: "CONDITIONAL_PARAGRAPH", locator: { node: "word/document.xml#/p[1]" }, include_when: nested }];
  const writes = [];
  const api = async (path, options = {}) => {
    if (path === "/document-templates") return [{ id: "template-1", name: "Тестовый договор", category: "Договоры", version_count: 1 }];
    if (path.endsWith("/versions")) return [version];
    if (path.endsWith("/preview")) return { nodes: [{ locator: "word/document.xml#/p[1]", kind: "paragraph", text: "Технический фрагмент" }] };
    if (path.endsWith("/questionnaire")) return { fields: ["A", "B", "C"].map(key => ({ id: key, field_key: key, label: key, field_type: "BOOLEAN", config: {} })) };
    if (path.endsWith("/conditional-regions") && !options.method) return [...regions];
    if (/\/(bindings|repeating-groups|binding-candidates)$/.test(path)) return [];
    if (path.endsWith("/conditional-regions") && options.method === "POST") {
      const payload = JSON.parse(options.body); writes.push(payload);
      const region = { ...payload, id: "region-2", locator: { node: payload.start_locator } }; regions.push(region); return region;
    }
    if (path.endsWith("/conditional-regions/region-1") && options.method === "PATCH") {
      const payload = JSON.parse(options.body); writes.push(payload); Object.assign(regions[0], payload); return { ...regions[0] };
    }
    if (path.endsWith("/conditional-regions/region-1") && options.method === "DELETE") { regions.shift(); return null; }
    throw new Error(`Unexpected API request: ${options.method || "GET"} ${path}`);
  };
  const click = async button => { assert.ok(button, "button exists"); await act(async () => button.click()); };
  const select = async (element, value) => { assert.ok(element); await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); };
  const mode = () => dom.window.document.querySelector(".region-editor select[aria-label='Отображение в готовом документе']");
  const edit = async () => click(dom.window.document.querySelector(".region-list button[aria-label='Изменить условную область']"));
  try {
    await act(async () => root.render(React.createElement(TemplateAdmin, { api })));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Тестовый договор")));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent.includes("Версия 1")));
    await edit();
    assert.equal(mode().value, "CONDITIONAL");
    assert.equal(dom.window.document.querySelectorAll(".region-editor .condition-group").length, 2);
    await select(mode(), "NEVER");
    assert.equal(dom.window.document.querySelector(".region-editor .condition-editor"), null);
    await select(mode(), "CONDITIONAL");
    assert.equal(dom.window.document.querySelectorAll(".region-editor .condition-group").length, 2);
    await select(mode(), "NEVER");
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent.includes("Сохранить область")));
    assert.deepEqual(writes.at(-1).include_when, { operator: "NEVER", previous_condition: nested });
    assert.ok(dom.window.document.querySelector(".preview-node.hidden-area .region-hidden-badge"));
    await edit();
    assert.equal(mode().value, "NEVER", "saved mode survives reopening");
    await select(mode(), "CONDITIONAL");
    assert.equal(dom.window.document.querySelectorAll(".region-editor .condition-group").length, 2, "nested rule survives save and reopening");
    await select(mode(), "ALWAYS");
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent.includes("Сохранить область")));
    assert.deepEqual(writes.at(-1).include_when, { operator: "ALWAYS", previous_condition: nested });
    await edit();
    assert.equal(mode().value, "ALWAYS");
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent.includes("Вернуть обычное отображение")));
    assert.equal(regions.length, 0);
    assert.equal(dom.window.document.querySelector(".preview-node.hidden-area"), null);
    await click(dom.window.document.querySelector(".preview-node .region-actions button"));
    await select(mode(), "NEVER");
    const key = dom.window.document.querySelector(".region-editor input[required]");
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(key, "new_hidden"); key.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    await click([...dom.window.document.querySelectorAll(".region-editor button")].find(button => button.textContent.includes("Сохранить область")));
    assert.deepEqual(writes.at(-1).include_when, { operator: "NEVER" });
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
