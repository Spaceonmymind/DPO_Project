export function questionHelp(field: any): { help: string; placeholder?: string } {
  const config = field?.config || {};
  const description = String(config.description || "").trim();
  const legacy = String(config.placeholder || "").trim();
  const mode = config.placeholder_mode || "AUTO";
  const looksLikeExample = /^(?:например\b|пример\b|дд[.\/-]мм[.\/-]гггг|\d{2}[.\/-]\d{2}[.\/-]\d{4}|введите\s+(?:инн|кпп|огрн|снилс|дату|номер|сумму)\b)/i.test(legacy);
  const asExample = mode === "EXAMPLE" || (mode === "AUTO" && looksLikeExample);
  return {
    help: [...new Set([description, asExample ? "" : legacy].filter(Boolean))].join(" "),
    placeholder: asExample ? legacy : undefined,
  };
}
