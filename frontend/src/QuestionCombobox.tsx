import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { exactQuestionExists, searchQuestions, type SearchableQuestion } from "./questionSearch";

const TYPE_NAMES: Record<string, string> = {
  TEXT: "Короткий текст", MULTILINE_TEXT: "Многострочный текст", INTEGER: "Целое число",
  DECIMAL: "Число", MONEY: "Денежная сумма", DATE: "Дата", BOOLEAN: "Да / нет",
  SINGLE_SELECT: "Выбор из списка", MULTI_SELECT: "Множественный выбор", LIST: "Повторяемый список", COMPOSITE: "Составное значение",
};

type Props = {
  fields: SearchableQuestion[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (label: string) => void;
};

export function QuestionCombobox({ fields, selectedId, onSelect, onCreate }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(() => fields.find(field => field.id === selectedId)?.label || "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => searchQuestions(fields, query), [fields, query]);
  const createLabel = query.trim();
  const canCreate = Boolean(createLabel) && !exactQuestionExists(fields, createLabel);
  const optionCount = matches.length + Number(canCreate);

  useEffect(() => {
    const selected = fields.find(field => field.id === selectedId);
    if (selected) setQuery(selected.label);
  }, [selectedId, fields]);

  function choose(index: number) {
    if (index < matches.length) {
      const field = matches[index];
      onSelect(field.id);
      setQuery(field.label);
      setOpen(false);
      setActive(0);
      inputRef.current?.focus();
    } else if (canCreate) {
      setOpen(false);
      onCreate(createLabel);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); } return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (optionCount) setActive(current => open ? (current + (event.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount : event.key === "ArrowDown" ? 0 : optionCount - 1);
      return;
    }
    if (event.key === "Enter" && open && optionCount) { event.preventDefault(); choose(active); }
  }

  return <div className="question-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label htmlFor={`${id}-input`}>Вопрос анкеты</label>
    <div className="question-combobox-input"><Search size={16} aria-hidden="true"/><input ref={inputRef} id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && optionCount ? `${id}-option-${active}` : undefined} autoComplete="off" placeholder="Найти вопрос или ввести новый" value={query} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); onSelect(""); }} onKeyDown={keyDown}/></div>
    <div id={`${id}-list`} role="listbox" aria-label="Вопросы анкеты" className="question-combobox-list" hidden={!open}>
      {!fields.length && !query.trim() && <p className="question-combobox-empty">Вопросов пока нет. Введите название, чтобы создать вопрос.</p>}
      {fields.length > 0 && !matches.length && <p className="question-combobox-empty">Совпадений нет.</p>}
      {matches.map((field, index) => <div key={field.id} id={`${id}-option-${index}`} role="option" aria-selected={active === index} className={`question-combobox-option ${active === index ? "active" : ""}`} onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><b>{field.label}</b><small>{TYPE_NAMES[field.field_type || ""] || field.field_type || "Вопрос"}{(field.config?.group || field.group) ? ` · ${field.config?.group || field.group}` : ""}</small></div>)}
      {canCreate && <div id={`${id}-option-${matches.length}`} role="option" aria-selected={active === matches.length} className={`question-combobox-option question-combobox-create ${active === matches.length ? "active" : ""}`} onPointerDown={event => event.preventDefault()} onMouseEnter={() => setActive(matches.length)} onClick={() => choose(matches.length)}>Создать новый вопрос: {createLabel}</div>}
    </div>
  </div>;
}
