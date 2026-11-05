import type { Condition } from "./conditions";

export const MAX_CONDITION_DEPTH = 8;
export const MAX_CONDITION_NODES = 100;

export function conditionStats(node: Condition | null | undefined, depth = 1): { count: number; depth: number } {
  if (!node) return { count: 0, depth: 0 };
  if (node.operator === "NOT") {
    const child = conditionStats(node.condition, depth + 1);
    return { count: child.count + 1, depth: Math.max(depth, child.depth) };
  }
  if (node.operator === "AND" || node.operator === "OR") {
    const children = (node.conditions || []).map(child => conditionStats(child, depth + 1));
    return { count: 1 + children.reduce((sum, child) => sum + child.count, 0), depth: Math.max(depth, ...children.map(child => child.depth)) };
  }
  return { count: 1, depth };
}

export function conditionError(node: Condition | null | undefined, fields: any[], ownKey?: string): string | null {
  if (!node) return null;
  const stats = conditionStats(node);
  if (stats.depth > MAX_CONDITION_DEPTH) return `Глубина условия не должна превышать ${MAX_CONDITION_DEPTH} уровней.`;
  if (stats.count > MAX_CONDITION_NODES) return `Условие не должно содержать больше ${MAX_CONDITION_NODES} элементов.`;
  function check(item: Condition): string | null {
    if (item.operator === "ALWAYS" || item.operator === "NEVER") return item.previous_condition ? conditionError(item.previous_condition, fields, ownKey) : null;
    if (item.operator === "NOT") return item.condition ? check(item.condition) : "У отрицания должно быть условие или группа.";
    if (item.operator === "AND" || item.operator === "OR") {
      if (!item.conditions || item.conditions.length < 2) return "В группе должно быть минимум два условия.";
      for (const child of item.conditions) { const error = check(child); if (error) return error; }
      return null;
    }
    const field = fields.find(f => f.field_key === item.field_key);
    if (!field) return `Поле «${item.field_key || "без ключа"}» не найдено.`;
    if (item.field_key === ownKey) return "Вопрос не может зависеть от самого себя.";
    if (!["EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "IS_EMPTY", "IS_NOT_EMPTY", "GREATER_THAN", "LESS_THAN", "GREATER_OR_EQUAL", "LESS_OR_EQUAL", "CONTAINS_OPTION", "NOT_CONTAINS_OPTION", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(item.operator)) return `Оператор «${item.operator}» не поддерживается.`;
    if (["CONTAINS_OPTION", "NOT_CONTAINS_OPTION", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(item.operator)) {
      if (!["SINGLE_SELECT", "MULTI_SELECT"].includes(field.field_type) || !field.config?.option_items?.length) return "Выберите вопрос со стабильными вариантами.";
      if (["OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(item.operator)) return field.config?.allow_other ? null : "Вариант «Иное» не разрешён.";
      return field.config.option_items.some((option: any) => option.key === item.value) ? null : "Выберите существующий вариант.";
    }
    if (["GREATER_THAN", "LESS_THAN", "GREATER_OR_EQUAL", "LESS_OR_EQUAL"].includes(item.operator) && !["INTEGER", "DECIMAL", "MONEY", "DATE"].includes(field.field_type)) return `Оператор не подходит для поля «${field.label}».`;
    if (["IS_EMPTY", "IS_NOT_EMPTY"].includes(item.operator)) return null;
    const validValue = (value: unknown) => {
      if (field.field_type === "BOOLEAN") return typeof value === "boolean";
      if (field.field_type === "INTEGER") return typeof value === "number" && Number.isInteger(value);
      if (["DECIMAL", "MONEY"].includes(field.field_type)) return typeof value === "number" && Number.isFinite(value);
      if (field.field_type === "DATE") return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
      if (field.field_type === "SINGLE_SELECT") return typeof value === "string" && (field.config?.options || []).includes(value);
      return typeof value === "string";
    };
    if (["IN", "NOT_IN"].includes(item.operator)) return !Array.isArray(item.value) || !item.value.length || item.value.length > 100 || !item.value.every(validValue) ? "Укажите корректные значения списка (не больше 100)." : null;
    if (item.value === undefined || item.value === null || item.value === "" || (typeof item.value === "number" && !Number.isFinite(item.value))) return `Укажите значение для поля «${field.label}».`;
    if (!validValue(item.value)) return `Значение не подходит для поля «${field.label}».`;
    return null;
  }
  return check(node);
}

export function replaceCondition(root: Condition, path: number[], next: Condition): Condition {
  if (!path.length) return next;
  if (root.operator === "NOT" && root.condition) return { ...root, condition: replaceCondition(root.condition, path, next) };
  if (root.operator !== "AND" && root.operator !== "OR") return root;
  const [index, ...rest] = path;
  return { ...root, conditions: (root.conditions || []).map((child, position) => position === index ? replaceCondition(child, rest, next) : child) };
}

export function removeCondition(root: Condition, path: number[]): Condition | null {
  if (!path.length) return null;
  if (root.operator === "NOT" && root.condition) {
    const child = removeCondition(root.condition, path);
    return child ? { ...root, condition: child } : null;
  }
  if (root.operator !== "AND" && root.operator !== "OR") return root;
  const [index, ...rest] = path;
  const children = rest.length
    ? (root.conditions || []).map((child, position) => position === index ? removeCondition(child, rest) : child).filter((child): child is Condition => Boolean(child))
    : (root.conditions || []).filter((_, position) => position !== index);
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...root, conditions: children };
}

export function moveCondition(root: Condition, path: number[], direction: -1 | 1): Condition {
  if (!path.length) return root;
  if (root.operator === "NOT" && root.condition) return { ...root, condition: moveCondition(root.condition, path, direction) };
  if (root.operator !== "AND" && root.operator !== "OR") return root;
  const [index, ...rest] = path;
  if (rest.length) return { ...root, conditions: (root.conditions || []).map((child, position) => position === index ? moveCondition(child, rest, direction) : child) };
  const children = [...(root.conditions || [])];
  const other = index + direction;
  if (other < 0 || other >= children.length) return root;
  [children[index], children[other]] = [children[other], children[index]];
  return { ...root, conditions: children };
}
