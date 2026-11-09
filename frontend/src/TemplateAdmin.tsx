import "./selection-panel.css";
import "./template-workspace.css";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Upload,
  Download,
  Link2,
  Trash2,
  Plus,
  Send,
  CheckCircle2,
  Pencil,
  GitBranch,
  Search,
  ArrowLeft,
  ChevronRight,
  EyeOff,
} from "lucide-react";
import { evaluateExpression } from "./calculations";
import type { Condition } from "./conditions";
import { conditionError, conditionStats, replaceCondition, removeCondition, moveCondition, canLiftCondition, liftCondition, canNestCondition, nestCondition, insertAdjacentCondition, MAX_CONDITION_DEPTH, MAX_CONDITION_NODES } from "./conditionTree";
import { formulaFromCondition, parseConditionFormula, usedFormulaNames, type NamedCondition } from "./conditionFormula";
import { blockUnitLocator, resolveBlockRange, regionBlockBounds } from "./docxBlockRange";
import { layoutPreviewNodes } from "./docxPreviewLayout";
import { useDocxVirtualPreview } from "./docxVirtualPreview";
import { ConfirmAction } from "./ConfirmAction";
import { QuestionCombobox } from "./QuestionCombobox";
import { DefaultValueEditor } from "./DefaultValueEditor";
import { OTHER, choiceAnswer, choiceOtherValues, isStructuredChoice } from "./choices";
import { CHARACTER_SETS } from "./textRules";
import { DEFAULT_PANES, fitPaneWidths, PANE_STORAGE_KEY, readPaneWidths, type PaneWidths } from "./paneLayout";
type Api = (path: string, options?: any) => Promise<any>;
const TYPES: any = {
  TEXT: "Короткий текст",
  MULTILINE_TEXT: "Многострочный текст",
  INTEGER: "Целое число",
  DECIMAL: "Число",
  MONEY: "Денежная сумма",
  DATE: "Дата",
  BOOLEAN: "Да / нет",
  SINGLE_SELECT: "Выбор из списка",
  MULTI_SELECT: "Множественный выбор",
  LIST: "Повторяемый список",
  COMPOSITE: "Составное значение",
};
const OUTPUT_FORMATS: any = {
  RAW: "Как введено",
  NUMBER: "Число",
  DECIMAL: "Десятичное число",
  MONEY: "Денежная сумма",
  MONEY_WITH_CURRENCY: "Сумма с руб.",
  MONEY_WORDS_RUB: "Сумма прописью",
  DATE: "Дата ДД.ММ.ГГГГ",
  DATE_WORDS: "Дата прописью",
  DATE_MONTH_SHORT: "10 января 2000 г.",
  GENITIVE: "Родительный падеж",
  PERCENT: "Процент",
};
const blank = (position = 1) => ({
  field_key: "",
  label: "",
  field_type: "TEXT",
  required: true,
  calculated: false,
  expression: null,
  precision: 2,
  rounding: "HALF_UP",
  output_format: "RAW",
  position,
  description: "",
  group: "Основные сведения",
  placeholder: "",
  validation: {},
  options: [],
  option_items: [],
  allow_other: false,
  other_required: false,
  default_value: null,
  default_source: null,
  visible_when: null,
  required_when: null,
  text_expression: null,
  item_config: { min_items: 0, max_items: 20, max_length: 500 },
  components: [],
  separator: "; ",
});
const parseOptionText = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
const bindingFormats = (question: any) => Object.entries(OUTPUT_FORMATS).filter(([key]) => key !== "GENITIVE" && key !== "DATE_MONTH_SHORT" || key === "GENITIVE" && !!question?.config?.option_items?.length || key === "DATE_MONTH_SHORT" && question?.field_type === "DATE");
const newOption = () => ({ key: `option_${Math.random().toString(36).slice(2, 10)}`, label: "" });
function conditionFieldKeys(node: any): string[] {
  if (!node || typeof node !== "object") return [];
  return [...(typeof node.field_key === "string" ? [node.field_key] : []), ...conditionFieldKeys(node.condition), ...conditionFieldKeys(node.previous_condition), ...(Array.isArray(node.conditions) ? node.conditions.flatMap(conditionFieldKeys) : [])];
}
export function TemplateAdmin({ api }: { api: Api }) {
  return <FormulaStatusProvider><TemplateBuilder api={api} /></FormulaStatusProvider>;
}
const FormulaStatusContext = React.createContext({ pending: false, setPending: (_id: string, _value: boolean) => {} });
function FormulaStatusProvider({ children }: { children: React.ReactNode }) {
  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});
  const setPending = React.useCallback((id: string, pending: boolean) => setPendingById(current => {
    if (current[id] === pending || (!pending && !(id in current))) return current;
    const next = { ...current };
    if (pending) next[id] = true; else delete next[id];
    return next;
  }), []);
  return <FormulaStatusContext.Provider value={{ pending: Object.keys(pendingById).length > 0, setPending }}>{children}</FormulaStatusContext.Provider>;
}
function TemplateBuilder({ api }: { api: Api }) {
  const { pending: formulaPending } = React.useContext(FormulaStatusContext);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const builderGridRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ side: "questions" | "settings"; x: number; lastX: number; lineX: number; widths: PaneWidths; available: number; frame: number | null } | null>(null);
  const dragLineRef = useRef<HTMLDivElement | null>(null);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(readPaneWidths);
  const [paneAvailable, setPaneAvailable] = useState(0);
  const [requisiteSets, setRequisiteSets] = useState<any[]>([]);
  const testAnswerVersionRef = useRef<string | undefined>(undefined);
  useEffect(() => { api("/requisite-sets?include_archived=true").then(setRequisiteSets).catch(() => setRequisiteSets([])); }, [api]);
  const [templates, setTemplates] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [versions, setVersions] = useState<any[]>([]),
    [version, setVersion] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [schema, setSchema] = useState<any>(),
    [copySourceId, setCopySourceId] = useState(""),
    [copyFields, setCopyFields] = useState<any[]>([]),
    [copySelected, setCopySelected] = useState<string[]>([]),
    [copyOpen, setCopyOpen] = useState(false),
    [bindings, setBindings] = useState<any[]>([]),
    [regions, setRegions] = useState<any[]>([]),
    [repeatingGroups, setRepeatingGroups] = useState<any[]>([]),
    [bindingCandidates, setBindingCandidates] = useState<any[]>([]),
    [candidateFilter, setCandidateFilter] = useState({rf_id:"", status:"", operation:""}),
    [selectedCandidates, setSelectedCandidates] = useState<string[]>([]),
    [testAnswers, setTestAnswers] = useState<any>({}),
    [testDocument, setTestDocument] = useState<any>(),
    [selection, setSelection] = useState<any>(),
    [activeBinding, setActiveBinding] = useState<any>(),
    [selectionDraft, setSelectionDraft] = useState<any>(),
    [repeatingBinding, setRepeatingBinding] = useState(""),
    [regionDraft, setRegionDraft] = useState<any>(),
    [regionRuleBackup, setRegionRuleBackup] = useState<any>(null),
    [groupDraft, setGroupDraft] = useState<any>(),
    [groupField, setGroupField] = useState<any>(),
    [blockStart, setBlockStart] = useState<string>(),
    [blockHover, setBlockHover] = useState<string>(),
    [blockError, setBlockError] = useState(""),
    [repeatBlockStart, setRepeatBlockStart] = useState<string>(),
    [field, setField] = useState<any>(blank()),
    [fieldOptionsText, setFieldOptionsText] = useState(""),
    [groupFieldOptionsText, setGroupFieldOptionsText] = useState(""),
    [editing, setEditing] = useState<string>(),
    [pendingFieldDelete, setPendingFieldDelete] = useState<any>(null),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [category, setCategory] = useState("Другое"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingAction, setPendingAction] = useState<"delete" | "archive" | "restore" | null>(null),
    [stage, setStage] = useState(1),
    // The tour changes only the visible editor stage; it never saves a template.

    [docQuery, setDocQuery] = useState(""),
    [questionQuery, setQuestionQuery] = useState(""),
    [workspaceTab, setWorkspaceTab] = useState<"questions" | "structure">("questions"),
    [showFieldEditor, setShowFieldEditor] = useState(false),
    [zoom, setZoom] = useState(100);
  const structureItems = useMemo(() => (preview?.nodes || []).map((node: any, index: number) => ({
    locator: node.locator,
    kind: node.kind,
    number: index + 1,
    description: node.text.trim() || "Пустой фрагмент",
    searchText: node.text.trim().toLocaleLowerCase("ru"),
  })), [preview]);
  const visibleStructureItems = useMemo(() => {
    const query = docQuery.trim().toLocaleLowerCase("ru");
    return query ? structureItems.filter((item: any) => item.searchText.includes(query)) : structureItems;
  }, [structureItems, docQuery]);
  const previewBlocks = useMemo(() => layoutPreviewNodes(preview?.nodes || []), [preview]);
  const virtualPreview = useDocxVirtualPreview(previewBlocks, canvasRef, pageRef, zoom);
  useEffect(() => {
    const grid = builderGridRef.current;
    if (!grid) return;
    const measure = () => setPaneAvailable(grid.clientWidth);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(grid);
    if (!observer) window.addEventListener("resize", measure);
    setPaneAvailable(grid.clientWidth);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [version?.id, preview]);
  const fittedPanes = fitPaneWidths(paneWidths, paneAvailable || 2000);
  function applyPaneWidths(result: PaneWidths) {
    virtualPreview.captureAnchor();
    setPaneWidths(result);
    window.localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(result));
    window.requestAnimationFrame(() => virtualPreview.restoreAnchor());
  }
  function changePane(side: "questions" | "settings", next: number) {
    const width = builderGridRef.current?.clientWidth || paneAvailable || 2000;
    applyPaneWidths(fitPaneWidths({ ...fittedPanes, [side]: next }, width));
  }
  function resetPanes() {
    virtualPreview.captureAnchor();
    setPaneWidths(DEFAULT_PANES);
    window.localStorage.removeItem(PANE_STORAGE_KEY);
    window.requestAnimationFrame(() => virtualPreview.restoreAnchor());
  }
  function panePointerDown(event: React.PointerEvent<HTMLDivElement>, side: "questions" | "settings") {
    if (event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const grid = builderGridRef.current?.getBoundingClientRect();
    if (!grid) return;
    const lineX = rect.left + rect.width / 2;
    dragRef.current = { side, x: event.clientX, lastX: event.clientX, lineX, widths: fittedPanes, available: grid.width, frame: null };
    if (dragLineRef.current) {
      dragLineRef.current.hidden = false;
      dragLineRef.current.style.top = `${grid.top}px`;
      dragLineRef.current.style.height = `${grid.height}px`;
      dragLineRef.current.style.transform = `translate3d(${lineX}px, 0, 0)`;
    }
    document.body.classList.add("workspace-resizing");
  }
  function panePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    drag.lastX = event.clientX;
    if (drag.frame !== null) return;
    drag.frame = window.requestAnimationFrame(() => {
      const current = dragRef.current;
      if (current !== drag) return;
      drag.frame = null;
      const delta = drag.lastX - drag.x;
      const widths = fitPaneWidths({ ...drag.widths, [drag.side]: drag.widths[drag.side] + (drag.side === "questions" ? delta : -delta) }, drag.available);
      const appliedDelta = (widths[drag.side] - drag.widths[drag.side]) * (drag.side === "questions" ? 1 : -1);
      if (dragLineRef.current) dragLineRef.current.style.transform = `translate3d(${drag.lineX + appliedDelta}px, 0, 0)`;
    });
  }
  function panePointerEnd(event?: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    if (event) {
      const delta = event.clientX - drag.x;
      applyPaneWidths(fitPaneWidths({ ...drag.widths, [drag.side]: drag.widths[drag.side] + (drag.side === "questions" ? delta : -delta) }, drag.available));
    }
    dragRef.current = null;
    if (dragLineRef.current) dragLineRef.current.hidden = true;
    document.body.classList.remove("workspace-resizing");
  }
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && dragRef.current) { event.preventDefault(); panePointerEnd(); } };
    const cancelOnBlur = () => panePointerEnd();
    window.addEventListener("keydown", cancelOnEscape);
    window.addEventListener("blur", cancelOnBlur);
    return () => { window.removeEventListener("keydown", cancelOnEscape); window.removeEventListener("blur", cancelOnBlur); panePointerEnd(); };
  }, []);
  function paneKeyDown(event: React.KeyboardEvent<HTMLDivElement>, side: "questions" | "settings") {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    changePane(side, fittedPanes[side] + (event.key === "ArrowRight" ? 16 : -16) * (side === "questions" ? 1 : -1));
  }
  function paneDivider(side: "questions" | "settings") {
    return <div className="workspace-pane-divider" role="separator" tabIndex={0} aria-label={side === "questions" ? "Изменить ширину панели вопросов" : "Изменить ширину панели настроек"} aria-orientation="vertical" aria-valuenow={fittedPanes[side]} aria-valuemin={side === "questions" ? 180 : 260} aria-valuemax={side === "questions" ? 420 : 520} onPointerDown={event => panePointerDown(event, side)} onPointerMove={panePointerMove} onPointerUp={panePointerEnd} onPointerCancel={() => panePointerEnd()} onLostPointerCapture={() => panePointerEnd()} onKeyDown={event => paneKeyDown(event, side)} onDoubleClick={() => changePane(side, DEFAULT_PANES[side])} title="Перетащите для изменения ширины. Двойной щелчок — стандартная ширина." />;
  }
  const availableBlockLocators = useMemo(() => new Set<string>((preview?.nodes || []).map((node: any) => node.locator)), [preview]);
  const firstBlockUnitNode = useMemo(() => {
    const map = new Map<string,string>();
    for (const node of preview?.nodes || []) { const unit=blockUnitLocator(node.locator); if (unit && !map.has(unit)) map.set(unit,node.locator); }
    return map;
  },[preview]);
  const savedBlockMarkers = useMemo(() => {
    const markers = new Map<string, { start: boolean; end: boolean }>();
    for (const region of regions) {
      const bounds = regionBlockBounds(region);
      if (!bounds) continue;
      markers.set(bounds.start, { ...markers.get(bounds.start), start: true, end: markers.get(bounds.start)?.end || bounds.start === bounds.end });
      markers.set(bounds.end, { ...markers.get(bounds.end), start: markers.get(bounds.end)?.start || bounds.start === bounds.end, end: true });
    }
    return markers;
  }, [regions]);
  const activeBlockRange = useMemo(() => {
    if (blockStart) return resolveBlockRange(blockStart, blockHover, availableBlockLocators);
    const bounds = regionBlockBounds(regionDraft);
    return bounds ? resolveBlockRange(bounds.start, bounds.end, availableBlockLocators) : null;
  }, [blockStart, blockHover, regionDraft, availableBlockLocators]);
  useEffect(() => {
    if (showFieldEditor && inspectorRef.current) inspectorRef.current.scrollTop = 0;
  }, [showFieldEditor, editing]);
  async function load() {
    setTemplates(await api("/document-templates"));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }
  async function openTemplate(x: any) {
    setSelected(x);
    setPendingFieldDelete(null);
    setVersion(null);
    setPreview(null);
    setSchema(null);
    setBindings([]);
    setStage(1);
    setVersions(await api(`/document-templates/${x.id}/versions`));
  }
  async function openVersion(x: any) {
    setVersion(x);
    setPendingFieldDelete(null);
    setCopyOpen(false);setCopySourceId("");setCopyFields([]);setCopySelected([]);
    setStage(2);
    setSelection(null);
    setActiveBinding(null);
    setSelectionDraft(null);
    setShowFieldEditor(false);
    setRepeatingBinding("");
    setRegionDraft(null);
    setGroupDraft(null);
    setGroupField(null);
    setBlockStart(undefined);
    setBlockHover(undefined);
    setBlockError("");
    setRepeatBlockStart(undefined);
    let b = `/document-templates/${x.template_id}/versions/${x.id}`,
      [p, q, links, areas, repeaters, candidates] = await Promise.all([
        api(b + "/preview"),
        api(b + "/questionnaire"),
        api(b + "/bindings"),
        api(b + "/conditional-regions"),
        api(b + "/repeating-groups"),
        api(b + "/binding-candidates"),
      ]);
    setPreview(p);
    setSchema(q);
    setTestAnswers((current:any) => {
      const previous = testAnswerVersionRef.current === x.id ? current : {};
      testAnswerVersionRef.current = x.id;
      return Object.fromEntries((q.fields || []).map((item:any) => {
        const value = previous[item.field_key];
        if (isStructuredChoice(item)) {
          const answer = choiceAnswer(value);
          const allowed = new Set([...(item.config?.option_items || []).map((option:any) => option.key), ...(item.config?.allow_other ? [OTHER] : [])]);
          return [item.field_key, { ...answer, selected: answer.selected.filter((key:string) => allowed.has(key)) }];
        }
        if (item.field_type === "SINGLE_SELECT" && value && !(item.config?.options || []).includes(value)) return [item.field_key, ""];
        return [item.field_key, value];
      }));
    });
    setTestDocument(null);
    setBindings(links);
    setRegions(areas);
    setRepeatingGroups(repeaters);
    setBindingCandidates(candidates);
    setField(blank(q.fields.length + 1));
    setFieldOptionsText("");
    setGroupFieldOptionsText("");
  }
  async function decideCandidate(candidate: any, decision: "CONFIRMED" | "REJECTED") {
    await run(async () => {
      const updated = await api(`/document-templates/${version.template_id}/versions/${version.id}/binding-candidates/${encodeURIComponent(candidate.candidate_id)}`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({decision})});
      setBindingCandidates(bindingCandidates.map((item) => item.candidate_id === updated.candidate_id ? updated : item));
      setNotice(decision === "CONFIRMED" ? "Структурный кандидат подтверждён." : "Кандидат отклонён и оставлен на ручную разметку.");
    });
  }
  async function materializeCandidate(candidate: any) {
    await run(async () => {
      const updated = await api(`/document-templates/${version.template_id}/versions/${version.id}/binding-candidates/${encodeURIComponent(candidate.candidate_id)}/materialize`, {method:"POST"});
      setBindingCandidates(bindingCandidates.map((item) => item.candidate_id === updated.candidate_id ? updated : item));
      setNotice("Кандидат преобразован в настоящую привязку.");
    });
  }
  async function rollbackCandidate(candidate: any) {
    await run(async () => {
      const updated = await api(`/document-templates/${version.template_id}/versions/${version.id}/binding-candidates/${encodeURIComponent(candidate.candidate_id)}/materialization`, {method:"DELETE"});
      setBindingCandidates(bindingCandidates.map((item) => item.candidate_id === updated.candidate_id ? updated : item));
      setNotice("Материализация отменена.");
    });
  }
  async function batchMaterialize() {
    await run(async () => {
      await api(`/document-templates/${version.template_id}/versions/${version.id}/binding-candidates/batch-materialize`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({candidate_ids:selectedCandidates})});
      await openVersion(version); setSelectedCandidates([]); setNotice("Выбранные и ранее подтверждённые кандидаты материализованы.");
    });
  }
  async function generateTestDocument() {
    await run(async()=>{
      const result=await api(`/document-templates/${version.template_id}/versions/${version.id}/test-drive`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({answers:testAnswers})});
      setTestDocument(result);setNotice("Тестовый DOCX сформирован и промаркирован.");
    });
  }
  React.useEffect(() => { const show = (event: Event) => setStage((event as CustomEvent<number>).detail); window.addEventListener("tour-template-stage", show); return () => window.removeEventListener("tour-template-stage", show); }, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let x = await api("/document-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, category }),
      });
      setName("");
      setCode("");
      await load();
      await openTemplate(x);
    });
  }
  async function upload(file: File) {
    await run(async () => {
      let body = new FormData();
      body.append("file", file);
      let x = await api(`/document-templates/${selected.id}/versions`, {
        method: "POST",
        body,
      });
      setVersions(await api(`/document-templates/${selected.id}/versions`));
      await openVersion(x);
    });
  }
  function selectRange(event: React.MouseEvent<HTMLElement>) {
    if (version?.status !== "DRAFT") return;
    if (blockStart || !(event.target as Element).closest(".docx-page [data-locator]")) return;
    let s = window.getSelection();
    if (!s || s.rangeCount !== 1 || s.isCollapsed) return;
    let r = s.getRangeAt(0),
      a = (
        r.startContainer.nodeType === 3
          ? r.startContainer.parentElement
          : (r.startContainer as HTMLElement)
      )?.closest?.("[data-locator]") as HTMLElement | null,
      z = (
        r.endContainer.nodeType === 3
          ? r.endContainer.parentElement
          : (r.endContainer as HTMLElement)
      )?.closest?.("[data-locator]") as HTMLElement | null;
    if (!a || a !== z || !event.currentTarget.contains(a) || !event.currentTarget.contains(z)) {
      setError(
        "Выделение должно находиться внутри одного абзаца или одной ячейки.",
      );
      return;
    }
    let before = document.createRange();
    before.selectNodeContents(a);
    before.setEnd(r.startContainer, r.startOffset);
    let start = before.toString().length,
      text = s.toString();
    if (text.trim())
      setActiveBinding(null);
    if (text.trim())
      setShowFieldEditor(false);
    if (text.trim())
      setSelection({
        locator: a.dataset.locator,
        start,
        end: start + text.length,
        selected_text: text,
        field_id: "",
      });
    if (text.trim()) s.removeAllRanges();
  }
  async function saveField(e: FormEvent) {
    e.preventDefault();
    if (formulaPending) return;
    await run(async () => {
      let path = `/document-templates/${selected.id}/versions/${version.id}/fields${editing ? "/" + editing : ""}`;
      const payload = field.field_type === "SINGLE_SELECT" && !field.option_items?.length && !field.allow_other
        ? { ...field, options: parseOptionText(fieldOptionsText) }
        : field;
      const saved = await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setFieldOptionsText((payload.options || []).join(", "));
      setField({ ...payload, group: saved?.config?.group || payload.group });
      if (selectionDraft && saved?.id) {
        setSelection({ ...selectionDraft, field_id: saved.id });
        setStage(3);
      } else if (saved?.id) {
        setEditing(saved.id);
        setShowFieldEditor(true);
        setStage(4);
        setWorkspaceTab("questions");
      }
      setSelectionDraft(null);
      if (selectionDraft || !saved?.id) {
        setEditing(undefined);
        setShowFieldEditor(false);
      }
      setNotice("Поле анкеты сохранено.");
    });
  }
  function editField(x: any) {
    setStage(4);
    setActiveBinding(null);
    setSelection(null);
    setSelectionDraft(null);
    setShowFieldEditor(true);
    setEditing(x.id);
    setField({
      ...x,
      ...x.config,
      validation: x.config.validation || {},
      options: x.config.options || [],
      option_items: x.config.option_items || [],
      allow_other: x.config.allow_other || false,
      other_required: x.config.other_required || false,
      default_value: x.config.default_value ?? null,
      default_source: x.config.default_source ?? null,
      visible_when: x.config.visible_when || null,
      required_when: x.config.required_when || null,
    });
    setFieldOptionsText((x.config.options || []).join(", "));
  }
  function newField(initialLabel = "") {
    setSelectionDraft(selection || null);
    setSelection(null);
    setActiveBinding(null);
    setRegionDraft(null);
    setGroupDraft(null);
    setGroupField(null);
    setStage(4);
    setEditing(undefined);
    setField({ ...blank((schema?.fields?.length || 0) + 1), label: initialLabel.trim(), field_key: `question_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` });
    setFieldOptionsText("");
    setShowFieldEditor(true);
  }
  async function removeField(item: any) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/fields/${item.id}`,
        { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed_dependencies: (item.dependencies || []).map((dependency:any) => `${dependency.kind}:${dependency.id}`), acknowledge_logic_change: true }) },
      );
      await openVersion(version);
      setPendingFieldDelete(null);
    } catch (error: any) {
      setPendingFieldDelete(null);
      setError(error.message || "Удаление вопроса не выполнено. Проверьте зависимости и повторите действие.");
    } finally {
      setBusy(false);
    }
  }
  async function prepareFieldDelete(item: any) {
    if (!item || busy || version?.status !== "DRAFT") return;
    await run(async () => {
      const result = await api(`/document-templates/${selected.id}/versions/${version.id}/fields/${item.id}/dependencies`);
      const dependencies = result.dependencies || [];
      setPendingFieldDelete({ ...item, dependencies });
    });
  }
  async function changeBindingFormat(binding: any, output_format: string) {
    await run(async () => {
      await api(`/document-templates/${selected.id}/versions/${version.id}/bindings/${binding.id}/format`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_format, format_options: binding.format_config?.options || { precision: 2, rounding: "HALF_UP" } }),
      });
      await openVersion(version);
      setNotice("Формат привязки сохранён.");
    });
  }
  async function bind() {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/bindings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        },
      );
      await openVersion(version);
      setNotice("Привязка создана.");
    });
  }
  async function unbind(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/bindings/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
    });
  }
  function draftRegion(
    region_type: string,
    start_locator: string,
    end_locator?: string,
  ) {
    setSelection(null);
    setActiveBinding(null);
    setGroupDraft(null);
    setBlockStart(undefined);
    setBlockHover(undefined);
    setBlockError("");
    setRegionRuleBackup(null);
    setRegionDraft({
      region_key: "",
      region_type,
      start_locator,
      end_locator: start_locator === end_locator ? undefined : end_locator,
      include_when: null,
    });
  }
  function editRegion(region: any) {
    setBlockStart(undefined);
    setBlockHover(undefined);
    setBlockError("");
    setRegionRuleBackup(regionMode(region.include_when) === "CONDITIONAL" ? region.include_when : region.include_when?.previous_condition || null);
    setRegionDraft({ ...region });
  }
  function changeRegionMode(mode: "ALWAYS" | "CONDITIONAL" | "NEVER") {
    if (mode === "CONDITIONAL") {
      setRegionDraft({ ...regionDraft, include_when: regionRuleBackup });
    } else {
      const previous = regionMode(regionDraft.include_when) === "CONDITIONAL" ? regionDraft.include_when : regionRuleBackup;
      if (previous) setRegionRuleBackup(previous);
      setRegionDraft({ ...regionDraft, include_when: previous ? { operator: mode, previous_condition: previous } : { operator: mode } });
    }
  }
  function chooseBlock(locator: string) {
    window.getSelection()?.removeAllRanges();
    if (!blockStart) {
      const range = resolveBlockRange(locator, undefined, availableBlockLocators);
      if (range.error) { setBlockError(range.error); return; }
      setBlockStart(locator);
      setBlockHover(undefined);
      setBlockError("");
      if (regionDraft?.id) setRegionDraft(null);
      else if (regionDraft?.region_type === "CONDITIONAL_PARAGRAPH_GROUP") setRegionDraft({ ...regionDraft, start_locator: locator, end_locator: undefined });
      setNotice("Начало блока отмечено. Теперь выберите его конец.");
    } else {
      const range = resolveBlockRange(blockStart, locator, availableBlockLocators);
      if (range.error) { setBlockError(range.error); return; }
      if (regionDraft?.region_type === "CONDITIONAL_PARAGRAPH_GROUP" && !regionDraft.id) setRegionDraft({ ...regionDraft, start_locator: blockStart, end_locator: locator });
      else draftRegion("CONDITIONAL_PARAGRAPH_GROUP", blockStart, locator);
      setBlockStart(undefined);
      setBlockHover(undefined);
      setBlockError("");
      setNotice("Границы блока выбраны. Настройте правило включения.");
    }
  }
  function previewBlockEnd(locator: string) {
    if (!blockStart || blockHover === locator) return;
    setBlockHover(locator);
    if (!resolveBlockRange(blockStart, locator, availableBlockLocators).error) setBlockError("");
  }
  async function saveRegion() {
    if (formulaPending) return;
    await run(async () => {
      let editingRegion = regionDraft.id,
        path = `/document-templates/${selected.id}/versions/${version.id}/conditional-regions${editingRegion ? "/" + editingRegion : ""}`,
        payload = editingRegion
          ? {
              region_key: regionDraft.region_key,
              include_when: regionDraft.include_when,
            }
          : regionDraft;
      await api(path, {
        method: editingRegion ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setNotice(
        editingRegion
          ? "Условие области изменено."
          : "Условная область создана.",
      );
    });
  }
  async function removeRegion(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/conditional-regions/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
      setNotice("Условная область удалена.");
    });
  }
  function draftRepeatingGroup(locator: string, endLocator?: string) {
    setSelection(null);
    setActiveBinding(null);
    setRegionDraft(null);
    setGroupDraft({
      group_key: "",
      name: "",
      description: "",
      min_items: 0,
      max_items: 10,
      required: false,
      position: Math.max(0, ...repeatingGroups.map((g: any) => g.position)) + 1,
      row_locator: locator,
      end_row_locator: endLocator,
      row_count: 1,
      source_repetitions: 1,
      visible_when: null,
    });
  }
  function chooseRepeatingBlock(locator:string) {
    if (!repeatBlockStart) { setRepeatBlockStart(locator); setNotice("Выберите ячейку последней строки повторяемого блока."); return; }
    draftRepeatingGroup(repeatBlockStart, locator); setRepeatBlockStart(undefined);
  }
  async function saveRepeatingGroup() {
    if (formulaPending) return;
    await run(async () => {
      let editing = groupDraft.id,
        path = `/document-templates/${selected.id}/versions/${version.id}/repeating-groups${editing ? "/" + editing : ""}`;
      let payload = { ...groupDraft };
      delete payload.id;
      delete payload.fields;
      delete payload.locator;
      delete payload.status;
      if (editing) delete payload.row_locator;
      await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setNotice("Повторяемая группа сохранена.");
    });
  }
  async function removeRepeatingGroup(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/repeating-groups/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
      setNotice("Повторяемая группа удалена.");
    });
  }
  function newGroupField(group: any) {
    setGroupFieldOptionsText("");
    setGroupField({
      group_id: group.id,
      field_key: "",
      label: "",
      field_type: "TEXT",
      required: true,
      calculated: false,
      expression: null,
      precision: 2,
      rounding: "HALF_UP",
      output_format: "RAW",
      position: Math.max(0, ...group.fields.map((f: any) => f.position)) + 1,
      description: "",
      placeholder: "",
      validation: {},
      options: [],
    });
  }
  function editGroupField(group: any, existing: any) {
    setGroupFieldOptionsText((existing.config?.options || []).join(", "));
    setGroupField({ ...existing, group_id: group.id, ...existing.config });
  }
  async function saveGroupField(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let path = `/document-templates/${selected.id}/versions/${version.id}/repeating-groups/${groupField.group_id}/fields${groupField.id ? "/" + groupField.id : ""}`,
        payload = groupField.field_type === "SINGLE_SELECT"
          ? { ...groupField, options: parseOptionText(groupFieldOptionsText) }
          : { ...groupField };
      delete payload.id;
      delete payload.group_id;
      delete payload.locator;
      await api(path, {
        method: groupField.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setNotice("Поле строки сохранено.");
    });
  }
  async function removeGroupField(groupId: string, id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/repeating-groups/${groupId}/fields/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
    });
  }
  async function bindGroupField() {
    let target = repeatingGroups
      .flatMap((g: any) => g.fields.map((f: any) => ({ group: g, field: f })))
      .find((x: any) => x.field.id === repeatingBinding);
    if (!target) return;
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/repeating-groups/${target.group.id}/fields/${target.field.id}/binding`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        },
      );
      await openVersion(version);
      setNotice("Фрагмент строки привязан к полю группы.");
    });
  }
  async function cloneVersion() {
    if (!selected || !version) return;
    await run(async () => {
      const created = await api(
        `/document-templates/${selected.id}/versions/${version.id}/clone`,
        { method: "POST" },
      );
      setVersions(await api(`/document-templates/${selected.id}/versions`));
      await openVersion(created);
      setStage(4);
      setNotice(`Версия ${created.version_number} создана. Можно редактировать.`);
    });
  }
  async function chooseCopySource(sourceId: string) {
    setCopySourceId(sourceId);setCopyFields([]);setCopySelected([]);
    if (!sourceId || !selected) return;
    await run(async () => {
      const source = await api(`/document-templates/${selected.id}/versions/${sourceId}/questionnaire`);
      setCopyFields(source.fields || []);setCopySelected((source.fields || []).map((item:any) => item.id));
    });
  }
  async function copyQuestions() {
    if (!selected || !version || !copySourceId) return;
    await run(async () => {
      const result = await api(`/document-templates/${selected.id}/versions/${version.id}/copy-questions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_version_id:copySourceId,field_ids:copySelected})});
      await openVersion(version);setStage(4);setNotice(`Скопировано вопросов: ${result.count}. Привязки к Word настройте заново.`);
    });
  }

  async function publish() {
    await run(async () => {
      let x = await api(
        `/document-templates/${selected.id}/versions/${version.id}/publish`,
        { method: "POST" },
      );
      await openVersion(x);
      await load();
      setSelected({ ...selected, status: "ACTIVE" });
      setNotice("Версия опубликована и доступна сотрудникам.");
    });
  }
  async function manageTemplate() {
    if (!selected || !pendingAction) return;
    const action = pendingAction;
    await run(async () => {
      await api(`/document-templates/${selected.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      if (action === "delete") setSelected(undefined);
      else setSelected({ ...selected, status: action === "archive" ? "ARCHIVED" : "ACTIVE" });
      await load(); setPendingAction(null);
      setNotice(action === "delete" ? "Шаблон удалён." : action === "archive" ? "Шаблон убран из каталога." : "Шаблон восстановлен в каталоге.");
    });
  }
  const selectedCopyFields=copyFields.filter(item=>copySelected.includes(item.id));
  const questionGroup=(item:any)=>editing===item.id&&showFieldEditor ? field.group : item.config?.group || "Основные сведения";
  const questionActions = useRef({ editField });
  questionActions.current = { editField };
  const filteredQuestions = useMemo(() => {
    const query = questionQuery.toLowerCase();
    return (schema?.fields || []).filter((item:any) => `${item.label} ${item.field_key} ${questionGroup(item)}`.toLowerCase().includes(query));
  }, [schema?.fields, questionQuery, editing, showFieldEditor, field.group]);
  const bindingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const binding of bindings) if (binding.field_id) counts.set(binding.field_id, (counts.get(binding.field_id) || 0) + 1);
    return counts;
  }, [bindings]);
  const questionCards = useMemo(() => filteredQuestions.map((item:any) => {
    const count = bindingCounts.get(item.id) || 0;
    return <button key={item.id} type="button" className={editing === item.id && showFieldEditor ? "active" : ""} onClick={() => questionActions.current.editField(item)}><span>{questionGroup(item)}</span><b>{item.label}</b><small>{TYPES[item.field_type]} · {count} привязок</small><em className={count ? "linked" : "unlinked"}>{count ? "Привязан" : "Без привязки"}</em><ChevronRight size={14}/></button>;
  }), [filteredQuestions, bindingCounts, editing, showFieldEditor, field.group]);
  const existingGroups=Array.from(new Map<string,string>((schema?.fields||[]).map((item:any)=>String(item.config?.group||"Основные сведения").trim()).filter(Boolean).map((group:string)=>[group.toLocaleLowerCase("ru"),group])).values());
  const availableCopyKeys=new Set([...(schema?.fields||[]).map((item:any)=>item.field_key),...selectedCopyFields.map(item=>item.field_key)]);
  const missingCopyFields=copyFields.filter(item=>!availableCopyKeys.has(item.field_key)&&selectedCopyFields.some(selectedField=>[...conditionFieldKeys(selectedField.config?.visible_when),...conditionFieldKeys(selectedField.config?.required_when)].includes(item.field_key)));
  const previewActions = useRef({ previewBlockEnd, draftRegion, chooseBlock, draftRepeatingGroup, chooseRepeatingBlock });
  previewActions.current = { previewBlockEnd, draftRegion, chooseBlock, draftRepeatingGroup, chooseRepeatingBlock };
  const previewContent = useMemo(() => {
  const renderPreviewNode = (node: any) => {
                              const active = activeBlockRange?.locators.has(node.locator) || false;
                              const unit=blockUnitLocator(node.locator) || node.locator;
                              const saved = savedBlockMarkers.get(unit);
                              const boundaryNode=firstBlockUnitNode.get(unit)===node.locator;
                              const startMarker = boundaryNode && (blockUnitLocator(activeBlockRange?.start || "") === unit || saved?.start);
                              const endMarker = boundaryNode && (blockUnitLocator(activeBlockRange?.end || "") === unit || saved?.end);
                              return (
                              <div
                                key={node.locator}
                                tabIndex={0}
                                onMouseEnter={() => previewActions.current.previewBlockEnd(node.locator)}
                                onMouseLeave={() => { if (blockStart) setBlockHover(undefined); }}
                                onFocus={() => previewActions.current.previewBlockEnd(node.locator)}
                                className={`preview-node ${regions.some((r) => regionHasNode(r, node.locator)) ? "conditional-area" : ""} ${regions.some((r) => regionMode(r.include_when) === "NEVER" && regionHasNode(r, node.locator)) ? "hidden-area" : ""} ${repeatingGroups.some((g: any) => repeatingHasNode(g, node.locator)) ? "repeating-area" : ""} ${active ? "block-range-active" : ""} ${blockStart && active && node.locator !== blockStart ? "block-range-preview" : ""} ${(startMarker || endMarker) && !active ? "block-boundary-saved" : ""}`}
                              >
                                {startMarker && <span className={`block-boundary-label ${active ? "is-active" : ""}`}>Начало блока</span>}
                                {endMarker && <span className={`block-boundary-label ${active ? "is-active" : ""}`}>Конец блока</span>}
                                {regions.some((r) => regionMode(r.include_when) === "NEVER" && regionHasNode(r, node.locator)) && <span className="region-hidden-badge"><EyeOff size={12}/>Скрыт</span>}
                                <p
                                  data-locator={node.locator}
                                  className={
                                    node.kind === "table_cell"
                                      ? "docx-cell"
                                      : ""
                                  }
                                >
                                  {paint(
                                    node.text,
                                    bindings.filter(
                                      (b) => b.locator.node === node.locator,
                                    ),
                                    schema?.fields || [],
                                    regions.filter(
                                      (r) =>
                                        r.region_type === "CONDITIONAL_RUN" &&
                                        r.locator.node === node.locator,
                                    ),
                                    (binding: any) => { setActiveBinding(binding); setSelection(null); setRegionDraft(null); setGroupDraft(null); setStage(3); },
                                  )}
                                </p>
                                {version.status === "DRAFT" && (
                                  <div
                                    className="region-actions"
                                    aria-label="Выбор условной области"
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        previewActions.current.draftRegion(
                                          "CONDITIONAL_PARAGRAPH",
                                          node.locator,
                                        )
                                      }
                                    >
                                      Абзац
                                    </button>
                                    {node.kind === "paragraph" && !!node.text.trim() && <button type="button" onClick={() => { setActiveBinding(null); setRegionDraft(null); setGroupDraft(null); setSelection({ locator: node.locator, start: 0, end: node.text.length, selected_text: node.text, field_id: "", output_format: "RAW" }); setStage(3); }}>Привязать абзац</button>}
                                    <button
                                      type="button"
                                      onClick={() => previewActions.current.chooseBlock(node.locator)}
                                    >
                                      {blockStart
                                        ? "Конец блока"
                                        : "Начало блока"}
                                    </button>
                                    {node.kind === "table_cell" && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSelection({
                                              locator: node.locator,
                                              start: 0,
                                              end: node.text.length,
                                              selected_text: node.text,
                                              field_id: "",
                                            })
                                          }
                                        >
                                          Выбрать ячейку
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            previewActions.current.draftRegion(
                                              "CONDITIONAL_TABLE_ROW",
                                              node.locator,
                                            )
                                          }
                                        >
                                          Строка
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            previewActions.current.draftRegion(
                                              "CONDITIONAL_TABLE",
                                              node.locator,
                                            )
                                          }
                                        >
                                          Таблица
                                        </button>
                                        <button type="button" onClick={() => previewActions.current.draftRegion("CONDITIONAL_TABLE_COLUMN", node.locator)}>Колонка</button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            previewActions.current.draftRepeatingGroup(node.locator)
                                          }
                                        >
                                          Сделать строку повторяемой
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => previewActions.current.chooseRepeatingBlock(node.locator)}
                                        >
                                          {repeatBlockStart ? "Завершить блок строк" : "Начать блок строк"}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
  };
    return <>
      <div className="docx-virtual-spacer" style={{ height: virtualPreview.top }} aria-hidden="true" />
      {previewBlocks.slice(virtualPreview.range.start, virtualPreview.range.end).map((block, offset) => {
        const index = virtualPreview.range.start + offset;
        return <div className="docx-virtual-block" key={index} data-block-index={index} ref={element => virtualPreview.measure(index, element)}>
          {block.kind === "paragraph" ? renderPreviewNode(block.node)
                              : <div className="docx-table-scroll"><table className="docx-table"><tbody>
                                  {block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) =>
                                    <td key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan} className={cell.continuation ? "docx-merge-continuation" : undefined}>
                                      {cell.nodes.map(renderPreviewNode)}
                                    </td>
                                  )}</tr>)}
                                </tbody></table></div>}
        </div>;
      })}
      <div className="docx-virtual-spacer" style={{ height: virtualPreview.bottom }} aria-hidden="true" />
    </>;
  }, [previewBlocks, virtualPreview.range, virtualPreview.top, virtualPreview.bottom, virtualPreview.measure, activeBlockRange, savedBlockMarkers, firstBlockUnitNode, regions, repeatingGroups, bindings, schema?.fields, version?.status, blockStart, repeatBlockStart]);
  return (
    <div className={`page template-admin ${selected ? "template-open" : ""}`}>
      <header className="pagehead">
        <div>
          <p>КОНСТРУКТОР ДОГОВОРОВ</p>
          <h1>Шаблоны документов</h1>
          <span>
            Настройте вопросы, отметьте заменяемые фрагменты и опубликуйте
            договор.
          </span>
        </div>
      </header>
      {error && (
        <div className="platform-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="platform-success" role="status">
          {notice}
        </div>
      )}
      <section className="template-layout">
        <aside className="template-catalog">
          <form className="template-create" data-tour="tpl-create" onSubmit={create}>
            <h2>Новый шаблон</h2>
            <label>
              Название
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Категория
              <input
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
            <label>
              Служебный код
              <input
                required
                pattern="[A-Za-z0-9_-]+"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={16} />
              Создать
            </button>
          </form>
          <section className="template-list" data-tour="tpl-list">
            <h2>Шаблоны</h2>
            {templates.map((x) => (
              <button
                key={x.id}
                className={selected?.id === x.id ? "active" : ""}
                onClick={() => openTemplate(x)}
              >
                <FileText />
                <span>
                  <b>{x.name}</b>
                  <small>
                    {x.category} · {x.version_count} версий
                  </small>
                </span>
              </button>
            ))}
          </section>
        </aside>
        <main className="template-workbench">
          {!selected ? (
            <Empty />
          ) : (
            <>
              <header className="template-title" data-tour="tpl-title">
                <div>
                  <button className="back-link" onClick={() => setSelected(undefined)}><ArrowLeft size={15}/>К списку шаблонов</button>
                  <span className="draft-state">
                    {version?.status === "PUBLISHED"
                      ? "Опубликовано"
                      : "Черновик"}
                  </span>
                  <h2>{selected.name}</h2>
                  <p>{selected.category}</p>
                </div>
                <div className="template-management-actions">
                  {selected.status === "ARCHIVED" ? <button type="button" className="secondary" onClick={() => setPendingAction("restore")}>Восстановить</button> : selected.status === "ACTIVE" ? <button type="button" className="secondary" onClick={() => setPendingAction("archive")}>Архивировать</button> : <button type="button" className="secondary document-delete" onClick={() => setPendingAction("delete")}>Удалить шаблон</button>}
                </div>
                {version?.status === "PUBLISHED" && (
                  <button
                    type="button"
                    className="primary" data-tour="tpl-new-version"
                    disabled={busy}
                    onClick={cloneVersion}
                  >
                    <Plus size={16} />
                    Создать новую версию
                  </button>
                )}
                <label className="secondary upload-version" data-tour="tpl-upload">
                  <Upload size={16} />
                  Загрузить DOCX
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) =>
                      e.target.files?.[0] && upload(e.target.files[0])
                    }
                  />
                </label>
              </header>
              <nav className="builder-stages" data-tour="tpl-stages" aria-label="Этапы настройки шаблона">
                {[
                  { step: 1, label: "Общие сведения" },
                  { step: 2, label: "Исходный документ" },
                  { step: 4, label: "Вопросы анкеты" },
                  { step: 3, label: "Привязки к Word" },
                  { step: 5, label: "Условия и таблицы" },
                  { step: 6, label: "Проверка и публикация" },
                ].map(({ step, label }, index) => (
                  <button
                    key={step}
                    className={stage === step ? "active" : ""}
                    aria-current={stage === step ? "step" : undefined}
                    onClick={() => setStage(step)}
                  >
                    <span>{index + 1}</span>{label}
                  </button>
                ))}
              </nav>
              <div className="version-grid">
                <section className="version-list" data-tour="tpl-versions">
                  <h3>Версии</h3>
                  {versions.map((x) => (
                    <button
                      key={x.id}
                      className={version?.id === x.id ? "active" : ""}
                      onClick={() => openVersion(x)}
                    >
                      <b>Версия {x.version_number}</b>
                      <small>{x.original_filename}</small>
                      <span>
                        {x.status === "PUBLISHED"
                          ? "Опубликована"
                          : x.status === "SUPERSEDED"
                            ? "Архивная"
                            : "Черновик"}
                      </span>
                    </button>
                  ))}
                </section>
                <section className="docx-preview" data-tour="tpl-source">
                  {version && preview ? (
                    <>
                      <header>
                        <div>
                          <h3>Версия {version.version_number}</h3>
                          <p>{preview.nodes.length} структурных фрагментов</p>
                        </div>
                        <a
                          className="secondary"
                          href={`/api/v1/document-templates/${selected.id}/versions/${version.id}/source`}
                        >
                          <Download size={15} />
                          Исходник
                        </a>
                      </header>
                      <div ref={builderGridRef} className="builder-grid" style={{ "--questions-pane-width": `${fittedPanes.questions}px`, "--settings-pane-width": `${fittedPanes.settings}px` } as React.CSSProperties}>
                        <div ref={dragLineRef} className="workspace-pane-drag-line" aria-hidden="true" hidden />
                        <aside className="document-outline" aria-label="Навигация по шаблону">
                          <div className="workspace-tabs" data-tour="tpl-tabs" role="tablist" aria-label="Навигация">
                            <button role="tab" aria-selected={workspaceTab === "questions"} className={workspaceTab === "questions" ? "active" : ""} onClick={() => setWorkspaceTab("questions")}>Вопросы</button>
                            <button role="tab" aria-selected={workspaceTab === "structure"} className={workspaceTab === "structure" ? "active" : ""} onClick={() => setWorkspaceTab("structure")}>Word</button>
                          </div>
                          {workspaceTab === "questions" ? <>
                            <div className="workspace-panel-heading"><h3>Вопросы анкеты</h3><span>{schema?.fields?.length || 0}</span></div>
                            <label className="workspace-search"><Search size={14}/><input value={questionQuery} onChange={(event) => setQuestionQuery(event.target.value)} placeholder="Найти вопрос" aria-label="Найти вопрос"/></label>
                            {version.status === "DRAFT" && <button className="workspace-add" data-tour="tpl-add-question" type="button" onClick={() => newField()}><Plus size={15}/>Добавить вопрос</button>}
                            <nav className="workspace-question-list" data-tour="tpl-questions" aria-label="Список вопросов">
                              {questionCards}
                              {schema?.fields?.length === 0 && <p className="workspace-empty">Вопросов пока нет. Добавьте первый вопрос или выделите текст в документе.</p>}
                              {schema?.fields?.length > 0 && filteredQuestions.length === 0 && <p className="workspace-empty">По запросу ничего не найдено.</p>}
                            </nav>
                          </> : <>
                            <div className="workspace-panel-heading"><h3>Структура Word</h3><span>{preview.nodes.length}</span></div>
                            <label className="workspace-search"><Search size={14}/><input value={docQuery} onChange={(event) => setDocQuery(event.target.value)} placeholder="Найти фрагмент" aria-label="Найти фрагмент"/></label>
                            <nav className="workspace-structure-list" aria-label="Структура документа">{visibleStructureItems.map((item: any) => <button key={item.locator} type="button" onClick={() => virtualPreview.scrollToLocator(item.locator)} title={item.description}><span>{item.kind === "table_cell" ? "Ячейка" : "Абзац"} {item.number}</span><b>{item.description}</b></button>)}{visibleStructureItems.length === 0 && <p className="workspace-empty">Фрагменты не найдены.</p>}</nav>
                          </>}
                        </aside>
                        {paneDivider("questions")}
                        <section ref={canvasRef} className="document-canvas" data-tour="tpl-canvas">
                          <div className="workspace-canvas-toolbar"><div><b>Исходный документ</b><span>Выделите фрагмент для настройки привязки или условия</span></div><div className="workspace-toolbar-actions"><button type="button" className="secondary workspace-reset-layout" onClick={resetPanes}>Сбросить расположение</button><label>Масштаб <select value={zoom} onChange={(event) => { virtualPreview.captureAnchor(); setZoom(Number(event.target.value)); }} aria-label="Масштаб документа"><option value={75}>75%</option><option value={90}>90%</option><option value={100}>100%</option><option value={110}>110%</option><option value={125}>125%</option></select></label></div></div>
                          {bindingCandidates.length > 0 && (
                            <details className="selection-card binding-candidate-review" data-tour="tpl-candidates" aria-label="Кандидаты структурной разметки">
                              <summary>Кандидаты структурной разметки · {bindingCandidates.length}</summary>
                              <div className="candidate-review-body">
                              <Link2 />
                              <div>
                                <h3>Готовность структурной разметки</h3>
                                <div className="candidate-metrics">
                                  <b>Обнаружено: {bindingCandidates.length}</b><span>Подтверждено: {bindingCandidates.filter(x=>x.review_decision==="CONFIRMED").length}</span><span>Материализовано: {bindingCandidates.filter(x=>x.status==="CONFIGURED"||x.status==="GENERATED_AND_VERIFIED").length}</span><span>Проверено генерацией: {bindingCandidates.filter(x=>x.status==="GENERATED_AND_VERIFIED").length}</span><span>Ручная настройка: {bindingCandidates.filter(x=>!["CONFIGURED","GENERATED_AND_VERIFIED","BLOCKED"].includes(x.status)).length}</span><span>Заблокировано: {bindingCandidates.filter(x=>x.status==="BLOCKED").length}</span>
                                </div>
                                <p>Автоматически найденные места требуют подтверждения специалиста. Подтверждение не создаёт привязку само по себе.</p>
                                <div className="candidate-filters"><select value={candidateFilter.rf_id} onChange={e=>setCandidateFilter({...candidateFilter,rf_id:e.target.value})}><option value="">Все RF</option>{[...new Set(bindingCandidates.map(x=>x.rf_id))].map((x:any)=><option key={x}>{x}</option>)}</select><select value={candidateFilter.status} onChange={e=>setCandidateFilter({...candidateFilter,status:e.target.value})}><option value="">Все статусы</option>{[...new Set(bindingCandidates.map(x=>x.status))].map((x:any)=><option key={x}>{x}</option>)}</select><select value={candidateFilter.operation} onChange={e=>setCandidateFilter({...candidateFilter,operation:e.target.value})}><option value="">Все операции</option>{[...new Set(bindingCandidates.map(x=>x.operation))].map((x:any)=><option key={x}>{x}</option>)}</select></div>
                                {selectedCandidates.length>0&&<button type="button" onClick={batchMaterialize}>Материализовать выбранные ({selectedCandidates.length})</button>}
                                {bindingCandidates.filter((x:any)=>(!candidateFilter.rf_id||x.rf_id===candidateFilter.rf_id)&&(!candidateFilter.status||x.status===candidateFilter.status)&&(!candidateFilter.operation||x.operation===candidateFilter.operation)).map((candidate: any) => (
                                  <article key={candidate.candidate_id} className="candidate-row">
                                    <input aria-label={`Выбрать ${candidate.candidate_id}`} type="checkbox" checked={selectedCandidates.includes(candidate.candidate_id)} disabled={candidate.review_decision!=="CONFIRMED"||candidate.status==="CONFIGURED"} onChange={e=>setSelectedCandidates(e.target.checked?[...selectedCandidates,candidate.candidate_id]:selectedCandidates.filter(x=>x!==candidate.candidate_id))}/>
                                    <button type="button" className="back-link" onClick={() => virtualPreview.scrollToLocator(candidate.locator || "")}>{candidate.rf_id} · {candidate.matrix_location}</button>
                                    <small>{candidate.operation} · {candidate.status}</small>
                                    <p>{candidate.context || "Структурный узел не найден"}</p>
                                    {candidate.review_reason&&<p><b>Причина:</b> {candidate.review_reason}<br/><b>Действие специалиста:</b> {candidate.required_specialist_action}</p>}
                                    <div>
                                      {candidate.review_group&&<button type="button" className="secondary" onClick={()=>setSelectedCandidates(bindingCandidates.filter((x:any)=>x.review_group===candidate.review_group&&x.review_decision==="CONFIRMED"&&x.status!=="CONFIGURED"&&x.locator).map((x:any)=>x.candidate_id))}>Выбрать подтверждённую группу</button>}
                                      <button type="button" disabled={version.status !== "DRAFT" || candidate.review_decision === "CONFIRMED"} onClick={() => decideCandidate(candidate, "CONFIRMED")}>Подтвердить</button>
                                      <button type="button" className="secondary" disabled={version.status !== "DRAFT" || candidate.review_decision === "REJECTED"} onClick={() => decideCandidate(candidate, "REJECTED")}>Отклонить</button>
                                      {candidate.review_decision==="CONFIRMED"&&candidate.status!=="CONFIGURED"&&<button type="button" onClick={()=>materializeCandidate(candidate)}>Создать привязку</button>}
                                      {candidate.status==="CONFIGURED"&&<button type="button" className="secondary" onClick={()=>rollbackCandidate(candidate)}>Отменить материализацию</button>}
                                    </div>
                                  </article>
                                ))}
                              </div>
                              </div>
                            </details>
                          )}
                          {stage===6&&version.status==="DRAFT"&&(
                            <section className="selection-card draft-test-drive" aria-label="Тестовая генерация черновика">
                              <FileText/><div><h3>Проверка документа</h3><p>Проверьте заполнение настроенных полей перед публикацией. Остальные фрагменты Word останутся без изменений.</p>
                              <div className="scenario-facts">{(schema?.fields||[]).map((item:any)=><TestDriveField key={item.id} field={item} value={testAnswers[item.field_key]} change={(value:any)=>setTestAnswers({...testAnswers,[item.field_key]:value})}/>)}</div>
                              <button type="button" disabled={busy} onClick={generateTestDocument}>Сформировать тестовый DOCX</button>
                              {testDocument&&<a className="primary" href={testDocument.download_url}><Download size={15}/>Скачать тестовый DOCX</a>}
                              <button
                                type="button"
                                className="primary"
                                disabled={busy}
                                onClick={publish}
                              >
                                {busy ? "Публикация..." : "Опубликовать"}
                              </button>
                              </div>
                            </section>
                          )}
                          <div className="preview-notice">
                            Выделите текст для привязки или условного фрагмента.
                            Для структурной области используйте действия у
                            абзаца.
                            {blockStart && <div className="block-selection-status"><span>Начало блока выбрано. Наведите на конечный абзац или строку таблицы и нажмите «Конец блока».</span><button type="button" onClick={() => { setBlockStart(undefined); setBlockHover(undefined); setBlockError(""); if (regionDraft?.region_type === "CONDITIONAL_PARAGRAPH_GROUP" && !regionDraft.end_locator && !regionDraft.id) setRegionDraft(null); }}>Отменить выбор блока</button></div>}
                            {(blockError || (blockStart && blockHover && activeBlockRange?.error)) && <p className="block-selection-error" role="alert">{blockError || activeBlockRange?.error}</p>}
                          </div>
                          <article
                            ref={pageRef}
                            className={`docx-page ${blockStart ? "block-picking" : ""}`}
                            onMouseUp={selectRange}
                            style={{ zoom: `${zoom}%` }}
                          >
                            {previewContent}
                          </article>
                          {selection && <InspectorPortal>
                            <section className="selection-card selection-card-floating" aria-label="Настройка выбранного фрагмента">
                              <Link2 />
                              <div>
                                <h3>Выбранный фрагмент</h3>
                                <blockquote>
                                  {selection.selected_text || "Пустая ячейка"}
                                </blockquote>
                                <QuestionCombobox fields={schema?.fields || []} selectedId={selection.field_id || ""} onSelect={field_id => setSelection((current: any) => current ? { ...current, field_id, output_format: bindingFormats(schema?.fields?.find((item:any) => item.id === field_id)).some(([key]) => key === current.output_format) ? current.output_format : "RAW" } : current)} onCreate={label => newField(label)}/>
                                <label>
                                  Формат в документе
                                  <select
                                    value={selection.output_format || "RAW"}
                                    onChange={(e) =>
                                      setSelection({
                                        ...selection,
                                        output_format: e.target.value,
                                        format_options: {
                                          precision: 2,
                                          rounding: "HALF_UP",
                                        },
                                      })
                                    }
                                  >
                                    <option value="RAW">Как введено</option>
                                    <option value="NUMBER">Число</option>
                                    <option value="DECIMAL">
                                      Десятичное число
                                    </option>
                                    <option value="MONEY">
                                      Денежная сумма
                                    </option>
                                    <option value="MONEY_WITH_CURRENCY">
                                      Сумма с руб.
                                    </option>
                                    <option value="MONEY_WORDS_RUB">
                                      Сумма прописью
                                    </option>
                                    <option value="DATE">
                                      Дата ДД.ММ.ГГГГ
                                    </option>
                                    <option value="DATE_WORDS">
                                      Дата прописью
                                    </option>
                                    {schema?.fields?.find((item:any) => item.id === selection.field_id)?.field_type === "DATE" && <option value="DATE_MONTH_SHORT">10 января 2000 г.</option>}
                                    {!!schema?.fields?.find((item:any) => item.id === selection.field_id)?.config?.option_items?.length && <option value="GENITIVE">Родительный падеж</option>}
                                    <option value="PERCENT">Процент</option>
                                  </select>
                                </label>
                                {!selection.field_id && (
                                  <p className="selection-help">
                                    Выберите существующий вопрос или создайте новый для этого фрагмента.
                                  </p>
                                )}
                                {version.status === "DRAFT" && <button className="secondary" type="button" onClick={() => newField()}><Plus size={15}/>Создать новый вопрос</button>}
                                <button
                                  className="primary"
                                  type="button"
                                  disabled={busy || !selection.field_id}
                                  onClick={bind}
                                >
                                  {busy ? "Сохранение..." : "Создать привязку"}
                                </button>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() => setSelection(null)}
                                >
                                  Закрыть панель
                                </button>
                                <button
                                  className="secondary"
                                  type="button"
                                  onClick={() =>
                                    { setRegionRuleBackup(null); setRegionDraft({
                                      region_key: "",
                                      region_type: "CONDITIONAL_RUN",
                                      start_locator: selection.locator,
                                      start: selection.start,
                                      end: selection.end,
                                      selected_text: selection.selected_text,
                                      include_when: null,
                                    }); setSelection(null); }
                                  }
                                >
                                  Сделать условным фрагментом
                                </button>
                                {repeatingGroups.some(
                                  (g: any) => g.fields.length > 0,
                                ) && (
                                  <>
                                    <label>
                                      Поле повторяемой строки
                                      <select
                                        value={repeatingBinding}
                                        onChange={(e) =>
                                          setRepeatingBinding(e.target.value)
                                        }
                                      >
                                        <option value="">Выберите поле</option>
                                        {repeatingGroups.map((g: any) => (
                                          <optgroup key={g.id} label={g.name}>
                                            {g.fields.map((f: any) => (
                                              <option key={f.id} value={f.id}>
                                                {f.label}
                                              </option>
                                            ))}
                                          </optgroup>
                                        ))}
                                      </select>
                                    </label>
                                    <button
                                      className="secondary"
                                      type="button"
                                      disabled={!repeatingBinding || busy}
                                      onClick={bindGroupField}
                                    >
                                      Связать с полем строки
                                    </button>
                                  </>
                                )}
                              </div>
                            </section>
                          </InspectorPortal>}
                          {regionDraft && <InspectorPortal>
                            <section
                              className="region-editor"
                              aria-label="Настройка условной области"
                            >
                              <h3>
                                {regionDraft.id
                                  ? "Изменить условную область"
                                  : "Новая условная область"}
                              </h3>
                              <p>{REGION_LABELS[regionDraft.region_type]}</p>
                              <label>Отображение в готовом документе
                                <select aria-label="Отображение в готовом документе" value={regionMode(regionDraft.include_when)} onChange={e => changeRegionMode(e.target.value as "ALWAYS" | "CONDITIONAL" | "NEVER")}>
                                  <option value="ALWAYS">Всегда показывать</option>
                                  <option value="CONDITIONAL">Показывать при выполнении условия</option>
                                  <option value="NEVER">Никогда не показывать</option>
                                </select>
                              </label>
                              <label>
                                Служебный ключ
                                <input
                                  required
                                  pattern="[A-Za-z][A-Za-z0-9_.-]*"
                                  value={regionDraft.region_key}
                                  onChange={(e) =>
                                    setRegionDraft({
                                      ...regionDraft,
                                      region_key: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              {regionMode(regionDraft.include_when) === "CONDITIONAL" && <ConditionEditor
                                title="Включать область, когда"
                                value={regionDraft.include_when}
                                fields={schema?.fields || []}
                                change={(value: any) =>
                                  setRegionDraft({
                                    ...regionDraft,
                                    include_when: value,
                                  })
                                }
                              />}
                              <div>
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={
                                    busy || formulaPending ||
                                    !regionDraft.region_key ||
                                    !regionDraft.include_when ||
                                    !!conditionError(regionDraft.include_when, schema?.fields || []) ||
                                    (regionDraft.region_type === "CONDITIONAL_PARAGRAPH_GROUP" && !regionDraft.id && (!regionDraft.end_locator || !!resolveBlockRange(regionDraft.start_locator, regionDraft.end_locator, availableBlockLocators).error))
                                  }
                                  onClick={saveRegion}
                                >
                                  Сохранить область
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setRegionDraft(null)}
                                >
                                  Отмена
                                </button>
                                {regionDraft.id && <button type="button" className="secondary" disabled={busy} onClick={async () => { await removeRegion(regionDraft.id); setRegionDraft(null); }}>Вернуть обычное отображение</button>}
                              </div>
                            </section>
                          </InspectorPortal>}
                          {groupDraft && <InspectorPortal>
                            <section
                              className="region-editor repeating-editor"
                              aria-label="Настройка повторяемой группы"
                            >
                              <h3>
                                {groupDraft.id
                                  ? "Изменить повторяемую группу"
                                  : "Новая повторяемая группа"}
                              </h3>
                              <p>
                                Настройте строки, которые сотрудник сможет
                                добавлять в анкету.
                              </p>
                              <p><b>Схема блока:</b> {groupDraft.locator?.row_count || (groupDraft.end_row_locator ? "несколько соседних строк" : "1 строка")}. Одна запись анкеты создаёт одну копию всего блока.</p>
                              {!groupDraft.id&&<label>Исходных блоков-заготовок заменить<input type="number" min="1" max="20" value={groupDraft.source_repetitions||1} onChange={e=>setGroupDraft({...groupDraft,source_repetitions:Number(e.target.value)})}/></label>}
                              <label>
                                Название
                                <input
                                  required
                                  value={groupDraft.name}
                                  onChange={(e) =>
                                    setGroupDraft({
                                      ...groupDraft,
                                      name: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Служебный ключ
                                <input
                                  required
                                  pattern="[A-Za-z][A-Za-z0-9_.-]*"
                                  value={groupDraft.group_key}
                                  onChange={(e) =>
                                    setGroupDraft({
                                      ...groupDraft,
                                      group_key: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Описание
                                <input
                                  value={groupDraft.description}
                                  onChange={(e) =>
                                    setGroupDraft({
                                      ...groupDraft,
                                      description: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <div className="repeat-limits">
                                <label>
                                  Минимум
                                  <input
                                    type="number"
                                    min="0"
                                    max="50"
                                    value={groupDraft.min_items}
                                    onChange={(e) =>
                                      setGroupDraft({
                                        ...groupDraft,
                                        min_items: Number(e.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  Максимум
                                  <input
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={groupDraft.max_items}
                                    onChange={(e) =>
                                      setGroupDraft({
                                        ...groupDraft,
                                        max_items: Number(e.target.value),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={groupDraft.required}
                                  onChange={(e) =>
                                    setGroupDraft({
                                      ...groupDraft,
                                      required: e.target.checked,
                                    })
                                  }
                                />
                                Обязательная группа
                              </label>
                              <ConditionEditor
                                title="Показывать группу, когда"
                                value={
                                  groupDraft.visible_when ??
                                  groupDraft.config?.visible_when
                                }
                                fields={schema?.fields || []}
                                change={(value: any) =>
                                  setGroupDraft({
                                    ...groupDraft,
                                    visible_when: value,
                                  })
                                }
                              />
                              <div>
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={
                                    busy || formulaPending ||
                                    !groupDraft.name ||
                                    !groupDraft.group_key ||
                                    groupDraft.max_items < groupDraft.min_items ||
                                    !!conditionError(groupDraft.visible_when ?? groupDraft.config?.visible_when, schema?.fields || [])
                                  }
                                  onClick={saveRepeatingGroup}
                                >
                                  Сохранить группу
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setGroupDraft(null)}
                                >
                                  Отмена
                                </button>
                              </div>
                            </section>
                          </InspectorPortal>}
                        </section>
                        {paneDivider("settings")}
                        <aside ref={inspectorRef} data-tour="tpl-panel" className={`questionnaire-builder builder-stage-${stage} ${(selection || activeBinding || regionDraft || groupDraft) ? "has-context" : ""}`} aria-label="Панель настройки">
                          <div className="workspace-inspector-header"><span>Панель настройки</span><b>{activeBinding ? "Настроенная привязка" : selection ? "Привязка фрагмента" : regionDraft ? "Условная область" : groupDraft ? "Повторяемая группа" : showFieldEditor ? editing ? "Редактирование вопроса" : "Новый вопрос" : stage === 5 ? "Условия и таблицы" : stage === 3 ? "Привязки к Word" : "Настройка шаблона"}</b></div>
                          <div id="workspace-context-inspector" />
                          {activeBinding && <section className="workspace-active-binding"><p>Вопрос: <b>{schema?.fields.find((item:any) => item.id === activeBinding.field_id)?.label || "Без вопроса"}</b></p><blockquote>{activeBinding.selected_text}</blockquote><label>Формат вывода<select disabled={version.status !== "DRAFT" || busy} value={activeBinding.format_config?.format || "RAW"} onChange={(event) => changeBindingFormat(activeBinding, event.target.value)}>{bindingFormats(schema?.fields.find((item:any) => item.id === activeBinding.field_id)).map(([key, label]) => <option key={key} value={key}>{label as string}</option>)}</select></label><div><button type="button" className="secondary" onClick={() => setActiveBinding(null)}>Закрыть</button>{version.status === "DRAFT" && <button type="button" className="secondary" disabled={busy} onClick={() => unbind(activeBinding.id)}>Удалить привязку</button>}</div></section>}
                          {(stage === 3 || stage === 5) && !selection && !activeBinding && !regionDraft && !groupDraft && <p className="workspace-inspector-tip">Создайте вопрос анкеты или выделите фрагмент Word для привязки. Для условий и таблиц используйте действия у фрагментов документа.</p>}
                          {stage <= 2 && <div className="stage-guidance"><h3>{stage === 1 ? "Общие сведения" : "Исходный документ"}</h3><p>{stage === 1 ? "Проверьте название, категорию и статус версии." : "Читайте документ, используйте структуру слева и выделяйте нужный текст."}</p></div>}
                          <h3 className="panel-questionnaire">Вопросы анкеты</h3>
                          {version.status === "DRAFT" && stage === 4 && versions.some(item=>item.id!==version.id) && <section className="copy-questions-panel"><button type="button" className="secondary" onClick={()=>setCopyOpen(!copyOpen)}>Скопировать вопросы из другой версии</button>{copyOpen && <div className="copy-questions-options"><label>Исходная версия<select value={copySourceId} onChange={event=>chooseCopySource(event.target.value)}><option value="">Выберите версию</option>{versions.filter(item=>item.id!==version.id).map(item=><option key={item.id} value={item.id}>Версия {item.version_number}</option>)}</select></label>{copySourceId && <><p>Выбрано вопросов: {copySelected.length} из {copyFields.length}</p><div className="copy-questions-list">{copyFields.map(item=><label key={item.id}><input type="checkbox" checked={copySelected.includes(item.id)} onChange={event=>setCopySelected(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>{item.label}</label>)}</div>{missingCopyFields.length>0 && <div role="alert">Для условий также нужны: {missingCopyFields.map(item=>item.label).join(", ")}. <button type="button" onClick={()=>setCopySelected(current=>[...new Set([...current,...missingCopyFields.map(item=>item.id)])])}>Добавить зависимости</button></div>}<button type="button" className="primary" disabled={busy||!copySelected.length||!!missingCopyFields.length} onClick={copyQuestions}>Скопировать выбранные вопросы</button></>}</div>}</section>}
                          {version.status === "DRAFT" && showFieldEditor && !selection && !activeBinding && !regionDraft && !groupDraft && (
                            <form className="field-editor" onSubmit={saveField}>
                              <label>
                                Раздел
                                <input
                                  list="questionnaire-existing-groups"
                                  value={field.group}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      group: e.target.value,
                                    })
                                  }
                                />
                                <datalist id="questionnaire-existing-groups">{existingGroups.map(group=><option key={group} value={group}/>)}</datalist>
                              </label>
                              <label>
                                Вопрос
                                <input
                                  required
                                  value={field.label}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      label: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <details className="workspace-advanced"><summary>Дополнительные настройки</summary><label>
                                Служебный ключ поля
                                <input
                                  required
                                  pattern="[A-Za-z][A-Za-z0-9_.-]*"
                                  value={field.field_key}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      field_key: e.target.value,
                                    })
                                  }
                                />
                              </label></details>
                              <label>
                                Тип
                                <select
                                  value={field.field_type}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      field_type: e.target.value,
                                      default_value: null,
                                    })
                                  }
                                >
                                  {Object.entries(TYPES).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v as string}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={!!field.calculated}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      calculated: e.target.checked,
                                      default_value: e.target.checked ? null : field.default_value,
                                      required: e.target.checked
                                        ? false
                                        : field.required,
                                      field_type:
                                        e.target.checked &&
                                        ![
                                          "TEXT",
                                          "INTEGER",
                                          "DECIMAL",
                                          "MONEY",
                                        ].includes(field.field_type)
                                          ? "DECIMAL"
                                          : field.field_type,
                                      expression: e.target.checked
                                        ? field.expression ||
                                          defaultFormula(schema?.fields || [])
                                        : null,
                                    })
                                  }
                                />
                                Вычисляемое поле
                              </label>
                              {field.calculated && field.field_type !== "TEXT" && (
                                <FormulaEditor
                                  value={field.expression}
                                  fields={(schema?.fields || []).filter(
                                    (x: any) => x.id !== editing,
                                  )}
                                  groups={repeatingGroups}
                                  change={(expression: any) =>
                                    setField({ ...field, expression })
                                  }
                                />
                              )}
                              {field.calculated && field.field_type === "TEXT" && (
                                <TextExpressionEditor value={field.text_expression} fields={(schema?.fields || []).filter((x:any)=>x.id!==editing)} change={(text_expression:any)=>setField({...field,text_expression})} />
                              )}
                              {field.calculated && (
                                <div className="repeat-limits">
                                  <label>
                                    Знаков после запятой
                                    <input
                                      type="number"
                                      min="0"
                                      max="12"
                                      value={field.precision}
                                      onChange={(e) =>
                                        setField({
                                          ...field,
                                          precision: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Округление
                                    <select
                                      value={field.rounding}
                                      onChange={(e) =>
                                        setField({
                                          ...field,
                                          rounding: e.target.value,
                                        })
                                      }
                                    >
                                      <option value="HALF_UP">Обычное</option>
                                      <option value="HALF_EVEN">
                                        Бухгалтерское
                                      </option>
                                      <option value="DOWN">Вниз</option>
                                      <option value="UP">Вверх</option>
                                    </select>
                                  </label>
                                </div>
                              )}
                              <label>
                                Подсказка
                                <input
                                  value={field.placeholder}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      placeholder: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              {field.field_type === "SINGLE_SELECT" && !field.option_items?.length && !field.allow_other && (
                                <label>
                                  Варианты через запятую
                                  <input
                                    value={fieldOptionsText}
                                    onChange={(e) => setFieldOptionsText(e.target.value)}
                                  />
                                </label>
                              )}
                              {field.field_type === "SINGLE_SELECT" && !field.option_items?.length && <button type="button" className="secondary" onClick={() => setField({ ...field, option_items: parseOptionText(fieldOptionsText).map(label => ({ key: newOption().key, label })) .concat(!parseOptionText(fieldOptionsText).length ? [newOption()] : []), options: [] })}>Настроить варианты и «Иное»</button>}
                              {["SINGLE_SELECT", "MULTI_SELECT"].includes(field.field_type) && (field.option_items?.length > 0 || field.field_type === "MULTI_SELECT") && <fieldset className="choice-options-editor"><legend>Варианты ответа</legend>{(field.option_items || []).map((option: any, index: number) => <div className="choice-option-row" key={option.key}><input aria-label={`Вариант ${index + 1}`} required value={option.label} onChange={e => setField({ ...field, option_items: field.option_items.map((item: any, n: number) => n === index ? { ...item, label: e.target.value } : item) })}/><input aria-label={`Родительный падеж варианта ${index + 1}`} placeholder="Родительный падеж" value={option.genitive || ""} onChange={e => setField({ ...field, option_items: field.option_items.map((item: any, n: number) => n === index ? { ...item, genitive: e.target.value } : item) })}/><button type="button" disabled={index === 0} onClick={() => { const items = [...field.option_items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; setField({ ...field, option_items: items }); }}>↑</button><button type="button" disabled={index === field.option_items.length - 1} onClick={() => { const items = [...field.option_items]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; setField({ ...field, option_items: items }); }}>↓</button><button type="button" aria-label={`Удалить вариант ${index + 1}`} onClick={() => setField({ ...field, option_items: field.option_items.filter((_: any, n: number) => n !== index) })}>×</button></div>)}<button type="button" onClick={() => setField({ ...field, option_items: [...(field.option_items || []), newOption()] })}>Добавить вариант</button><label className="check"><input type="checkbox" checked={!!field.allow_other} onChange={e => setField({ ...field, allow_other: e.target.checked, other_required: e.target.checked ? field.other_required : false })}/>Разрешить вариант «Иное»</label>{field.allow_other && <label className="check"><input type="checkbox" checked={!!field.other_required} onChange={e => setField({ ...field, other_required: e.target.checked })}/>Текст для «Иное» обязателен</label>}</fieldset>}
                              {field.field_type === "LIST" && <div className="repeat-limits"><label>Минимум элементов<input type="number" min="0" max="100" value={field.item_config?.min_items ?? 0} onChange={e=>setField({...field,item_config:{...field.item_config,min_items:Number(e.target.value)}})}/></label><label>Максимум элементов<input type="number" min="1" max="100" value={field.item_config?.max_items ?? 20} onChange={e=>setField({...field,item_config:{...field.item_config,max_items:Number(e.target.value)}})}/></label><label>Разделитель в DOCX<input value={field.separator} onChange={e=>setField({...field,separator:e.target.value})}/></label></div>}
                              {field.field_type === "COMPOSITE" && <CompositeEditor components={field.components || []} change={(components:any)=>setField({...field,components})}/>}
                              {["TEXT","MULTILINE_TEXT"].includes(field.field_type) && <details className="workspace-text-rules"><summary>Ограничения ответа</summary><div className="repeat-limits"><label>Минимум символов<input type="number" min="0" max="10000" value={field.validation?.min_length ?? ""} onChange={e=>setField({...field,validation:{...field.validation,min_length:e.target.value===""?undefined:Number(e.target.value)}})}/></label><label>Максимум символов<input type="number" min="0" max="10000" value={field.validation?.max_length ?? ""} onChange={e=>setField({...field,validation:{...field.validation,max_length:e.target.value===""?undefined:Number(e.target.value)}})}/></label></div><label>Допустимые символы<select value={field.validation?.character_set || "ANY"} onChange={e=>setField({...field,validation:{...field.validation,character_set:e.target.value}})}>{Object.entries(CHARACTER_SETS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{field.validation?.character_set && field.validation.character_set!=="ANY" && <div className="workspace-text-rule-flags"><label className="check"><input type="checkbox" checked={!!field.validation?.allow_spaces} onChange={e=>setField({...field,validation:{...field.validation,allow_spaces:e.target.checked}})}/>Разрешить пробелы</label><label className="check"><input type="checkbox" checked={!!field.validation?.allow_hyphens} onChange={e=>setField({...field,validation:{...field.validation,allow_hyphens:e.target.checked}})}/>Разрешить дефисы</label></div>}{field.validation?.min_length!==undefined && field.validation?.max_length!==undefined && field.validation.min_length>field.validation.max_length && <p role="alert">Минимальная длина не может быть больше максимальной.</p>}</details>}
                              <DefaultValueEditor field={field} optionText={fieldOptionsText} requisiteSets={requisiteSets} change={value => setField((current:any) => ({ ...current, default_value: value }))} changeSource={value => setField((current:any) => ({ ...current, default_source: value }))}/>
                              {!field.calculated && (
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    checked={field.required}
                                    onChange={(e) =>
                                      setField({
                                        ...field,
                                        required: e.target.checked,
                                      })
                                    }
                                  />
                                  Всегда обязательный вопрос
                                </label>
                              )}
                              <ConditionEditor
                                title="Показывать вопрос, когда"
                                value={field.visible_when}
                                fields={(schema?.fields || []).filter(
                                  (x: any) => x.id !== editing,
                                )}
                                ownKey={field.field_key}
                                change={(value: any) =>
                                  setField({ ...field, visible_when: value })
                                }
                              />
                              <ConditionEditor
                                title="Делать обязательным, когда"
                                value={field.required_when}
                                fields={(schema?.fields || []).filter(
                                  (x: any) => x.id !== editing,
                                )}
                                ownKey={field.field_key}
                                change={(value: any) =>
                                  setField({ ...field, required_when: value })
                                }
                              />
                              {editing && <div className="workspace-linked-fragments"><b>Связанные фрагменты · {bindings.filter((item:any) => item.field_id === editing).length}</b>{bindings.filter((item:any) => item.field_id === editing).map((item:any) => <button key={item.id} type="button" className="secondary" onClick={() => { setActiveBinding(item); setStage(3); virtualPreview.scrollToLocator(item.locator.node); }}>{item.selected_text || "Фрагмент Word"}</button>)}</div>}
                              <button className="primary" disabled={busy || formulaPending || !!conditionError(field.visible_when, (schema?.fields || []).filter((x:any) => x.id !== editing), field.field_key) || !!conditionError(field.required_when, (schema?.fields || []).filter((x:any) => x.id !== editing), field.field_key)}>
                                {editing
                                  ? "Сохранить изменения"
                                  : "Добавить вопрос"}
                              </button>
                              <button type="button" className="secondary" onClick={() => { setShowFieldEditor(false); setEditing(undefined); if (selectionDraft) { setSelection(selectionDraft); setSelectionDraft(null); setStage(3); } }}>Отмена</button>
                              {editing && <button type="button" className="secondary document-delete" disabled={busy} onClick={() => prepareFieldDelete(schema?.fields?.find((item:any) => item.id === editing))}>Удалить вопрос</button>}
                            </form>
                          )}
                          {stage === 4 && !showFieldEditor && !selection && !regionDraft && !groupDraft && <div className="workspace-inspector-empty"><FileText size={26}/><h3>Выберите вопрос</h3><p>Откройте вопрос слева, чтобы изменить его настройки, или добавьте новый.</p>{version.status === "DRAFT" && <button type="button" className="secondary" onClick={() => newField()}><Plus size={15}/>Добавить вопрос</button>}</div>}
                          <div className="field-list panel-fields">
                            {schema?.fields.map((x: any) => (
                              <article key={x.id}>
                                <div>
                                  <b>{x.label}</b>
                                  <small>
                                    {TYPES[x.field_type]} ·{" "}
                                    {
                                      bindings.filter(
                                        (b) => b.field_id === x.id,
                                      ).length
                                    }{" "}
                                    вхождений
                                    {x.config?.visible_when ||
                                    x.config?.required_when
                                      ? " · Есть условия"
                                      : ""}
                                  </small>
                                </div>
                                {version.status === "DRAFT" && (
                                  <span>
                                    <button
                                      aria-label="Изменить вопрос"
                                      onClick={() => editField(x)}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      aria-label="Удалить вопрос"
                                      onClick={() => prepareFieldDelete(x)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </span>
                                )}
                              </article>
                            ))}
                          </div>
                          <h3 className="panel-bindings">Привязки</h3>
                          <div className="binding-list panel-bindings">
                            {bindings.length === 0 && <p className="region-empty">Привязок пока нет. Выделите текст в документе и выберите вопрос анкеты.</p>}
                            {bindings.map((b: any) => (
                              <article key={b.id}>
                                <span>
                                  <b>
                                    {schema?.fields.find(
                                      (x: any) => x.id === b.field_id,
                                    )?.label || "Без вопроса"}
                                  </b>
                                  <small>
                                    Вхождение {b.occurrence_index}: «
                                    {b.selected_text}»
                                  </small>
                                  <label className="binding-format">
                                    Формат вывода
                                    <select
                                      disabled={version.status !== "DRAFT" || busy}
                                      value={b.format_config?.format || "RAW"}
                                      onChange={(event) => changeBindingFormat(b, event.target.value)}
                                    >
                                      {bindingFormats(schema?.fields.find((item:any) => item.id === b.field_id)).map(([key, label]) => <option key={key} value={key}>{label as string}</option>)}
                                    </select>
                                  </label>
                                </span>
                                {version.status === "DRAFT" && (
                                  <button
                                    aria-label="Удалить привязку"
                                    onClick={() => unbind(b.id)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </article>
                            ))}
                          </div>
                          <h3 className="panel-conditions">Условные области</h3>
                          <div className="binding-list region-list panel-conditions">
                            {regions.length === 0 && (
                              <p className="region-empty">
                                Области ещё не настроены.
                              </p>
                            )}
                            {regions.map((r: any) => (
                              <article key={r.id}>
                                <span>
                                  <b>{r.region_key}</b>
                                  <small>{REGION_LABELS[r.region_type]} · {regionMode(r.include_when) === "NEVER" ? "Скрыт" : regionMode(r.include_when) === "ALWAYS" ? "Всегда" : "По условию"}</small>
                                </span>
                                {version.status === "DRAFT" && (
                                  <span>
                                    <button
                                      aria-label="Изменить условную область"
                                      onClick={() => editRegion(r)}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      aria-label="Удалить условную область"
                                      onClick={() => removeRegion(r.id)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </span>
                                )}
                              </article>
                            ))}
                          </div>
                          <h3 className="panel-conditions">Повторяемые строки</h3>
                          <div className="repeat-group-list panel-conditions">
                            {repeatingGroups.length === 0 && (
                              <p className="region-empty">
                                Повторяемые строки ещё не настроены.
                              </p>
                            )}
                            {repeatingGroups.map((g: any) => (
                              <article key={g.id}>
                                <header>
                                  <span>
                                    <b>{g.name}</b>
                                    <small>
                                      От{" "}
                                      {Math.max(
                                        g.min_items,
                                        g.required ? 1 : 0,
                                      )}{" "}
                                      до {g.max_items} записей
                                    </small>
                                    <small>{g.locator?.row_count || 1} строк в одной записи</small>
                                  </span>
                                  {version.status === "DRAFT" && (
                                    <span>
                                      <button
                                        aria-label="Добавить поле строки"
                                        onClick={() => newGroupField(g)}
                                      >
                                        <Plus size={14} />
                                      </button>
                                      <button
                                        aria-label="Изменить повторяемую группу"
                                        onClick={() =>
                                          setGroupDraft({
                                            ...g,
                                            visible_when:
                                              g.config?.visible_when,
                                          })
                                        }
                                      >
                                        <Pencil size={14} />
                                      </button>
                                      <button
                                        aria-label="Удалить повторяемую группу"
                                        onClick={() =>
                                          removeRepeatingGroup(g.id)
                                        }
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </span>
                                  )}
                                </header>
                                {g.fields.map((f: any) => (
                                  <div className="repeat-field" key={f.id}>
                                    <span>
                                      <b>{f.label}</b>
                                      <small>
                                        {TYPES[f.field_type]} ·{" "}
                                        {f.locator
                                          ? "Привязано"
                                          : "Не привязано"}
                                      </small>
                                    </span>
                                    {version.status === "DRAFT" && (
                                      <span>
                                        <button
                                          aria-label="Изменить поле строки"
                                          onClick={() => editGroupField(g, f)}
                                        >
                                          <Pencil size={13} />
                                        </button>
                                        <button
                                          aria-label="Удалить поле строки"
                                          onClick={() =>
                                            removeGroupField(g.id, f.id)
                                          }
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </article>
                            ))}
                          </div>
                          {groupField && version.status === "DRAFT" && (
                            <form
                              className="repeat-field-form panel-conditions"
                              onSubmit={saveGroupField}
                            >
                              <h3>
                                {groupField.id
                                  ? "Изменить поле строки"
                                  : "Новое поле строки"}
                              </h3>
                              <label>
                                Название
                                <input
                                  required
                                  value={groupField.label}
                                  onChange={(e) =>
                                    setGroupField({
                                      ...groupField,
                                      label: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Ключ поля
                                <input
                                  required
                                  pattern="[A-Za-z][A-Za-z0-9_.-]*"
                                  value={groupField.field_key}
                                  onChange={(e) =>
                                    setGroupField({
                                      ...groupField,
                                      field_key: e.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Тип
                                <select
                                  value={groupField.field_type}
                                  onChange={(e) =>
                                    setGroupField({
                                      ...groupField,
                                      field_type: e.target.value,
                                    })
                                  }
                                >
                                  {Object.entries(TYPES).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v as string}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={!!groupField.calculated}
                                  onChange={(e) =>
                                    setGroupField({
                                      ...groupField,
                                      calculated: e.target.checked,
                                      required: e.target.checked
                                        ? false
                                        : groupField.required,
                                      field_type:
                                        e.target.checked &&
                                        ![
                                          "INTEGER",
                                          "DECIMAL",
                                          "MONEY",
                                        ].includes(groupField.field_type)
                                          ? "DECIMAL"
                                          : groupField.field_type,
                                      expression: e.target.checked
                                        ? groupField.expression ||
                                          defaultRowFormula(
                                            repeatingGroups.find(
                                              (g: any) =>
                                                g.id === groupField.group_id,
                                            )?.fields || [],
                                          )
                                        : null,
                                    })
                                  }
                                />
                                Вычисляемое поле строки
                              </label>
                              {groupField.calculated && (
                                <FormulaEditor
                                  value={groupField.expression}
                                  fields={
                                    repeatingGroups
                                      .find(
                                        (g: any) =>
                                          g.id === groupField.group_id,
                                      )
                                      ?.fields.filter(
                                        (x: any) => x.id !== groupField.id,
                                      ) || []
                                  }
                                  groups={[]}
                                  row
                                  change={(expression: any) =>
                                    setGroupField({ ...groupField, expression })
                                  }
                                />
                              )}
                              {groupField.field_type === "SINGLE_SELECT" && (
                                <label>
                                  Варианты через запятую
                                  <input
                                    value={groupFieldOptionsText}
                                    onChange={(e) => setGroupFieldOptionsText(e.target.value)}
                                  />
                                </label>
                              )}
                              {!groupField.calculated && (
                                <label className="check">
                                  <input
                                    type="checkbox"
                                    checked={groupField.required}
                                    onChange={(e) =>
                                      setGroupField({
                                        ...groupField,
                                        required: e.target.checked,
                                      })
                                    }
                                  />
                                  Обязательное поле
                                </label>
                              )}
                              <div>
                                <button className="primary" disabled={busy}>
                                  Сохранить поле
                                </button>
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setGroupField(null)}
                                >
                                  Отмена
                                </button>
                              </div>
                            </form>
                          )}
                          {version.status === "DRAFT" && (
                            <button
                              className="publish panel-publish"
                              onClick={publish}
                              disabled={busy}
                            >
                              <Send size={15} />
                              Проверить и опубликовать
                            </button>
                          )}
                          {version.status === "PUBLISHED" && (
                            <p className="binding-ok panel-publish">
                              <CheckCircle2 />
                              Версия доступна сотрудникам.
                            </p>
                          )}
                        </aside>
                      </div>
                    </>
                  ) : (
                    <Empty upload />
                  )}
                </section>
              </div>
            </>
          )}
        </main>
      </section>
      {pendingAction && selected && <ConfirmAction title={pendingAction === "delete" ? "Удалить шаблон" : pendingAction === "archive" ? "Архивировать шаблон" : "Восстановить шаблон"} body={pendingAction === "delete" ? `Удалить черновой шаблон «${selected.name}»?` : pendingAction === "archive" ? `Убрать шаблон «${selected.name}» из каталога новых договоров? Созданные документы сохранятся.` : `Вернуть шаблон «${selected.name}» в каталог?`} action={pendingAction === "delete" ? "Удалить" : pendingAction === "archive" ? "Архивировать" : "Восстановить"} busy={busy} onConfirm={() => void manageTemplate()} onCancel={() => setPendingAction(null)}/>}
      {pendingFieldDelete && <ConfirmAction title="Удалить вопрос" body={`Удалить вопрос «${pendingFieldDelete.label}»? Связанных зависимостей: ${pendingFieldDelete.dependencies.length}.`} details={pendingFieldDelete.dependencies.map((dependency:any)=>dependency.label)} warning={pendingFieldDelete.dependencies.some((dependency:any)=>dependency.complex) ? "Внимание: логика вложенных условий или вычислений изменится. Условные области с этим вопросом станут всегда включёнными." : pendingFieldDelete.dependencies.some((dependency:any)=>dependency.kind==="region") ? "Условные области с этим вопросом станут всегда включёнными." : undefined} action="Удалить" busy={busy} onConfirm={() => void removeField(pendingFieldDelete)} onCancel={() => setPendingFieldDelete(null)}/>}
    </div>
  );
}

function InspectorPortal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById("workspace-context-inspector"));
  }, []);
  return target ? createPortal(children, target) : null;
}

export function TestDriveField({field,value,change}:any){
  if(field.field_type==="BOOLEAN")return <label>{field.label}<select value={String(value??"")} onChange={e=>change(e.target.value===""?null:e.target.value==="true")}><option value="">Не выбрано</option><option value="true">Да</option><option value="false">Нет</option></select></label>;
  if(isStructuredChoice(field)){
    const answer=choiceAnswer(value),multiple=field.field_type==="MULTI_SELECT";
    const options=[...field.config.option_items,...(field.config.allow_other?[{key:OTHER,label:"Иное"}]:[])];
    return <fieldset className="test-drive-choice"><legend>{field.label}</legend><div className="test-drive-options">{options.map((option:any)=><label key={option.key}><input type={multiple?"checkbox":"radio"} name={`test-${field.id}`} checked={answer.selected.includes(option.key)} onChange={event=>change({...answer,selected:multiple?event.target.checked?[...answer.selected,option.key]:answer.selected.filter(key=>key!==option.key):[option.key]})}/><span>{option.label}</span></label>)}</div>{answer.selected.includes(OTHER)&&(multiple?<div className="test-drive-other">{choiceOtherValues(answer).map((text,index)=><div key={index}><input aria-label={`Свой вариант ${index+1}`} value={text} onChange={event=>{const other_texts=[...choiceOtherValues(answer)];other_texts[index]=event.target.value;change({...answer,other_text:other_texts[0]||"",other_texts});}}/><button type="button" onClick={()=>{const other_texts=choiceOtherValues(answer).filter((_,position)=>position!==index);change({...answer,other_text:other_texts[0]||"",other_texts});}}>Удалить</button></div>)}<button type="button" onClick={()=>change({...answer,other_texts:[...choiceOtherValues(answer),""]})}>Добавить свой вариант</button></div>:<input aria-label="Свой вариант" value={answer.other_text} onChange={event=>change({...answer,other_text:event.target.value})}/>)}</fieldset>;
  }
  if(field.field_type==="SINGLE_SELECT")return <label>{field.label}<select value={value??""} onChange={e=>change(e.target.value)}><option value="">Не выбрано</option>{(field.config?.options||[]).map((option:string)=><option key={option}>{option}</option>)}</select></label>;
  if(field.field_type==="LIST")return <label>{field.label}<textarea value={(value||[]).join("\n")} onChange={e=>change(e.target.value.split("\n").filter(Boolean))}/></label>;
  if(field.field_type==="COMPOSITE")return <fieldset><legend>{field.label}</legend>{(field.config?.components||[]).map((part:any)=><label key={part.key}>{part.label}<input value={(value||{})[part.key]||""} onChange={e=>change({...value,[part.key]:e.target.value})}/></label>)}</fieldset>;
  return <label>{field.label}<input type={field.field_type==="DATE"?"date":field.field_type==="INTEGER"||field.field_type==="DECIMAL"?"number":"text"} value={value??""} onChange={e=>change(field.field_type==="INTEGER"||field.field_type==="DECIMAL"?Number(e.target.value):e.target.value)}/></label>;
}

const OPS: any = {
  EQUALS: "равно",
  NOT_EQUALS: "не равно",
  IN: "входит в список",
  NOT_IN: "не входит в список",
  CONTAINS_OPTION: "содержит выбранный вариант",
  NOT_CONTAINS_OPTION: "не содержит выбранный вариант",
  OTHER_SELECTED: "выбрано «Иное»",
  OTHER_NOT_SELECTED: "не выбрано «Иное»",
  IS_EMPTY: "не заполнено",
  IS_NOT_EMPTY: "заполнено",
  GREATER_THAN: "больше",
  LESS_THAN: "меньше",
  GREATER_OR_EQUAL: "больше или равно",
  LESS_OR_EQUAL: "меньше или равно",
};
const REGION_LABELS: any = {
  CONDITIONAL_RUN: "Фрагмент текста",
  CONDITIONAL_PARAGRAPH: "Абзац",
  CONDITIONAL_PARAGRAPH_GROUP: "Блок абзацев и строк таблицы",
  CONDITIONAL_TABLE_ROW: "Строка таблицы",
  CONDITIONAL_TABLE: "Таблица",
  CONDITIONAL_TABLE_COLUMN: "Колонка таблицы",
};
const regionMode = (condition: any): "ALWAYS" | "CONDITIONAL" | "NEVER" => condition?.operator === "ALWAYS" || condition?.operator === "NEVER" ? condition.operator : "CONDITIONAL";

function CompositeEditor({components,change}:any){return <section className="repeat-field-form"><h3>Компоненты</h3>{components.map((x:any,i:number)=><div key={i}><input aria-label="Ключ компонента" placeholder="passport.series" value={x.key} onChange={e=>change(components.map((v:any,n:number)=>n===i?{...v,key:e.target.value}:v))}/><input aria-label="Название компонента" placeholder="Серия паспорта" value={x.label} onChange={e=>change(components.map((v:any,n:number)=>n===i?{...v,label:e.target.value}:v))}/><select value={x.type||"TEXT"} onChange={e=>change(components.map((v:any,n:number)=>n===i?{...v,type:e.target.value,components:e.target.value==="COMPOSITE"?(v.components||[]):undefined}:v))}><option value="TEXT">Текст</option><option value="DATE">Дата</option><option value="INTEGER">Число</option><option value="COMPOSITE">Группа компонентов</option></select><label className="check"><input type="checkbox" checked={!!x.required} onChange={e=>change(components.map((v:any,n:number)=>n===i?{...v,required:e.target.checked}:v))}/>Обязательный</label>{x.type==="COMPOSITE"&&<CompositeEditor components={x.components||[]} change={(nested:any)=>change(components.map((v:any,n:number)=>n===i?{...v,components:nested}:v))}/>}<button type="button" onClick={()=>change(components.filter((_:any,n:number)=>n!==i))}>Удалить</button></div>)}<button type="button" onClick={()=>change([...components,{key:"",label:"",type:"TEXT",required:false,validation:{}}])}>Добавить компонент</button></section>}

function TextExpressionEditor({value,fields,change}:any){let expression=value||{operation:"CONCAT",parts:[{literal:""}]},conditional=expression.operation==="IF";return <section className="repeat-field-form"><h3>Текстовое значение</h3><label>Режим<select value={conditional?"IF":"CONCAT"} onChange={e=>change(e.target.value==="IF"?{operation:"IF",condition:null,then:{literal:""},else:{literal:""}}:{operation:"CONCAT",parts:[{literal:""}]})}><option value="CONCAT">Собрать из частей</option><option value="IF">Выбрать по условию</option></select></label>{conditional?<><ConditionEditor title="Условие выбора" value={expression.condition} fields={fields} change={(condition:any)=>change({...expression,condition})}/><label>Текст, если да<textarea value={expression.then?.literal||""} onChange={e=>change({...expression,then:{literal:e.target.value}})}/></label><label>Текст, если нет<textarea value={expression.else?.literal||""} onChange={e=>change({...expression,else:{literal:e.target.value}})}/></label></>:<>{(expression.parts||[]).map((part:any,i:number)=><div key={i}><select value={"literal" in part?"literal":"field"} onChange={e=>{let parts=[...expression.parts];parts[i]=e.target.value==="literal"?{literal:""}:{field_key:fields[0]?.field_key||"",format:"RAW"};change({...expression,parts})}}><option value="literal">Утверждённый текст</option><option value="field">Значение вопроса</option></select>{"literal" in part?<input value={part.literal} onChange={e=>{let parts=[...expression.parts];parts[i]={literal:e.target.value};change({...expression,parts})}}/>:<select value={part.field_key} onChange={e=>{let parts=[...expression.parts];parts[i]={...part,field_key:e.target.value};change({...expression,parts})}}>{fields.map((f:any)=><option key={f.id} value={f.field_key}>{f.label}</option>)}</select>}<button type="button" onClick={()=>change({...expression,parts:expression.parts.filter((_:any,n:number)=>n!==i)})}>Удалить</button></div>)}<button type="button" onClick={()=>change({...expression,parts:[...(expression.parts||[]),{literal:""}]})}>Добавить часть</button></>}</section>}
function regionHasNode(region: any, node: string) {
  let loc = region.locator;
  if (
    region.region_type === "CONDITIONAL_RUN" ||
    region.region_type === "CONDITIONAL_PARAGRAPH"
  )
    return loc.node === node;
  if (region.region_type === "CONDITIONAL_PARAGRAPH_GROUP")
    return loc.nodes.includes(blockUnitLocator(node));
  let prefix = `${loc.part}#/tbl[${loc.table}]`;
  return node.startsWith(
    region.region_type === "CONDITIONAL_TABLE_ROW"
      ? `${prefix}/tr[${loc.row}]`
      : prefix,
  );
}
function repeatingHasNode(group: any, node: string) {
  let loc = group.locator || {}, match=node.match(/^(.*)#\/tbl\[(\d+)\]\/tr\[(\d+)\]/);
  if(!match)return false;
  let row=Number(match[3]);return (loc.targets||[loc]).some((target:any)=>match![1]===target.part&&Number(match![2])===target.table&&row>=target.row&&row<target.row+(target.source_row_count||target.row_count||1));
}
const conditionLeaf = (fields: any[]): Condition => fields[0]?.config?.option_items?.length
  ? { operator: "CONTAINS_OPTION", field_key: fields[0].field_key, value: fields[0].config.option_items[0].key }
  : { operator: "EQUALS", field_key: fields[0]?.field_key || "", value: "" };
const conditionGroup = (fields: any[]): Condition => ({ operator: "AND", conditions: [conditionLeaf(fields), conditionLeaf(fields)] });
const conditionCore = (node: Condition): Condition => node.operator === "NOT" && node.condition ? node.condition : node;
const withCore = (node: Condition, core: Condition): Condition => node.operator === "NOT" ? { operator: "NOT", condition: core } : core;
const conditionValue = (raw: string, source: any): any => {
  if (source?.field_type === "BOOLEAN") return raw === "" ? "" : raw === "true";
  if (source?.field_type === "INTEGER") return raw === "" ? "" : Number.parseInt(raw, 10);
  if (["DECIMAL", "MONEY"].includes(source?.field_type)) return raw === "" ? "" : Number(raw);
  return raw;
};
const conditionDescription = (node: Condition, fields: any[]): string => {
  if (node.operator === "NOT") return `НЕ (${node.condition ? conditionDescription(node.condition, fields) : "?"})`;
  if (node.operator === "AND" || node.operator === "OR") return `(${(node.conditions || []).map(child => conditionDescription(child, fields)).join(node.operator === "AND" ? " И " : " ИЛИ ")})`;
  const name = fields.find((field: any) => field.field_key === node.field_key)?.label || node.field_key || "Поле";
  if (["IS_EMPTY", "IS_NOT_EMPTY", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(node.operator)) return `${name} ${OPS[node.operator]}`;
  const values = Array.isArray(node.value) ? node.value.join(", ") : String(node.value ?? "");
  return `${name} ${OPS[node.operator] || node.operator} ${values || "…"}`;
};

export function ConditionEditor({ title, value, fields, change, ownKey }: any) {
  const root = value as Condition | null;
  const [mode, setMode] = useState<"visual" | "formula">("visual");
  const [formulaDraft, setFormulaDraft] = useState<{ formula: string; variables: NamedCondition[] }>({ formula: "", variables: [] });
  const [formulaDirty, setFormulaDirty] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const lastFormulaRoot = useRef<string | null>(null);
  const editorId = React.useId();
  const formulaStatus = React.useContext(FormulaStatusContext);
  useEffect(() => { formulaStatus.setPending(editorId, formulaDirty); }, [editorId, formulaDirty, formulaStatus.setPending]);
  useEffect(() => () => formulaStatus.setPending(editorId, false), [editorId, formulaStatus.setPending]);
  const parsedFormula = useMemo(() => {
    if (mode !== "formula") return { value: null as Condition | null, error: null as string | null };
    try {
      const parsed = parseConditionFormula(formulaDraft.formula, formulaDraft.variables);
      return { value: parsed, error: conditionError(parsed, fields, ownKey) };
    } catch (error) { return { value: null, error: (error as Error).message }; }
  }, [mode, formulaDraft, fields, ownKey]);
  function enterFormula() {
    const signature = JSON.stringify(root);
    if (!formulaDirty && lastFormulaRoot.current !== signature) {
      setFormulaDraft(root ? formulaFromCondition(root) : { formula: "", variables: [] });
      setFormulaDirty(false);
    }
    lastFormulaRoot.current = signature;
    setPendingDelete(null); setMode("formula");
  }
  function applyFormula() {
    if (!parsedFormula.value || parsedFormula.error) return false;
    change(parsedFormula.value); lastFormulaRoot.current = JSON.stringify(parsedFormula.value); setFormulaDirty(false); setPendingDelete(null); return true;
  }
  function enterVisual() {
    setMode("visual");
  }
  function discardFormulaDraft() {
    setFormulaDraft(root ? formulaFromCondition(root) : { formula: "", variables: [] });
    lastFormulaRoot.current = JSON.stringify(root);
    setFormulaDirty(false); setPendingDelete(null);
  }
  function updateFormula(next: { formula: string; variables: NamedCondition[] }) { setFormulaDraft(next); setFormulaDirty(true); }
  const error = conditionError(root, fields, ownKey);
  const stats = conditionStats(root);
  function commit(next: Condition | null) {
    if (next && (conditionStats(next).depth > MAX_CONDITION_DEPTH || conditionStats(next).count > MAX_CONDITION_NODES)) return;
    change(next);
  }
  function edit(path: number[], next: Condition) { if (root) commit(replaceCondition(root, path, next)); }
  function remove(path: number[]) { if (root) commit(removeCondition(root, path)); }
  function move(path: number[], direction: -1 | 1) { if (root) commit(moveCondition(root, path, direction)); }
  function insertBeside(path: number[], before: boolean) { if (root) commit(insertAdjacentCondition(root, path, conditionLeaf(fields), before)); }
  function lift(path: number[]) { if (root) commit(liftCondition(root, path)); }
  function nest(path: number[], direction: -1 | 1) { if (root) commit(nestCondition(root, path, direction)); }
  const usedNames = usedFormulaNames(formulaDraft.formula);
  if (mode === "formula") return <fieldset className="condition-editor condition-formula-mode"><legend><GitBranch size={14}/>{title}</legend>
    <div className="condition-mode-tabs"><button type="button" onClick={enterVisual}>Визуальный конструктор</button><button type="button" className="active" aria-current="page">Логическое выражение</button></div>
    <div className="named-condition-list"><b>Именованные условия</b>{formulaDraft.variables.map(variable => <div className="named-condition" key={variable.name}><div className="named-condition-heading"><strong>{variable.name}</strong><span className={usedNames.has(variable.name) ? "" : "unused"}>{usedNames.has(variable.name) ? "В формуле" : "Не используется"}</span><button type="button" onClick={() => {
      if (usedNames.has(variable.name)) { setPendingDelete(variable.name); return; }
      updateFormula({ ...formulaDraft, variables: formulaDraft.variables.filter(item => item.name !== variable.name) });
    }}>Удалить</button></div><ConditionRow row={variable.condition} fields={fields} change={(condition: Condition) => updateFormula({ ...formulaDraft, variables: formulaDraft.variables.map(item => item.name === variable.name ? { ...item, condition } : item) })}/>{pendingDelete === variable.name && <div className="condition-delete-warning" role="alert">Условие {variable.name} используется в формуле. После удаления выражение станет невалидным.<button type="button" onClick={() => { updateFormula({ ...formulaDraft, variables: formulaDraft.variables.filter(item => item.name !== variable.name) }); setPendingDelete(null); }}>Удалить всё равно</button><button type="button" onClick={() => setPendingDelete(null)}>Отмена</button></div>}</div>)}<button type="button" className="condition-add-variable secondary" disabled={!fields.length || formulaDraft.variables.length >= MAX_CONDITION_NODES} onClick={() => { const names = new Set(formulaDraft.variables.map(item => item.name)); let index = 0, name = ""; do { let value = ++index; name = ""; while (value) { value--; name = String.fromCharCode(65 + value % 26) + name; value = Math.floor(value / 26); } } while (names.has(name)); updateFormula({ ...formulaDraft, variables: [...formulaDraft.variables, { name, condition: conditionLeaf(fields) }] }); }}>+ Добавить условие</button></div>
    <label className="condition-formula-input">Формула<textarea value={formulaDraft.formula} placeholder="(A ИЛИ B) И НЕ C" onChange={event => updateFormula({ ...formulaDraft, formula: event.target.value })}/></label>
    <small>Можно использовать AND, OR, NOT или И, ИЛИ, НЕ. Скобки задают уровни.</small>
    {parsedFormula.error && <p className="condition-error" role="alert">{parsedFormula.error}</p>}
    <button type="button" className="condition-apply-formula" disabled={!formulaDirty || !!parsedFormula.error} onClick={applyFormula}>Применить выражение</button>
  </fieldset>;
  function render(node: Condition, path: number[], depth: number, siblings = 1) {
    const core = conditionCore(node);
    const group = core.operator === "AND" || core.operator === "OR";
    const children = core.conditions || [];
    const canLeaf = stats.count + (group ? 1 : 2) <= MAX_CONDITION_NODES && depth + (node.operator === "NOT" ? 1 : 0) + (group ? 1 : 1) <= MAX_CONDITION_DEPTH;
    const canGroup = stats.count + (group ? 3 : 4) <= MAX_CONDITION_NODES && depth + (node.operator === "NOT" ? 1 : 0) + (group ? 2 : 3) <= MAX_CONDITION_DEPTH;
    const updateCore = (next: Condition) => edit(path, withCore(node, next));
    return <div className={`condition-node ${group ? "condition-group" : "condition-leaf"}`} key={path.join("-") || "root"}>
      <div className="condition-node-header">
        {group ? <><strong className="condition-level-label">{path.length ? "Вложенная группа" : "Основная группа"}</strong><label>Связь внутри группы<select aria-label="Связь внутри группы" value={core.operator} onChange={event => updateCore({ ...core, operator: event.target.value })}><option value="AND">Все условия (И)</option><option value="OR">Любое условие (ИЛИ)</option></select></label></> : <strong>Условие</strong>}
        <label className="condition-negate"><input type="checkbox" checked={node.operator === "NOT"} disabled={node.operator !== "NOT" && stats.depth >= MAX_CONDITION_DEPTH} onChange={event => edit(path, event.target.checked ? { operator: "NOT", condition: node } : core)}/>Отрицание (НЕ)</label>
      </div>
      {group ? <div className="condition-children">{children.map((child, index) => render(child, [...path, index], depth + 1 + (node.operator === "NOT" ? 1 : 0), children.length))}</div> : <ConditionRow row={core} fields={fields} change={updateCore}/>}
      {group && <div className="condition-group-actions"><button type="button" disabled={!canLeaf} onClick={() => updateCore({ ...core, conditions: [...children, conditionLeaf(fields)] })}><Plus size={14}/>Добавить условие в эту группу</button><button type="button" disabled={!canGroup} onClick={() => updateCore({ ...core, conditions: [...children, conditionGroup(fields)] })}><Plus size={14}/>Добавить группу внутрь</button></div>}
      <div className="condition-node-actions"><button type="button" aria-label="Выше" title="Переместить выше" disabled={!path.length || path[path.length - 1] === 0} onClick={() => move(path, -1)}>↑</button><button type="button" aria-label="Ниже" title="Переместить ниже" disabled={!path.length || path[path.length - 1] === siblings - 1} onClick={() => move(path, 1)}>↓</button><button type="button" disabled={stats.count + (path.length ? 1 : 2) > MAX_CONDITION_NODES} onClick={() => insertBeside(path, true)}>Добавить условие до</button><button type="button" disabled={stats.count + (path.length ? 1 : 2) > MAX_CONDITION_NODES} onClick={() => insertBeside(path, false)}>Добавить условие после</button>{path.length > 1 && <button type="button" disabled={!root || !canLiftCondition(root, path)} onClick={() => lift(path)}>Переместить в родительскую группу</button>}{path.length > 0 && <><button type="button" disabled={!root || !canNestCondition(root, path, -1)} onClick={() => nest(path, -1)}>Вложить в предыдущую группу</button><button type="button" disabled={!root || !canNestCondition(root, path, 1)} onClick={() => nest(path, 1)}>Вложить в следующую группу</button></>}<button type="button" className="condition-remove" onClick={() => remove(path)}>{group ? "Удалить группу" : "Удалить условие"}</button></div>
    </div>;
  }
  return <fieldset className="condition-editor"><legend><GitBranch size={14}/>{title}</legend><div className="condition-mode-tabs"><button type="button" className="active" aria-current="page">Визуальный конструктор</button><button type="button" onClick={enterFormula}>Логическое выражение</button></div>{formulaDirty && <div className="condition-draft-note" role="status">Есть неприменённая формула. Для сохранения правила примените её или отмените черновик.<button type="button" onClick={discardFormulaDraft}>Отменить черновик формулы</button></div>}
    {!root ? <button type="button" className="condition-add" disabled={!fields.length} onClick={() => commit(conditionLeaf(fields))}><Plus size={14}/>Добавить условие</button> : <>{render(root, [], 1)}{conditionCore(root).operator !== "AND" && conditionCore(root).operator !== "OR" && <div className="condition-group-actions"><button type="button" disabled={stats.count + 2 > MAX_CONDITION_NODES || stats.depth + 1 > MAX_CONDITION_DEPTH} onClick={() => commit({ operator: "AND", conditions: [root, conditionLeaf(fields)] })}><Plus size={14}/>Добавить условие</button><button type="button" disabled={stats.count + 4 > MAX_CONDITION_NODES || stats.depth + 2 > MAX_CONDITION_DEPTH} onClick={() => commit({ operator: "AND", conditions: [root, conditionGroup(fields)] })}><Plus size={14}/>Добавить группу</button></div>}<div className="condition-preview"><b>Логика условия</b><p>{conditionDescription(root, fields)}</p></div>{error && <p className="condition-error" role="alert">{error}</p>}<small className="condition-limit">{stats.count}/{MAX_CONDITION_NODES} элементов · глубина {stats.depth}/{MAX_CONDITION_DEPTH}</small></>}
  </fieldset>;
}
function ConditionRow({ row, fields, change }: any) {
  const [listText, setListText] = useState(() => Array.isArray(row.value) ? row.value.join(", ") : String(row.value ?? ""));
  const listValues = (text: string, field: any) => text.split(",").map(part => part.trim()).filter(Boolean).map(part => conditionValue(part, field));
  let source = fields.find((x: any) => x.field_key === row.field_key),
    ordered = ["INTEGER", "DECIMAL", "MONEY", "DATE"].includes(
      source?.field_type,
    ),
    ops = Object.entries(OPS).filter(
      ([k]) =>
        (source?.config?.option_items?.length ? !["EQUALS", "NOT_EQUALS", ...(source.field_type === "MULTI_SELECT" ? [] : ["IN", "NOT_IN"])].includes(k) : !["CONTAINS_OPTION", "NOT_CONTAINS_OPTION", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(k)) &&
        (source?.config?.allow_other || !["OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(k)) &&
        (ordered || ![
          "GREATER_THAN",
          "LESS_THAN",
          "GREATER_OR_EQUAL",
          "LESS_OR_EQUAL",
        ].includes(k)),
    ),
    noValue = ["IS_EMPTY", "IS_NOT_EMPTY", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(row.operator);
  useEffect(() => {
    setListText(Array.isArray(row.value) ? row.value.join(", ") : String(row.value ?? ""));
  }, [row.field_key, row.operator]);
  return (
    <div className="condition-row">
      <label>
        Поле
        <select
          required
          value={row.field_key}
          onChange={(e) => { const next = fields.find((field: any) => field.field_key === e.target.value); change(next?.config?.option_items?.length ? { operator: "CONTAINS_OPTION", field_key: e.target.value, value: next.config.option_items[0].key } : { operator: "EQUALS", field_key: e.target.value, value: "" }); }}
        >
          {fields.map((x: any) => (
            <option key={x.id} value={x.field_key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Оператор
        <select
          value={row.operator}
          onChange={(e) => {
            const operator = e.target.value;
            if (["IS_EMPTY", "IS_NOT_EMPTY", "OTHER_SELECTED", "OTHER_NOT_SELECTED"].includes(operator)) change({ operator, field_key: row.field_key });
            else if (["CONTAINS_OPTION", "NOT_CONTAINS_OPTION"].includes(operator)) change({ operator, field_key: row.field_key, value: source?.config?.option_items?.[0]?.key || "" });
            else change({ operator, field_key: row.field_key, value: ["IN", "NOT_IN"].includes(operator) ? (Array.isArray(row.value) ? row.value : row.value === "" || row.value === undefined ? [] : [row.value]) : Array.isArray(row.value) ? (row.value[0] ?? "") : (row.value ?? "") });
          }}
        >
          {ops.map(([k, v]) => (
            <option key={k} value={k}>
              {v as string}
            </option>
          ))}
        </select>
      </label>
      {!noValue && (
        <label>
          Значение
          {["CONTAINS_OPTION", "NOT_CONTAINS_OPTION"].includes(row.operator) ? <select value={String(row.value || "")} onChange={e => change({ ...row, value: e.target.value })}>{(source?.config?.option_items || []).map((option: any) => <option key={option.key} value={option.key}>{option.label}</option>)}</select> : source?.field_type === "MULTI_SELECT" && ["IN", "NOT_IN"].includes(row.operator) ? <div className="condition-option-list">{[...(source.config.option_items||[]),...(source.config.allow_other?[{key:"__other__",label:"Иное"}]:[])].map((option:any)=><label key={option.key}><input type="checkbox" checked={Array.isArray(row.value)&&row.value.includes(option.key)} onChange={event=>{const current=Array.isArray(row.value)?row.value:[];change({...row,value:event.target.checked?[...current,option.key]:current.filter((key:string)=>key!==option.key)});}}/>{option.label}</label>)}</div> : ["IN", "NOT_IN"].includes(row.operator) ? (
            <input required type="text" value={listText} placeholder="Значения через запятую" onChange={e => setListText(e.target.value)} onBlur={() => change({ ...row, value: listValues(listText, source) })}/>
          ) : source?.field_type === "SINGLE_SELECT" ? (
            <select
              value={row.value}
              onChange={(e) => change({ ...row, value: e.target.value })}
            >
              <option value="">Выберите значение</option>
              {source.config.options.map((x: string) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          ) : source?.field_type === "BOOLEAN" ? (
            <select
              value={row.value === "" || row.value === undefined ? "" : String(row.value)}
              onChange={(e) => change({ ...row, value: conditionValue(e.target.value, source) })}
            >
              <option value="">Выберите значение</option>
              <option value="true">Да</option>
              <option value="false">Нет</option>
            </select>
          ) : (
            <input
              required
              type={
                source?.field_type === "DATE"
                  ? "date"
                  : ordered
                    ? "number"
                    : "text"
              }
              value={row.value ?? ""}
              onChange={(e) => change({ ...row, value: conditionValue(e.target.value, source) })}
            />
          )}
        </label>
      )}
    </div>
  );
}
const CALC_OPS: any = {
  ADD: "Сложение",
  SUBTRACT: "Вычитание",
  MULTIPLY: "Умножение",
  DIVIDE: "Деление",
  ROUND: "Округление",
  IF: "Значение по условию",
  PERCENT_OF: "Процент от суммы",
  ADD_PERCENT: "Начислить процент",
  EXTRACT_PERCENT: "Выделить процент из суммы",
  REMOVE_PERCENT: "Сумма без процента",
  SUM: "Сумма по строкам",
  COUNT: "Количество строк",
  MIN: "Минимум по строкам",
  MAX: "Максимум по строкам",
};
const numeric = (fields: any[]) =>
  fields.filter((x: any) =>
    ["INTEGER", "DECIMAL", "MONEY"].includes(x.field_type),
  );
const source = (field: any, row = false) => ({
  source: field?.config?.calculated
    ? row
      ? "ROW_CALCULATED"
      : "CALCULATED"
    : row
      ? "ROW_FIELD"
      : "FIELD",
  field_key: field?.field_key || "",
});
function defaultFormula(fields: any[]) {
  let f = numeric(fields)[0];
  return {
    operation: "ADD",
    operands: [source(f), { source: "CONSTANT", value: "0" }],
  };
}
function defaultRowFormula(fields: any[]) {
  let f = numeric(fields)[0];
  return {
    operation: "MULTIPLY",
    operands: [source(f, true), { source: "CONSTANT", value: "1" }],
  };
}
function FormulaEditor({ value, fields, groups, row = false, change }: any) {
  let operation = value?.operation || "ADD",
    aggregate = ["SUM", "COUNT", "MIN", "MAX"].includes(operation),
    available = numeric(fields);
  function setOperation(op: string) {
    if (["SUM", "COUNT", "MIN", "MAX"].includes(op)) {
      let g = groups[0],
        f = numeric(g?.fields || [])[0];
      change({
        operation: op,
        group_key: g?.group_key || "",
        ...(op === "COUNT" ? {} : { field_key: f?.field_key || "" }),
      });
    } else if (op === "IF")
      change({operation:"IF",condition:null,then:source(available[0],row),else:{source:"CONSTANT",value:"0"}});
    else
      change({
        operation: op,
        operands: (op === "ROUND" ? [
          source(available[0], row),
        ] : [
          source(available[0], row),
          { source: "CONSTANT", value: "1" },
        ]),
        ...(op === "ROUND" ? {precision:2,rounding:"HALF_UP"} : {}),
      });
  }
  return (
    <fieldset className="condition-editor formula-editor">
      <legend>Формула</legend>
      <label>
        Операция
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          {Object.entries(CALC_OPS)
            .filter(
              ([k]) => !row || !["SUM", "COUNT", "MIN", "MAX"].includes(k),
            )
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v as string}
              </option>
            ))}
        </select>
      </label>
      {operation === "IF" ? (
        <>
          <ConditionEditor title="Условие выбора" value={value.condition} fields={fields} change={(condition:any)=>change({...value,condition})}/>
          <div className="condition-row"><FormulaOperand value={value.then} fields={available} row={row} change={(then:any)=>change({...value,then})}/><FormulaOperand value={value.else} fields={available} row={row} change={(otherwise:any)=>change({...value,else:otherwise})}/></div>
        </>
      ) : aggregate ? (
        <>
          <label>
            Повторяемая группа
            <select
              value={value.group_key || ""}
              onChange={(e) => {
                let g = groups.find((x: any) => x.group_key === e.target.value),
                  f = numeric(g?.fields || [])[0];
                change({
                  ...value,
                  group_key: e.target.value,
                  field_key: f?.field_key || "",
                });
              }}
            >
              {groups.map((g: any) => (
                <option key={g.id} value={g.group_key}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {operation !== "COUNT" && (
            <label>
              Числовое поле
              <select
                value={value.field_key || ""}
                onChange={(e) =>
                  change({ ...value, field_key: e.target.value })
                }
              >
                {numeric(
                  groups.find((g: any) => g.group_key === value.group_key)
                    ?.fields || [],
                ).map((f: any) => (
                  <option key={f.id} value={f.field_key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      ) : (
        <div className="condition-row">
          {Array.from({length:operation === "ROUND" ? 1 : 2},(_,index) => (
            <FormulaOperand
              key={index}
              value={value.operands?.[index]}
              fields={available}
              row={row}
              change={(next: any) => {
                let operands = [...(value.operands || [])];
                operands[index] = next;
                change({ ...value, operands });
              }}
            />
          ))}
          {operation === "ROUND"&&<label>Знаков после запятой<input type="number" min="0" max="12" value={value.precision??2} onChange={e=>change({...value,precision:Number(e.target.value)})}/></label>}
        </div>
      )}
      <FormulaTester expression={value} fields={available} groups={groups} row={row} />
    </fieldset>
  );
}
function FormulaTester({ expression, fields, groups, row }: any) {
  const [samples, setSamples] = useState<Record<string, string>>({}),
    [aggregateRows, setAggregateRows] = useState("100, 200");
  const refs = new Set<string>();
  function collect(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.field_key && ["FIELD", "CALCULATED", "ROW_FIELD", "ROW_CALCULATED"].includes(node.source)) refs.add(node.field_key);
    (node.operands || []).forEach(collect);
    collect(node.then); collect(node.else);
    if (node.condition?.field_key) refs.add(node.condition.field_key);
  }
  collect(expression);
  const referenced = fields.filter((field: any) => refs.has(field.field_key));
  let result: string | number = "—";
  try {
    const values: any = {}, rowValues: any = {};
    for (const field of referenced) {
      const value = Number(String(samples[field.field_key] ?? "100").replace(",", "."));
      values[field.field_key] = value;
      rowValues[field.field_key] = value;
    }
    const groupValues: any = {};
    if (["SUM", "COUNT", "MIN", "MAX"].includes(expression?.operation)) {
      groupValues[expression.group_key] = aggregateRows.split(",").map((item) => ({ [expression.field_key]: Number(item.trim().replace(",", ".")) }));
    }
    result = evaluateExpression(expression, values, groupValues, row ? rowValues : undefined);
  } catch (error: any) { result = error.message || "Формула не готова"; }
  return <details className="formula-tester"><summary>Проверить на своих значениях</summary><div>
    {referenced.map((field: any) => <label key={field.id}>{field.label}<input type="number" step="any" value={samples[field.field_key] ?? "100"} onChange={(event) => setSamples({ ...samples, [field.field_key]: event.target.value })}/></label>)}
    {["SUM", "COUNT", "MIN", "MAX"].includes(expression?.operation) && <label>Значения строк через запятую<input value={aggregateRows} onChange={(event) => setAggregateRows(event.target.value)}/></label>}
    <output>Результат проверки: <b>{String(result)}</b></output>
  </div></details>;
}
function FormulaOperand({ value, fields, row, change }: any) {
  let constant = value?.source === "CONSTANT";
  return (
    <label>
      {constant ? "Число" : "Поле"}
      <select
        value={constant ? "__constant" : value?.field_key || ""}
        onChange={(e) =>
          change(
            e.target.value === "__constant"
              ? { source: "CONSTANT", value: "0" }
              : source(
                  fields.find((f: any) => f.field_key === e.target.value),
                  row,
                ),
          )
        }
      >
        {fields.map((f: any) => (
          <option key={f.id} value={f.field_key}>
            {f.label}
          </option>
        ))}
        <option value="__constant">Числовая константа</option>
      </select>
      {constant && (
        <input
          type="number"
          step="any"
          value={value.value ?? "0"}
          onChange={(e) => change({ ...value, value: e.target.value })}
        />
      )}
    </label>
  );
}
function Empty({ upload = false }: { upload?: boolean }) {
  return (
    <section className="platform-empty">
      <FileText />
      <h2>{upload ? "Загрузите исходный DOCX" : "Выберите шаблон"}</h2>
      <p>
        {upload
          ? "Оригинал сохранится неизменяемым."
          : "Здесь появятся версии и настройки анкеты."}
      </p>
    </section>
  );
}
function paint(
  text: string,
  items: any[],
  fields: any[],
  conditional: any[] = [],
  onBindingSelect?: (binding: any) => void,
) {
  const ranges = [
    ...items.map((b) => ({
      start: b.locator.text_start,
      end: b.locator.text_end,
      kind: "binding",
      binding: b,
      title: fields.find((x) => x.id === b.field_id)?.label || "Привязка",
    })),
    ...conditional.map((r) => ({
      start: r.locator.text_start,
      end: r.locator.text_end,
      kind: "conditional",
      binding: null,
      title: `Условная область: ${r.region_key}`,
    })),
  ];
  if (!ranges.length) return text;
  const points = [
    ...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])]),
  ].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    let end = points[index + 1],
      active = ranges.filter((r) => r.start <= start && r.end >= end),
      value = text.slice(start, end);
    if (!active.length) return value;
    return (
      <mark
        key={`${start}-${end}`}
        className={
          active.some((r) => r.kind === "conditional") ? "conditional-run" : ""
        }
        title={active.map((r) => r.title).join(" · ")}
        role={active.some((r) => r.binding) ? "button" : undefined}
        tabIndex={active.some((r) => r.binding) ? 0 : undefined}
        onClick={() => { const binding = active.find((r) => r.binding)?.binding; if (binding) onBindingSelect?.(binding); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { const binding = active.find((r) => r.binding)?.binding; if (binding) { event.preventDefault(); onBindingSelect?.(binding); } } }}
      >
        {value}
      </mark>
    );
  });
}
