import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("question prefill switches between fixed value, requisite snapshot source and fallback", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { DefaultValueEditor } = await server.ssrLoadModule("/src/DefaultValueEditor.tsx");
  const React = await import("react"); const { act } = React; const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  let field = { field_type: "TEXT", field_key: "address", default_value: null, default_source: null };
  const sets = [{ id: "set-1", name: "Организация", status: "ACTIVE", entries: [{ key: "address", label: "Юридический адрес", value: "Москва" }] }];
  const render = () => root.render(React.createElement(DefaultValueEditor, { field, optionText: "", requisiteSets: sets, change: value => { field = { ...field, default_value: value }; render(); }, changeSource: value => { field = { ...field, default_source: value }; render(); } }));
  const select = async (element, value) => act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  try {
    await act(async () => render());
    await select(dom.window.document.querySelector('[aria-label="Источник предзаполнения"]'), "REQUISITES");
    assert.deepEqual(field.default_source, { set_id: "set-1", field_key: "address", fallback: "NONE" });
    assert.match(dom.window.document.body.textContent, /Юридический адрес/);
    const fallback = [...dom.window.document.querySelectorAll("select")].find(element => element.parentElement.textContent.includes("Если значение недоступно"));
    await select(fallback, "FIXED");
    assert.equal(field.default_source.fallback, "FIXED");
    const input = dom.window.document.querySelector('.default-value-editor input[type="text"]');
    await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, "Резерв"); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    assert.equal(field.default_value, "Резерв");
    await select(dom.window.document.querySelector('[aria-label="Источник предзаполнения"]'), "NONE");
    assert.equal(field.default_source, null); assert.equal(field.default_value, null);
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
