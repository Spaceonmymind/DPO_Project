export const OTHER = "__other__";
export type ChoiceAnswer = { selected: string[]; other_text: string };
export const isStructuredChoice = (field: any) => ["SINGLE_SELECT", "MULTI_SELECT"].includes(field.field_type) && !!field.config?.option_items?.length;
export const choiceAnswer = (value: unknown): ChoiceAnswer => value && typeof value === "object" && Array.isArray((value as ChoiceAnswer).selected)
  ? { selected: (value as ChoiceAnswer).selected, other_text: String((value as ChoiceAnswer).other_text || "") }
  : { selected: [], other_text: "" };
export const choiceText = (field: any, value: unknown) => {
  if (!isStructuredChoice(field)) return String(value ?? "");
  const answer = choiceAnswer(value);
  const labels = Object.fromEntries((field.config.option_items || []).map((item: any) => [item.key, item.label]));
  return answer.selected.map(key => key === OTHER ? answer.other_text.trim() : labels[key] || "").filter(Boolean).join(", ");
};
export const choiceComplete = (field: any, value: unknown) => {
  const answer = choiceAnswer(value);
  return answer.selected.length > 0 && (!answer.selected.includes(OTHER) || !field.config?.other_required || !!answer.other_text.trim());
};
