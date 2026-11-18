import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { JSDOM } from "jsdom";

test("repeating groups share question order and remain stage-filtered", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { questionnaireSteps } = await server.ssrLoadModule("/src/questionnaireSteps.ts");
    const { selectedQuestionnaire } = await server.ssrLoadModule("/src/contractStages.ts");
    const fields = Array.from({ length: 151 }, (_, i) => ({ id: `f${i}`, position: i + 1, field_key: `f${i}`, label: i === 0 ? "Услуга" : `Вопрос ${i}`, config: { group: "Общие вопросы" } }));
    const groups = [
      { id: "g1", group_key: "services", name: "Услуга", position: 1, config: { group: "Общие вопросы", questionnaire_after_position: 1, questionnaire_after_field_id: "f0", stage_ids: ["a", "b"] }, fields: [{ id: "cell", field_key: "cell", label: "Услуга", config: { description: "Подсказка" } }] },
      { id: "g2", group_key: "legacy", name: "Старая группа", position: 2, config: {}, fields: [] },
    ];
    const schema = { stages: [{ id: "a" }, { id: "b" }, { id: "c" }], fields, repeating_groups: groups };
    const selected = selectedQuestionnaire(schema, ["a", "b"]);
    const step = questionnaireSteps(selected.fields, selected.groups)[0];
    assert.deepEqual(step.items.slice(0, 3).map(x => x.value.id), ["f0", "g1", "f1"]);
    assert.equal(step.items.at(-1).value.id, "g2");
    assert.equal(step.fields.length, 151);
    assert.equal(step.groups.length, 2);
    assert.equal(selectedQuestionnaire(schema, ["c"]).groups.length, 1);
    assert.equal(selectedQuestionnaire(schema, ["a"]).groups.length, 2);
    fields[0].position = 4;
    fields[3].position = 1;
    const reordered = questionnaireSteps(fields, groups)[0].items.map(item => item.value.id);
    assert.ok(reordered.indexOf("g1") === reordered.indexOf("f0") + 1);
  } finally { await server.close(); }
});

test("each repeated row keeps its own visible hint and accessible input", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { RepeatingGroupForm } = await server.ssrLoadModule("/src/ContractCatalog.tsx");
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const group = { id: "g", name: "Услуги", max_items: 3, fields: [{ id: "cell", field_key: "service", label: "Услуга", field_type: "TEXT", required: true, config: { description: "Укажите полное название услуги" } }] };
    const html = renderToStaticMarkup(React.createElement(RepeatingGroupForm, { group, items: [{ _id: "one", service: "A" }, { _id: "two", service: "B" }], calculatedItems: [], calculationErrors: {}, add() {}, remove() {}, move() {}, change() {} }));
    const dom = new JSDOM(html);
    const inputs = [...dom.window.document.querySelectorAll("input")];
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].id, inputs[1].id);
    for (const input of inputs) {
      assert.equal(input.getAttribute("placeholder"), null);
      assert.match(dom.window.document.getElementById(input.getAttribute("aria-describedby")).textContent, /Укажите полное название услуги/);
    }
  } finally { await server.close(); }
});
