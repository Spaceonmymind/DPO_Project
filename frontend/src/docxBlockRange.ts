export type BlockRange = { locators: Set<string>; start: string; end?: string; error?: string };

const topParagraph = (locator: string) => {
  const match = locator.match(/^(.*)#\/p\[(\d+)\]$/);
  return match ? { part: match[1], number: Number(match[2]) } : null;
};

/** Mirrors the DOCX region API: one range of top-level paragraphs in one part. */
export function resolveBlockRange(start: string, end: string | undefined, available: Iterable<string>): BlockRange {
  const ordered = Array.from(available);
  const known = new Set(ordered);
  const first = topParagraph(start);
  if (!first || !known.has(start)) return { locators: new Set(), start, end, error: "Блок можно создать только из абзацев документа. Ячейку таблицы выберите отдельной областью." };
  if (!end) return { locators: new Set([start]), start };
  const last = topParagraph(end);
  if (!last || !known.has(end) || last.part !== first.part) return { locators: new Set([start]), start, end, error: "Начало и конец блока должны быть абзацами одной части документа." };
  if (last.number < first.number) return { locators: new Set([start]), start, end, error: "Конец блока должен находиться после начала." };
  if (ordered.indexOf(end) < ordered.indexOf(start)) return { locators: new Set([start]), start, end, error: "Порядок фрагментов Word не совпадает с границами блока." };
  const locators = new Set<string>();
  for (const locator of ordered.slice(ordered.indexOf(start), ordered.indexOf(end) + 1)) {
    const paragraph = topParagraph(locator);
    if (paragraph?.part === first.part && paragraph.number >= first.number && paragraph.number <= last.number) locators.add(locator);
  }
  return { locators, start, end };
}

export function regionBlockBounds(region: any): { start: string; end: string } | null {
  if (region?.region_type !== "CONDITIONAL_PARAGRAPH_GROUP") return null;
  if (region.locator?.nodes?.length) return { start: region.locator.nodes[0], end: region.locator.nodes[region.locator.nodes.length - 1] };
  if (region.start_locator && region.end_locator) return { start: region.start_locator, end: region.end_locator };
  return null;
}
