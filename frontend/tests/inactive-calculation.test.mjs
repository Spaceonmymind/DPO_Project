import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("hidden prepayment source is not reused by active calculation", async () => {
  const server = await createServer({ server: { middlewareMode: true }, logLevel: "silent" });
  try {
    const { calculateAnswers } = await server.ssrLoadModule("/src/calculations.ts");
    const condition = { operator: "EQUALS", field_key: "payment", value: "partial" };
    const fields = [
      { field_key: "payment", label: "Порядок оплаты", field_type: "SINGLE_SELECT", config: {} },
      { field_key: "advance", label: "Размер предоплаты", field_type: "DECIMAL", config: { visible_when: condition } },
      { field_key: "balance", label: "Размер остатка", field_type: "DECIMAL", config: { calculated: true, expression: { operation: "SUBTRACT", operands: [{ source: "CONSTANT", value: 100 }, { source: "FIELD", field_key: "advance" }] } } },
    ];
    const full = calculateAnswers({ fields }, { payment: "full", advance: 25 });
    assert.equal(full.values.advance, undefined);
    assert.equal(full.values.balance, undefined);
    assert.match(full.errors.balance, /Размер предоплаты/);
    fields[2].config.visible_when = condition;
    const aligned = calculateAnswers({ fields }, { payment: "full", advance: 25 });
    assert.deepEqual(aligned.errors, {});
    assert.equal(aligned.values.balance, undefined);
    const partial = calculateAnswers({ fields }, { payment: "partial", advance: 30 });
    assert.equal(partial.values.balance, 70);
  } finally {
    await server.close();
  }
});
