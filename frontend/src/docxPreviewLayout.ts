export type PreviewNode = {
  locator: string;
  kind: string;
  metadata?: { table?: number; row?: number; cell?: number; grid_span?: number; vertical_merge?: string | null };
};

export type PreviewCell<T extends PreviewNode> = { nodes: T[]; colSpan: number; rowSpan: number; continuation?: boolean };
export type PreviewBlock<T extends PreviewNode> =
  | { kind: "paragraph"; node: T }
  | { kind: "table"; rows: PreviewCell<T>[][] };

// The adapter emits paragraphs in document order, including paragraphs inside cells.
// Keep those original nodes intact so selection and structural locators remain stable.
export function layoutPreviewNodes<T extends PreviewNode>(nodes: T[]): PreviewBlock<T>[] {
  const blocks: PreviewBlock<T>[] = [];
  let tableKey = "";
  let table: Extract<PreviewBlock<T>, { kind: "table" }> | null = null;
  let rowNumber = -1;
  let cellNumber = -1;
  let cell: PreviewCell<T> | null = null;
  let gridColumn = 0;
  let activeMerges = new Map<number, PreviewCell<T>>();
  let nextMerges = new Map<number, PreviewCell<T>>();

  for (const node of nodes) {
    const meta = node.metadata || {};
    if (node.kind !== "table_cell" || !meta.table || !meta.row || !meta.cell) {
      blocks.push({ kind: "paragraph", node });
      table = null;
      tableKey = "";
      continue;
    }
    const key = `${node.locator.split("#/")[0]}:${meta.table}`;
    if (!table || tableKey !== key) {
      table = { kind: "table", rows: [] };
      blocks.push(table);
      tableKey = key;
      rowNumber = -1;
      activeMerges = new Map();
    }
    if (rowNumber !== meta.row) {
      if (rowNumber !== -1) activeMerges = nextMerges;
      nextMerges = new Map();
      table.rows.push([]);
      rowNumber = meta.row;
      cellNumber = -1;
      gridColumn = 0;
    }
    if (cellNumber !== meta.cell) {
      cellNumber = meta.cell;
      const colSpan = Math.max(1, Number(meta.grid_span) || 1);
      const merge = meta.vertical_merge;
      const previous = activeMerges.get(gridColumn);
      if (merge === "continue" && previous && previous.colSpan === colSpan) {
        previous.rowSpan += 1;
        nextMerges.set(gridColumn, previous);
        // Keep continuation locators in their original row without adding a visible column.
        cell = { nodes: [], colSpan, rowSpan: 1, continuation: true };
        table.rows[table.rows.length - 1].push(cell);
      } else {
        cell = { nodes: [], colSpan, rowSpan: 1 };
        table.rows[table.rows.length - 1].push(cell);
        if (merge === "restart") nextMerges.set(gridColumn, cell);
      }
      gridColumn += colSpan;
    }
    cell!.nodes.push(node);
  }
  return blocks;
}
