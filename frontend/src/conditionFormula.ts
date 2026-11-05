import type { Condition } from "./conditions";
import { conditionStats, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES } from "./conditionTree";

export type NamedCondition = { name: string; condition: Condition };

const nameFor = (index: number): string => {
  let value = index + 1, name = "";
  while (value) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); }
  return name;
};

export function formulaFromCondition(root: Condition): { formula: string; variables: NamedCondition[] } {
  const variables: NamedCondition[] = [];
  const visit = (node: Condition): string => {
    if (node.operator === "AND" || node.operator === "OR") return `(${(node.conditions || []).map(visit).join(` ${node.operator} `)})`;
    if (node.operator === "NOT") return `NOT ${node.condition?.operator === "AND" || node.condition?.operator === "OR" ? visit(node.condition) : `(${visit(node.condition!)})`}`;
    const name = nameFor(variables.length);
    variables.push({ name, condition: structuredClone(node) });
    return name;
  };
  return { formula: visit(root), variables };
}

type Token = { kind: "name" | "AND" | "OR" | "NOT" | "(" | ")"; text: string };
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s+|[()]|[A-Za-z]+|[А-Яа-яЁё]+|./gu;
  for (const match of input.matchAll(pattern)) {
    const text = match[0];
    if (!text.trim()) continue;
    const upper = text.toLocaleUpperCase("ru");
    if (text === "(" || text === ")") tokens.push({ kind: text, text });
    else if (upper === "AND" || upper === "И") tokens.push({ kind: "AND", text });
    else if (upper === "OR" || upper === "ИЛИ") tokens.push({ kind: "OR", text });
    else if (upper === "NOT" || upper === "НЕ") tokens.push({ kind: "NOT", text });
    else if (/^[A-Z]+$/.test(upper) && /^[A-Za-z]+$/.test(text)) tokens.push({ kind: "name", text: upper });
    else throw new Error(`Недопустимый символ или оператор «${text}». Используйте A, B, И, ИЛИ, НЕ и скобки.`);
    if (tokens.length > MAX_CONDITION_NODES * 3) throw new Error("Формула слишком длинная.");
  }
  return tokens;
}

export function parseConditionFormula(input: string, variables: NamedCondition[]): Condition {
  const tokens = tokenize(input);
  if (!tokens.length) throw new Error("Введите логическое выражение.");
  const defined = new Map(variables.map(item => [item.name.toUpperCase(), item.condition]));
  if (defined.size !== variables.length) throw new Error("Имена условий должны быть уникальны.");
  let index = 0;
  const peek = () => tokens[index]?.kind;
  const take = () => tokens[index++];
  const atom = (depth: number): Condition => {
    if (depth > 32) throw new Error("Слишком много вложенных скобок.");
    if (peek() === "NOT") { take(); return { operator: "NOT", condition: atom(depth + 1) }; }
    if (peek() === "(") {
      take();
      if (peek() === ")") throw new Error("Пустая группа в скобках.");
      const node = orExpr(depth + 1);
      if (peek() !== ")") throw new Error("Проверьте закрывающую скобку.");
      take(); return node;
    }
    if (peek() === "name") {
      const name = take().text;
      const node = defined.get(name);
      if (!node) throw new Error(`Условие ${name} не определено.`);
      return structuredClone(node);
    }
    throw new Error(peek() === ")" ? "Лишняя закрывающая скобка." : "Ожидалось имя условия или открывающая скобка.");
  };
  const andExpr = (depth: number): Condition => {
    const children = [atom(depth)];
    while (peek() === "AND") { take(); children.push(atom(depth)); }
    return children.length === 1 ? children[0] : { operator: "AND", conditions: children };
  };
  const orExpr = (depth: number): Condition => {
    const children = [andExpr(depth)];
    while (peek() === "OR") { take(); children.push(andExpr(depth)); }
    return children.length === 1 ? children[0] : { operator: "OR", conditions: children };
  };
  const result = orExpr(1);
  if (index < tokens.length) throw new Error(peek() === ")" ? "Лишняя закрывающая скобка." : `Проверьте оператор перед «${tokens[index].text}».`);
  const stats = conditionStats(result);
  if (stats.depth > MAX_CONDITION_DEPTH) throw new Error(`Глубина условия превышает ${MAX_CONDITION_DEPTH}.`);
  if (stats.count > MAX_CONDITION_NODES) throw new Error(`Условие содержит больше ${MAX_CONDITION_NODES} элементов.`);
  return result;
}

export function usedFormulaNames(input: string): Set<string> {
  try { return new Set(tokenize(input).filter(token => token.kind === "name").map(token => token.text)); }
  catch { return new Set(); }
}
