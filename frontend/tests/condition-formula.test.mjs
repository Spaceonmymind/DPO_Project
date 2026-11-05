import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const leaf = (key, value = true) => ({ operator: "EQUALS", field_key: key, value });
const variables = ["A", "B", "C", "D"].map(name => ({ name, condition: leaf(name) }));
const fields = variables.map(({ name }) => ({ id: name, field_key: name, label: name, field_type: "BOOLEAN", config: {} }));

test("formula parser accepts nested English and Russian operators and rejects malformed input", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { parseConditionFormula, formulaFromCondition } = await server.ssrLoadModule("/src/conditionFormula.ts");
    const { evaluateCondition } = await server.ssrLoadModule("/src/conditions.ts");
    const { conditionError, conditionStats } = await server.ssrLoadModule("/src/conditionTree.ts");
    const nested = parseConditionFormula("(A OR (B AND C)) AND D", variables);
    assert.deepEqual(nested, { operator: "AND", conditions: [{ operator: "OR", conditions: [leaf("A"), { operator: "AND", conditions: [leaf("B"), leaf("C")] }] }, leaf("D")] });
    assert.deepEqual(parseConditionFormula("(A ИЛИ (B И C)) И D", variables), nested);
    assert.equal(evaluateCondition(nested, { A: false, B: true, C: true, D: true }), true);
    assert.deepEqual(parseConditionFormula("NOT (A OR B)", variables), { operator: "NOT", condition: { operator: "OR", conditions: [leaf("A"), leaf("B")] } });
    assert.deepEqual(parseConditionFormula("НЕ (A ИЛИ B)", variables), parseConditionFormula("NOT (A OR B)", variables));
    assert.deepEqual(parseConditionFormula("(A AND B) OR C", variables), { operator: "OR", conditions: [{ operator: "AND", conditions: [leaf("A"), leaf("B")] }, leaf("C")] });
    assert.equal(conditionError(nested, fields), null);
    const roundTrip = formulaFromCondition(nested);
    assert.deepEqual(parseConditionFormula(roundTrip.formula, roundTrip.variables), nested);
    for (const formula of ["", "A AND", "(A OR B", "A OR B)", "A XOR B", "A B", "Z", "NOT ()", "A && B"]) {
      assert.throws(() => parseConditionFormula(formula, variables), undefined, formula);
    }
    let deep = "A";
    for (let index = 0; index < 8; index++) deep = `NOT (${deep})`;
    assert.throws(() => parseConditionFormula(deep, variables), /Глубина/);
    assert.ok(conditionStats(nested).depth <= 8);
  } finally { await server.close(); }
});

test("group actions insert siblings and move across levels only when logic is preserved", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { insertAdjacentCondition, liftCondition, nestCondition, canLiftCondition, canNestCondition, conditionError } = await server.ssrLoadModule("/src/conditionTree.ts");
    const { evaluateCondition } = await server.ssrLoadModule("/src/conditions.ts");
    const nested = { operator: "AND", conditions: [leaf("A"), { operator: "AND", conditions: [leaf("B"), leaf("C")] }] };
    const sibling = insertAdjacentCondition(nested, [1], leaf("D"), false);
    assert.deepEqual(sibling.conditions.map(node => node.operator), ["EQUALS", "AND", "EQUALS"]);
    assert.equal(canLiftCondition(sibling, [1, 1]), true);
    const lifted = liftCondition(sibling, [1, 1]);
    assert.deepEqual(lifted.conditions.map(node => node.field_key || node.operator), ["A", "B", "C", "D"]);
    assert.equal(canNestCondition(sibling, [2], -1), true);
    const nestedAgain = nestCondition(sibling, [2], -1);
    assert.deepEqual(nestedAgain.conditions[1].conditions.map(node => node.field_key), ["B", "C", "D"]);
    for (const answers of [{ A: true, B: true, C: true, D: true }, { A: true, B: false, C: true, D: true }]) {
      assert.equal(evaluateCondition(sibling, answers), evaluateCondition(lifted, answers));
      assert.equal(evaluateCondition(sibling, answers), evaluateCondition(nestedAgain, answers));
    }
    const mixed = { operator: "AND", conditions: [leaf("A"), { operator: "OR", conditions: [leaf("B"), leaf("C")] }, leaf("D")] };
    assert.equal(canLiftCondition(mixed, [1, 0]), false);
    assert.equal(canNestCondition(mixed, [2], -1), false);
    const negated = { operator: "NOT", condition: { operator: "OR", conditions: [leaf("A"), leaf("B")] } };
    const withSibling = insertAdjacentCondition(negated, [0], leaf("C"), false);
    assert.equal(withSibling.operator, "NOT");
    assert.deepEqual(withSibling.condition.conditions.map(node => node.field_key), ["A", "C", "B"]);
    assert.equal(conditionError(sibling, fields), null);
  } finally { await server.close(); }
});

