import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type WordStructureItem = { locator: string; kind: string; number: number; description: string };
const ROW_HEIGHT = 58;
const OVERSCAN = 8;

export const WordStructureList = memo(function WordStructureList({ items, onSelect }: { items: WordStructureItem[]; onSelect: (locator: string) => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 640 });

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    list.scrollTop = 0;
    setViewport({ top: 0, height: list.clientHeight || 640 });
  }, [items]);

  useEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewport(current => ({ ...current, height: list.clientHeight || 640 })));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const window = useMemo(() => {
    const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(items.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
    return { start, end };
  }, [items.length, viewport]);

  return <nav ref={ref} className="workspace-structure-list" aria-label="Структура документа" onScroll={event => {
    const list = event.currentTarget;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => { frame.current = null; setViewport(current => current.top === list.scrollTop ? current : { ...current, top: list.scrollTop }); });
  }}>
    <div className="workspace-structure-spacer" style={{ height: window.start * ROW_HEIGHT }} aria-hidden="true" />
    {items.slice(window.start, window.end).map((item, index) => <button key={item.locator} type="button" aria-posinset={window.start + index + 1} aria-setsize={items.length} onClick={() => onSelect(item.locator)} title={item.description}><span>{item.kind === "table_cell" ? "Ячейка" : "Абзац"} {item.number}</span><b>{item.description}</b></button>)}
    <div className="workspace-structure-spacer" style={{ height: (items.length - window.end) * ROW_HEIGHT }} aria-hidden="true" />
    {items.length === 0 && <p className="workspace-empty">Фрагменты не найдены.</p>}
  </nav>;
});
