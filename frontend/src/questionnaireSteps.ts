import { evaluateCondition, fieldState } from "./conditions";
import { OTHER, choiceAnswer, isStructuredChoice } from "./choices";

export type QuestionnaireStep = { name: string; fields: any[]; groups: any[] };

export function questionnaireSteps(fields: any[], groups: any[] = []): QuestionnaireStep[] {
  const steps = new Map<string, QuestionnaireStep>();
  const add = (name: string) => {
    if (!steps.has(name)) steps.set(name, { name, fields: [], groups: [] });
    return steps.get(name)!;
  };
  for (const field of fields) {
    if (field.config?.calculated) continue;
    add(field.config?.group?.trim() || "Общие вопросы").fields.push(field);
  }
  for (const group of groups) add(group.config?.group?.trim() || "Общие вопросы").groups.push(group);
  return [...steps.values()];
}

const empty = (value: any) => value === undefined || value === null || value === "";
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function fieldError(field: any, value: any, required: boolean): string | undefined {
  const rules = field.config?.validation || {};
  if (empty(value)) return required ? "Обязательное поле" : undefined;
  if (isStructuredChoice(field)) {
    const answer = choiceAnswer(value);
    const keys = answer.selected;
    const allowed = new Set((field.config.option_items || []).map((item: any) => item.key));
    if (field.config.allow_other) allowed.add(OTHER);
    if (!value || typeof value !== "object" || !Array.isArray(value.selected) || typeof value.other_text !== "string" || keys.some((key: string) => !allowed.has(key)) || new Set(keys).size !== keys.length || (field.field_type === "SINGLE_SELECT" && keys.length > 1)) return "Выберите значение из списка";
    if (required && !keys.length) return "Обязательное поле";
    if (keys.includes(OTHER) && field.config.other_required && !answer.other_text.trim()) return "Заполните вариант «Иное»";
    return undefined;
  }
  if (["TEXT", "MULTILINE_TEXT"].includes(field.field_type)) {
    if (typeof value !== "string") return "Ожидался текст";
    if (rules.min_length !== undefined && value.length < Number(rules.min_length)) return `Минимум ${rules.min_length} символов`;
    if (rules.max_length !== undefined && value.length > Number(rules.max_length)) return `Максимум ${rules.max_length} символов`;
    if (rules.regex) {
      try { if (!new RegExp(`^(?:${rules.regex})$`).test(value)) return "Значение не соответствует требуемому формату"; }
      catch { return "Некорректный формат значения"; }
    }
  }
  if (["INTEGER", "DECIMAL", "MONEY"].includes(field.field_type)) {
    const number = Number(String(value).replace(",", "."));
    if (!Number.isFinite(number) || (field.field_type === "INTEGER" && !Number.isInteger(number))) return "Некорректный формат значения";
    if (rules.min !== undefined && number < Number(rules.min)) return `Значение не меньше ${rules.min}`;
    if (rules.max !== undefined && number > Number(rules.max)) return `Значение не больше ${rules.max}`;
  }
  if (field.field_type === "DATE" && (typeof value !== "string" || !validDate(value))) return "Некорректная дата";
  if (field.field_type === "BOOLEAN" && typeof value !== "boolean") return "Выберите да или нет";
  if (field.field_type === "SINGLE_SELECT" && !field.config?.options?.includes(value)) return "Выберите значение из списка";
  if (field.field_type === "LIST") {
    const config = field.config?.item_config || {};
    if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) return "Ожидался список строк";
    if (value.length < (config.min_items ?? 0) || value.length > (config.max_items ?? 20)) return "Проверьте количество элементов";
    if (value.some((x) => !x.trim() || x.length > (config.max_length ?? 500))) return "Проверьте элементы списка";
    if (config.regex) {
      try { if (value.some((x) => !new RegExp(`^(?:${config.regex})$`).test(x))) return "Элемент списка не соответствует формату"; }
      catch { return "Некорректный формат значения"; }
    }
  }
  if (field.field_type === "COMPOSITE") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Ожидалось составное значение";
    for (const component of field.config?.components || []) {
      const result = fieldError({ ...component, field_type: component.type || "TEXT", config: { validation: component.validation, components: component.components } }, value[component.key], !!component.required);
      if (result) return `«${component.label}»: ${result.toLowerCase()}`;
    }
  }
  return undefined;
}

export function validateStep(step: QuestionnaireStep, answers: Record<string, any>, allFields: any[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of step.fields) {
    const state = fieldState(field, answers);
    if (!state.visible) continue;
    const error = fieldError(field, answers[field.field_key], state.required);
    if (error) errors[field.field_key] = error;
  }
  const activeAnswers = Object.fromEntries(allFields.filter((field) => fieldState(field, answers).visible).map((field) => [field.field_key, answers[field.field_key]]));
  for (const group of step.groups) {
    if (!evaluateCondition(group.config?.visible_when, activeAnswers)) continue;
    const items = answers[group.group_key] || [];
    if (!Array.isArray(items)) { errors[group.group_key] = "Ожидался список записей"; continue; }
    const minimum = Math.max(group.min_items || 0, group.required ? 1 : 0);
    if (items.length < minimum) { errors[group.group_key] = `Добавьте минимум ${minimum} записей`; continue; }
    if (items.length > group.max_items) { errors[group.group_key] = `Можно добавить не больше ${group.max_items} записей`; continue; }
    for (const [index, item] of items.entries()) {
      for (const field of group.fields || []) {
        if (field.config?.calculated) continue;
        const error = fieldError(field, item[field.field_key], field.required);
        if (error) { errors[group.group_key] = `Запись № ${index + 1}, «${field.label}»: ${error}`; break; }
      }
      if (errors[group.group_key]) break;
    }
  }
  return errors;
}