test("formula mode preserves old rule, blocks invalid draft and applies valid AST", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/templates" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const { ConditionEditor } = await server.ssrLoadModule("/src/TemplateAdmin.tsx");
  const React = await import("react"); const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  let current = { operator: "AND", conditions: [leaf("A"), { operator: "OR", conditions: [leaf("B"), leaf("C")] }] };
  const changed = next => { current = next; root.render(React.createElement(ConditionEditor, { title: "Тест", value: current, fields, change: changed })); };
  const click = async name => { const button = [...dom.window.document.querySelectorAll("button")].find(item => item.textContent === name); assert.ok(button, name); await act(async () => button.click()); };
  const type = async text => { const input = dom.window.document.querySelector(".condition-formula-input textarea"); await act(async () => { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set; setter.call(input, text); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(ConditionEditor, { title: "Тест", value: current, fields, change: changed })));
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelectorAll(".named-condition-list .named-condition").length, 3);
    assert.match(dom.window.document.querySelector(".condition-formula-input textarea").value, /A AND/);
    await type("A AND Z");
    assert.match(dom.window.document.querySelector(".condition-error").textContent, /не определено/);
    assert.equal(dom.window.document.querySelector(".condition-apply-formula").disabled, true);
    assert.deepEqual(current, { operator: "AND", conditions: [leaf("A"), { operator: "OR", conditions: [leaf("B"), leaf("C")] }] });
    await click("Визуальный конструктор");
    assert.ok(!dom.window.document.querySelector(".condition-formula-mode"), "invalid expression does not block switching");
    assert.deepEqual(current, { operator: "AND", conditions: [leaf("A"), { operator: "OR", conditions: [leaf("B"), leaf("C")] }] });
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelector(".condition-formula-input textarea").value, "A AND Z", "unfinished formula survives the round trip");
    await type("NOT (A OR B)");
    await click("Визуальный конструктор");
    assert.deepEqual(current, { operator: "AND", conditions: [leaf("A"), { operator: "OR", conditions: [leaf("B"), leaf("C")] }] }, "valid but unapplied formula does not change AST");
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelector(".condition-formula-input textarea").value, "NOT (A OR B)");
    await click("Применить выражение");
    assert.deepEqual(current, { operator: "NOT", condition: { operator: "OR", conditions: [leaf("A"), leaf("B")] } });
    await type("(A AND B) OR C");
    await click("Применить выражение");
    assert.deepEqual(current, { operator: "OR", conditions: [{ operator: "AND", conditions: [leaf("A"), leaf("B")] }, leaf("C")] });
    await click("+ Добавить условие");
    assert.match([...dom.window.document.querySelectorAll(".named-condition")].at(-1).textContent, /Не используется/);
    await click("Визуальный конструктор");
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelectorAll(".named-condition").length, 4, "unused conditions remain while switching modes in the same edit session");
    await click("Удалить");
    assert.match(dom.window.document.querySelector(".condition-delete-warning").textContent, /используется в формуле/);
    await click("Отмена");
    await click("Визуальный конструктор");
    await act(async () => [...dom.window.document.querySelectorAll(".condition-editor > .condition-node > .condition-node-actions button")].find(button => button.textContent === "Добавить условие после").click());
    assert.equal(current.operator, "AND", "a condition can be added alongside a root group");
    assert.equal(current.conditions.length, 2);
    current = null;
    await act(async () => root.render(React.createElement(ConditionEditor, { key: "empty-session", title: "Тест", value: current, fields, change: changed })));
    await click("Логическое выражение");
    await click("+ Добавить условие");
    await click("Визуальный конструктор");
    assert.equal(current, null, "adding A with an empty formula leaves the main AST untouched");
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelectorAll(".named-condition").length, 1);
    assert.equal(dom.window.document.querySelector(".condition-formula-input textarea").value, "");
    await click("Визуальный конструктор");
    await click("Отменить черновик формулы");
    await click("Логическое выражение");
    assert.equal(dom.window.document.querySelectorAll(".named-condition").length, 0, "draft is removed only by an explicit action");
  } finally {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
