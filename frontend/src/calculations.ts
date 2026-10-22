import { evaluateCondition, fieldState } from "./conditions";
const number = (value: any) =>
  value === undefined || value === null || value === ""
    ? 0
    : Number(String(value).replace(",", "."));
export function evaluateExpression(
  e: any,
  values: any,
  groups: any,
  row?: any,
): number {
  if (e?.source === "CONSTANT") return number(e.value);
  if (e?.source === "FIELD" || e?.source === "CALCULATED")
    return number(values[e.field_key]);
  if (e?.source === "ROW_FIELD" || e?.source === "ROW_CALCULATED")
    return number(row?.[e.field_key]);
  let op = e?.operation;
  if (["SUM", "COUNT", "MIN", "MAX"].includes(op)) {
    let rows = groups[e.group_key] || [];
    if (op === "COUNT") return rows.length;
    let xs = rows.map((x: any) => number(x[e.field_key]));
    if (op === "SUM") return xs.reduce((a: number, b: number) => a + b, 0);
    return xs.length ? (op === "MIN" ? Math.min(...xs) : Math.max(...xs)) : 0;
  }
  if (op === "IF")
    return evaluateExpression(
      evaluateCondition(e.condition, values) ? e.then : e.else,
      values,
      groups,
      row,
    );
  let a = (e.operands || []).map((x: any) =>
      evaluateExpression(x, values, groups, row),
    ),
    result = 0;
  if (op === "ADD") result = a.reduce((x: number, y: number) => x + y, 0);
  else if (op === "SUBTRACT") result = a[0] - a[1];
  else if (op === "MULTIPLY")
    result = a.reduce((x: number, y: number) => x * y, 1);
  else if (op === "DIVIDE") result = a[1] === 0 ? 0 : a[0] / a[1];
  else if (op === "ROUND") result = a[0];
  else if (op === "PERCENT_OF") result = (a[0] * a[1]) / 100;
  else if (op === "ADD_PERCENT") result = a[0] * (1 + a[1] / 100);
  else if (op === "EXTRACT_PERCENT") result = (a[0] * a[1]) / (100 + a[1]);
  else if (op === "REMOVE_PERCENT") result = (a[0] * 100) / (100 + a[1]);
  return Number.isFinite(result)
    ? Number(result.toFixed(e.precision ?? 12))
    : 0;
}
export function calculateAnswers(schema: any, answers: any) {
  let values = { ...answers },
    groups: any = {};
  for (let group of schema?.repeating_groups || []) {
    if (!evaluateCondition(group.config?.visible_when, answers)) {
      groups[group.group_key] = [];
      continue;
    }
    let rows = (answers[group.group_key] || []).map((x: any) => ({ ...x }));
    for (let row of rows) {
      let fields = group.fields.filter((f: any) => f.config?.calculated);
      for (let pass = 0; pass <= fields.length; pass++)
        for (let field of fields)
          row[field.field_key] = evaluateExpression(
            field.config.expression,
            values,
            groups,
            row,
          );
    }
    groups[group.group_key] = rows;
  }
  let fields = (schema?.fields || []).filter(
    (f: any) => f.config?.calculated && fieldState(f, answers).visible,
  );
  for (let pass = 0; pass <= fields.length; pass++)
    for (let field of fields)
      values[field.field_key] = evaluateExpression(
        field.config.expression,
        values,
        groups,
      );
  return { values, groups };
}
