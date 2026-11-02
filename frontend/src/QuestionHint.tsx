import React, { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

export function QuestionHint({ text, id }: { text?: string; id: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  if (!text?.trim()) return null;
  return <span className="question-hint" ref={root} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="question-hint-trigger" aria-label="Подсказка к вопросу" aria-expanded={open} aria-describedby={open ? `${id}-hint` : undefined} onClick={(event) => { event.preventDefault(); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}><CircleHelp size={16} aria-hidden="true" /></button>
    {open && <span id={`${id}-hint`} className="question-hint-popup" role="tooltip">{text}</span>}
  </span>;
}
