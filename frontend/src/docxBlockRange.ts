export type BlockRange = { locators: Set<string>; start: string; end?: string; error?: string };

/** One selectable OOXML unit: a top-level paragraph or an entire table row. */
export function blockUnitLocator(locator: string): string | null {
  if (/^.*#\/p\[\d+\]$/.test(locator)) return locator;
  const row = locator.match(/^(.*)#\/tbl\[(\d+)\]\/tr\[(\d+)\](?:\/tc\[\d+\]\/p\[\d+\])?$/);
  return row ? `${row[1]}#/tbl[${row[2]}]/tr[${row[3]}]` : null;
}

export function resolveBlockRange(start: string, end: string | undefined, available: Iterable<string>): BlockRange {
  const ordered = Array.from(available);
  const units = [...new Set(ordered.map(blockUnitLocator).filter((value): value is string => !!value))];
  const first = blockUnitLocator(start);
  if (!first || !units.includes(first)) return { locators: new Set(), start, end, error: "Выберите абзац документа или ячейку строки таблицы." };
  if (!end) return { locators: new Set(ordered.filter(locator => blockUnitLocator(locator) === first)), start };
  const last = blockUnitLocator(end);
  if (!last || !units.includes(last) || first.split("#/")[0] !== last.split("#/")[0]) return { locators: new Set(), start, end, error: "Границы блока должны находиться в одной части документа." };
  const a = units.indexOf(first), b = units.indexOf(last);
  if (b < a) return { locators: new Set(), start, end, error: "Конец блока должен находиться после начала." };
  const selected = new Set(units.slice(a, b + 1));
  return { locators: new Set(ordered.filter(locator => selected.has(blockUnitLocator(locator) || ""))), start, end };
}

export function regionBlockBounds(region: any): { start: string; end: string } | null {
  if (region?.region_type !== "CONDITIONAL_PARAGRAPH_GROUP") return null;
  if (region.locator?.nodes?.length) return { start: region.locator.nodes[0], end: region.locator.nodes[region.locator.nodes.length - 1] };
  if (region.start_locator && region.end_locator) return { start: region.start_locator, end: region.end_locator };
  return null;
}
