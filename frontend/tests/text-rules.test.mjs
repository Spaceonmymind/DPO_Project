import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("text limits validate employee answers while preserving leading zeros", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { validateStep } = await server.ssrLoadModule("/src/questionnaireSteps.ts");
    const field = { id: "passport", field_key: "passport_series", label: "Серия паспорта", field_type: "TEXT", required: false, config: { validation: { min_length: 4, max_length: 4, character_set: "DIGITS" } } };
    const step = { name: "Паспорт", fields: [field], groups: [] };
    const check = value => validateStep(step, { passport_series: value }, [field]);
    assert.deepEqual(check("0012"), {});
    assert.deepEqual(check(""), {});
    assert.match(check("123").passport_series, /Минимум 4/);
    assert.match(check("12345").passport_series, /Максимум 4/);
    assert.match(check("12A4").passport_series, /Только цифры/);
    assert.deepEqual(validateStep(step, { passport_series: "12-4" }, [field]).passport_series.includes("Только цифры"), true);
    const legacy = { ...field, config: { validation: {} } };
    assert.deepEqual(validateStep({ ...step, fields: [legacy] }, { passport_series: "Любое значение" }, [legacy]), {});
  } finally { await server.close(); }
});
