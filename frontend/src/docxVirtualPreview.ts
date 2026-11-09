import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PreviewBlock, PreviewNode } from "./docxPreviewLayout";

type WindowRange = { start: number; end: number };
const OVERSCAN = 700;
const scheduleFrame = (callback: FrameRequestCallback): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : window.setTimeout(() => callback(performance.now()), 16);
const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else window.clearTimeout(id);
};

function estimatedHeight(block: PreviewBlock<PreviewNode>): number {
  return block.kind === "table" ? Math.max(65, block.rows.length * 43) : 45;
}

function indexAt(offsets: number[], position: number): number {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, offsets.length - 2);
}

export function useDocxVirtualPreview<T extends PreviewNode>(
  blocks: PreviewBlock<T>[],
  canvasRef: RefObject<HTMLElement | null>,
  pageRef: RefObject<HTMLElement | null>,
  zoom: number,
) {
  const heights = useRef(new Map<number, number>());
  const observers = useRef(new Map<number, ResizeObserver>());
  const pending = useRef(new Map<number, number>());
  const frame = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const anchor = useRef<{ index: number; within: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<WindowRange>({ start: 0, end: 35 });
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const offsets = useMemo(() => {
    const values = [0];
    for (let index = 0; index < blocks.length; index++) {
      values.push(values[index] + (heights.current.get(index) ?? estimatedHeight(blocks[index])));
    }
    return values;
  }, [blocks, revision]);

  const locatorIndex = useMemo(() => {
    const index = new Map<string, number>();
    blocks.forEach((block, blockIndex) => {
      if (block.kind === "paragraph") index.set(block.node.locator, blockIndex);
      else for (const row of block.rows) for (const cell of row) for (const node of cell.nodes) index.set(node.locator, blockIndex);
    });
    return index;
  }, [blocks]);

  const updateRange = useCallback(() => {
    const canvas = canvasRef.current, page = pageRef.current;
    if (!canvas || !page || !blocks.length) return;
    const scale = zoomRef.current / 100;
    const top = Math.max(0, (canvas.getBoundingClientRect().top - page.getBoundingClientRect().top) / scale);
    const bottom = top + canvas.clientHeight / scale;
    const start = indexAt(offsets, Math.max(0, top - OVERSCAN / scale));
    const end = Math.min(blocks.length, indexAt(offsets, bottom + OVERSCAN / scale) + 2);
    setRange(current => current.start === start && current.end === end ? current : { start, end });
  }, [blocks, canvasRef, pageRef, offsets]);

  const queueMeasurement = useCallback((index: number, element: HTMLElement) => {
    const height = element.getBoundingClientRect().height / (zoomRef.current / 100);
    if (height <= 0 || Math.abs((heights.current.get(index) ?? estimatedHeight(blocks[index])) - height) < 1) return;
    pending.current.set(index, height);
    if (frame.current !== null) return;
    frame.current = scheduleFrame(() => {
      frame.current = null;
      const canvas = canvasRef.current;
      let priorDelta = 0;
      for (const [blockIndex, measured] of pending.current) {
        const previous = heights.current.get(blockIndex) ?? estimatedHeight(blocks[blockIndex]);
        heights.current.set(blockIndex, measured);
        if (blockIndex < rangeRef.current.start) priorDelta += measured - previous;
      }
      pending.current.clear();
      if (canvas && priorDelta) canvas.scrollTop += priorDelta * (zoomRef.current / 100);
      setRevision(value => value + 1);
    });
  }, [blocks, canvasRef]);

  const measure = useCallback((index: number, element: HTMLElement | null) => {
    observers.current.get(index)?.disconnect();
    observers.current.delete(index);
    if (!element) return;
    queueMeasurement(index, element);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => queueMeasurement(index, element));
      observer.observe(element);
      observers.current.set(index, observer);
    }
  }, [queueMeasurement]);

  useLayoutEffect(() => {
    heights.current.clear();
    pending.current.clear();
    setRevision(value => value + 1);
    setRange({ start: 0, end: 35 });
    if (canvasRef.current) canvasRef.current.scrollTop = 0;
  }, [blocks, canvasRef]);

  useEffect(() => () => {
    if (frame.current !== null) cancelFrame(frame.current);
    if (scrollFrame.current !== null) cancelFrame(scrollFrame.current);
    for (const observer of observers.current.values()) observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onScroll = () => {
      if (scrollFrame.current !== null) return;
      scrollFrame.current = scheduleFrame(() => { scrollFrame.current = null; updateRange(); });
    };
    canvas.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(canvas);
    onScroll();
    return () => { canvas.removeEventListener("scroll", onScroll); observer?.disconnect(); if (scrollFrame.current !== null) cancelFrame(scrollFrame.current); scrollFrame.current = null; };
  }, [canvasRef, updateRange]);

  const captureAnchor = useCallback(() => {
    const canvas = canvasRef.current, page = pageRef.current;
    if (!canvas || !page || !blocks.length) return;
    const top = Math.max(0, (canvas.getBoundingClientRect().top - page.getBoundingClientRect().top) / (zoomRef.current / 100));
    const index = indexAt(offsets, top);
    anchor.current = { index, within: top - offsets[index] };
  }, [blocks.length, canvasRef, pageRef, offsets]);

  const restoreAnchor = useCallback(() => {
    const saved = anchor.current, canvas = canvasRef.current, page = pageRef.current;
    if (!saved || !canvas || !page) return;
    anchor.current = null;
    const pageTop = page.getBoundingClientRect().top - canvas.getBoundingClientRect().top + canvas.scrollTop;
    canvas.scrollTop = pageTop + (offsets[saved.index] + saved.within) * (zoom / 100);
    updateRange();
  }, [zoom, canvasRef, pageRef, offsets, updateRange]);
  useLayoutEffect(() => { restoreAnchor(); }, [zoom, restoreAnchor]);

  // Existing measured heights are in unzoomed coordinates. Mounted blocks are
  // remeasured by ResizeObserver after a width change; keep the scroll anchor.
  useEffect(() => { updateRange(); }, [zoom, updateRange]);

  const scrollToLocator = useCallback((locator: string) => {
    const index = locatorIndex.get(locator), canvas = canvasRef.current, page = pageRef.current;
    if (index === undefined || !canvas || !page) return false;
    const scale = zoomRef.current / 100;
    const pageTop = page.getBoundingClientRect().top - canvas.getBoundingClientRect().top + canvas.scrollTop;
    canvas.scrollTop = pageTop + offsets[index] * scale - canvas.clientHeight / 2 + (offsets[index + 1] - offsets[index]) * scale / 2;
    const start = Math.max(0, indexAt(offsets, Math.max(0, offsets[index] - OVERSCAN / scale)));
    const end = Math.min(blocks.length, indexAt(offsets, offsets[index + 1] + canvas.clientHeight / scale + OVERSCAN / scale) + 2);
    setRange({ start, end });
    scheduleFrame(() => {
      const target = page.querySelector<HTMLElement>(`[data-locator="${CSS.escape(locator)}"]`);
      target?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    return true;
  }, [blocks.length, canvasRef, pageRef, locatorIndex, offsets]);

  return { range, top: offsets[range.start] ?? 0, bottom: (offsets[blocks.length] ?? 0) - (offsets[Math.min(range.end, blocks.length)] ?? 0), measure, scrollToLocator, captureAnchor, restoreAnchor };
}
