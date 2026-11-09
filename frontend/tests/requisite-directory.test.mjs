import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("administrator creates, edits and archives a requisite set in the rendered directory", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/requisites" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { RequisiteDirectory } = await server.ssrLoadModule("/src/RequisiteDirectory.tsx");
  const React = await import("react"); const { act } = React; const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  let item = null; const calls = [];
  const api = async (path, options = {}) => {
    calls.push([path, options.method || "GET"]);
    if (path === "/requisite-sets?include_archived=true") return item ? [item] : [];
    if (path === "/requisite-sets" && options.method === "POST") { item = { ...JSON.parse(options.body), id: "set-1", status: "ACTIVE", revision: 1 }; return item; }
    if (path === "/requisite-sets/set-1" && options.method === "PUT") { item = { ...item, ...JSON.parse(options.body), revision: 2 }; return item; }
    if (path === "/requisite-sets/set-1/archive" && options.method === "POST") { item = { ...item, status: "ARCHIVED", revision: 3 }; return item; }
    throw new Error(`Unexpected ${options.method || "GET"} ${path}`);
  };
  const setInput = async (input, value) => act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  const click = async (element) => act(async () => element.click());
  try {
    await act(async () => root.render(React.createElement(RequisiteDirectory, { api })));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Создать набор"));
    const form = dom.window.document.querySelector(".requisite-directory form");
    assert.ok(form);
    await setInput(form.querySelector('input'), "Тестовый набор");
    await click([...form.querySelectorAll("button")].find(button => button.textContent === "Добавить реквизит"));
    const inputs = form.querySelectorAll(".requisite-entry input");
    await setInput(inputs[0], "address"); await setInput(inputs[1], "Адрес"); await setInput(inputs[2], "Москва");
    await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(item.entries[0].value, "Москва");
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Просмотреть"));
    await setInput(dom.window.document.querySelectorAll(".requisite-entry input")[2], "Казань");
    await act(async () => dom.window.document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(calls.some(([path, method]) => path === "/requisite-sets/set-1" && method === "PUT"), true);
    assert.equal(item.entries[0].value, "Казань");
    dom.window.confirm = () => true;
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Просмотреть"));
    await click([...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "Архивировать"));
    assert.equal(item.status, "ARCHIVED");
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
