export type SearchableQuestion = { id: string; label: string; field_type?: string; config?: { group?: string }; group?: string };

const normalized = (value: string) => value.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ");

function withinDistance(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let beforePrevious: number[] | null = null;
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      let cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (beforePrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) value = Math.min(value, beforePrevious[column - 2] + 1);
      current.push(value);
    }
    if (Math.min(...current) > limit) return false;
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length] <= limit;
}

function fuzzy(label: string, query: string): boolean {
  if (query.length < 3) return false;
  const limit = query.length <= 5 ? 1 : 2;
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const candidates = [label, label.slice(0, query.length), ...words, ...words.map(word => word.slice(0, query.length))];
  return candidates.some(candidate => withinDistance(candidate, query, limit));
}

export function searchQuestions<T extends SearchableQuestion>(fields: T[], rawQuery: string, limit = 12): T[] {
  const query = normalized(rawQuery);
  if (!query) return fields.slice(0, limit);
  return fields.map((field, index) => {
    const label = normalized(field.label);
    const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const rank = label === query ? 0 : words.some(word => word.startsWith(query)) ? 1 : label.includes(query) ? 2 : fuzzy(label, query) ? 3 : 4;
    return { field, index, rank };
  }).filter(item => item.rank < 4).sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, limit).map(item => item.field);
}

export function exactQuestionExists(fields: SearchableQuestion[], query: string): boolean {
  const target = normalized(query);
  return Boolean(target) && fields.some(field => normalized(field.label) === target);
}
