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
} from "lucide-react";
import { evaluateExpression } from "./calculations";
import { ProductAdmin } from "./ProductAdmin";
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
  visible_when: null,
  required_when: null,
  text_expression: null,
  item_config: { min_items: 0, max_items: 20, max_length: 500 },
  components: [],
  separator: "; ",
});
const parseOptionText = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
export function TemplateAdmin({ api }: { api: Api }) {
  const [section, setSection] = useState<"templates" | "products">("templates");
  return <TemplateBuilder api={api} />;
}
function TemplateBuilder({ api }: { api: Api }) {
  const inspectorRef = useRef<HTMLElement | null>(null);
  const [templates, setTemplates] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [versions, setVersions] = useState<any[]>([]),
    [version, setVersion] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [schema, setSchema] = useState<any>(),
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
    [groupDraft, setGroupDraft] = useState<any>(),
    [groupField, setGroupField] = useState<any>(),
    [blockStart, setBlockStart] = useState<string>(),
    [repeatBlockStart, setRepeatBlockStart] = useState<string>(),
    [field, setField] = useState<any>(blank()),
    [fieldOptionsText, setFieldOptionsText] = useState(""),
    [groupFieldOptionsText, setGroupFieldOptionsText] = useState(""),
    [editing, setEditing] = useState<string>(),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [category, setCategory] = useState("Другое"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(1),
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
    setVersion(null);
    setPreview(null);
    setSchema(null);
    setBindings([]);
    setStage(1);
    setVersions(await api(`/document-templates/${x.id}/versions`));
  }
  async function openVersion(x: any) {
    setVersion(x);
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
  function selectRange() {
    if (version?.status !== "DRAFT") return;
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
    if (!a || a !== z) {
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
  }
  async function saveField(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      let path = `/document-templates/${selected.id}/versions/${version.id}/fields${editing ? "/" + editing : ""}`;
      const payload = field.field_type === "SINGLE_SELECT"
        ? { ...field, options: parseOptionText(fieldOptionsText) }
        : field;
      const saved = await api(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await openVersion(version);
      setFieldOptionsText((payload.options || []).join(", "));
      setField(payload);
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
      visible_when: x.config.visible_when || null,
      required_when: x.config.required_when || null,
    });
    setFieldOptionsText((x.config.options || []).join(", "));
  }
  function newField() {
    setSelectionDraft(selection || null);
    setSelection(null);
    setActiveBinding(null);
    setRegionDraft(null);
    setGroupDraft(null);
    setGroupField(null);
    setStage(4);
    setEditing(undefined);
    setField({ ...blank((schema?.fields?.length || 0) + 1), field_key: `question_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` });
    setFieldOptionsText("");
    setShowFieldEditor(true);
  }
  async function removeField(id: string) {
    await run(async () => {
      await api(
        `/document-templates/${selected.id}/versions/${version.id}/fields/${id}`,
        { method: "DELETE" },
      );
      await openVersion(version);
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
    setRegionDraft({
      region_key: "",
      region_type,
      start_locator,
      end_locator: start_locator === end_locator ? undefined : end_locator,
      include_when: null,
    });
  }
  function chooseBlock(locator: string) {
    if (!blockStart) {
      setBlockStart(locator);
      setNotice("Начало блока отмечено. Теперь выберите его конец.");
    } else {
      draftRegion("CONDITIONAL_PARAGRAPH_GROUP", blockStart, locator);
      setBlockStart(undefined);
      setNotice("Границы блока выбраны. Настройте правило включения.");
    }
  }
  async function saveRegion() {
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

  async function publish() {
    await run(async () => {
      let x = await api(
        `/document-templates/${selected.id}/versions/${version.id}/publish`,
        { method: "POST" },
      );
      await openVersion(x);
      await load();
      setNotice("Версия опубликована и доступна сотрудникам.");
    });
  }
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
          <form className="template-create" onSubmit={create}>
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
          <section className="template-list">
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
              <header className="template-title">
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
                {version?.status === "PUBLISHED" && (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={cloneVersion}
                  >
                    <Plus size={16} />
                    Создать новую версию
                  </button>
                )}
                <label className="secondary upload-version">
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
              <nav className="builder-stages" aria-label="Этапы настройки шаблона">
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
                <section className="version-list">
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
                <section className="docx-preview">
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
                      <div className="builder-grid">
                        <aside className="document-outline" aria-label="Навигация по шаблону">
                          <div className="workspace-tabs" role="tablist" aria-label="Навигация">
                            <button role="tab" aria-selected={workspaceTab === "questions"} className={workspaceTab === "questions" ? "active" : ""} onClick={() => setWorkspaceTab("questions")}>Вопросы</button>
                            <button role="tab" aria-selected={workspaceTab === "structure"} className={workspaceTab === "structure" ? "active" : ""} onClick={() => setWorkspaceTab("structure")}>Word</button>
                          </div>
                          {workspaceTab === "questions" ? <>
                            <div className="workspace-panel-heading"><h3>Вопросы анкеты</h3><span>{schema?.fields?.length || 0}</span></div>
                            <label className="workspace-search"><Search size={14}/><input value={questionQuery} onChange={(event) => setQuestionQuery(event.target.value)} placeholder="Найти вопрос" aria-label="Найти вопрос"/></label>
                            {version.status === "DRAFT" && <button className="workspace-add" type="button" onClick={newField}><Plus size={15}/>Добавить вопрос</button>}
                            <nav className="workspace-question-list" aria-label="Список вопросов">
                              {(schema?.fields || []).filter((item:any) => `${item.label} ${item.field_key} ${item.group}`.toLowerCase().includes(questionQuery.toLowerCase())).map((item:any) => <button key={item.id} type="button" className={editing === item.id && showFieldEditor ? "active" : ""} onClick={() => editField(item)}><span>{item.group || "Основные сведения"}</span><b>{item.label}</b><small>{TYPES[item.field_type]} · {bindings.filter((binding:any) => binding.field_id === item.id).length} привязок</small><em className={bindings.some((binding:any) => binding.field_id === item.id) ? "linked" : "unlinked"}>{bindings.some((binding:any) => binding.field_id === item.id) ? "Привязан" : "Без привязки"}</em><ChevronRight size={14}/></button>)}
                              {schema?.fields?.length === 0 && <p className="workspace-empty">Вопросов пока нет. Добавьте первый вопрос или выделите текст в документе.</p>}
                              {schema?.fields?.length > 0 && !(schema.fields as any[]).some((item:any) => `${item.label} ${item.field_key} ${item.group}`.toLowerCase().includes(questionQuery.toLowerCase())) && <p className="workspace-empty">По запросу ничего не найдено.</p>}
                            </nav>
                          </> : <>
                            <div className="workspace-panel-heading"><h3>Структура Word</h3><span>{preview.nodes.length}</span></div>
                            <label className="workspace-search"><Search size={14}/><input value={docQuery} onChange={(event) => setDocQuery(event.target.value)} placeholder="Найти фрагмент" aria-label="Найти фрагмент"/></label>
                            <nav className="workspace-structure-list" aria-label="Структура документа">{visibleStructureItems.map((item: any) => <button key={item.locator} type="button" onClick={() => document.querySelector(`[data-locator="${CSS.escape(item.locator)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"})} title={item.description}><span>{item.kind === "table_cell" ? "Ячейка" : "Абзац"} {item.number}</span><b>{item.description}</b></button>)}{visibleStructureItems.length === 0 && <p className="workspace-empty">Фрагменты не найдены.</p>}</nav>
                          </>}
                        </aside>
                        <section className="document-canvas">
                          <div className="workspace-canvas-toolbar"><div><b>Исходный документ</b><span>Выделите фрагмент для настройки привязки или условия</span></div><label>Масштаб <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Масштаб документа"><option value={75}>75%</option><option value={90}>90%</option><option value={100}>100%</option><option value={110}>110%</option><option value={125}>125%</option></select></label></div>
                          {bindingCandidates.length > 0 && (
                            <details className="selection-card binding-candidate-review" aria-label="Кандидаты структурной разметки">
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
                                    <button type="button" className="back-link" onClick={() => document.querySelector(`[data-locator="${CSS.escape(candidate.locator || "")}"]`)?.scrollIntoView({behavior:"smooth", block:"center"})}>{candidate.rf_id} · {candidate.matrix_location}</button>
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
                          </div>
                          <article
                            className="docx-page"
                            onMouseUp={selectRange}
                            style={{ zoom: `${zoom}%` }}
                          >
                            {preview.nodes.map((node: any) => (
                              <div
                                key={node.locator}
                                tabIndex={0}
                                className={`preview-node ${regions.some((r) => regionHasNode(r, node.locator)) ? "conditional-area" : ""} ${repeatingGroups.some((g: any) => repeatingHasNode(g, node.locator)) ? "repeating-area" : ""}`}
                              >
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
                                        draftRegion(
                                          "CONDITIONAL_PARAGRAPH",
                                          node.locator,
                                        )
                                      }
                                    >
                                      Абзац
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => chooseBlock(node.locator)}
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
                                            draftRegion(
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
                                            draftRegion(
                                              "CONDITIONAL_TABLE",
                                              node.locator,
                                            )
                                          }
                                        >
                                          Таблица
                                        </button>
                                        <button type="button" onClick={() => draftRegion("CONDITIONAL_TABLE_COLUMN", node.locator)}>Колонка</button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            draftRepeatingGroup(node.locator)
                                          }
                                        >
                                          Сделать строку повторяемой
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => chooseRepeatingBlock(node.locator)}
                                        >
                                          {repeatBlockStart ? "Завершить блок строк" : "Начать блок строк"}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </article>
                          {selection && <InspectorPortal>
                            <section className="selection-card selection-card-floating" aria-label="Настройка выбранного фрагмента">
                              <Link2 />
                              <div>
                                <h3>Выбранный фрагмент</h3>
                                <blockquote>
                                  {selection.selected_text || "Пустая ячейка"}
                                </blockquote>
                                <label>
                                  Вопрос анкеты
                                  <select
                                    value={selection.field_id}
                                    onChange={(e) =>
                                      setSelection({
                                        ...selection,
                                        field_id: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Выберите вопрос</option>
                                    {schema?.fields.map((x: any) => (
                                      <option key={x.id} value={x.id}>
                                        {x.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
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
                                    <option value="PERCENT">Процент</option>
                                  </select>
                                </label>
                                {!selection.field_id && (
                                  <p className="selection-help">
                                    Выберите существующий вопрос или создайте новый для этого фрагмента.
                                  </p>
                                )}
                                {version.status === "DRAFT" && <button className="secondary" type="button" onClick={newField}><Plus size={15}/>Создать новый вопрос</button>}
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
                                    { setRegionDraft({
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
                              <ConditionEditor
                                title="Включать область, когда"
                                value={regionDraft.include_when}
                                fields={schema?.fields || []}
                                change={(value: any) =>
                                  setRegionDraft({
                                    ...regionDraft,
                                    include_when: value,
                                  })
                                }
                              />
                              <div>
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={
                                    busy ||
                                    !regionDraft.region_key ||
                                    !regionDraft.include_when
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
                                    busy ||
                                    !groupDraft.name ||
                                    !groupDraft.group_key ||
                                    groupDraft.max_items < groupDraft.min_items
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
                        <aside ref={inspectorRef} className={`questionnaire-builder builder-stage-${stage} ${(selection || activeBinding || regionDraft || groupDraft) ? "has-context" : ""}`} aria-label="Панель настройки">
                          <div className="workspace-inspector-header"><span>Панель настройки</span><b>{activeBinding ? "Настроенная привязка" : selection ? "Привязка фрагмента" : regionDraft ? "Условная область" : groupDraft ? "Повторяемая группа" : showFieldEditor ? editing ? "Редактирование вопроса" : "Новый вопрос" : stage === 5 ? "Условия и таблицы" : stage === 3 ? "Привязки к Word" : "Настройка шаблона"}</b></div>
                          <div id="workspace-context-inspector" />
                          {activeBinding && <section className="workspace-active-binding"><p>Вопрос: <b>{schema?.fields.find((item:any) => item.id === activeBinding.field_id)?.label || "Без вопроса"}</b></p><blockquote>{activeBinding.selected_text}</blockquote><label>Формат вывода<select disabled={version.status !== "DRAFT" || busy} value={activeBinding.format_config?.format || "RAW"} onChange={(event) => changeBindingFormat(activeBinding, event.target.value)}>{Object.entries(OUTPUT_FORMATS).map(([key, label]) => <option key={key} value={key}>{label as string}</option>)}</select></label><div><button type="button" className="secondary" onClick={() => setActiveBinding(null)}>Закрыть</button>{version.status === "DRAFT" && <button type="button" className="secondary" disabled={busy} onClick={() => unbind(activeBinding.id)}>Удалить привязку</button>}</div></section>}
                          {(stage === 3 || stage === 5) && !selection && !activeBinding && !regionDraft && !groupDraft && <p className="workspace-inspector-tip">Создайте вопрос анкеты или выделите фрагмент Word для привязки. Для условий и таблиц используйте действия у фрагментов документа.</p>}
                          {stage <= 2 && <div className="stage-guidance"><h3>{stage === 1 ? "Общие сведения" : "Исходный документ"}</h3><p>{stage === 1 ? "Проверьте название, категорию и статус версии." : "Читайте документ, используйте структуру слева и выделяйте нужный текст."}</p></div>}
                          <h3 className="panel-questionnaire">Вопросы анкеты</h3>
                          {version.status === "DRAFT" && showFieldEditor && !selection && !activeBinding && !regionDraft && !groupDraft && (
                            <form className="field-editor" onSubmit={saveField}>
                              <label>
                                Раздел
                                <input
                                  value={field.group}
                                  onChange={(e) =>
                                    setField({
                                      ...field,
                                      group: e.target.value,
                                    })
                                  }
                                />
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
                              {field.field_type === "SINGLE_SELECT" && (
                                <label>
                                  Варианты через запятую
                                  <input
                                    value={fieldOptionsText}
                                    onChange={(e) => setFieldOptionsText(e.target.value)}
                                  />
                                </label>
                              )}
                              {field.field_type === "LIST" && <div className="repeat-limits"><label>Минимум элементов<input type="number" min="0" max="100" value={field.item_config?.min_items ?? 0} onChange={e=>setField({...field,item_config:{...field.item_config,min_items:Number(e.target.value)}})}/></label><label>Максимум элементов<input type="number" min="1" max="100" value={field.item_config?.max_items ?? 20} onChange={e=>setField({...field,item_config:{...field.item_config,max_items:Number(e.target.value)}})}/></label><label>Разделитель в DOCX<input value={field.separator} onChange={e=>setField({...field,separator:e.target.value})}/></label></div>}
                              {field.field_type === "COMPOSITE" && <CompositeEditor components={field.components || []} change={(components:any)=>setField({...field,components})}/>}
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
                                change={(value: any) =>
                                  setField({ ...field, required_when: value })
                                }
                              />
                              {editing && <div className="workspace-linked-fragments"><b>Связанные фрагменты · {bindings.filter((item:any) => item.field_id === editing).length}</b>{bindings.filter((item:any) => item.field_id === editing).map((item:any) => <button key={item.id} type="button" className="secondary" onClick={() => { setActiveBinding(item); setStage(3); document.querySelector(`[data-locator="${CSS.escape(item.locator.node)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}); }}>{item.selected_text || "Фрагмент Word"}</button>)}</div>}
                              <button className="primary" disabled={busy}>
                                {editing
                                  ? "Сохранить изменения"
                                  : "Добавить вопрос"}
                              </button>
                              <button type="button" className="secondary" onClick={() => { setShowFieldEditor(false); setEditing(undefined); if (selectionDraft) { setSelection(selectionDraft); setSelectionDraft(null); setStage(3); } }}>Отмена</button>
                            </form>
                          )}
                          {stage === 4 && !showFieldEditor && !selection && !regionDraft && !groupDraft && <div className="workspace-inspector-empty"><FileText size={26}/><h3>Выберите вопрос</h3><p>Откройте вопрос слева, чтобы изменить его настройки, или добавьте новый.</p>{version.status === "DRAFT" && <button type="button" className="secondary" onClick={newField}><Plus size={15}/>Добавить вопрос</button>}</div>}
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
                                      onClick={() => removeField(x.id)}
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
                                      {Object.entries(OUTPUT_FORMATS).map(([key, label]) => <option key={key} value={key}>{label as string}</option>)}
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
                                  <small>{REGION_LABELS[r.region_type]}</small>
                                </span>
                                {version.status === "DRAFT" && (
                                  <span>
                                    <button
                                      aria-label="Изменить условную область"
                                      onClick={() => setRegionDraft({ ...r })}
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

function TestDriveField({field,value,change}:any){
  if(field.field_type==="BOOLEAN")return <label>{field.label}<select value={String(value??"")} onChange={e=>change(e.target.value===""?null:e.target.value==="true")}><option value="">Не выбрано</option><option value="true">Да</option><option value="false">Нет</option></select></label>;
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
  CONDITIONAL_PARAGRAPH_GROUP: "Блок соседних абзацев",
  CONDITIONAL_TABLE_ROW: "Строка таблицы",
  CONDITIONAL_TABLE: "Таблица",
  CONDITIONAL_TABLE_COLUMN: "Колонка таблицы",
};

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
    return loc.nodes.includes(node);
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
const rowFrom = (x: any) => {
  let neg = x?.operator === "NOT",
    n = neg ? x.condition : x;
  return {
    field_key: n?.field_key || "",
    operator: n?.operator || "EQUALS",
    value: Array.isArray(n?.value) ? n.value.join(", ") : (n?.value ?? ""),
    negated: neg,
  };
};
const rowsFrom = (value: any) =>
  !value
    ? []
    : (value.operator === "AND" || value.operator === "OR"
        ? value.conditions
        : [value]
      ).map(rowFrom);
export function ConditionEditor({ title, value, fields, change }: any) {
  const rows = rowsFrom(value),
    join = value?.operator === "OR" ? "OR" : "AND";
  function emit(next: any[], group = join) {
    if (!next.length) return change(null);
    let nodes = next.map((r) => {
      let source = fields.find((f: any) => f.field_key === r.field_key),
        raw: any = r.value;
      if (["INTEGER"].includes(source?.field_type))
        raw = Number.parseInt(raw, 10);
      else if (["DECIMAL", "MONEY"].includes(source?.field_type))
        raw = Number(raw);
      else if (source?.field_type === "BOOLEAN") raw = raw === "true";
      if (["IN", "NOT_IN"].includes(r.operator))
        raw = String(r.value)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) =>
            ["INTEGER", "DECIMAL", "MONEY"].includes(source?.field_type)
              ? Number(x)
              : source?.field_type === "BOOLEAN"
                ? x === "true"
                : x,
          );
      let node: any = { operator: r.operator, field_key: r.field_key };
      if (!["IS_EMPTY", "IS_NOT_EMPTY"].includes(r.operator)) node.value = raw;
      return r.negated ? { operator: "NOT", condition: node } : node;
    });
    change(
      nodes.length === 1 ? nodes[0] : { operator: group, conditions: nodes },
    );
  }
  return (
    <fieldset className="condition-editor">
      <legend>
        <GitBranch size={14} />
        {title}
      </legend>
      {!rows.length ? (
        <button
          type="button"
          className="condition-add"
          onClick={() =>
            emit([
              {
                field_key: fields[0]?.field_key || "",
                operator: "EQUALS",
                value: "",
                negated: false,
              },
            ])
          }
          disabled={!fields.length}
        >
          <Plus size={14} />
          Добавить условие
        </button>
      ) : (
        <>
          <label>
            Объединение
            <select
              value={join}
              onChange={(e) => emit(rows, e.target.value)}
              disabled={rows.length < 2}
            >
              <option value="AND">Все условия (И)</option>
              <option value="OR">Любое условие (ИЛИ)</option>
            </select>
          </label>
          {rows.map((row: any, index: number) => (
            <ConditionRow
              key={index}
              row={row}
              fields={fields}
              change={(next: any) => {
                let copy = [...rows];
                copy[index] = next;
                emit(copy);
              }}
              remove={() =>
                emit(rows.filter((_: any, i: number) => i !== index))
              }
            />
          ))}
          <button
            type="button"
            className="condition-add"
            onClick={() =>
              emit([
                ...rows,
                {
                  field_key: fields[0]?.field_key || "",
                  operator: "EQUALS",
                  value: "",
                  negated: false,
                },
              ])
            }
          >
            <Plus size={14} />
            Добавить условие
          </button>
        </>
      )}
    </fieldset>
  );
}
function ConditionRow({ row, fields, change, remove }: any) {
  let source = fields.find((x: any) => x.field_key === row.field_key),
    ordered = ["INTEGER", "DECIMAL", "MONEY", "DATE"].includes(
      source?.field_type,
    ),
    ops = Object.entries(OPS).filter(
      ([k]) =>
        ordered ||
        ![
          "GREATER_THAN",
          "LESS_THAN",
          "GREATER_OR_EQUAL",
          "LESS_OR_EQUAL",
        ].includes(k),
    ),
    noValue = ["IS_EMPTY", "IS_NOT_EMPTY"].includes(row.operator);
  return (
    <div className="condition-row">
      <label>
        Поле
        <select
          required
          value={row.field_key}
          onChange={(e) =>
            change({ ...row, field_key: e.target.value, value: "" })
          }
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
          onChange={(e) => change({ ...row, operator: e.target.value })}
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
          {source?.field_type === "SINGLE_SELECT" ? (
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
              value={String(row.value)}
              onChange={(e) => change({ ...row, value: e.target.value })}
            >
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
              value={row.value}
              onChange={(e) => change({ ...row, value: e.target.value })}
              placeholder={
                ["IN", "NOT_IN"].includes(row.operator)
                  ? "Значения через запятую"
                  : ""
              }
            />
          )}
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={row.negated}
          onChange={(e) => change({ ...row, negated: e.target.checked })}
        />
        Отрицание (НЕ)
      </label>
      <button
        type="button"
        className="condition-remove"
        aria-label="Удалить условие"
        onClick={remove}
      >
        <Trash2 size={14} />
      </button>
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
