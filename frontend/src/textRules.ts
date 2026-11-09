export const CHARACTER_SETS: Record<string, string> = {
  ANY: "Любые символы", DIGITS: "Только цифры", LETTERS: "Только буквы", ALNUM: "Буквы и цифры",
};

export function characterRuleError(value: string, rules: any): string | undefined {
  const kind = rules?.character_set || "ANY";
  if (kind === "ANY") return undefined;
  const valid = [...value].every(char => char === " " && rules.allow_spaces || char === "-" && rules.allow_hyphens || kind === "DIGITS" && char >= "0" && char <= "9" || kind === "LETTERS" && /\p{L}/u.test(char) || kind === "ALNUM" && (/\p{L}/u.test(char) || char >= "0" && char <= "9"));
  return valid ? undefined : `${CHARACTER_SETS[kind] || "Недопустимые символы"}${rules.allow_spaces ? " с пробелами" : ""}${rules.allow_hyphens ? " и дефисами" : ""}`;
}

export function textRuleHint(rules: any): string {
  const parts = [];
  if (rules?.min_length !== undefined) parts.push(`от ${rules.min_length} символов`);
  if (rules?.max_length !== undefined) parts.push(`до ${rules.max_length} символов`);
  if (rules?.character_set && rules.character_set !== "ANY") parts.push(`${CHARACTER_SETS[rules.character_set]?.toLowerCase() || "ограниченный набор символов"}${rules.allow_spaces ? ", пробелы" : ""}${rules.allow_hyphens ? ", дефисы" : ""}`);
  return parts.join(" · ");
}
