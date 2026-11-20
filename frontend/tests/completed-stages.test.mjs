import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("step 6 shows the optional locking setting without completing a real draft", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { TemplateQuestionnairePreview } = await server.ssrLoadModule("/src/TemplateQuestionnairePreview.tsx");
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(React.createElement(TemplateQuestionnairePreview, { schema: { fields: [], repeating_groups: [], stages: [{ id: "s1", name: "Первый этап", position: 1, status: "ACTIVE" }] }, answers: {}, selectedStageIds: ["s1"], change() {}, changeStages() {}, changeStageLocking() {}, lockCompletedStages: true, busy: false, published: false }));
    assert.match(html, /Блокировать редактирование завершённых этапов/);
    assert.match(html, /боевые состояния этапов не создаются/);
    assert.match(html, /checked=""/);
  } finally { await server.close(); }
});

test("stage lock switch updates before save and restores its value after an error", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { TemplateQuestionnairePreview } = await server.ssrLoadModule("/src/TemplateQuestionnairePreview.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const schema = { fields: [], repeating_groups: [], stages: [{ id: "s1", name: "Этап", position: 1, status: "ACTIVE" }] };
  let resolveSave;
  const changeStageLocking = () => new Promise(resolve => { resolveSave = resolve; });
  const props = { schema, answers: {}, selectedStageIds: ["s1"], change() {}, changeStages() {}, changeStageLocking, lockCompletedStages: false, busy: false, published: false };
  const switchInput = () => dom.window.document.querySelector(".contract-stage-lock-setting input");
  try {
    await act(async () => root.render(React.createElement(TemplateQuestionnairePreview, props)));
    act(() => switchInput().click());
    assert.equal(switchInput().checked, true, "the check appears while the save request is pending");
    assert.equal(switchInput().disabled, true, "a second request cannot start");
    await act(async () => resolveSave(false));
    assert.equal(switchInput().checked, false);
    assert.match(dom.window.document.querySelector(".contract-stage-lock-setting").textContent, /Не удалось сохранить настройку/);
    act(() => switchInput().click());
    assert.equal(switchInput().checked, true);
    await act(async () => { root.render(React.createElement(TemplateQuestionnairePreview, { ...props, lockCompletedStages: true })); resolveSave(true); });
    assert.equal(switchInput().checked, true);
    assert.equal(switchInput().disabled, false);
  } finally {
    await act(async () => root.unmount());
    await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});

test("employee completes a stage, reviews locked answers, and continues", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/contracts" });
  dom.window.confirm = () => true;
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, crypto: dom.window.crypto, location: dom.window.location, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window) };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { ContractCatalog } = await server.ssrLoadModule("/src/ContractCatalog.tsx");
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const fields = [
    { id: "f1", field_key: "first", label: "Первый вопрос", field_type: "TEXT", required: true, position: 1, config: { stage_ids: ["s1"], group: "Первый" } },
    { id: "f2", field_key: "second", label: "Второй вопрос", field_type: "TEXT", required: true, position: 2, config: { stage_ids: ["s2"], group: "Второй" } },
  ];
  const stageProgress = completed => [{ id: "s1", name: "Первый этап", state: completed.includes("s1") ? "COMPLETED" : "IN_PROGRESS" }, { id: "s2", name: "Второй этап", state: completed.includes("s2") ? "COMPLETED" : completed.includes("s1") ? "IN_PROGRESS" : "NOT_STARTED" }];
  const draft = { id: "d1", title: "Тестовый договор", template: { id: "t1", name: "Договор", category: "Тест" }, schema: { fields, repeating_groups: [], stages: [{ id: "s1", name: "Первый этап", position: 1, status: "ACTIVE" }, { id: "s2", name: "Второй этап", position: 2, status: "ACTIVE" }] }, answers: {}, selected_stage_ids: ["s1", "s2"], completed_stage_ids: [], lock_completed_stages: true, stage_progress: stageProgress([]) };
  const calls = [];
  const api = async (path, options = {}) => {
    if (path === "/contract-catalog") return [{ id: "t1", name: "Договор", category: "Тест", description: "" }];
    if (path === "/contract-drafts" && !options.method) return [];
    if (path === "/contract-product-catalog" || path === "/contract-product-drafts") return [];
    if (path === "/contract-drafts" && options.method === "POST") return draft;
    if (path === "/contract-drafts/d1/autosave") return { id: "d1" };
    if (path.startsWith("/contract-drafts/d1/stages/") && path.endsWith("/complete")) {
      calls.push(path);
      const id = path.split("/")[4];
      draft.answers = { ...draft.answers, ...JSON.parse(options.body).answers };
      draft.completed_stage_ids = [...draft.completed_stage_ids, id];
      draft.stage_progress = stageProgress(draft.completed_stage_ids);
      return { answers: draft.answers, completed_stage_ids: draft.completed_stage_ids, stage_progress: draft.stage_progress };
    }
    throw new Error(`Unexpected ${path}`);
  };
  const button = label => [...dom.window.document.querySelectorAll("button")].find(item => item.textContent.includes(label));
  const click = async target => { assert.ok(target); await act(async () => target.click()); };
  const type = async (input, value) => { await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set; setter.call(input, value); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(ContractCatalog, { api })));
    await click(button("Заполнить договор"));
    assert.ok(dom.window.document.querySelector("#field-f1"));
    await type(dom.window.document.querySelector("#field-f1"), "Ответ 1");
    await click(button("Завершить этап и перейти далее"));
    assert.deepEqual(calls, ["/contract-drafts/d1/stages/s1/complete"]);
    assert.ok(dom.window.document.querySelector("#field-f2"));
    await click(button("Первый этап"));
    assert.equal(dom.window.document.querySelector("#field-f1").matches(":disabled"), true);
    assert.match(dom.window.document.body.textContent, /Этап завершён. Редактирование ответов заблокировано/);
    await click(button("Перейти далее"));
    assert.equal(dom.window.document.querySelector("#field-f2").disabled, false);
  } finally {
    await act(async () => root.unmount());
    await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
